# TrendLab — non-negotiable project instructions

**Read [docs/REQUIREMENTS_ACCEPTANCE.md](docs/REQUIREMENTS_ACCEPTANCE.md) before proposing architecture, collecting data, scoring trends, changing the UI, or declaring a task complete.** This document is the project's durable requirements and acceptance checklist.

- Scope: the official Education category on Android and iOS **worldwide**; no predefined shortlist, only famous apps, Vietnam-only, US-only, or chart-only substitute.
- Continuously discover previously unknown apps AND refresh existing ones. A chart sweep is a supplementary source, **never** proof of full discovery. Audit coverage against the known catalog and label its unknown denominator.
- Collection limits are **per cycle**, not lifetime caps. Measure attempts, success, unique apps observed, freshness, backlog, throughput, and realistic revisit latency. A 24-hour refresh is a target to prove, never a default guarantee.
- Preserve immutable raw observations and provenance. No estimated downloads, fabricated values, missing-as-zero, unverified maxInstalls semantics, or summing Android counters with iOS storefront ratings.
- Trend scores are provisional until adequate time series and validation. Expose readiness, uncertainty, and windows; do not market the prototype as validated predictive analytics.
- A high-quality, usable interactive treemap is essential, but UI polish must not conceal missing catalog coverage or weak data.
- Server runs unattended via systemd. Avoid duplicate collectors, destructive DB resets, and changes that disable backups. Preserve operational safety.
- Before calling a work item complete, report which acceptance criterion passed, which is only partially met, and which remains unsolved.
- User communication and deployment instructions: **Vietnamese**.

Important limitations today: AppGoblin import is not a verified auto-updating global feed; Top-K discovery misses non-charting and newly published apps; Android app collector currently uses a US lookup; source access and data semantics require auditing.
