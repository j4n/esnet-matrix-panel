import { dateTime, DataFrame, Field, FieldType, MutableDataFrame, PanelData } from '@grafana/data';
import { findField } from './dataParser';
import { MatrixOptions, TimeSlice } from './types';

export interface TimeSeriesPoint {
  time: number;
  value: number;
}

/**
 * Find a time field in the first data series.
 */
export function findTimeField(series: DataFrame): Field | undefined {
  return series.fields.find((f: Field) => f.type === FieldType.time);
}

/**
 * Group all rows by "source|target" key, collecting (time, value) pairs sorted by time.
 */
export function groupBySourceTarget(
  series: DataFrame,
  sourceFieldName: string,
  targetFieldName: string,
  valueFieldName: string,
): Map<string, TimeSeriesPoint[]> {
  const sourceField = findField(series.fields, sourceFieldName)
    ?? series.fields.find((f: Field) => f.type === FieldType.string);
  const targetField = findField(series.fields, targetFieldName)
    ?? series.fields.find((f: Field) => f.type === FieldType.string && f.name !== sourceField?.name);
  const valueField = findField(series.fields, valueFieldName)
    ?? series.fields.find((f: Field) => f.type === FieldType.number);
  const timeField = findTimeField(series);

  if (!sourceField || !targetField || !valueField || !timeField) {
    return new Map();
  }

  const length = series.length;
  const groups = new Map<string, TimeSeriesPoint[]>();

  for (let i = 0; i < length; i++) {
    const src = String(sourceField.values[i]);
    const tgt = String(targetField.values[i]);
    const val = valueField.values[i] as number;
    const time = timeField.values[i] as number;

    if (val == null || time == null) {
      continue;
    }

    const key = `${src}|${tgt}`;
    let points = groups.get(key);
    if (!points) {
      points = [];
      groups.set(key, points);
    }
    points.push({ time, value: val });
  }

  // Sort each group by time
  for (const points of groups.values()) {
    points.sort((a, b) => a.time - b.time);
  }

  return groups;
}

/**
 * Aggregate each (source, target) group into a single value.
 */
export function aggregateTimeSeries(
  groups: Map<string, TimeSeriesPoint[]>,
  aggregation: MatrixOptions['aggregation'],
): Array<{ source: string; target: string; value: number }> {
  const result: Array<{ source: string; target: string; value: number }> = [];

  for (const [key, points] of groups.entries()) {
    const [source, target] = key.split('|');
    if (points.length === 0) {
      continue;
    }

    const values = points.map((p) => p.value);
    let aggregated: number;

    switch (aggregation) {
      case 'mean': {
        const sum = values.reduce((a, b) => a + b, 0);
        aggregated = sum / values.length;
        break;
      }
      case 'min':
        aggregated = Math.min(...values);
        break;
      case 'max':
        aggregated = Math.max(...values);
        break;
      case 'sum':
        aggregated = values.reduce((a, b) => a + b, 0);
        break;
      case 'count':
        aggregated = values.length;
        break;
      case 'range':
        aggregated = Math.max(...values) - Math.min(...values);
        break;
      case 'delta':
        aggregated = values[values.length - 1] - values[0];
        break;
      case 'last':
      default:
        aggregated = values[values.length - 1];
        break;
    }

    result.push({ source, target, value: aggregated });
  }

  return result;
}

const MAX_ANIMATION_FRAMES = 120;

/**
 * Slice grouped time series into discrete time steps for animation.
 * Carries forward the last known value for sparse data.
 * Downsamples to MAX_ANIMATION_FRAMES if there are too many timestamps.
 */
