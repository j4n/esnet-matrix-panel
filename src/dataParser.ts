import { DataFrameView, Field, FieldType, GrafanaTheme2, PanelData, getFieldDisplayName } from '@grafana/data';
import { DataMatrixCell, LegendData, MatrixData, MatrixOptions } from './types';

// import { legend } from 'matrixLegend';

/**
 * this function creates an adjacency matrix to be consumed by the matrix diagram
 * function returns the matrix + forward and reverse lookup Maps to go from
 * source and target id to description assumes that data coming to us has at
 * least 3 columns if no preferences provided, assumes the first 3 columns are
 * source and target dimensions then value to display
 * @param {PanelData} data Data for the matrix diagram
 * @param {MatrixOptions} options Panel configuration
 * @param {GrafanaTheme2} theme Grafana theme
 * @return {MatrixData}
 */

export function parseData(data: PanelData, options: MatrixOptions, theme: GrafanaTheme2): MatrixData {
  const series = data.series[0];
  if (series === null || series === undefined) {
    // no data, bail
    console.error('no data');
    return { rows: null, columns: null, data: null, legend: null };
  }

  const frame = new DataFrameView(series);
  if (frame === null || frame === undefined) {
    // no data, bail
    console.error('no data');
    return { rows: null, columns: null, data: null, legend: null };
  }
  // set fields
  const sourceField = series.fields.find((f: Field) =>
    options.sourceField !== undefined && (
      options.sourceField === f.name
      || options.sourceField === f.config?.displayNameFromDS
      || options.sourceField === getFieldDisplayName(f)
    )
  ) ?? series.fields.find((f: Field) => f.type === FieldType.string);
  const targetField = series.fields.find((f: Field) =>
    options.targetField !== undefined && (
      options.targetField === f.name
      || options.targetField === f.config?.displayNameFromDS
      || options.targetField === getFieldDisplayName(f)
    )
  ) ?? series.fields.find((f: Field) => f.type === FieldType.string && f.name !== sourceField?.name);
  const sourceKey = sourceField?.name;
  const targetKey = targetField?.name;

  if (sourceKey === undefined || targetKey === undefined) {
    // no data, bail
    console.error('no data');
    return { rows: null, columns: null, data: null, legend: null };
  }

  // assign valueField to the specified field or use the first number field by default
  const valueField: any = series.fields.find((f: Field) =>
    options.valueField !== undefined && (
      options.valueField === f.name
      || options.valueField === f.config?.displayNameFromDS
      || options.valueField === getFieldDisplayName(f)
    )
  ) ?? series.fields.find((f: Field) => f.type === FieldType.number);
  const valKey = valueField?.name;

  if (valueField === undefined || valKey === undefined) {
    // no data, bail
    console.error('no data');
    return { rows: null, columns: null, data: null, legend: null };
  }

  // function that maps value to color specified by Standard Options panel.
  // if value is null or was not returned by query, use different value
  const nullColor = theme.visualization.getColorByName(options.nullColor);
  const defaultColor = theme.visualization.getColorByName(options.defaultColor);
  function colorMap(v: any): string {
    if (v === null) {
      return nullColor;
    } else if (v === -1) {
      return defaultColor;
    } else {
      return valueField.display(v).color;
    }
  }

  // Make Row and Column Lists
  let rows: string[] = [];
  let columns: string[] = [];
  // let uniqueVals: any[] = [];

  // IF static list toggle is set, use input list
  if (options.inputList) {
    if (options.staticRows !== undefined) {
      rows = options.staticRows.split(',');
    }
    if (options.staticColumns !== undefined) {
      columns = options.staticColumns.split(',');
    }
  } else {
    // ELSE  Make new arrays from unique set of row and column axis labels
    // find all axis labels
    rows = Array.from(new Set(sourceField.values));
    columns = Array.from(new Set(targetField.values));
  }

  if (rows.length === 0 || columns.length === 0) {
    // no data, bail
    console.error('no data');
    return { rows: null, columns: null, data: null, legend: null };
  }

  switch(options.sortType) {
  case "natural-asc":
  case "natural-desc":
    const naturalSort = (a: any, b: any) => {
      return a.toString().localeCompare(b.toString(), undefined, { numeric: true });
    };

    let sort = naturalSort;
    if (options.sortType.endsWith("-desc")) {
      sort = (a, b) => naturalSort(b, a);
    }

    rows.sort(sort);
    columns.sort(sort);
    break;
  }

  const numSquaresInMatrix = rows.length * columns.length;
  if (numSquaresInMatrix > 50000) {
    return { rows: null, columns: null, data: 'too many inputs', legend: null };
  }

  //playground DELETE LATER ////////////////
  // let tempvals = frame.fields[valKey];
  // let min = 0;
  // let max = 0;
  // if (tempvals.state) {
  //   if(tempvals.state.range) {
  //     if(tempvals.state.range.min) {
  //     min = tempvals.state.range.min;
  //     }
  //     if (tempvals.state.range.max) {
  //       max = tempvals.state.range.max;
  //     }
  //   }
  // }
  // console.log(`min: ${min} max: ${max}`);

  ////////////////////////////

  // console.log(options);
  // resolve extra tooltip fields (comma-separated field names)
  // extra tooltip series: series[1], series[2], ... matched to extraTooltipFields labels
  const extraFieldNames: string[] = options.extraTooltipFields
    ? options.extraTooltipFields.split(',').map((s: string) => s.trim()).filter(Boolean)
    : [];

  // For each extra series, build a lookup map keyed by "sourceVal|targetVal".
  // If Grafana auto-merged all queries into series[0] (columns become "Value #A/B/C/D"),
  // fall back to using the (i+1)-th number field from series[0].
  const mergedNumberFields = series.fields.filter((f: any) => f.type === 'number');
  const extraLookups = extraFieldNames.map((label: string, i: number) => {
    const extraSeries = data.series[i + 1];
    const lookup: Record<string, any> = {};
    if (extraSeries) {
      // separate series case
      const extraFrame = new DataFrameView(extraSeries);
      const extraValField = extraSeries.fields.find((f: any) => f.type === 'number');
      if (extraValField) {
        extraFrame.forEach((row: any) => {
          const key = `${row[sourceKey]}|${row[targetKey]}`;
          const ev = row[extraValField.name];
          lookup[key] = extraValField.display
            ? extraValField.display(ev)
            : { text: ev != null ? String(ev) : '', suffix: '' };
        });
      }
    } else {
      // merged series case: use (i+1)-th number field in series[0]
      const extraField = mergedNumberFields[i + 1];
      if (extraField) {
        frame.forEach((row: any) => {
          const key = `${row[sourceKey]}|${row[targetKey]}`;
          const ev = row[extraField.name];
          lookup[key] = extraField.display
            ? extraField.display(ev)
            : { text: ev != null ? String(ev) : '', suffix: '' };
        });
      }
    }
    return { label, lookup };
  });

  // create data matrix
  const dataMatrix: DataMatrixCell[][] = [];
  for (let i = 0; i < rows.length; i++) {
    dataMatrix.push(new Array(columns.length).fill(-1));
  }
  frame.forEach((row) => {
    let r = rows.indexOf(String(row[sourceKey]));
    let c = columns.indexOf(String(row[targetKey]));
    let v = row[valKey];
    if (r > -1 && c > -1) {
      const key = `${row[sourceKey]}|${row[targetKey]}`;
      const extras = extraLookups.map(({ label, lookup }: any) => ({
        label,
        display: lookup[key] ?? { text: '', suffix: '' },
      }));
      dataMatrix[r][c] = {
        row: row[sourceKey],
        col: row[targetKey],
        val: v,
        color: colorMap(v),
        display: valueField.display(v),
        extras,
      };
    }
  });

  // parse data for legend
  const legendData: LegendData[] = [];
  if (options.showLegend) {
    
    // let allVals = frame.fields[valKey].values;
    let tempValues: any[] = [];
    if (options.legendType === 'range') { 
      //get min & max, steps
      let allValues: number[] = Object.values(frame.fields[valKey].values);
      let thisMin = Math.min(...allValues);
      let thisMax = Math.max(...allValues);
      let step = (thisMax - thisMin) / 10;
      // push 10 steps to use for legend
      tempValues = [];
      for(let i = 0; i <= 10; i++) {
        tempValues.push(thisMin + (i*step));
      }
    } else {
      // get unique categories
      let allValues: string[] = Object.values(frame.fields[valKey].values);
      let unique = new Set(allValues);
      tempValues = [...unique];
    }
    tempValues.forEach((val) => {
      // find display values, unit & color for each
      // store in array
      let text = valueField.display(val).text;
      if (valueField.display(val).suffix) {
        text = text + ` ${valueField.display(val).suffix}`;
      }
        legendData.push({
          label: text,
          color: colorMap(val),
        });
    });
  }
  // console.log(legendData);

  const dataObject = { rows: rows, columns: columns, data: dataMatrix, legend: legendData };
  return dataObject;
}
