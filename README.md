# Matrix Panel Plugin

A Grafana panel that renders a 2D matrix showing relationships between two categorical fields (e.g. source x destination). Cell color is driven by a numeric value field and Grafana's threshold system.

This is a fork of [esnet/esnet-matrix-panel](https://github.com/esnet/esnet-matrix-panel) with added time series support: animated timelapse playback (up to 30 days), stepping, and an interactive playback bar. Requires a Prometheus-compatible datasource for timelapse features. Works well for visualizing how relationships between dimensions change over time. Limit is 200 unique rows or columns. Thanks to ESnet for the original plugin. See [CHANGELOG.md](CHANGELOG.md) for a full list of changes.

![Matrix panel screenshot](dist/img/matrix-plugin.webp)

## Building

Requires [Bun](https://bun.sh) (v1.0+). Install it with:

```bash
curl -fsSL https://bun.sh/install | bash
```

Then:

```bash
# Install type dependencies (only needed once, or after changing package.json)
bun install

# Development build with file watching
bun run dev

# Production build (minified)
bun run build

# Type-check without emitting
bun run typecheck
```

Output goes to `dist/`.

## Installing

```bash
rsync -a --delete dist/ /var/lib/grafana/plugins/esnet-matrix-panel/ 
sudo systemctl restart grafana-server # on server
```

Then hard-reload the browser (Ctrl+Shift+R) to pick up the new module.

## Panel Options

### Row/Column Options

| Option | Description |
|--------|-------------|
| **Sort Type** | How row and column labels are ordered: *None*, *Natural ascending* (e.g. "node2" before "node10"), or *Natural descending*. |
| **Use Static Row/Column Lists** | When enabled, provide fixed comma-separated row and column names instead of deriving them from the data. |
| **Rows / Columns / Value Field** | Field pickers for the data fields that map to matrix rows, columns, and cell values. Uses a 3-way fallback: `field.name` -> `displayNameFromDS` -> `getFieldDisplayName()`. |

### Display

| Option | Description |
|--------|-------------|
| **Show Legend** | Adds a legend below the matrix. |
| **Legend Type** | *Range* shows a gradient bar with min/max labels. *Categorical* shows colored circles for each distinct threshold value (wraps with flexbox). |
| **Source / Target / Value Text** | Custom labels shown in the cell tooltip (defaults: "From", "To", "Value"). |
| **Fit to Panel Width** | Scales the matrix down via SVG viewBox so all columns fit within the panel width. |
| **Extra Tooltip Fields** | Comma-separated field names (e.g. `Loss,p10,p90`) to include as additional rows in the cell tooltip. |
| **Cell Size** | Width and height of each cell in pixels (10-50, default 15). |
| **Cell Padding** | Relative padding between cells (0-100, default 5). |
| **Text Length** | Max characters before label truncation with "..." (default 50). |
| **Text Size** | Font size for axis labels in scaled em units (default 10). |
| **Null Color** | Color for cells where the query returned null. |
| **No Data Color** | Color for source/target pairs with no matching data. |

### Grouping

| Option | Description |
|--------|-------------|
| **Enable Column Grouping** | Group columns by a category field with visual gaps and rotated headers. |
| **Column Category Field** | The field whose values define column categories (e.g. "region"). |
| **Category Header Height** | Height in pixels for rotated category header labels (20-300, default 100). |
| **Gap Between Column Groups** | Extra spacing in pixels between category groups (0-200, default 4). |
| **Enable Row Grouping** | Group rows by a category field with visual gaps and horizontal headers. |
| **Row Category Field** | The field whose values define row categories (e.g. "tier"). |
| **Row Category Header Width** | Width in pixels for row category header labels (50-300, default 100). |
| **Gap Between Row Groups** | Extra spacing in pixels between row groups (0-200, default 4). |

Both column and row grouping can be used simultaneously.

### Colors

Cell color is determined by the numeric value field and the **Thresholds** configured under Grafana's standard *Field Configuration* options.

### Link Options

| Option | Description |
|--------|-------------|
| **Add Data Link** | When enabled, clicking a cell navigates to a configured URL. |
| **Link URL** | Base URL to navigate to on cell click (e.g. `/d/my-dashboard?`). Must end with `?` so that variable parameters are appended correctly. |
| **Variable 1** | Name of a Grafana template variable that receives the row (source) label. Appended as `&var-<name>=<row>`. |
| **Variable 2** | Name of a Grafana template variable that receives the column (target) label. Appended as `&var-<name>=<col>`. |

### Time Series

| Option | Description |
|--------|-------------|
| **Time Mode** | *Last* (default) shows the most recent value -- no bar, no extra fetches. *Timelapse* shows the playback bar with Step and Anim sub-modes. |
| **Step Interval** | How far to shift the dashboard time window per step (15m to 30d). Visible when Time Mode is Timelapse. |
| **Animation Speed (ms)** | Milliseconds between frames during Anim playback (50-5000, default 1000). Visible when Time Mode is Timelapse. |

When Time Mode is *Timelapse*, a playback bar appears at the bottom of the panel. The bar has two sub-mode buttons: **Step** (shifts the Grafana dashboard time window) and **Anim** (fetches 120 frames covering the current dashboard time range and plays them back client-side). Use the Grafana time range picker at the top of the page to control how much history Anim loads. Sub-mode can be toggled at any time from the bar without opening panel edit.

### Query setup

A single query works for both time modes. Write your query using `$__range` and set the query type to **Instant**:

    avg_over_time(my_metric{source=~".+", target=~".+"}[$__range])

**How this works across modes:**

In **Last mode**, Grafana sends an instant query. Prometheus evaluates `avg_over_time(metric[24h])` once at the current timestamp -- one evaluation covering the full dashboard window. Fast.

In **Timelapse / Anim sub-mode**, the plugin fetches range data behind the scenes when you click "Anim". To make the animation show real temporal change, it automatically:

1. Switches the query from instant to range (120 evaluation steps)
2. Rewrites `$__range` to `$__interval` in your expression

This turns `avg_over_time(metric[$__range])` into `avg_over_time(metric[$__interval])`, where `$__interval` is the dashboard time range divided by 120 frames. The dashboard time range picker controls how much history is animated.

Without this rewrite, every frame would compute `avg_over_time(metric[6h])` -- a sliding window equal to the full range -- and all 120 frames would look nearly identical.

| Dashboard time range | Frame interval | PromQL window per frame |
|----------------------|----------------|-------------------------|
| 1 hour               | 30s            | `avg_over_time(m[30s])` |
| 3 hours              | 90s            | `avg_over_time(m[90s])` |
| 24 hours             | 12 min         | `avg_over_time(m[12m])` |
| 7 days               | 84 min         | `avg_over_time(m[84m])` |
| 30 days              | 6 hours        | `avg_over_time(m[6h])`  |

In **Timelapse / Step sub-mode**, Grafana shifts the dashboard time window by the step interval and re-executes your query as-is. No rewrite needed.

**If you don't need server-side averaging**, just use the raw metric with Instant type:

    my_metric{source=~".+", target=~".+"}

Last mode returns the latest sample. Anim sub-mode returns one sample per frame with carry-forward for gaps.

## Test Dashboard

A comprehensive test dashboard is included at [`doc/test-dashboard.json`](doc/test-dashboard.json). It uses the built-in **TestData** datasource to exercise every panel option without needing a real data source.

To use it:

1. In Grafana, go to **Connections -> Data sources -> Add data source** and add **TestData DB** (search for "TestData"). No configuration needed.
2. Import the dashboard via **Dashboards -> Import**, then paste or upload `doc/test-dashboard.json`.

The dashboard contains 17 panels covering:

| Panel | What it tests |
|-------|---------------|
| 1. Categorical Legend | `showLegend` + categorical type with colored circles |
| 2. Data Links | Cell click -> URL with template variables |
| 3. Static Rows/Columns | Fixed row/column lists via `staticRows`/`staticColumns` |
| 4a-c. Sort Variants | `none`, `natural-asc`, `natural-desc` side by side |
| 5. Null + Missing Data | `nullColor` and `defaultColor` rendering |
| 6. Field Pickers | Explicit `sourceField`/`targetField`/`valueField` selection |
| 7. Migration | Panel saved without `sortType` (tests migration handler) |
| 8. Empty Query | No data -> "No Data" message |
| 9. Column Grouping | Columns grouped by region category |
| 10. Row Grouping | Rows grouped by tier category |
| 11. Both Axes Grouped | Column and row grouping simultaneously |
| 12. Timelapse (CSV) | `timeMode=timelapse` with time series CSV data |
| 13. Timelapse (Prometheus) | `timeMode=timelapse` with real datasource, `stepInterval=15m` |
| 14. Animation Playback | `timeMode=timelapse` with `animationSpeedMs=500` |
| 15. Extra Tooltip Fields | `extraTooltipFields="p50,p99"` adds columns to tooltip |
| 16. Custom Styling | Non-default `cellPadding=15`, `txtSize=14`, `txtLength=8` |
| 17. Custom Grouping Headers | Non-default `colCategoryHeaderHeight=160`, `rowCategoryHeaderWidth=140` |