export function sliceTimeSeries(
  groups: Map<string, TimeSeriesPoint[]>,
): TimeSlice[] {
  // Collect all unique timestamps
  const timestampSet = new Set<number>();
  for (const points of groups.values()) {
    for (const p of points) {
      timestampSet.add(p.time);
    }
  }

  let timestamps = Array.from(timestampSet).sort((a, b) => a - b);

  // Downsample if too many frames
  if (timestamps.length > MAX_ANIMATION_FRAMES) {
    const step = Math.ceil(timestamps.length / MAX_ANIMATION_FRAMES);
    const sampled: number[] = [];
    for (let i = 0; i < timestamps.length; i += step) {
      sampled.push(timestamps[i]);
    }
    // Always include the last timestamp
    if (sampled[sampled.length - 1] !== timestamps[timestamps.length - 1]) {
      sampled.push(timestamps[timestamps.length - 1]);
    }
    timestamps = sampled;
  }

  // Build index of sorted points per group for efficient lookup
  const groupIndices = new Map<string, number>();
  for (const key of groups.keys()) {
    groupIndices.set(key, 0);
  }

  const slices: TimeSlice[] = [];
  const lastKnown = new Map<string, number>();

  for (const ts of timestamps) {
    const values = new Map<string, number>();

    for (const [key, points] of groups.entries()) {
      let idx = groupIndices.get(key)!;

      // Advance index to current timestamp
      while (idx < points.length && points[idx].time <= ts) {
        lastKnown.set(key, points[idx].value);
        idx++;
      }
      groupIndices.set(key, idx);

      // Use last known value (carry-forward)
      const val = lastKnown.get(key);
      if (val !== undefined) {
        values.set(key, val);
      }
    }

    slices.push({
      timestamp: ts,
      label: dateTime(ts).format('YYYY-MM-DD HH:mm:ss'),
      values,
    });
  }

  return slices;
}

/**
 * Build a synthetic PanelData from aggregated rows, preserving the original
 * value field's config (thresholds, display, etc.) so parseData() colors correctly.
 */
export function buildSyntheticPanelData(
  rows: Array<{ source: string; target: string; value: number }>,
  originalData: PanelData,
  options: MatrixOptions,
): PanelData {
  const originalSeries = originalData.series[0];
  const originalValueField = findField(originalSeries.fields, options.valueField)
    ?? originalSeries.fields.find((f: Field) => f.type === FieldType.number);
  const originalSourceField = findField(originalSeries.fields, options.sourceField)
    ?? originalSeries.fields.find((f: Field) => f.type === FieldType.string);
  const originalTargetField = findField(originalSeries.fields, options.targetField)
    ?? originalSeries.fields.find((f: Field) => f.type === FieldType.string && f.name !== originalSourceField?.name);

  const sourceName = originalSourceField?.name ?? 'source';
  const targetName = originalTargetField?.name ?? 'target';
  const valueName = originalValueField?.name ?? 'value';

  const frame = new MutableDataFrame({
    fields: [
      {
        name: sourceName,
        type: FieldType.string,
        values: rows.map((r) => r.source),
        config: originalSourceField?.config ?? {},
      },
      {
        name: targetName,
        type: FieldType.string,
        values: rows.map((r) => r.target),
        config: originalTargetField?.config ?? {},
      },
      {
        name: valueName,
        type: FieldType.number,
        values: rows.map((r) => r.value),
        config: originalValueField?.config ?? {},
      },
    ],
  });

  // Copy display processor from original value field so thresholds work
  if (originalValueField?.display) {
    const syntheticValueField = frame.fields.find((f) => f.name === valueName);
    if (syntheticValueField) {
      syntheticValueField.display = originalValueField.display;
    }
  }

  // Copy category fields if present
  if (options.enableColGrouping && options.colCategoryField) {
    const origCatField = findField(originalSeries.fields, options.colCategoryField);
    if (origCatField) {
      // Build lookup from original data
      const catLookup = new Map<string, string>();
      const origTarget = originalTargetField;
      if (origTarget) {
        for (let i = 0; i < originalSeries.length; i++) {
          const tgt = String(origTarget.values[i]);
          const cat = String(origCatField.values[i]);
          if (!catLookup.has(tgt)) {
            catLookup.set(tgt, cat);
          }
        }
      }
      frame.addField({
        name: origCatField.name,
        type: FieldType.string,
        values: rows.map((r) => catLookup.get(r.target) ?? 'Uncategorized'),
        config: origCatField.config ?? {},
      });
    }
  }

  if (options.enableRowGrouping && options.rowCategoryField) {
    const origCatField = findField(originalSeries.fields, options.rowCategoryField);
    if (origCatField) {
      const catLookup = new Map<string, string>();
      const origSource = originalSourceField;
      if (origSource) {
        for (let i = 0; i < originalSeries.length; i++) {
          const src = String(origSource.values[i]);
          const cat = String(origCatField.values[i]);
          if (!catLookup.has(src)) {
            catLookup.set(src, cat);
          }
        }
      }
      frame.addField({
        name: origCatField.name,
        type: FieldType.string,
        values: rows.map((r) => catLookup.get(r.source) ?? 'Uncategorized'),
        config: origCatField.config ?? {},
      });
    }
  }

  return {
    ...originalData,
    series: [frame],
  };
}
