# Changelog

## Unreleased

### Time Series Support
- **Time modes**: last (default) and timelapse with two sub-modes (step / animate)
- **Playback bar**: appears when time mode is timelapse, with interactive
  sub-mode switcher and unicode transport controls
- **Lazy fetch**: animate sub-mode fetches range data on demand via datasource
  API, so dashboards load fast even with large time ranges
- **Stepping**: shifts dashboard time window forward/backward by configurable
  interval (15m to 30d)
- **Animate**: fetches 120 frames covering the dashboard time range, rewrites
  `$__range` to `$__interval` for proper per-frame windowing

### New Categorize Features (from upstream PR #26 `categorize` branch)
- **Column grouping**: group columns by a category field with visual gaps and
  rotated category headers (options: `enableColGrouping`, `colCategoryField`,
  `colCategoryHeaderHeight`, `colCategoryGap`)
- **Row grouping**: group rows by a category field with visual gaps and
  horizontal category headers (options: `enableRowGrouping`, `rowCategoryField`,
  `rowCategoryHeaderWidth`, `rowCategoryGap`)
- Both grouping axes can be used simultaneously
- Duplicate-cell guard: skip overwrite when `dataMatrix[r][c]` is already populated

### Improved Legends
- Use HTML elements for both categorical and continuous legends, allowing the
  former to line wrap and the latter to have a working tool tip, use values from
  the thresholds instead of sampling.

### Test dashboard
- Added Panel 9 (column grouping by region), Panel 10 (row grouping by tier),
  Panel 11 (both axes grouped simultaneously)

### Modernized Build system
- Replaced webpack + 1.7 GB `node_modules` with **bun** (`build.mjs`, ~200 lines)
- Zero npm build dependencies, only needs the bun binary; the old version 
  was webpack + @grafana/toolkit + 900 transitive deps where a single mismatch
  broke the build. Now the build has zero npm deps, bun parsing TypeScript
  directly. The type deps are optional. 
- AMD wrapper handles minified output via
  single-pass regex (no per-dependency loop)
- Classic JSX transform (`React.createElement`) for Grafana SystemJS compatibility
- `--watch` and `--production` flags; linked sourcemaps

### New features
- **Field name pickers** for source, target, and value fields with 3-way fallback:
  `field.name` → `displayNameFromDS` → `getFieldDisplayName()` (from PR #22)
- **Configurable sort**: none / natural-asc / natural-desc (was hardcoded lexicographic)
- **Fit to panel width**: scales cells down to fit available width
- **Extra tooltip fields**: comma-separated field names shown in cell tooltip
- **Migration handler**: dashboards without `sortType` default to `natural-asc`

### Bug fixes
- **Legend NaN..NaN**: filter NaN/null values before computing min/max range
- **Categorical legend overflow**: replaced fixed-width SVG with HTML flexbox (wraps)
- **Hooks violation**: `useTheme2`, `useStyles2` moved inside React component
- **Missing useEffect deps**: added proper dependency array (was rebuilding D3 every render)
- **CSS typo**: `border-radius` line ended with `:` instead of `;`
- **Static list crash**: null-guard for undefined `staticRows` / `staticColumns`
- **Shadowed parameter**: removed duplicate `height` binding in matrix renderer

### Code quality (from PR #20)
- Full TypeScript types for all interfaces (`MatrixOptions`, `CellData`, `ParsedData`, etc.)
- `const`/`let` throughout, no `var`
- Type-safe equality operators (`===` / `!==`)

### Removed
- `d3.min.js` vendored blob (280 KB) → tree-shaken d3 submodules (~40 KB bundled)
- `sanitize-html` (776 KB + 6 deps) → 11-line `escapeHtml.ts`
- `matrixLegend.js` (dead code, never imported)
- `useD3.js` / `useD3.d.ts` (replaced by direct `useEffect` + `useRef`)
- `module.test.ts` (stub with no real tests)
- `.config/` webpack scaffolding, `docker-compose.yaml`, `jest.config.js`
- `yarn.lock` (10,948 lines)

### Size reduction

| Metric           | Before                        | After              |
|------------------|-------------------------------|--------------------|
| `dist/module.js` | 468 KB                        | 56 KB (prod)       |
| Build deps       | 1.7 GB                        | 0 (bun binary)     |
| d3               | 280 KB blob                   | ~40 KB tree-shaken |
| sanitize-html    | 776 KB + 6 deps               | 11 lines           |
| Source files     | 8 mixed .js/.ts + .d.ts stubs | 8 clean .ts/.tsx   |

# 2.0.2
- renamed from ESNET to Esnet Matrix Panel

## 2.0.1
- tooltip improvements
- minor fixes to layouts & padding
- bumped d3 version

## 2.0.0
- bumped minimum version of Grafana to Grafana 10
- fixed tooltip bug
- added legend

## 1.2.0
- Fixed tooltip to work with Grafana 12
- Fixed tooltip on link click bug
- Added legend feature.  2 options categorical or range

## 1.0.9
update grafana tooling to webpack

## 1.0.6
Allow for up to 200 UNIQUE rows and columns
Print "No Data" instead of throwing error if dataframe is empty

## 1.0.5
Fixed repo link
Fixed bug with null color values
