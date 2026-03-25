import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dateTime, PanelProps } from '@grafana/data';
import { useTheme2, useStyles2, CustomScrollbar } from '@grafana/ui';
import { AnimationFrames, MatrixOptions } from './types';
import { parseData } from './dataParser';
import { createViz, updateViz } from './createViz';
import { getStyles } from './tooltip';
import { findTimeField, groupBySourceTarget, aggregateTimeSeries, buildSyntheticPanelData, sliceTimeSeries } from './timeSeriesProcessor';
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

export const MatrixPanel: React.FC<PanelProps<MatrixOptions>> = ({
  options, data, width, height, id, timeRange, onChangeTimeRange,
}) => {
  const theme = useTheme2();
  const styles = useStyles2(getStyles);
  const ref = useRef<HTMLDivElement>(null);

  // Animation state
  const [animPlaying, setAnimPlaying] = useState(false);
  const [animIndex, setAnimIndex] = useState(0);
  const [animSpeed, setAnimSpeed] = useState(options.animationSpeedMs || 1000);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Track whether initial createViz has been called for animation
  const animInitRef = useRef(false);

  const showControls = options.timeMode === 'stepping' || options.timeMode === 'animate';

  // Pre-compute ALL animation frames at once: colors + labels
  const animFrames: AnimationFrames | null = useMemo(() => {
    if (options.timeMode !== 'animate' || !data.series[0]) {
      return null;
    }
    const timeField = findTimeField(data.series[0]);
    if (!timeField) {
      console.log('[matrix-anim] no time field in series[0]');
      return null;
    }
    const groups = groupBySourceTarget(
      data.series[0], options.sourceField, options.targetField, options.valueField,
    );
    if (groups.size === 0) {
      console.log('[matrix-anim] no groups found');
      return null;
    }
    const slices = sliceTimeSeries(groups);
    if (slices.length === 0) {
      return null;
    }
    console.log('[matrix-anim] pre-computing', slices.length, 'frames for', groups.size, 'pairs');

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
    const originalValueField = data.series[0].fields.find((f) => f.type === 'number');
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

    // Pre-compute flat color array for each frame
    // Order must match createViz's rect layout: row by row, column by column
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

    console.log('[matrix-anim] pre-computed', colors.length, 'frames,', rowNames.length, 'x', colNames.length, 'cells');
    return { labels, colors, baseData };
  }, [data, options, theme]);

  // Reset animation when frames change
  useEffect(() => {
    setAnimIndex(0);
    setAnimPlaying(false);
    animInitRef.current = false;
  }, [animFrames]);

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
    if (options.timeMode === 'animate' && animFrames) {
      return animFrames.baseData;
    }

    // Aggregation mode
    if (options.timeMode === 'aggregate' && data.series[0] && findTimeField(data.series[0])) {
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
  }, [data, options, theme, animFrames]);

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
    if (options.timeMode !== 'animate' || !animFrames || !ref.current || !animInitRef.current) {
      return;
    }
    const frameIdx = Math.min(animIndex, animFrames.colors.length - 1);
    updateViz(ref.current, id, animFrames.colors[frameIdx]);
  }, [animIndex, animFrames, id, options.timeMode]);

  // Debug: log data state when in stepping mode
  useEffect(() => {
    if (options.timeMode === 'stepping') {
      const fmt = 'YYYY-MM-DD HH:mm:ss';
      console.log('[matrix-step] timeRange:', {
        from: dateTime(timeRange.from).format(fmt),
        to: dateTime(timeRange.to).format(fmt),
        raw: timeRange.raw,
      });
      console.log('[matrix-step] series count:', data.series.length);
      if (data.series[0]) {
        const s = data.series[0];
        console.log('[matrix-step] series[0] fields:', s.fields.map((f) => `${f.name}(${f.type})[${f.values.length}]`));
      }
      console.log('[matrix-step] parsedData:', {
        rows: parsedData.rows?.length ?? 'null',
        cols: parsedData.columns?.length ?? 'null',
        data: typeof parsedData.data === 'string' ? parsedData.data : parsedData.data ? 'matrix' : 'null',
      });
    }
  }, [options.timeMode, timeRange, data, parsedData]);

  // Stepping callbacks
  const handleStepForward = useCallback(() => {
    const ms = intervalToMs(options.stepInterval || '60m');
    const now = Date.now();
    const newTo = Math.min(timeRange.to.valueOf() + ms, now);
    const newFrom = newTo - (timeRange.to.valueOf() - timeRange.from.valueOf());
    if (timeRange.to.valueOf() >= now) {
      console.log('[matrix-step] already at now, not stepping forward');
      return;
    }
    console.log('[matrix-step] stepping forward by', options.stepInterval || '60m', '(', ms, 'ms)');
    onChangeTimeRange({ from: newFrom, to: newTo });
  }, [options.stepInterval, timeRange, onChangeTimeRange]);

  const handleStepBackward = useCallback(() => {
    const ms = intervalToMs(options.stepInterval || '60m');
    const newFrom = timeRange.from.valueOf() - ms;
    const newTo = timeRange.to.valueOf() - ms;
    console.log('[matrix-step] stepping backward by', options.stepInterval || '60m', '(', ms, 'ms)');
    onChangeTimeRange({ from: newFrom, to: newTo });
  }, [options.stepInterval, timeRange, onChangeTimeRange]);

  // Format time label for stepping mode
  const timeLabel = useMemo(() => {
    const fmt = 'YYYY-MM-DD HH:mm';
    return `${dateTime(timeRange.from).format(fmt)} -- ${dateTime(timeRange.to).format(fmt)}`;
  }, [timeRange]);

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

  const matrixHeight = showControls ? height - CONTROLS_HEIGHT : height;
  const totalAnimFrames = animFrames?.colors.length ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <CustomScrollbar autoHeightMin={`${Math.max(matrixHeight, 100)}px`}>
          <div ref={ref} id={`matrix-panel-${id}`} style={{ width: '100%' }} />
        </CustomScrollbar>
      </div>
      {options.timeMode === 'stepping' && (
        <PlaybackControls
          mode="stepping"
          timeLabel={timeLabel}
          stepInterval={options.stepInterval || '60m'}
          onStepForward={handleStepForward}
          onStepBackward={handleStepBackward}
          onStepIntervalChange={() => {}}
        />
      )}
      {options.timeMode === 'animate' && totalAnimFrames > 0 && (
        <PlaybackControls
          mode="animate"
          totalFrames={totalAnimFrames}
          currentIndex={animIndex}
          frameLabel={animFrames!.labels[Math.min(animIndex, totalAnimFrames - 1)] ?? ''}
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
