import { DisplayValue } from '@grafana/data';

export interface MatrixOptions {
  sortType: 'none' | 'natural-asc' | 'natural-desc';
  sourceField: string;
  targetField: string;
  valueField: string;
  cellSize: number;
  cellPadding: number;
  txtLength: number;
  txtSize: number;
  nullColor: string;
  defaultColor: string;
  sourceText: string;
  targetText: string;
  valueText: string;
  addUrl: boolean;
  url: string;
  urlVar1: string;
  urlVar2: string;
  inputList: boolean;
  staticRows: string;
  staticColumns: string;
  showLegend: boolean;
  legendType: string;
  extraTooltipFields: string;
  fitToPanel: boolean;
  colCategoryField: string;
  enableColGrouping: boolean;
  colCategoryHeaderHeight: number;
  colCategoryGap: number;
  rowCategoryField: string;
  enableRowGrouping: boolean;
  rowCategoryHeaderWidth: number;
  rowCategoryGap: number;
}

export interface ExtraTooltipField {
  label: string;
  display: { text: string; suffix?: string };
}

export interface CellData {
  row: string;
  col: string;
  val: number;
  color: string;
  display: DisplayValue;
  extras: ExtraTooltipField[];
}

export interface LegendItem {
  label: string;
  color: string;
}

export interface ColumnInfo {
  name: string;
  category: string;
  categoryIndex: number;
  indexInCategory: number;
}

export interface CategoryGroup {
  name: string;
  columns: string[];
  startIndex: number;
  endIndex: number;
}

export interface RowInfo {
  name: string;
  category: string;
  categoryIndex: number;
  indexInCategory: number;
}

export interface RowCategoryGroup {
  name: string;
  rows: string[];
  startIndex: number;
  endIndex: number;
}

export interface ParsedData {
  rows: string[] | null;
  columns: string[] | null;
  colMetadata: ColumnInfo[];
  colCategories: CategoryGroup[];
  rowMetadata: RowInfo[];
  rowCategories: RowCategoryGroup[];
  data: CellData[][] | string | null;
  legend: LegendItem[] | null;
}
