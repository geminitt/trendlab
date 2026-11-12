# TrendLab visual dashboard — reference-inspired redesign

## Visual intent
The user supplied a cloud dashboard screenshot as a **layout reference**: a large treemap on the left, four clearly structured KPIs on the top right, and a 2×2 grid of small trend panels below. We adapt the visual hierarchy and high-contrast color language, **not** the cloud-dashboard's unrelated user counts, traffic, incidents or uptime.

## What is actually measured

- **Treemap**: the 24 highest measured distinct native store IDs **per platform**. Android and iOS have separate, equal-width panels; tile weights are `log10(count + 10)^2`, which is a *display transform*, not market share. Android `maxInstalls` semantics remain unverified; iOS uses US rating count only. Color uses anchored source-specific user star-rating thresholds, not inferred growth. Native IDs are deduplicated across storefront catalog rows.
- **Top KPIs**: local catalog platform record count, platform records with at least one observed metric, local observation coverage, and platform records observed within the last 48 hours. They do not claim global market coverage.
- **Daily Observations**: count of recorded `observed_metrics` rows per UTC date over 30 dates. Some rows are chart/rank observations; they are not downloads or unique active users.
- **First Observations**: platform IDs with their earliest ever `observed_metrics` record on each UTC date, not apps first published to app stores.
- **Collection Reliability**: outcomes of completed collection audit cycles per day, plotted as attempted successes/failures. There can be repeat attempts; no unique-user inference.
- **Evidence Freshness**: age buckets for `lastObservedAt` among observed catalog rows; catalog IDs without observations are excluded. No fake zeros.
- **App directory**: collapsible below the main dashboard, searchable and deduplicated by native ID within each platform. Original app inspector remains available.

The global research overview and 30-day charts do **not** change with treemap's platform/search filter; this deliberate choice should remain clear via the “GLOBAL OBSERVED SET” label. Treemap tiles and directory do respond to search, platform and metric filters.

## Deployment
After PR merge on Ubuntu:
```sh
cd ~/trendlab
git pull --ff-only origin main
npm ci
npm test
node bin/cli.js export
```

Reload `http://localhost:8080` with Ctrl+Shift+R through the existing SSH tunnel. The server's `serve` process rereads assets for each request; no collector or timer restart is necessary. The existing daily analytics/export timer will also regenerate the new activity series on its next run.

## Known constraints
- Still only a prototype with limited known-catalog coverage and an unverified Android install-count source.
- Activity is derived from existing observation and audit tables. The graphs are not daily-download, DAU, network-traffic, app-uptime or growth forecasts.
- The 24-app-per-platform visualization limit is a presentation choice only; the rest remain searchable in the app directory. It must never be confused with the collection limit or catalog size.
- This PR is a layout/observability improvement only. Global long-tail discovery, measured 24-hour refresh feasibility and validated growth modeling remain separate unmet acceptance criteria.
