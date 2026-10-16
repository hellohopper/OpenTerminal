# Chart drawings and comparison overlays

Open **CHART** and expand **Drawing tools**.

- Select **Horizontal line**, then click a price in the main chart pane. The line spans the chart with a price-axis label.
- Select **Trend line**, then click two different plotted times in the main pane. Either time order works. The segment connects the two price/time anchors; it does not extend as a ray. Clicks outside the available history cannot anchor a trend.
- **Navigate** or Escape cancels an unfinished drawing. Each completed drawing returns to navigation mode. Pan and zoom work normally in navigation mode.
- **Undo drawing** removes the latest drawing. Individual **Delete** controls and **Clear drawings** remove saved annotations. Creating more than 50 drawings discards the oldest.

Annotations use native chart coordinates, so they follow pan, zoom, resizing and price-chart type changes. They are saved locally for each widget ID, symbol and range. Select the same range to see its annotations again. Browser storage failure is reported; clearing browser data removes annotations. Annotations are not server-synced or included in workspace JSON exports. A newly created or duplicated widget has its own annotation collection. Price-chart settings, including range, retain their existing behavior and reset when the widget remounts.

## Compare assets on the chart

Enter one to three comma-separated symbols in **Chart comparison symbols**, then select **Overlay comparison**. The current chart symbol is always included, for up to four assets. The current range also applies to each comparison symbol. The mode plots closing-price lines on one normalized scale; all series start at 100 on their first exact shared timestamp. For example, 110 means a 10% price increase from that common starting sample.

Only timestamps present in every asset's history are plotted. Missing sessions are neither forward-filled nor interpolated. Daily or intraday feeds with different timestamps may have few or no common samples; the panel reports insufficient overlap or failed requests. Comparison inputs are temporary widget state.

Comparison mode temporarily hides price-unit drawings, indicators, volume and OHLC legends. Select **Price mode** to restore them. Chart style and indicator buttons are disabled during comparison. This avoids mixing price levels with normalized returns. Lines use distinct colors and symbol labels on the price scale. **JOURNAL SNAPSHOT** saves the displayed chart, with comparison symbols or drawing count recorded in the journal note.

Returns use each asset's own quote currency; there is no FX conversion or dividend adjustment. Provider split adjustment may differ between instruments. These are price comparisons, not total investment returns.

## Verification

Unit tests cover corrupt stored annotations, duplicate IDs, the 50-drawing limit, reversed trend anchors, shared-timestamp normalization and intraday samples with no overlap. Browser integration uses deterministic provider fixtures with the real API/web proxy to exercise drawing, persistence, range changes, cancellation, deletion, comparison, missing history and journal capture. Live provider availability is not part of that check.

Chart rendering uses the existing [Lightweight Charts price-line API](https://tradingview.github.io/lightweight-charts/tutorials/how_to/price-line) and line series.
