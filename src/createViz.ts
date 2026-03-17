import { GrafanaTheme2 } from '@grafana/data';
import { select, local } from 'd3-selection';
import { scaleBand } from 'd3-scale';
import { axisTop, axisLeft } from 'd3-axis';
import 'd3-transition';
import { escapeHtml } from './escapeHtml';
import { CellData, LegendItem, MatrixOptions, ParsedData } from './types';
import { TooltipStyles, moveTooltip, truncateLabel } from './tooltip';

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

  const margin = { top: colTxtOffset, right: 0, bottom: 0, left: rowTxtOffset };
  const width = colNames.length * cellSize;
  const height = rowNames.length * cellSize;

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

  // X axis (columns, top)
  const x = scaleBand<string>().range([0, width]).domain(colNames).padding(cellPadding);
  svg.append('g').call(axisTop(x)).select('.domain').remove();
  svg.selectAll<SVGTextElement, string>('text')
    .attr('style', 'text-anchor:start')
    .attr('transform', 'translate(12,-12)rotate(-90)');

  // Y axis (rows, left, reversed)
  const y = scaleBand<string>().range([height, 0]).domain(rowNames.slice().reverse()).padding(cellPadding);
  svg.append('g').call(axisLeft(y)).select('.domain').remove();

  // Style all axis labels
  svg.selectAll<SVGTextElement, string>('text')
    .attr('font-size', txtSize + 'em')
    .style('font-family', theme.typography.fontFamily)
    .attr('fill', theme.colors.text.primary)
    .call(truncateLabel, txtLength)
    .on('mouseover', function (_event: MouseEvent, d: string) {
      tooltip.html(escapeHtml(d))
        .transition().duration(150).style('opacity', 1);
    })
    .on('mousemove', function (event: MouseEvent) {
      moveTooltip(event, elem, tooltip);
    })
    .on('mouseout', function () {
      select(this).attr('opacity', '1');
      tooltip.transition().delay(100).duration(150).style('opacity', 0);
    });

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
      return x(colNames[i]) ?? 0;
    })
    .attr('y', function (this: SVGRectElement) {
      const outerIdx = outer.get(this)!;
      return y(rowNames[outerIdx]) ?? 0;
    })
    .attr('width', x.bandwidth())
    .attr('height', y.bandwidth())
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
        .attr('width', x.bandwidth() + 5)
        .attr('height', y.bandwidth() + 5)
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
        .attr('width', x.bandwidth())
        .attr('height', y.bandwidth());
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
    select(elem)
      .append('div')
      .attr('class', `matrix-legend-${id}`)
      .append('svg')
      .attr('id', legendClass);

    const legendSvg = select(`#${legendClass}`);

    if (options.legendType === 'range') {
      // Range legend: color bar with min/max labels
      legendSvg
        .attr('width', 25 + (legend.length - 1) * 10 + legend[legend.length - 1].label.length * 9)
        .attr('height', 50 + 16)
        .append('g')
        .selectAll('rect')
        .data(legend)
        .enter()
        .append('rect')
        .attr('class', `legend-bar-${id}`)
        .attr('width', 10)
        .attr('height', 10)
        .attr('fill', (d) => d.color)
        .attr('x', (_d, i) => 25 + i * 10)
        .attr('y', 20);
      legendSvg.append('g')
        .selectAll('text')
        .data(legend)
        .enter()
        .append('text')
        .attr('x', (_d, i) => 20 + i * 10)
        .attr('y', 50)
        .text((d, i) => (i === 0 || i === legend.length - 1) ? d.label : '')
        .attr('fill', theme.colors.text.primary);
    } else {
      // Categorical legend: circles with labels
      legendSvg
        .attr('width', 25 + (legend.length - 1) * 75 + 20 + legend[legend.length - 1].label.length * 9)
        .attr('height', 50 + 16)
        .append('g')
        .selectAll('circle')
        .data(legend)
        .enter()
        .append('circle')
        .attr('class', `legend-circle-${id}`)
        .attr('r', 10)
        .attr('fill', (d) => d.color)
        .attr('cx', (_d, i) => 25 + i * 75)
        .attr('cy', 20);
      legendSvg.append('g')
        .selectAll('text')
        .data(legend)
        .enter()
        .append('text')
        .attr('x', (_d, i) => 15 + i * 75)
        .attr('y', 50)
        .text((d) => d.label)
        .attr('fill', theme.colors.text.primary);
    }
  }
}
