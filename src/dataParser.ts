import { DataFrameView, Field, FieldType, GrafanaTheme2, PanelData, getFieldDisplayName } from '@grafana/data';
import { CellData, ExtraTooltipField, LegendItem, MatrixOptions, ParsedData } from './types';

const EMPTY: ParsedData = { rows: null, columns: null, data: null, legend: null };
const MAX_CELLS = 50000;

/**
 * Transform Grafana DataFrames into the row/column/matrix structure needed for rendering.
 */
export function parseData(data: PanelData, options: MatrixOptions, theme: GrafanaTheme2): ParsedData {
  const series = data.series[0];
  if (!series) {
    return EMPTY;
  }

  const frame = new DataFrameView(series);
  if (!frame) {
    return EMPTY;
  }

  // Resolve fields using name → displayNameFromDS → getFieldDisplayName fallback chain
  const sourceField = findField(series.fields, options.sourceField)
    ?? series.fields.find((f: Field) => f.type === FieldType.string);
  const targetField = findField(series.fields, options.targetField)
    ?? series.fields.find((f: Field) => f.type === FieldType.string && f.name !== sourceField?.name);
  const sourceKey = sourceField?.name;
  const targetKey = targetField?.name;

  if (sourceKey === undefined || targetKey === undefined) {
    return EMPTY;
  }

  const valueField = findField(series.fields, options.valueField)
    ?? series.fields.find((f: Field) => f.type === FieldType.number);
  const valKey = valueField?.name;

  if (!valueField || valKey === undefined) {
    return EMPTY;
  }

  // Color mapping: value → threshold color, null → nullColor, -1 sentinel → defaultColor
  const nullColor = theme.visualization.getColorByName(options.nullColor);
  const defaultColor = theme.visualization.getColorByName(options.defaultColor);
  function colorMap(v: number | null): string {
    if (v === null) {
      return nullColor;
    } else if (v === -1) {
      return defaultColor;
    }
    return valueField!.display!(v).color!;
  }

  // Build row and column label lists
  let rows: string[] = [];
  let columns: string[] = [];

  if (options.inputList) {
    if (options.staticRows !== undefined) {
      rows = options.staticRows.split(',');
    }
    if (options.staticColumns !== undefined) {
      columns = options.staticColumns.split(',');
    }
  } else {
    rows = Array.from(new Set<string>(sourceField!.values));
    columns = Array.from(new Set<string>(targetField!.values));
  }

  if (rows.length === 0 || columns.length === 0) {
    return EMPTY;
  }

  // Sort
  if (options.sortType === 'natural-asc' || options.sortType === 'natural-desc') {
    const naturalSort = (a: string, b: string) =>
      a.toString().localeCompare(b.toString(), undefined, { numeric: true });
    const sort = options.sortType === 'natural-desc'
      ? (a: string, b: string) => naturalSort(b, a)
      : naturalSort;
    rows.sort(sort);
    columns.sort(sort);
  }

  if (rows.length * columns.length > MAX_CELLS) {
    return { rows: null, columns: null, data: 'too many inputs', legend: null };
  }

  // Extra tooltip fields: resolve from additional series or merged number columns
  const extraFieldNames: string[] = options.extraTooltipFields
    ? options.extraTooltipFields.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  const mergedNumberFields = series.fields.filter((f: Field) => f.type === 'number');
  const extraLookups = extraFieldNames.map((label, i) => {
    const extraSeries = data.series[i + 1];
    const lookup: Record<string, { text: string; suffix?: string }> = {};
    if (extraSeries) {
      const extraFrame = new DataFrameView(extraSeries);
      const extraValField = extraSeries.fields.find((f: Field) => f.type === 'number');
      if (extraValField) {
        extraFrame.forEach((row: Record<string, unknown>) => {
          const key = `${row[sourceKey]}|${row[targetKey]}`;
          const ev = row[extraValField.name] as number | null;
          lookup[key] = extraValField.display
            ? extraValField.display(ev)
            : { text: ev != null ? String(ev) : '', suffix: '' };
        });
      }
    } else {
      const extraField = mergedNumberFields[i + 1];
      if (extraField) {
        frame.forEach((row: Record<string, unknown>) => {
          const key = `${row[sourceKey]}|${row[targetKey]}`;
          const ev = row[extraField.name] as number | null;
          lookup[key] = extraField.display
            ? extraField.display(ev)
            : { text: ev != null ? String(ev) : '', suffix: '' };
        });
      }
    }
    return { label, lookup };
  });

  // Build data matrix
  const dataMatrix: (CellData | number)[][] = [];
  for (let i = 0; i < rows.length; i++) {
    dataMatrix.push(new Array(columns.length).fill(-1));
  }
  frame.forEach((row: Record<string, unknown>) => {
    const r = rows.indexOf(String(row[sourceKey]));
    const c = columns.indexOf(String(row[targetKey]));
    const v = row[valKey] as number;
    if (r > -1 && c > -1) {
      const key = `${row[sourceKey]}|${row[targetKey]}`;
      const extras: ExtraTooltipField[] = extraLookups.map(({ label, lookup }) => ({
        label,
        display: lookup[key] ?? { text: '', suffix: '' },
      }));
      dataMatrix[r][c] = {
        row: String(row[sourceKey]),
        col: String(row[targetKey]),
        val: v,
        color: colorMap(v),
        display: valueField!.display!(v),
        extras,
      };
    }
  });

  // Build legend data
  const legend: LegendItem[] = [];
  if (options.showLegend) {
    let tempValues: (number | string)[] = [];
    if (options.legendType === 'range') {
      const allValues: number[] = Object.values(frame.fields[valKey].values)
        .filter((v): v is number => typeof v === 'number' && !isNaN(v));
      const min = Math.min(...allValues);
      const max = Math.max(...allValues);
      const step = (max - min) / 10;
      for (let i = 0; i <= 10; i++) {
        tempValues.push(min + i * step);
      }
    } else {
      tempValues = [...new Set<string>(Object.values(frame.fields[valKey].values))];
    }
    for (const val of tempValues) {
      const d = valueField!.display!(val);
      let text = d.text;
      if (d.suffix) {
        text += ` ${d.suffix}`;
      }
      legend.push({ label: text, color: colorMap(val as number) });
    }
  }

  return { rows, columns, data: dataMatrix as CellData[][], legend };
}

/** Find a field by name, displayNameFromDS, or getFieldDisplayName. */
function findField(fields: Field[], name: string | undefined): Field | undefined {
  if (name === undefined) {
    return undefined;
  }
  return fields.find((f) =>
    name === f.name
    || name === f.config?.displayNameFromDS
    || name === getFieldDisplayName(f)
  );
}
