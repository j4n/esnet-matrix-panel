import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';

const STEP_INTERVALS = [
  { value: '15m', label: '15m' },
  { value: '60m', label: '1h' },
  { value: '3h', label: '3h' },
  { value: '12h', label: '12h' },
  { value: '24h', label: '1d' },
  { value: '3d', label: '3d' },
  { value: '7d', label: '7d' },
  { value: '14d', label: '14d' },
  { value: '30d', label: '30d' },
];

const SPEED_OPTIONS = [
  { value: 2000, label: '0.5x' },
  { value: 1000, label: '1x' },
  { value: 500, label: '2x' },
  { value: 200, label: '5x' },
  { value: 100, label: '10x' },
  { value: 50, label: '20x' },
  { value: 20, label: '50x' },
];

type TimeMode = 'last' | 'aggregate' | 'stepping' | 'animate';

export interface PlaybackControlsProps {
  activeMode: TimeMode;
  onModeChange: (mode: TimeMode) => void;
  loading?: boolean;
  // Stepping mode
  timeLabel?: string;
  stepInterval?: string;
  onStepForward?: () => void;
  onStepBackward?: () => void;
  onStepIntervalChange?: (interval: string) => void;
  // Animation mode
  totalFrames?: number;
  currentIndex?: number;
  frameLabel?: string;
  playing?: boolean;
  speed?: number;
  onPlay?: () => void;
  onPause?: () => void;
  onSeek?: (index: number) => void;
  onSpeedChange?: (ms: number) => void;
}

const getPlaybackStyles = (theme: GrafanaTheme2) => ({
  container: css`
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: ${theme.colors.background.secondary};
    border-top: 1px solid ${theme.colors.border.weak};
    font-family: ${theme.typography.fontFamily};
    font-size: ${theme.typography.size.sm};
    height: 40px;
    flex-shrink: 0;
  `,
  modeButton: css`
    background: ${theme.colors.background.primary};
    border: 1px solid ${theme.colors.border.medium};
    border-radius: ${theme.shape.radius.default};
    color: ${theme.colors.text.secondary};
    cursor: pointer;
    padding: 2px 8px;
    font-size: ${theme.typography.size.xs};
    font-family: ${theme.typography.fontFamily};
    line-height: 1.5;
    &:hover {
      background: ${theme.colors.action.hover};
    }
  `,
  modeButtonActive: css`
    background: ${theme.colors.primary.main};
    border: 1px solid ${theme.colors.primary.main};
    border-radius: ${theme.shape.radius.default};
    color: ${theme.colors.primary.contrastText};
    cursor: pointer;
    padding: 2px 8px;
    font-size: ${theme.typography.size.xs};
    font-family: ${theme.typography.fontFamily};
    line-height: 1.5;
  `,
  separator: css`
    width: 1px;
    height: 20px;
    background: ${theme.colors.border.medium};
    flex-shrink: 0;
  `,
  button: css`
    background: ${theme.colors.background.primary};
    border: 1px solid ${theme.colors.border.medium};
    border-radius: ${theme.shape.radius.default};
    color: ${theme.colors.text.primary};
    cursor: pointer;
    padding: 2px 8px;
    font-size: ${theme.typography.size.sm};
    font-family: ${theme.typography.fontFamilyMonospace};
    line-height: 1.5;
    &:hover {
      background: ${theme.colors.action.hover};
    }
    &:active {
      background: ${theme.colors.action.selected};
    }
  `,
  select: css`
    background: ${theme.colors.background.primary};
    border: 1px solid ${theme.colors.border.medium};
    border-radius: ${theme.shape.radius.default};
    color: ${theme.colors.text.primary};
    font-size: ${theme.typography.size.sm};
    padding: 2px 4px;
    cursor: pointer;
  `,
  label: css`
    color: ${theme.colors.text.secondary};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  `,
  slider: css`
    flex: 1;
    min-width: 60px;
    cursor: pointer;
  `,
  frameCounter: css`
    color: ${theme.colors.text.secondary};
    font-family: ${theme.typography.fontFamilyMonospace};
    font-size: ${theme.typography.size.xs};
    white-space: nowrap;
  `,
  loadingLabel: css`
    color: ${theme.colors.text.secondary};
    font-style: italic;
    white-space: nowrap;
  `,
});

