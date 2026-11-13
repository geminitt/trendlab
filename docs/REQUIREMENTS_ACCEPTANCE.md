# TrendLab — Binding Vietnam research requirements (2026-11-13)

**The owner changed the project scope from worldwide to Vietnam.** This document supersedes all earlier worldwide requirements and conflicting global-market claims elsewhere in the repository. This is a research prototype, not an audited census or a source of verified daily downloads.

## Goal

Discover and monitor apps offered in the **official Education category in the Vietnamese storefront** of **both Google Play and the Apple App Store**. Analyze meaningful changes in observed source counters, VN-specific ratings and Education VN chart rankings, seeking small emerging apps as well as well-known ones. The app developer does **not** need to be Vietnamese. Keep Android and iOS separate when their measurement units differ.

## R1 — VN-specific discovery and universe (P0; PARTIAL)

- `VN` is the only active lookup/chart country; never silently probe US/JP or label US observations as Vietnam evidence.
- The old ~331k-ID imported international AppGoblin catalog remains a **candidate pool**, not the number of Education apps available in Vietnam. Keep it; it can be sampled conservatively and should never be called Vietnam coverage.
- Apps seen on VN Education charts OR found by successful VN storefront lookups are VN-evidenced candidates. Store chart/source/date/availability and maintain distinct platform-native identities. Do not declare global delisting because one country returns a 404.
- VN Top-Free Education charts are supplemental and incomplete, particularly for new, niche, paid, lower-ranked apps; the collector reserves a capped exploration lane of unknown catalog IDs. These sources do not prove completeness.
- **Acceptance:** repeatable daily VN discovery with measured chart and first-seen deltas; known distinction between regional evidence, trial candidate and not-found; confirmed coverage limitations; proof that genuinely new VN app IDs can enter the catalog.
- **Remaining blocker:** there is no verified exhaustive, live list of all Education apps available in VN. Do not claim complete market coverage.

## R2 — Relevant throughput and ongoing freshness (P0; PARTIAL)

- Optimize **new distinct VN-measured apps/day** and freshness of VN-evidenced apps, NOT raw attempt volume.
- Prefer known VN Education chart/lookup apps; reserve bounded capacity for unverified candidate exploration (initially 20%). Do not fill all unused slots with likely unrelated international IDs.
- Keep per-app per-VN-storefront collection state, rate limits, jitter and retry backoff. Regional not-found responses receive longer retry delays and must not trigger system-wide rate-limit cooldown; 429/network errors do.
- An aspirational 24-hour revisit goal needs observed measurements of daily throughput, success, latency and backlog before it can be advertised as achieved.
- **Acceptance:** demonstrated VN-only continuous collection across both platforms with per-country first observation/refresh and error reporting, no overlapping workers, safe operation after server restarts.

## R3 — Provenance and meaning of Vietnam trends (P0; PARTIAL)

- Store immutable raw snapshots, numeric observation times, country and source evidence.
- Apple `userRatingCount` observed from `country=vn` is VN storefront-specific; do not mix with `us`, `jp` or global. Source counter `maxInstalls` from Android **is NOT Vietnam-specific installs/downloads** even when the app is queried with `country=vn`. It may be used only as an explicitly labeled broad/possibly global public counter for an app available in VN.
- VN Education chart rank is country-specific, but chart-only snapshot has **no rating/install value** and must not be made into a fake zero or downloaded-user estimate. A separate rank-change model should be developed and validated.
- Source data from US/other markets can remain in SQLite for archival comparison but is excluded from VN scoring, VN treemap and VN metric history.
- **Acceptance:** tests prove US/JP observations cannot influence VN count, score or star-color; source-semantic caveats shown in UI.

## R4 — Verified trend ranking (P1; NOT MET)

- Keep time windows 7/14/30/90/all, require sufficient dated points, temporal coverage and freshness, separate observations from predictions and missing values from zero.
- Model Breakout and Sustained scores remain provisional until backtests/forward validation and stability tests on **VN-scoped time series**; chart rank momentum not yet modeled. No fabricated Vietnamese downloads.
- **Acceptance:** reproducible backtests, baselines and evidence quality statistics on VN cohorts.

## R5 — Research treemap (P1; PARTIAL)

- Simple Karpathy-style treemap-first layout with metric-proportional rectangle area, Android/iOS source-unit isolation, local market provenance, clear missing states, search and detail.
- VN-specific labels and counts; **no global catalog count presented as VN candidate population**.
- No silent Top-N cutoff affecting analytics or selection of chart/trend data. Avoid unrelated collector monitoring charts on the research homepage.
- **Acceptance:** tested VN dataset export, meaningful source labels, area ratios, color segmentation and honest completeness statements.

## R6 — Unattended and safe Ubuntu operations (P0; PARTIAL)

- Keep backups, SQLite WAL integrity and independent systemd services (monitor, discover, analytics/export, backup) working after reboots; **never run hourly collector and continuous monitor together**.
- The installed `trendlab-monitor.service` and `trendlab-discover.service` may still explicitly pass `us,vn,gb,de,jp,in`; they **must be updated to VN** during deployment. CLI refuses non-VN market flags to prevent silent contamination.
- **No destructive database reset by default.** The owner is willing to restart fresh if it materially improves performance, but deleting historical rows does not improve provider request throughput; any optional archive/reset requires a verified restorable backup and explicit, justified procedure.
- **Acceptance:** tested install/rollout, only VN requests in logs, safe backout procedure, existing backup/analytics timers preserved.

## Priority and truthful status

1. Deploy VN-only scheduler + systemd market overrides and start VN chart sweep safely.
2. Measure useful VN coverage, first observations, error types, stable response latency and refresh capacity.
3. Improve market discovery beyond Top-Free Education charts without claiming complete VN coverage.
4. Validate source metadata/market definitions; build a VN chart-rank momentum model and backtest growth algorithms.
5. Continue improving drilldown/zoom when many true linear-area tiles are tiny.

Report **MET / PARTIAL / NOT MET** per requirement. Never confuse a foreign app's presence in the global candidate catalog with availability in Vietnam.
