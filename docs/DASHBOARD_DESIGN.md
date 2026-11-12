# TrendLab — Research UI: treemap-first, minimal and evidence-aware

This document describes the current interface and supersedes the older reference-inspired 2-column analytics layout.

## Intent

Follow the research-first interaction of Karpathy Jobs rather than importing unrelated Cloud Dashboard reporting components. The homepage should make the **app treemap, meaningful controls, and a few truthful metrics** dominant. Infrastructure charts (daily collector activity, attempts, backups) do **not** belong on the research homepage; available exported activity remains in `data.json` for future operations monitoring.

## Page hierarchy

1. Clear title, brief explanation of source semantics.
2. Controls: Android / iOS / All (separate), metric/layer, time window and search.
3. Compact metrics: known catalog platform rows, observed platform rows + catalog-local coverage, valid model evidence among filtered distinct apps, and recently observed rows (48h).
4. **Full-width treemap** with one rectangle per distinct measured native store app; click for history/provenance. All distinct eligible apps are displayed by default without an arbitrary 24/64-app cutoff.
5. Minimal source-unit/color/area legend; the detail drawer stays available for individual records.

## Critical correctness rules

- Default view: **Android only**, so a single treemap has a consistent source unit and many application rectangles. iOS only is an independent treemap based on US rating counts. The All view is optional and displays **two separate coordinate panels**, not a falsely comparable combined market scale.
- Android `maxInstalls` source semantics are unverified. iOS source counter is **US rating count**, not downloads. Both use `log10(count + 10)^2` for legible rectangle area. This is **not proportional market share** (unlike the employment-area example in Karpathy Jobs).
- Color in the default layer reflects source-matched **1–5 user rating**, anchored red→amber→green; gray means missing score. The growth layers are provisional models, per-platform normalizations; they are not validated forecasts.
- A Top-N or search filter **must never alter raw snapshots, model calculations or the catalog**. Top-N is omitted by default. Only users' visible selection changes.
- Native store IDs are deduplicated within each platform, without silently equating Android/iOS apps.
- Insufficient evidence for a requested trend layer must render a compact message, not fake positive/negative scores; observed scale remains available.
- Long-term large-catalog performance will eventually require zoom/drilldown or progressive rendering; do not reinstate a silent Top-24 cutoff as a workaround.

## Deployment after merge

```bash
cd ~/trendlab
git pull --ff-only origin main
npm ci
npm test
node bin/cli.js export
```

Open the existing localhost dashboard and perform **Ctrl+Shift+R**. The currently running static server reads web files on each request; monitor, discovery, analytics, and backup services should not be restarted. There is no DB migration.

## Unmet research requirements

True worldwide Education app discovery, a verified 24h refresh SLA across the known catalog, and validated growth scoring remain incomplete. See `docs/REQUIREMENTS_ACCEPTANCE.md`. This is a UI/layout change, **not** an improvement to the observation/collection pipeline.