const MODE_LABELS: Record<TimeMode, string> = {
  last: 'Last',
  aggregate: 'Aggr',
  stepping: 'Step',
  animate: 'Anim',
};

const AVAILABLE_MODES: TimeMode[] = ['last', 'stepping', 'animate'];

export const PlaybackControls: React.FC<PlaybackControlsProps> = (props) => {
  const styles = useStyles2(getPlaybackStyles);
  const { activeMode, onModeChange, loading } = props;

  const modeButtons = (
    <>
      {AVAILABLE_MODES.map((mode) => (
        <button
          key={mode}
          className={activeMode === mode ? styles.modeButtonActive : styles.modeButton}
          onClick={() => onModeChange(mode)}
          title={`Switch to ${MODE_LABELS[mode]} mode`}
        >
          {MODE_LABELS[mode]}
        </button>
      ))}
    </>
  );

  // Last mode: just show mode buttons
  if (activeMode === 'last' || activeMode === 'aggregate') {
    return (
      <div className={styles.container}>
        {modeButtons}
      </div>
    );
  }

  // Stepping mode
  if (activeMode === 'stepping') {
    return (
      <div className={styles.container}>
        {modeButtons}
        <div className={styles.separator} />
        <button className={styles.button} onClick={props.onStepBackward} title="Step backward">
          {'\u25C0\u25C0'}
        </button>
        <button className={styles.button} onClick={props.onStepForward} title="Step forward">
          {'\u25B6\u25B6'}
        </button>
        <select
          className={styles.select}
          value={props.stepInterval}
          onChange={(e) => props.onStepIntervalChange?.(e.target.value)}
          title="Step interval"
        >
          {STEP_INTERVALS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <span className={styles.label}>{props.timeLabel}</span>
      </div>
    );
  }

  // Animation mode
  if (loading) {
    return (
      <div className={styles.container}>
        {modeButtons}
        <div className={styles.separator} />
        <span className={styles.loadingLabel}>Loading...</span>
      </div>
    );
  }

  const total = props.totalFrames ?? 0;
  const current = props.currentIndex ?? 0;

  return (
    <div className={styles.container}>
      {modeButtons}
      <div className={styles.separator} />
      <button
        className={styles.button}
        onClick={() => props.onSeek?.(0)}
        title="Jump to start"
      >
        {'\u23EE'}
      </button>
      <button
        className={styles.button}
        onClick={() => props.onSeek?.(Math.max(0, current - 1))}
        title="Step backward"
      >
        {'\u25C0'}
      </button>
      {props.playing ? (
        <button className={styles.button} onClick={props.onPause} title="Pause">
          {'\u23F8'}
        </button>
      ) : (
        <button className={styles.button} onClick={props.onPlay} title="Play">
          {'\u25B6'}
        </button>
      )}
      <button
        className={styles.button}
        onClick={() => props.onSeek?.(Math.min(total - 1, current + 1))}
        title="Step forward"
      >
        {'\u25B6\u25B6'}
      </button>
      <button
        className={styles.button}
        onClick={() => props.onSeek?.(total - 1)}
        title="Jump to end"
      >
        {'\u23ED'}
      </button>
      <input
        type="range"
        className={styles.slider}
        min={0}
        max={Math.max(0, total - 1)}
        value={current}
        onChange={(e) => props.onSeek?.(Number(e.target.value))}
      />
      <select
        className={styles.select}
        value={props.speed}
        onChange={(e) => props.onSpeedChange?.(Number(e.target.value))}
        title="Playback speed"
      >
        {SPEED_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      <span className={styles.frameCounter}>
        {current + 1}/{total}
      </span>
      <span className={styles.label}>{props.frameLabel}</span>
    </div>
  );
};
