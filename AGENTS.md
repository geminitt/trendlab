# TrendLab — Agent instructions (read before any change)

This file is **binding project context** for every engineer, coding agent, reviewer, or assistant working on this repository. Read [docs/PROJECT_CONSTITUTION.md](docs/PROJECT_CONSTITUTION.md) before planning, coding, writing PRs, or claiming completion.

## Non-negotiable product goal

Build a **personal, evidence-first global discovery and research system for ALL apps whose official store category is Education**, across **Google Play Android and Apple App Store iOS**. The user did **not** request a manually curated famous-app shortlist, a US-only tracker, or a Top Charts-only tracker. Apps newly entering the eligible universe must be discovered through a documented, recurring, auditable catalog discovery process, with honest coverage gaps.

1. Discovery and catalog updates are separate from metric collection. A continuous worker over a static ID list does not satisfy continuous discovery.
2. Collect observed store data repeatedly; prioritize both first observations and overdue refreshes. Target a 24-hour refresh for the known eligible catalog **only if measured source capacity makes it feasible**. Expose real attempted/succeeded/overdue coverage; never equate eligibility after 24h with guaranteed refresh.
3. No fabricated, modeled, or “estimated downloads” in the trusted-data pipeline. Always preserve source name, storefront, timestamp, original payload, exact field semantics, and quality flags. Android `maxInstalls` is not proven exact daily downloads; Apple competitor downloads are not publicly available. Ratings and rank movements are **proxies**, not downloads. Never mix country-scoped iOS ratings or incompatible Android/iOS units.
4. Trend scoring must distinguish accelerating, decelerating, persistent and noisy changes; reject insufficient/stale observation windows and backtest before claiming predictive accuracy.
5. The flagship UX is a precise, information-rich, interactive **treemap + research dashboard** with the visual rigor of karpathy.ai/jobs. Honest data-readiness information is supplementary; don't remove treemap entirely or invent scores to make the UI look populated.
6. The Ubuntu server operates unattended, with exactly one collector mode, audited discovery, reliable SQLite backup, measured freshness, and a private dashboard.
7. **Never call a partial feature “global market coverage,” “real-time,” “24-hour guaranteed,” or “validated trend” without concrete evidence.** Distinguish intent, implemented mechanism, measured results, and limits every time.

## Workflow rules

- Keep source of truth in `docs/PROJECT_CONSTITUTION.md` and update implementation status there when scope changes.
- Before changes: examine repository and tests; identify data provenance, failure semantics, backward compatibility, and Ubuntu migration risks.
- Each PR: state which acceptance criteria improve, what remains unresolved, add regression tests, avoid writing real data files or replacing production service config automatically.
- Use branches/PRs. Do not merge into `main`, delete SQLite history, or restart production units without explicit instruction.
- External sources: verify update timestamps, availability, licensing/terms, rate limits and coverage. No invisible estimating; a stale vendor dump cannot be presented as fresh discovery.
- Human-readable outputs and operator instructions should be in Vietnamese. English code and conventional identifiers are fine.
