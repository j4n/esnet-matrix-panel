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

export interface ParsedData {
  rows: string[] | null;
  columns: string[] | null;
  data: CellData[][] | string | null;
  legend: LegendItem[] | null;
}
