import { Field, FieldConfigProperty, FieldConfigSource, FieldType, PanelPlugin } from '@grafana/data';
import { MatrixOptions } from './types';
import { MatrixPanel } from './MatrixPanel';

const OptionsCategory = ['Display'];
const URLCategory = ['Link Options'];
const RowOptions = ['Row/Column Options'];

const urlBool = (v: boolean) => (config: MatrixOptions) => config.addUrl === v;
const staticBool = (v: boolean) => (config: MatrixOptions) => config.inputList === v;
const legendBool = (v: boolean) => (config: MatrixOptions) => config.showLegend === v;

export const plugin = new PanelPlugin<MatrixOptions>(MatrixPanel);

plugin.useFieldConfig({
  standardOptions: {
    [FieldConfigProperty.Thresholds]: {},
    [FieldConfigProperty.Color]: {
      settings: { preferThresholdMode: true },
    },
  },
  disableStandardOptions: [
    FieldConfigProperty.NoValue,
    FieldConfigProperty.Links,
  ],
});

plugin.setMigrationHandler((panel: { options: MatrixOptions; fieldConfig: FieldConfigSource }) => {
  if (panel.options.sortType === undefined) {
    panel.options.sortType = 'natural-asc';
  }
  return panel.options;
});

plugin.setPanelOptions((builder) => {
  // Row/Column Options
  builder.addSelect({
    path: 'sortType',
    name: 'Sort Type',
    description: 'Sorting to apply to row/column names',
    category: RowOptions,
    defaultValue: 'natural-asc',
    settings: {
      allowCustomValue: false,
      options: [
        { value: 'none', label: 'None' },
        { value: 'natural-asc', label: 'Natural ascending' },
        { value: 'natural-desc', label: 'Natural descending' },
      ],
    },
  });
  builder.addBooleanSwitch({
    path: 'inputList',
    name: 'Use Static Row/Column Lists',
    category: RowOptions,
    defaultValue: false,
  });
  builder.addTextInput({
    path: 'staticRows',
    name: 'Row Array',
    description: 'Labels to use as matrix rows (comma separated)',
    category: RowOptions,
    showIf: staticBool(true),
  });
  builder.addTextInput({
    path: 'staticColumns',
    name: 'Column Array',
    description: 'Labels to use as matrix columns (comma separated)',
    category: RowOptions,
    showIf: staticBool(true),
  });
  builder.addFieldNamePicker({
    path: 'sourceField',
    name: 'Rows Field',
    description: 'Select the field that should be used for the rows',
    category: RowOptions,
    settings: {
      filter: (field: Field) => field.type === FieldType.string,
    },
  });
  builder.addFieldNamePicker({
    path: 'targetField',
    name: 'Columns Field',
    description: 'Select the field to use for the columns',
    category: RowOptions,
    settings: {
      filter: (field: Field) => field.type === FieldType.string,
    },
  });
  builder.addFieldNamePicker({
    path: 'valueField',
    name: 'Value Field',
    description: 'Select the numeric field used to color the matrix cells.',
    category: RowOptions,
    settings: {
      filter: (field: Field) => field.type === FieldType.number,
    },
  });

  // Display Options
  builder.addBooleanSwitch({
    path: 'showLegend',
    name: 'Show Legend',
    category: OptionsCategory,
    defaultValue: false,
  });
  builder.addSelect({
    path: 'legendType',
    name: 'Legend Type',
    category: OptionsCategory,
    showIf: legendBool(true),
    defaultValue: 'range',
    settings: {
      allowCustomValue: false,
      options: [
        { value: 'categorical', label: 'categorical' },
        { value: 'range', label: 'range' },
      ],
    },
  });
  builder.addTextInput({
    path: 'sourceText',
    name: 'Source Text',
    description: 'The text to be displayed in the tooltip.',
    category: OptionsCategory,
    defaultValue: 'From',
  });
  builder.addTextInput({
    path: 'targetText',
    name: 'Target Text',
    description: 'The text to be displayed in the tooltip.',
    category: OptionsCategory,
    defaultValue: 'To',
  });
  builder.addTextInput({
    path: 'valueText',
    name: 'value Text',
    description: 'The text to be displayed in the tooltip.',
    category: OptionsCategory,
    defaultValue: 'Value',
  });
  builder.addBooleanSwitch({
    path: 'fitToPanel',
    name: 'Fit to Panel Width',
    description: 'Scale the matrix to fit the panel width. Uses SVG viewBox scaling so all cells remain proportional.',
    category: OptionsCategory,
    defaultValue: false,
  });
  builder.addTextInput({
    path: 'extraTooltipFields',
    name: 'Extra Tooltip Fields',
    description: 'Comma-separated field names to include in the cell tooltip (e.g. "Loss,p10,p90").',
    category: OptionsCategory,
    defaultValue: '',
  });
  builder.addNumberInput({
    path: 'cellSize',
    name: 'Cell Size',
    description: 'Adjust the size in pixels that each matrix cell should use.',
    category: OptionsCategory,
    settings: { placeholder: 'Auto', integer: true, min: 10, max: 50 },
    defaultValue: 15,
  });
  builder.addNumberInput({
    path: 'cellPadding',
    name: 'Cell Padding',
    description: 'Adjust the padding between the matrix cells (relative, not pixels).',
    category: OptionsCategory,
    settings: { placeholder: 'Auto', integer: true, min: 0, max: 100 },
    defaultValue: 5,
  });
  builder.addNumberInput({
    path: 'txtLength',
    name: 'Text Length',
    description: 'Adjust amount of space used for labels',
    category: OptionsCategory,
    settings: { placeholder: 'Auto', integer: true, min: 1, max: 300 },
    defaultValue: 50,
  });
  builder.addNumberInput({
    path: 'txtSize',
    name: 'Text Size',
    description: 'Adjust the size of the text labels',
    category: OptionsCategory,
    settings: { placeholder: 'Auto', integer: true, min: 1, max: 200 },
    defaultValue: 10,
  });
  builder.addColorPicker({
    path: 'nullColor',
    name: 'Null Color',
    description: 'The color to use when the query returns a null value',
    category: OptionsCategory,
    defaultValue: '#E6E6E6',
  });
  builder.addColorPicker({
    path: 'defaultColor',
    name: 'No Data Color',
    description: 'The color to use when there is no data returned by the query',
    category: OptionsCategory,
    defaultValue: '#E6E6E6',
  });

  // Link Options
  builder.addBooleanSwitch({
    path: 'addUrl',
    name: 'Add Data Link',
    category: URLCategory,
    defaultValue: false,
  });
  builder.addTextInput({
    path: 'url',
    name: 'Link URL',
    description: 'URL to go to when square is clicked.',
    category: URLCategory,
    showIf: urlBool(true),
  });
  builder.addTextInput({
    path: 'urlVar1',
    name: 'Variable 1',
    description: 'The name of the template variable to pass the source label to',
    category: URLCategory,
    showIf: urlBool(true),
  });
  builder.addTextInput({
    path: 'urlVar2',
    name: 'Variable 2',
    description: 'The name of the template variable to pass the target label to',
    category: URLCategory,
    showIf: urlBool(true),
  });
});
