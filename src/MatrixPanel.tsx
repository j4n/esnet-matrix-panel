import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dateTime, PanelProps, DataQueryRequest, DataQuery, DataSourceApi } from '@grafana/data';
import { getDataSourceSrv } from '@grafana/runtime';
import { useTheme2, useStyles2, CustomScrollbar } from '@grafana/ui';
import { AnimationFrames, MatrixOptions } from './types';
import { parseData } from './dataParser';
import { createViz, updateViz } from './createViz';
import { getStyles } from './tooltip';
import { findTimeField, groupBySourceTarget, aggregateTimeSeries, buildSyntheticPanelData, sliceTimeSeries } from './timeSeriesProcessor';
import { PlaybackControls } from './PlaybackControls';

type TimeMode = 'last' | 'aggregate' | 'stepping' | 'animate';

/** Parse interval strings like '15m', '3h', '7d' into milliseconds. */
function intervalToMs(interval: string): number {
  const match = interval.match(/^(\d+)([mhd])$/);
  if (!match) {
    return 3600000;
  }
  const n = parseInt(match[1], 10);
  switch (match[2]) {
    case 'm': return n * 60 * 1000;
    case 'h': return n * 3600 * 1000;
    case 'd': return n * 86400 * 1000;
    default: return 3600000;
  }
}

const CONTROLS_HEIGHT = 40;
const MAX_ANIMATION_FRAMES = 120;

