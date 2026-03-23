import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { select } from 'd3-selection';

export const getStyles = (theme: GrafanaTheme2) => ({
  tooltip: css`
    background-color: ${theme.components.tooltip.background};
    color: ${theme.components.tooltip.text};
    font-family: ${theme.typography.fontFamily};
    font-size: ${theme.typography.size.sm};
    font-weight: ${theme.typography.fontWeightRegular};
    border: 1px solid ${theme.colors.border.weak};
    border-radius: ${theme.shape.radius.default};
    box-shadow: ${theme.shadows.z3};
    padding: 5px;
    z-index: 500;
    position: absolute;
    width: fit-content;
    pointer-events: none;
  `,
  tooltipTable: css`
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 2px;
    padding: 3px;
  `,
  tooltipTableCell: css`
    display: flex;
    -webkit-box-align: center;
    align-items: center;
  `,
  tooltipTableRowLabel: css`
    color: ${theme.colors.text.secondary};
    margin-right: 16px;
  `,
  tooltipTableRowValue: css`
    font-weight: ${theme.typography.fontWeightMedium};
  `,
});

export type TooltipStyles = ReturnType<typeof getStyles>;

/**
 * Move tooltip element to follow the mouse, clamped within the scroll container.
 */
export function moveTooltip(
  event: MouseEvent,
  elem: HTMLElement,
  tooltip: ReturnType<typeof select<HTMLDivElement, unknown>>
): void {
  const elemRect = elem.getBoundingClientRect();
  const scrollRect = elem.parentElement!.getBoundingClientRect();
  const tooltipRect = tooltip.node()!.getBoundingClientRect();

  // Position relative to elem, not the event target
  const mouseX = event.clientX - elemRect.left + elem.scrollLeft;
  const mouseY = event.clientY - elemRect.top + elem.scrollTop;

  const mouseDistance = 10;
  const xMax = scrollRect.width + elem.parentElement!.scrollLeft - tooltipRect.width;
  const yMax = scrollRect.height + elem.parentElement!.scrollTop - tooltipRect.height;

  let xPos: number;
  if (mouseX - mouseDistance >= 0 && mouseX + mouseDistance >= xMax) {
    xPos = Math.max(mouseX - tooltipRect.width - mouseDistance, 0);
  } else {
    xPos = Math.min(mouseX + mouseDistance, xMax);
  }

  let yPos: number;
  if (mouseY - mouseDistance >= 0 && mouseY + mouseDistance >= yMax) {
    yPos = Math.max(mouseY - tooltipRect.height - mouseDistance, 0);
  } else {
    yPos = Math.min(mouseY + mouseDistance, yMax);
  }

  tooltip.style('left', `${xPos}px`).style('top', `${yPos}px`);
}

/**
 * Truncate D3 text labels to a maximum character length, appending "...".
 */
export function truncateLabel(
  text: ReturnType<typeof select>,
  width: number
): void {
  text.each(function (this: SVGTextElement) {
    let label = select(this).text();
    if (label.length > width) {
      label = label.slice(0, width) + '...';
    }
    select(this).text(label);
  });
}
