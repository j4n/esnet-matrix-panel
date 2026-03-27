import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dateTime, PanelProps, DataQueryRequest, DataQuery, DataSourceApi } from '@grafana/data';
import { getDataSourceSrv } from '@grafana/runtime';
import { useTheme2, useStyles2, CustomScrollbar } from '@grafana/ui';
import { AnimationFrames, MatrixOptions } from './types';
import { parseData } from './dataParser';
import { createViz, updateViz } from './createViz';
import { getStyles } from './tooltip';
import { findTimeField, groupBySourceTarget, buildSyntheticPanelData, sliceTimeSeries } from './timeSeriesProcessor';
import { PlaybackControls } from './PlaybackControls';

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

  // Sub-mode within timelapse bar
  const [activeSubMode, setActiveSubMode] = useState<'stepping' | 'animate'>('stepping');
  // Step interval: local state so the bar dropdown works without opening the options panel
  const [stepInterval, setStepInterval] = useState(options.stepInterval || '60m');

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

  const showBar = options.timeMode === 'timelapse';

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

  // Pre-compute animation frames from inline panel data when in timelapse mode
  const inlineAnimFrames: AnimationFrames | null = useMemo(() => {
    if (options.timeMode !== 'timelapse') {
      return null;
    }
    return buildAnimFrames(data.series);
  }, [data, options.timeMode, buildAnimFrames]);

  // Determine which animation frames to use: lazy-fetched or inline
  const animFrames = activeSubMode === 'animate' ? (lazyFrames ?? inlineAnimFrames) : null;

  // Reset animation when frames change
  useEffect(() => {
    setAnimIndex(0);
    setAnimPlaying(false);
    animInitRef.current = false;
  }, [animFrames]);

  // Lazy fetch when switching to animate sub-mode
  useEffect(() => {
    if (activeSubMode !== 'animate') {
      return;
    }

    // If panel data already has real temporal range (>1 frame), use it directly.
    // A single-frame result from an instant query must NOT suppress the range fetch.
    if (inlineAnimFrames && inlineAnimFrames.labels.length > 1) {
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
          targets: request.targets.map((t: any) => ({
            ...t,
            instant: false,
            range: true,
            // Rewrite $__range to $__interval so each frame averages one step,
            // not the full animation window (which would make all frames identical)
            expr: typeof t.expr === 'string'
              ? t.expr.replace(/\$__range/g, '$__interval')
              : t.expr,
          })),
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
        console.warn('[matrix] lazy fetch returned no usable frames (empty response or no time field)');
        setLazyLoading(false);
      } catch (err) {
        console.warn('[matrix] lazy fetch failed, falling back to panel data:', err);
        setLazyLoading(false);
      }
    })();
  }, [activeSubMode, data.request, options.animationRange, inlineAnimFrames, id, buildAnimFrames, lazyFrames]);

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

  // Compute parsed data
  const parsedData = useMemo(() => {
    if (activeSubMode === 'animate' && animFrames) {
      return animFrames.baseData;
    }
    return parseData(data, options, theme);
  }, [data, options, theme, animFrames, activeSubMode]);

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
    if (activeSubMode !== 'animate' || !animFrames || !ref.current || !animInitRef.current) {
      return;
    }
    const frameIdx = Math.min(animIndex, animFrames.colors.length - 1);
    updateViz(ref.current, id, animFrames.colors[frameIdx]);
  }, [animIndex, animFrames, id, activeSubMode]);

  // Stepping callbacks
  const handleStepForward = useCallback(() => {
    const ms = intervalToMs(stepInterval);
    const now = Date.now();
    const newTo = timeRange.to.valueOf() + ms;
    if (newTo > now) {
      return; // already at or past the live edge
    }
    const span = timeRange.to.valueOf() - timeRange.from.valueOf();
    onChangeTimeRange({ from: newTo - span, to: newTo });
  }, [stepInterval, timeRange, onChangeTimeRange]);

  const handleStepBackward = useCallback(() => {
    const ms = intervalToMs(stepInterval);
    onChangeTimeRange({ from: timeRange.from.valueOf() - ms, to: timeRange.to.valueOf() - ms });
  }, [stepInterval, timeRange, onChangeTimeRange]);

  // Format time label for stepping mode
  const timeLabel = useMemo(() => {
    const fmt = 'YYYY-MM-DD HH:mm';
    return `${timeRange.from.format(fmt)} -- ${timeRange.to.format(fmt)}`;
  }, [timeRange]);

  // Handle sub-mode change within timelapse bar
  const handleModeChange = useCallback((mode: 'stepping' | 'animate') => {
    if (mode === activeSubMode) {
      return;
    }
    if (activeSubMode === 'animate') {
      setAnimPlaying(false);
    }
    setActiveSubMode(mode);
  }, [activeSubMode]);

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
          activeMode={activeSubMode}
          onModeChange={handleModeChange}
          loading={lazyLoading}
          // Stepping props
          timeLabel={timeLabel}
          stepInterval={stepInterval}
          onStepForward={handleStepForward}
          onStepBackward={handleStepBackward}
          onStepIntervalChange={setStepInterval}
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
