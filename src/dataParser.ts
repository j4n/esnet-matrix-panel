import { DataFrameView, Field, FieldType, GrafanaTheme2, PanelData, getFieldDisplayName } from '@grafana/data';
import { CategoryGroup, CellData, ColumnInfo, ExtraTooltipField, LegendItem, MatrixOptions, ParsedData, RowCategoryGroup, RowInfo } from './types';

const EMPTY: ParsedData = { rows: null, columns: null, colMetadata: [], colCategories: [], rowMetadata: [], rowCategories: [], data: null, legend: null };
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

  // Resolve optional category fields
  const colCategoryField = options.colCategoryField
    ? findField(series.fields, options.colCategoryField) : undefined;
  const colCategoryKey = colCategoryField?.name;
  const rowCategoryField = options.rowCategoryField
    ? findField(series.fields, options.rowCategoryField) : undefined;
  const rowCategoryKey = rowCategoryField?.name;

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

  // Build column category groupings
  let colMetadata: ColumnInfo[] = [];
  let colCategories: CategoryGroup[] = [];

  if (colCategoryKey && options.enableColGrouping) {
    const colToCategoryMap = new Map<string, string>();
    frame.forEach((row: Record<string, unknown>) => {
      const col = String(row[targetKey]);
      const cat = row[colCategoryKey] != null ? String(row[colCategoryKey]) : 'Uncategorized';
      if (!colToCategoryMap.has(col)) {
        colToCategoryMap.set(col, cat);
      }
    });

    const categoryToColumns = new Map<string, string[]>();
    for (const col of columns) {
      const cat = colToCategoryMap.get(col) ?? 'Uncategorized';
      if (!categoryToColumns.has(cat)) {
        categoryToColumns.set(cat, []);
      }
      categoryToColumns.get(cat)!.push(col);
    }

    const sortedCategories = Array.from(categoryToColumns.keys()).sort();
    let globalIndex = 0;
    for (const catName of sortedCategories) {
      const columnsInCat = categoryToColumns.get(catName)!;
      colCategories.push({
        name: catName,
        columns: columnsInCat,
        startIndex: globalIndex,
        endIndex: globalIndex + columnsInCat.length - 1,
      });
      globalIndex += columnsInCat.length;
    }

    for (let catIndex = 0; catIndex < colCategories.length; catIndex++) {
      const cat = colCategories[catIndex];
      for (let indexInCat = 0; indexInCat < cat.columns.length; indexInCat++) {
        colMetadata.push({
          name: cat.columns[indexInCat],
          category: cat.name,
          categoryIndex: catIndex,
          indexInCategory: indexInCat,
        });
      }
    }

    // Re-order columns to match grouped order
    columns = colMetadata.map((cm) => cm.name);
  } else {
    colMetadata = columns.map((name, idx) => ({
      name,
      category: '',
      categoryIndex: 0,
      indexInCategory: idx,
    }));
  }

  // Build row category groupings
  let rowMetadata: RowInfo[] = [];
  let rowCategories: RowCategoryGroup[] = [];

  if (rowCategoryKey && options.enableRowGrouping) {
    const rowToCategoryMap = new Map<string, string>();
    frame.forEach((row: Record<string, unknown>) => {
      const rowName = String(row[sourceKey]);
      const cat = row[rowCategoryKey] != null ? String(row[rowCategoryKey]) : 'Uncategorized';
      if (!rowToCategoryMap.has(rowName)) {
        rowToCategoryMap.set(rowName, cat);
      }
    });

    const categoryToRows = new Map<string, string[]>();
    for (const rowName of rows) {
      const cat = rowToCategoryMap.get(rowName) ?? 'Uncategorized';
      if (!categoryToRows.has(cat)) {
        categoryToRows.set(cat, []);
      }
      categoryToRows.get(cat)!.push(rowName);
    }

    const sortedRowCategories = Array.from(categoryToRows.keys()).sort();
    let globalRowIndex = 0;
    for (const catName of sortedRowCategories) {
      const rowsInCat = categoryToRows.get(catName)!;
      rowCategories.push({
        name: catName,
        rows: rowsInCat,
        startIndex: globalRowIndex,
        endIndex: globalRowIndex + rowsInCat.length - 1,
      });
      globalRowIndex += rowsInCat.length;
    }

    for (let catIndex = 0; catIndex < rowCategories.length; catIndex++) {
      const cat = rowCategories[catIndex];
      for (let indexInCat = 0; indexInCat < cat.rows.length; indexInCat++) {
        rowMetadata.push({
          name: cat.rows[indexInCat],
          category: cat.name,
          categoryIndex: catIndex,
          indexInCategory: indexInCat,
        });
      }
    }

    // Re-order rows to match grouped order
    rows = rowMetadata.map((rm) => rm.name);
  } else {
    rowMetadata = rows.map((name, idx) => ({
      name,
      category: '',
      categoryIndex: 0,
      indexInCategory: idx,
    }));
  }

  if (rows.length * columns.length > MAX_CELLS) {
    return { rows: null, columns: null, colMetadata: [], colCategories: [], rowMetadata: [], rowCategories: [], data: 'too many inputs', legend: null };
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
    if (r > -1 && c > -1 && dataMatrix[r][c] === -1) {
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
      const thresholds = valueField!.config.thresholds;
      const allValues: number[] = Object.values(frame.fields[valKey].values)
        .filter((v): v is number => typeof v === 'number' && !isNaN(v));
      const min = Math.min(...allValues);
      const max = Math.max(...allValues);
      if (thresholds && thresholds.steps.length > 1) {
        // Use actual threshold boundaries
        tempValues.push(min);
        for (const step of thresholds.steps) {
          if (step.value != null && step.value > min && step.value < max) {
            tempValues.push(step.value);
          }
        }
        tempValues.push(max);
      } else {
        // Fallback: evenly sample
        const steps = 100;
        const step = (max - min) / steps;
        for (let i = 0; i <= steps; i++) {
          tempValues.push(min + i * step);
        }
      }
    } else {
      tempValues = [...new Set<string>(Object.values(frame.fields[valKey].values))];
      if (options.sortType === 'natural-asc' || options.sortType === 'natural-desc') {
        const naturalSort = (a: string, b: string) =>
          a.toString().localeCompare(b.toString(), undefined, { numeric: true });
        tempValues.sort(options.sortType === 'natural-desc'
          ? (a, b) => naturalSort(String(b), String(a))
          : (a, b) => naturalSort(String(a), String(b)));
      }
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

  return { rows, columns, colMetadata, colCategories, rowMetadata, rowCategories, data: dataMatrix as CellData[][], legend };
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