export const MatrixPanel: React.FC<PanelProps<MatrixOptions>> = ({
  options, data, width, height, id, timeRange, onChangeTimeRange,
}) => {
  const theme = useTheme2();
  const styles = useStyles2(getStyles);
  const ref = useRef<HTMLDivElement>(null);

  // Interactive mode state -- initialized from panel option
  const [activeMode, setActiveMode] = useState<TimeMode>(options.timeMode);

  // Animation state
  const [animPlaying, setAnimPlaying] = useState(false);
  const [animIndex, setAnimIndex] = useState(0);
  const [animSpeed, setAnimSpeed] = useState(options.animationSpeedMs || 1000);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const animInitRef = useRef(false);

  // Lazy fetch state for animate mode
  const [lazyLoading, setLazyLoading] = useState(false);
  const [lazyFrames, setLazyFrames] = useState<AnimationFrames | null>(null);
  // Cache key: tracks what data request + range was used for the cached frames
  const lazyCacheKeyRef = useRef<string>('');

  const showBar = activeMode !== 'last' && activeMode !== 'aggregate';

  // Build animation frames from DataFrame[] (used by both inline and lazy-fetched data)
  const buildAnimFrames = useCallback((series: any): AnimationFrames | null => {
    const frame = series[0];
    if (!frame) {
      return null;
    }
    const timeField = findTimeField(frame);
    if (!timeField) {
      return null;
    }
    const groups = groupBySourceTarget(
      frame, options.sourceField, options.targetField, options.valueField,
    );
    if (groups.size === 0) {
      return null;
    }
    const slices = sliceTimeSeries(groups);
    if (slices.length === 0) {
      return null;
    }

    // Build the first frame's full ParsedData for initial createViz
    const firstSlice = slices[0];
    const firstRows: Array<{ source: string; target: string; value: number }> = [];
    for (const [key, value] of firstSlice.values.entries()) {
      const [source, target] = key.split('|');
      firstRows.push({ source, target, value });
    }
    const firstSynthetic = buildSyntheticPanelData(firstRows, data, options);
    const baseData = parseData(firstSynthetic, options, theme);

    if (!baseData.data || typeof baseData.data === 'string' || !baseData.rows || !baseData.columns) {
      return null;
    }

    // Get the color mapping function from the original value field
    const nullColor = theme.visualization.getColorByName(options.nullColor);
    const defaultColor = theme.visualization.getColorByName(options.defaultColor);
    const originalValueField = frame.fields.find((f: any) => f.type === 'number');
    const displayFn = originalValueField?.display;

    function colorFor(v: number | undefined): string {
      if (v === undefined || v === null) {
        return nullColor;
      }
      if (displayFn) {
        return displayFn(v).color ?? defaultColor;
      }
      return defaultColor;
    }

    const rowNames = baseData.rows;
    const colNames = baseData.columns;
    const labels: string[] = [];
    const colors: string[][] = [];

    for (const slice of slices) {
      labels.push(slice.label);
      const frameColors: string[] = [];
      for (const rowName of rowNames) {
        for (const colName of colNames) {
          const key = `${rowName}|${colName}`;
          const val = slice.values.get(key);
          frameColors.push(colorFor(val));
        }
      }
      colors.push(frameColors);
    }

    return { labels, colors, baseData };
  }, [data, options, theme]);

  // Pre-compute animation frames from inline panel data (when timeMode is 'animate')
  const inlineAnimFrames: AnimationFrames | null = useMemo(() => {
    if (options.timeMode !== 'animate') {
      return null;
    }
    return buildAnimFrames(data.series);
  }, [data, options.timeMode, buildAnimFrames]);

  // Determine which animation frames to use: lazy-fetched or inline
  const animFrames = activeMode === 'animate' ? (lazyFrames ?? inlineAnimFrames) : null;

  // Reset animation when frames change
  useEffect(() => {
    setAnimIndex(0);
    setAnimPlaying(false);
    animInitRef.current = false;
  }, [animFrames]);

  // Lazy fetch when switching to animate mode interactively
  useEffect(() => {
    if (activeMode !== 'animate') {
      return;
    }

    // If we already have inline frames from panel data (timeMode was already 'animate'), use those
    if (inlineAnimFrames) {
      return;
    }

    // Build cache key from datasource uid + targets + animation range
    const request = data.request;
    const dsUid = request?.targets?.[0]?.datasource?.uid ?? '';
    const targetKeys = (request?.targets ?? []).map((t: any) => JSON.stringify(t)).join('|');
    const range = options.animationRange || '3h';
    const cacheKey = `${dsUid}|${targetKeys}|${range}`;

    // Skip if we already have cached frames for this exact request
    if (lazyFrames && lazyCacheKeyRef.current === cacheKey) {
      return;
    }

    if (!dsUid || !request?.targets?.length) {
      return;
    }

    setLazyLoading(true);

    (async () => {
      try {
        const ds: DataSourceApi = await getDataSourceSrv().get({ uid: dsUid });
        const rangeMs = intervalToMs(range);
        const to = Date.now();
        const from = to - rangeMs;

        const queryRequest: DataQueryRequest<DataQuery> = {
          requestId: `matrix-lazy-${id}-${Date.now()}`,
          interval: `${Math.floor(rangeMs / MAX_ANIMATION_FRAMES / 1000)}s`,
          intervalMs: Math.floor(rangeMs / MAX_ANIMATION_FRAMES),
          maxDataPoints: MAX_ANIMATION_FRAMES,
          range: {
            from: dateTime(from),
            to: dateTime(to),
            raw: { from: `now-${range}`, to: 'now' },
          },
          scopedVars: request.scopedVars ?? {},
          targets: request.targets,
          timezone: request.timezone ?? 'browser',
          app: 'panel-editor',
          startTime: Date.now(),
        };

        const response = await new Promise<any>((resolve, reject) => {
          const sub = ds.query(queryRequest).subscribe({
            next: (res: any) => resolve(res),
            error: (err: any) => reject(err),
            complete: () => {},
          });
          // Timeout after 30s
          setTimeout(() => {
            sub.unsubscribe();
            reject(new Error('Lazy fetch timeout'));
          }, 30000);
        });

        if (response?.data?.length > 0) {
          const frames = buildAnimFrames(response.data);
          if (frames) {
            lazyCacheKeyRef.current = cacheKey;
            setLazyFrames(frames);
            setLazyLoading(false);
            return;
          }
        }

        // Fallback: no usable data from lazy fetch
        setLazyLoading(false);
      } catch (err) {
        console.warn('[matrix] lazy fetch failed, falling back to panel data:', err);
        setLazyLoading(false);
      }
    })();
  }, [activeMode, data.request, options.animationRange, inlineAnimFrames, id, buildAnimFrames, lazyFrames]);

  // Invalidate lazy cache when Grafana time range changes (user changed dashboard time)
  const timeRangeKey = `${timeRange.from.valueOf()}-${timeRange.to.valueOf()}`;
  const prevTimeRangeRef = useRef(timeRangeKey);
  useEffect(() => {
    if (prevTimeRangeRef.current !== timeRangeKey) {
      prevTimeRangeRef.current = timeRangeKey;
      lazyCacheKeyRef.current = '';
      setLazyFrames(null);
    }
  }, [timeRangeKey]);

  // Animation timer
  useEffect(() => {
    if (animPlaying && animFrames && animFrames.colors.length > 0) {
      timerRef.current = setInterval(() => {
        setAnimIndex((prev) => {
          const next = prev + 1;
          if (next >= animFrames.colors.length) {
            setAnimPlaying(false);
            return prev;
          }
          return next;
        });
      }, animSpeed);
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [animPlaying, animSpeed, animFrames]);

  // Compute parsed data for non-animation modes
  const parsedData = useMemo(() => {
    if (activeMode === 'animate' && animFrames) {
      return animFrames.baseData;
    }

    // Aggregation mode
    if (activeMode === 'aggregate' && data.series[0] && findTimeField(data.series[0])) {
      const groups = groupBySourceTarget(
        data.series[0], options.sourceField, options.targetField, options.valueField,
      );
      if (groups.size > 0) {
        const aggregated = aggregateTimeSeries(groups, options.aggregation || 'mean');
        const syntheticData = buildSyntheticPanelData(aggregated, data, options);
        return parseData(syntheticData, options, theme);
      }
    }

    // Default: last value (also used by stepping mode)
    return parseData(data, options, theme);
  }, [data, options, theme, animFrames, activeMode]);

  // Initial render (createViz) -- runs once per data/layout change
  useEffect(() => {
    if (!ref.current || !parsedData.data || typeof parsedData.data === 'string') {
      return;
    }
    createViz(ref.current, id, width, parsedData, options, theme, styles);
    animInitRef.current = true;
  }, [id, width, parsedData, options, theme, styles]);

  // Animation frame update -- fast path, only updates fills
  useEffect(() => {
    if (activeMode !== 'animate' || !animFrames || !ref.current || !animInitRef.current) {
      return;
    }
    const frameIdx = Math.min(animIndex, animFrames.colors.length - 1);
    updateViz(ref.current, id, animFrames.colors[frameIdx]);
  }, [animIndex, animFrames, id, activeMode]);

  // Stepping callbacks
  const handleStepForward = useCallback(() => {
    const ms = intervalToMs(options.stepInterval || '60m');
    const now = Date.now();
    const newTo = Math.min(timeRange.to.valueOf() + ms, now);
    const newFrom = newTo - (timeRange.to.valueOf() - timeRange.from.valueOf());
    if (timeRange.to.valueOf() >= now) {
      return;
    }
    onChangeTimeRange({ from: newFrom, to: newTo });
  }, [options.stepInterval, timeRange, onChangeTimeRange]);

  const handleStepBackward = useCallback(() => {
    const ms = intervalToMs(options.stepInterval || '60m');
    const newFrom = timeRange.from.valueOf() - ms;
    const newTo = timeRange.to.valueOf() - ms;
    onChangeTimeRange({ from: newFrom, to: newTo });
  }, [options.stepInterval, timeRange, onChangeTimeRange]);

  // Format time label for stepping mode
  const timeLabel = useMemo(() => {
    const fmt = 'YYYY-MM-DD HH:mm';
    return `${dateTime(timeRange.from).format(fmt)} -- ${dateTime(timeRange.to).format(fmt)}`;
  }, [timeRange]);

  // Handle mode change
  const handleModeChange = useCallback((mode: TimeMode) => {
    if (mode === activeMode) {
      return;
    }
    // Stop animation when leaving animate mode
    if (activeMode === 'animate') {
      setAnimPlaying(false);
    }
    setActiveMode(mode);
  }, [activeMode]);

  // Error states
  if (typeof parsedData.data === 'string') {
    switch (parsedData.data) {
      case 'too many inputs':
        return <div>Too many data points! Try adding limits to your query.</div>;
      default:
        return <div>Unknown Error</div>;
    }
  }

  if (parsedData.data === null) {
    return <div>No Data</div>;
  }

  const matrixHeight = showBar ? height - CONTROLS_HEIGHT : height;
  const totalAnimFrames = animFrames?.colors.length ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <CustomScrollbar autoHeightMin={`${Math.max(matrixHeight, 100)}px`}>
          <div ref={ref} id={`matrix-panel-${id}`} style={{ width: '100%' }} />
        </CustomScrollbar>
      </div>
      {showBar && (
        <PlaybackControls
          activeMode={activeMode}
          onModeChange={handleModeChange}
          loading={lazyLoading}
          // Stepping props
          timeLabel={timeLabel}
          stepInterval={options.stepInterval || '60m'}
          onStepForward={handleStepForward}
          onStepBackward={handleStepBackward}
          onStepIntervalChange={() => {}}
          // Animation props
          totalFrames={totalAnimFrames}
          currentIndex={animIndex}
          frameLabel={animFrames?.labels[Math.min(animIndex, totalAnimFrames - 1)] ?? ''}
          playing={animPlaying}
          speed={animSpeed}
          onPlay={() => {
            if (animIndex >= totalAnimFrames - 1) {
              setAnimIndex(0);
            }
            setAnimPlaying(true);
          }}
          onPause={() => setAnimPlaying(false)}
          onSeek={(idx) => {
            setAnimIndex(idx);
            setAnimPlaying(false);
          }}
          onSpeedChange={(ms) => setAnimSpeed(ms)}
        />
      )}
    </div>
  );
};
