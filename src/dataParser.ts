import { DataFrameView } from '@grafana/data';

// import { legend } from 'matrixLegend';

/**
 * this function creates an adjacency matrix to be consumed by the chord
 * function returns the matrix + forward and reverse lookup Maps to go from
 * source and target id to description assumes that data coming to us has at
 * least 3 columns if no preferences provided, assumes the first 3 columns are
 * source and target dimensions then value to display
 * @param {*} data Data for the chord diagram
 * @param {string} src The data series that will act as the source
 * @param {string} target The data series that will act as * the target
 * @param {string} val The data series that will act as the value
 * @return {[rowNames, colNames, dataMatrix]}
 */

export function parseData(data: { series: any[] }, options: any, theme: any) {
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
  let sourceKey = options.sourceField;
  let targetKey = options.targetField;
  if (!sourceKey) {
    sourceKey = 0;
  }
  if (!targetKey) {
    targetKey = 1;
  }

  // assign valueField to the specified field or use the first number field by default
  const val = options.valueField;
  const valueField = val
    ? data.series.map((series: { fields: any[] }) => series.fields.find((field: { name: any }) => field.name === val))
    : data.series.map((series: { fields: any[] }) =>
        series.fields.find((field: { type: string }) => field.type === 'number')
      );
  // fall back to first number field when Grafana auto-merges multi-query series
  // and renames "Value" to "Value #A", "Value #B", etc.
  if (valueField[0] == null) {
    valueField[0] = series.fields.find((field: any) => field.type === 'number');
  }
  const valKey = valueField[0].name;

  // function that maps value to color specified by Standard Options panel.
  // if value is null or was not returned by query, use different value
  const nullColor = theme.visualization.getColorByName(options.nullColor);
  const defaultColor = theme.visualization.getColorByName(options.defaultColor);
  function colorMap(v: any) {
    if (v == null) {
      return nullColor;
    } else if (v === -1) {
      return defaultColor;
    } else {
      return valueField[0].display(v).color;
    }
  }

  // Make Row and Column Lists
  let rows: any[] = [];
  let columns: any[] = [];
  // let uniqueVals: any[] = [];

  // IF static list toggle is set, use input list
  if (options.inputList) {
    rows = options.staticRows.split(',');
    columns = options.staticColumns.split(',');
  } else {
    // ELSE  Make new arrays from unique set of row and column axis labels
    // find all axis labels
    frame.forEach((row) => {
      rows.push(String(row[sourceKey]));
      columns.push(String(row[targetKey]));
    });
  }
  // get unique set
  const rowNames = Array.from(new Set(rows)).sort();
  const colNames = Array.from(new Set(columns)).sort();

  const numSquaresInMatrix = rowNames.length * colNames.length;
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
  let dataMatrix: any[][] = [];
  for (let i = 0; i < rowNames.length; i++) {
    dataMatrix.push(new Array(colNames.length).fill(-1));
  }
  frame.forEach((row) => {
    let r = rowNames.indexOf(String(row[sourceKey]));
    let c = colNames.indexOf(String(row[targetKey]));
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
        display: valueField[0].display(v),
        extras,
      };
    }
  });

  // parse data for legend
  let legendData: any[] = [];
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
      let text = valueField[0].display(val).text;
      if (valueField[0].display(val).suffix) {
        text = text + ` ${valueField[0].display(val).suffix}`;
      }
        legendData.push({
          label: text,
          color: colorMap(val),
        });
    });
  }
  // console.log(legendData);

  let dataObject = { rows: rowNames, columns: colNames, data: dataMatrix, legend: legendData };
  return dataObject;
}
