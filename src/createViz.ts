import { GrafanaTheme2 } from '@grafana/data';
import { select, local, selectAll } from 'd3-selection';
import 'd3-transition';
import { escapeHtml } from './escapeHtml';
import { CellData, MatrixOptions, ParsedData } from './types';
import { TooltipStyles, moveTooltip, truncateLabel } from './tooltip';

/**
 * Fast update of cell colors only -- no DOM rebuild.
 * colors is a flat array of [row0col0, row0col1, ..., row1col0, ...] color strings.
 */
export function updateViz(
  elem: HTMLElement,
  id: number,
  colors: string[],
): void {
  let idx = 0;
  select(elem).select(`.rectArea-${id}`).selectAll('.row').each(function () {
    select(this).selectAll('rect').each(function () {
      if (idx < colors.length) {
        select(this).attr('fill', colors[idx]);
        idx++;
      }
    });
  });
}

interface PositionEntry {
  name: string;
  pos: number;    // x for columns, y for rows
  category: string;
  categoryIndex: number;
}

/**
 * Render the matrix diagram into the given DOM element using D3.
 */
export function createViz(
  elem: HTMLElement,
  id: number,
  panelWidth: number,
  parsedData: ParsedData,
  options: MatrixOptions,
  theme: GrafanaTheme2,
  styles: TooltipStyles,
): void {
  const rowNames = parsedData.rows!;
  const colNames = parsedData.columns!;
  const colCategories = parsedData.colCategories;
  const rowCategories = parsedData.rowCategories;
  const matrix = parsedData.data as (CellData | number)[][];
  const legend = parsedData.legend!;

  const srcText = escapeHtml(options.sourceText);
  const targetText = escapeHtml(options.targetText);
  const valText = escapeHtml(options.valueText);
  const cellPadding = options.cellPadding / 100;
  const txtLength = options.txtLength;
  const txtSize = options.txtSize / 10; // convert to em scaling
  const linkURL = options.url;
  const urlVar1 = options.urlVar1;
  const urlVar2 = options.urlVar2;
  const defaultColor = theme.visualization.getColorByName(options.defaultColor);

  if (!elem) {
    return;
  }

  // Calculate label-based margins
  const longestColName = colNames.reduce((a, b) => (a.length > b.length ? a : b));
  const longestRowName = rowNames.reduce((a, b) => (a.length > b.length ? a : b));
  const maxColTxtLength = longestColName.length < txtLength ? longestColName.length : txtLength + 3;
  const maxRowTxtLength = longestRowName.length < txtLength ? longestRowName.length : txtLength + 3;
  const colTxtOffset = maxColTxtLength * txtSize * 5 + 25;
  const rowTxtOffset = maxRowTxtLength * txtSize * 5 + 25;

  // Optionally shrink cell size to fit panel width
  let cellSize = options.cellSize;
  if (options.fitToPanel && panelWidth > 0) {
    const availableWidth = panelWidth - rowTxtOffset;
    const maxCellSize = Math.floor(availableWidth / colNames.length);
    if (maxCellSize < cellSize) {
      cellSize = Math.max(maxCellSize, 1);
    }
  }

  const hasColGrouping = options.enableColGrouping && colCategories && colCategories.length > 0;
  const hasRowGrouping = options.enableRowGrouping && rowCategories && rowCategories.length > 0;

  // Category header dimensions
  const colCategoryHeaderHeight = hasColGrouping
    ? (options.colCategoryHeaderHeight ?? 40) : 0;
  const colCategoryGap = hasColGrouping
    ? (options.colCategoryGap ?? 4) : 0;
  const rowCategoryHeaderWidth = hasRowGrouping
    ? (options.rowCategoryHeaderWidth ?? 100) : 0;
  const rowCategoryGap = hasRowGrouping
    ? (options.rowCategoryGap ?? 4) : 0;

  // Build column positions (with optional category gaps)
  const columnPositions: PositionEntry[] = [];
  let totalWidth = 0;

  if (hasColGrouping) {
    colCategories.forEach((category, catIndex) => {
      for (const colName of category.columns) {
        columnPositions.push({
          name: colName,
          pos: totalWidth,
          category: category.name,
          categoryIndex: catIndex,
        });
        totalWidth += cellSize;
      }
      if (catIndex < colCategories.length - 1) {
        totalWidth += colCategoryGap;
      }
    });
  } else {
    for (const colName of colNames) {
      columnPositions.push({ name: colName, pos: totalWidth, category: '', categoryIndex: 0 });
      totalWidth += cellSize;
    }
  }

  // Build row positions (with optional category gaps)
  const rowPositions: PositionEntry[] = [];
  let totalHeight = 0;

  if (hasRowGrouping) {
    rowCategories.forEach((category, catIndex) => {
      for (const rowName of category.rows) {
        rowPositions.push({
          name: rowName,
          pos: totalHeight,
          category: category.name,
          categoryIndex: catIndex,
        });
        totalHeight += cellSize;
      }
      if (catIndex < rowCategories.length - 1) {
        totalHeight += rowCategoryGap;
      }
    });
  } else {
    for (const rowName of rowNames) {
      rowPositions.push({ name: rowName, pos: totalHeight, category: '', categoryIndex: 0 });
      totalHeight += cellSize;
    }
  }

  // Custom scale functions: map name -> position
  const colPosMap = new Map(columnPositions.map((cp) => [cp.name, cp.pos]));
  const rowPosMap = new Map(rowPositions.map((rp) => [rp.name, rp.pos]));

  const xPos = (name: string): number => colPosMap.get(name) ?? 0;
  const yPos = (name: string): number => rowPosMap.get(name) ?? 0;
  const bandwidth = cellSize * (1 - cellPadding);

  const margin = {
    top: colTxtOffset + colCategoryHeaderHeight,
    right: 0,
    bottom: 0,
    left: rowTxtOffset + rowCategoryHeaderWidth,
  };
  const width = totalWidth;
  const height = totalHeight;

  // Clear previous contents
  elem.replaceChildren();

  // Tooltip div
  const tooltip = select(elem)
    .append('div')
    .attr('class', `${styles.tooltip} matrix-tooltip-${id}`)
    .style('opacity', 0);

  // SVG container
  const svgClass = `svg-${id}`;
  const svgEl = select(elem).append('svg').attr('id', svgClass);
  svgEl.attr('width', width + margin.left + margin.right)
       .attr('height', height + margin.top + margin.bottom);
  const svg = svgEl.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  // Helper: attach label tooltip events
  function addLabelTooltip(sel: any, labelText: string) {
    sel.on('mouseover', function (_event: MouseEvent) {
      tooltip.html(escapeHtml(labelText))
        .transition().duration(150).style('opacity', 1);
    })
    .on('mousemove', function (event: MouseEvent) {
      moveTooltip(event, elem, tooltip);
    })
    .on('mouseout', function () {
      tooltip.transition().delay(100).duration(150).style('opacity', 0);
    });
  }

  // X axis labels (columns, rotated at top)
  const xAxisGroup = svg.append('g').attr('class', 'x-axis');
  for (const cp of columnPositions) {
    const label = xAxisGroup.append('text')
      .attr('transform', `translate(${cp.pos + cellSize / 2},-12)rotate(-90)`)
      .attr('text-anchor', 'start')
      .attr('font-size', txtSize + 'em')
      .style('font-family', theme.typography.fontFamily)
      .attr('fill', theme.colors.text.primary)
      .text(cp.name);
    label.call(truncateLabel, txtLength);
    addLabelTooltip(label, cp.name);
  }

  // Y axis labels (rows, left side)
  const yAxisGroup = svg.append('g').attr('class', 'y-axis');
  for (const rp of rowPositions) {
    const label = yAxisGroup.append('text')
      .attr('x', -10)
      .attr('y', rp.pos + cellSize / 2)
      .attr('text-anchor', 'end')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', txtSize + 'em')
      .style('font-family', theme.typography.fontFamily)
      .attr('fill', theme.colors.text.primary)
      .text(rp.name);
    label.call(truncateLabel, txtLength);
    addLabelTooltip(label, rp.name);
  }

  // Column category headers
  if (hasColGrouping) {
    const headerGroup = svg.append('g')
      .attr('class', `category-headers-${id}`)
      .attr('transform', `translate(0, ${-colTxtOffset - colCategoryHeaderHeight})`);

    for (const category of colCategories) {
      const startPos = colPosMap.get(category.columns[0]);
      if (startPos === undefined) {
        continue;
      }
      const catLabel = headerGroup.append('text')
        .attr('transform', `translate(${startPos + cellSize / 2}, ${colCategoryHeaderHeight - 12})rotate(-90)`)
        .attr('text-anchor', 'start')
        .attr('font-size', (txtSize * 1.2) + 'em')
        .attr('font-weight', 'bold')
        .attr('fill', theme.colors.text.primary)
        .style('font-family', theme.typography.fontFamily)
        .text(category.name);
      addLabelTooltip(catLabel, category.name);
    }
  }

  // Row category headers
  if (hasRowGrouping) {
    const headerGroup = svg.append('g')
      .attr('class', `row-category-headers-${id}`)
      .attr('transform', `translate(${-rowTxtOffset - rowCategoryHeaderWidth}, 0)`);

    for (const category of rowCategories) {
      const startPos = rowPosMap.get(category.rows[0]);
      if (startPos === undefined) {
        continue;
      }
      const catLabel = headerGroup.append('text')
        .attr('x', rowCategoryHeaderWidth / 2)
        .attr('y', startPos + cellSize / 2)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', (txtSize * 1.2) + 'em')
        .attr('font-weight', 'bold')
        .attr('fill', theme.colors.text.primary)
        .style('font-family', theme.typography.fontFamily)
        .text(category.name);
      addLabelTooltip(catLabel, category.name);
    }
  }

  // Matrix cells
  const outer = local<number>();
  const svgG = select('#' + svgClass).selectAll('svg > g');
  const rectArea = svgG.append('g').attr('class', `rectArea-${id}`);

  const rows = rectArea.selectAll('g')
    .data(matrix)
    .enter().append('g').attr('class', 'row');

  rows.selectAll('rect')
    .data(function (this: SVGGElement, d: (CellData | number)[], i: number) {
      outer.set(this, i);
      return d;
    })
    .enter()
    .append('a')
    .attr('xlink:href', (d) => {
      if (linkURL && typeof d !== 'number') {
        let url = linkURL;
        if (urlVar1) url += `&var-${urlVar1}=${d.row}`;
        if (urlVar2) url += `&var-${urlVar2}=${d.col}`;
        return url;
      }
      return null;
    })
    .append('rect')
    .attr('id', `rect-${id}`)
    .attr('x', function (_d, i) {
      return xPos(colNames[i]);
    })
    .attr('y', function (this: SVGRectElement) {
      const outerIdx = outer.get(this)!;
      return yPos(rowNames[outerIdx]);
    })
    .attr('width', bandwidth)
    .attr('height', bandwidth)
    .attr('data', function (this: SVGRectElement, d, i) {
      const outerIdx = outer.get(this)!;
      return `${outerIdx}:${i} ${rowNames[outerIdx]}:${colNames[i]} ${d}`;
    })
    .attr('fill', (d) => {
      if (typeof d !== 'number' && d.color) {
        return d.color;
      }
      return defaultColor;
    })
    // Cell tooltip
    .on('mouseover', function (_event: MouseEvent, d: CellData | number) {
      if (typeof d === 'number') return;
      select(this)
        .attr('width', bandwidth + 5)
        .attr('height', bandwidth + 5)
        .attr('transform', 'translate(-1, -1)');

      let extrasHtml = '';
      if (d.extras && d.extras.length > 0) {
        for (const extra of d.extras) {
          const label = escapeHtml(extra.label);
          const text = escapeHtml(extra.display.text);
          const suffix = extra.display.suffix ? escapeHtml(extra.display.suffix) : '';
          extrasHtml += `<div class="${styles.tooltipTableCell}">
    <div class="${styles.tooltipTableRowLabel}">${label}</div>
  </div>
  <div class="${styles.tooltipTableCell}">
    <div class="${styles.tooltipTableRowValue}">${text}${suffix ? ' ' + suffix : ''}</div>
  </div>`;
        }
      }

      tooltip.html(`<div class="${styles.tooltipTable}">
  <div class="${styles.tooltipTableCell}">
    <div class="${styles.tooltipTableRowLabel}">${srcText}</div>
  </div>
  <div class="${styles.tooltipTableCell}">
    <div class="${styles.tooltipTableRowValue}">${escapeHtml(d.row)}</div>
  </div>
  <div class="${styles.tooltipTableCell}">
    <div class="${styles.tooltipTableRowLabel}">${targetText}</div>
  </div>
  <div class="${styles.tooltipTableCell}">
    <div class="${styles.tooltipTableRowValue}">${escapeHtml(d.col)}</div>
  </div>
  <div class="${styles.tooltipTableCell}">
    <div class="${styles.tooltipTableRowLabel}">${valText}</div>
  </div>
  <div class="${styles.tooltipTableCell}">
    <div class="${styles.tooltipTableRowValue}">${escapeHtml(d.display.text)} ${d.display.suffix ? escapeHtml(d.display.suffix) : ''}</div>
  </div>
${extrasHtml}</div>`)
        .transition().duration(150).style('opacity', 1);
    })
    .on('mousemove', function (event: MouseEvent) {
      moveTooltip(event, elem, tooltip);
    })
    .on('mouseout', function () {
      select(this)
        .attr('transform', 'translate(0, 0)')
        .attr('width', bandwidth)
        .attr('height', bandwidth);
      tooltip.transition().delay(100).duration(150).style('opacity', 0);
    })
    .on('click', function () {
      if (linkURL) {
        tooltip.remove();
      }
    });

  // Legend
  if (options.showLegend && legend.length > 0) {
    const legendClass = `legend-${id}`;

    if (options.legendType === 'range') {
      // Range legend: HTML color bar with min/max labels and hover values
      const legendDiv = select(elem)
        .append('div')
        .attr('class', `matrix-legend-${id}`)
        .style('padding', '8px 0');

      const barRow = legendDiv.append('div')
        .style('display', 'flex')
        .style('align-items', 'center');

      barRow.append('span')
        .style('font-family', theme.typography.fontFamily)
        .style('font-size', theme.typography.size.sm)
        .style('color', theme.colors.text.primary)
        .style('margin-right', '6px')
        .text(legend[0].label);

      // Group consecutive segments by color to show full range per color
      const colorGroups: { color: string; startLabel: string; endLabel: string; count: number }[] = [];
      for (let i = 0; i < legend.length; i++) {
        const last = colorGroups[colorGroups.length - 1];
        if (last && last.color === legend[i].color) {
          last.endLabel = legend[i].label;
          last.count++;
        } else {
          colorGroups.push({ color: legend[i].color, startLabel: legend[i].label, endLabel: legend[i].label, count: 1 });
        }
      }
      for (const group of colorGroups) {
        const rangeText = group.startLabel === group.endLabel
          ? group.startLabel
          : `${group.startLabel} - ${group.endLabel}`;
        barRow.append('div')
          .attr('class', `legend-bar-${id}`)
          .attr('title', rangeText)
          .style('width', `${group.count * 15}px`)
          .style('height', '14px')
          .style('background-color', group.color)
          .style('flex-shrink', '0');
      }

      barRow.append('span')
        .style('font-family', theme.typography.fontFamily)
        .style('font-size', theme.typography.size.sm)
        .style('color', theme.colors.text.primary)
        .style('margin-left', '6px')
        .text(legend[legend.length - 1].label);
    } else {
      // Categorical legend: HTML flexbox (wraps naturally within panel width)
      const legendDiv = select(elem)
        .append('div')
        .attr('class', `matrix-legend-${id}`)
        .style('display', 'flex')
        .style('flex-wrap', 'wrap')
        .style('gap', '8px 16px')
        .style('padding', '8px 0')
        .style('align-items', 'center');

      for (const item of legend) {
        const entry = legendDiv.append('div')
          .style('display', 'flex')
          .style('align-items', 'center')
          .style('gap', '6px');
        entry.append('div')
          .style('width', '12px')
          .style('height', '12px')
          .style('border-radius', '50%')
          .style('background-color', item.color)
          .style('flex-shrink', '0');
        entry.append('span')
          .style('font-family', theme.typography.fontFamily)
          .style('font-size', theme.typography.size.sm)
          .style('color', theme.colors.text.primary)
          .text(item.label);
      }
    }
  }
}
