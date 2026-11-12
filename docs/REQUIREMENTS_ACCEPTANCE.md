# TrendLab — core requirements & acceptance criteria

Status: **binding product requirements**, not a claim that the current prototype satisfies them.
Owner intent: personal, continuously updated research of **all discoverable apps in the official Education category worldwide**, on Google Play and Apple App Store. The goal is to find observed emerging and sustained growth, not to present a curated popularity list.

## R1. Global catalog discovery (P0; NOT MET)

- Discover applications across markets and languages on **both** platforms without a predefined famous-app shortlist.
- Automatically ingest newly published or newly discovered applications, deduplicate by stable platform identity, record when/how each ID entered the catalog, and track subsequent removals, category moves and country availability.
- Seek a broad, regularly refreshed catalog source **subject to verified license, accessibility and provider limits**. Supplement with multi-country Top Charts, but never substitute Top Charts for complete catalog coverage.
- **Acceptance:** repeatable automated discovery without manual imports; recorded source and discovery timestamps; demonstrable daily catalog deltas; duplicate/identity tests; measured source coverage and its known limitations.
- **Known blocker:** no verified accessible feed that enumerates every currently live Education app worldwide. No full-global-coverage claim is permitted before this is resolved.

## R2. Continuous evidence collection and freshness (P0; PARTIAL)

- Persist real dated snapshots and revisit apps on an ongoing schedule. Balance first-time coverage vs revisits. Avoid competing systemd workers.
- Maintain per-source/country pacing, retry/backoff, errors, and clear distinctions between unlisted, unavailable in one region, changed category, and provider/API failures.
- A **24-hour revisit goal** is a performance target, not a promise from `refreshHours=24`.
- **Acceptance:** 24-hour reporting of unique successful apps, elapsed collection times, aged-out apps, per-country/provider error rates, freshness distributions, and measured capacity versus total due catalog. Verify the goal at observed throughput before declaring it met.

## R3. Observational data integrity (P0; PARTIAL)

- Save source, fetch time, storefront, raw payload/hash, native IDs, unit, and missingness.
- Never label iOS rating counts as installations or downloaded units. Do not treat Android public `maxInstalls` as precise daily downloads without verification. Do not sum incompatible Android/iOS dimensions; don't replace missing with zero.
- **Acceptance:** independent audits of raw snapshots to exported metrics, metric provenance and semantics, missing-data tests, and conspicuous uncertainty labels.

## R4. Validated trend detection (P1; NOT YET VALIDATED)

- Distinguish emerging breakouts, sustained growth, deceleration, reversals, persistence and noisy movements, across 7/14/30/90-day windows when valid evidence exists.
- Use robust time-series methods with minimum observation count, time span and recency. Separate observed rates from model inference.
- **Acceptance:** historical/forward-chaining backtests, baselines, precision/recall or rank stability, sensitivity to missing data, and reproducibility. Provisional model scores cannot be called verified.

## R5. Useful research dashboard (P1; PARTIAL)

- Interactive, dense, clearly labeled treemap with platform/source separation, documented area/color semantics, selection and provenance detail; avoid filler UI.
- Show observed scale separately from growth and distinguish unknown/unscored from negative growth. Deduplicate logical app identities in visible rankings.
- **Acceptance:** no unsupported visual claims; usable at early collection stages; tests of area, grouping, filtering, duplicates, accessibility and temporal metrics.

## R6. Unattended Ubuntu operations (P0; PARTIAL)

- Independent from the user's PC/SSH/browser. systemd services and timers for collection, discovery, analytics/export and backups; measured health and failures.
- Preserve SQLite/WAL integrity, atomic export and verified recoverable backups; avoid simultaneous duplicate collection and aggressive provider requests.
- **Acceptance:** restart/reboot and failure recovery tests, no overlapping workers, verified backups, monitoring of cycle reports, and successful autonomous discovery of a genuinely new app.

## Truthful status reporting

Use **MET**, **PARTIAL**, **NOT MET**, or **BLOCKED** separately for each criterion. The existing ~331k-ID local catalog is *not* an audited global census. Chart-only discovery can be a worthwhile interim step, but R1 remains unmet. A continuously looping process alone does not prove R2's daily freshness target.

## Immediate execution priorities

1. Make basic Top-Chart discovery run unattended, with coverage and scope clearly labeled. This is **only a supplemental discovery layer**.
2. Verify and integrate a continuously refreshed licensed catalog data source; add identity/provenance and daily-change tracking. Investigate alternatives if no comprehensive source exists.
3. Measure actual collection capacity and country-specific availability before scaling. Fix one-country assumptions and high false-delist rates.
4. Verify data integrity; then backtest models and refine treemap/UI.

This file supersedes optimistic language elsewhere in the repository when statements conflict.
