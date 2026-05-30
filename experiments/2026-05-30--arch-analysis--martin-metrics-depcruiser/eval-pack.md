# Eval pack: 2026-05-30--arch-analysis--martin-metrics-depcruiser

1. **Condition 1:** Run `dependency-cruiser@17.4.0 --metrics --output-type json` against the TypeScript workspace `ws_apps/example-typescript/src`.
2. **Measurement:** Parse the resulting JSON to extract Martin metrics (Ca, Ce, I).
3. **Signal:** The JSON contains valid Ca, Ce, and I metrics for the analyzed modules, enabling a recommendation on adopting the Rust aggregator.
4. **Invalidation:** If `dependency-cruiser` fails to run, crashes, or the output JSON does not contain module/folder metrics.