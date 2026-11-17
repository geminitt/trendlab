<div align="center">

# TrendLab

![Python 3.11+](https://img.shields.io/badge/Python-3.11%2B-498AF2?style=for-the-badge)
![JavaScript](https://img.shields.io/badge/JavaScript-Canvas-A19654?style=for-the-badge)
![Tests](https://img.shields.io/github/actions/workflow/status/geminitt/trendlab/test.yml?branch=main&style=for-the-badge&label=tests&color=498AF2)
![License ISC](https://img.shields.io/badge/License-ISC-6B7F4E?style=for-the-badge)

**Explore what people are reading on Wikipedia through a treemap of real pageviews.**

Inspired by [karpathy/jobs](https://github.com/karpathy/jobs).

</div>

---

## Explore the map

The bundled data contains English and Vietnamese Wikipedia samples. Serve the
static dashboard from the repository root:

```bash
python3 -m trendlab serve
```

Open **http://127.0.0.1:8080**. Serving does not contact Wikipedia or refresh data.
No Python runtime dependencies are required. For an isolated environment, use
`pixi install --locked` followed by `pixi run serve`.

| Control | Behavior |
|---|---|
| Wikipedia edition | Switch between collected language editions; each has its own data and date |
| Period | Show 1, 7 or 30 complete UTC days |
| Show | Filter rising, falling or zero-prior-view articles |
| Search | Find an article by title |
| Map / List | Switch between proportional tiles and an accessible article table |
| Article details | Inspect daily history, exact values and original source links |

**Area is linear in recorded pageviews.** Color is percentage change from an
equally long previous period, on a fixed red–neutral–green scale. Color saturates
at −100% and +100%; tooltips retain the actual change. Gray means no finite
percentage comparison. Zero and missing current totals receive no tile area.
Arrow keys and Enter work when the map has keyboard focus.

> **Note:** A language edition is not a geographic region. Pageviews are not unique
> readers. This map describes observed Wikipedia attention, not future popularity.

---

## Collect and refresh

Run from the repository root. Python 3.11 or newer is required. The project uses
only its standard library; Pixi provides the optional locked environment.

```bash
pixi run python -m trendlab collect --languages en vi --limit 100
```

Without Pixi, the same command works with `python3 -m trendlab collect`.
The collector finds the latest available daily chart within the previous seven
completed UTC days. The actual end date appears in the dashboard. Different
editions can have different source availability.

| Option | Purpose |
|---|---|
| `--languages en vi fr ja` | Collect any supported Wikipedia edition codes; exported editions populate the selector |
| `--limit 100` | Maximum articles per edition, from 1 to 1,000; default 100 |
| `--end-date 2026-11-14` | Reproduce a fixed, completed UTC date |
| `--deadline-seconds 600` | Operational run limit; not a runtime estimate |
| `--refresh` | Refetch cached responses to incorporate source corrections |
| `--cache PATH` | SQLite response cache; default `data/wikipedia.sqlite` |
| `--output PATH` | Static export directory; default `web/data/wikipedia` |

Completed source requests are committed individually to SQLite. **Repeat an
interrupted command with the same date and options to resume**; successful
requests are reused. A changed date is a new input. Use `--refresh` when you want
to update previously cached dates. Requests run sequentially with timeouts,
spacing and bounded retries; long provider cooldowns stop the run.

For example, the bundled sample can be regenerated with:

```bash
pixi run python -m trendlab collect --languages en vi --limit 100 --end-date 2026-11-14
pixi run python scripts/verify_wikipedia.py
```

A failed article request produces an explicitly partial export and exit code 2.
A fatal error, deadline or interruption returns exit code 1, retains cache
progress and preserves the previous affected export. Fully collected earlier
editions remain exported. A complete collection means its requests succeeded;
individual periods can still have missing historical days.

> **Note:** Larger samples need more API requests. Keep a durable log and enforce
> an external watchdog for unattended jobs. A resumable command does not restart
> itself after shutdown. Do not run concurrent exporters against the same output.

---

## Data and interpretation

| Stage | Source and contract |
|---|---|
| Discovery | Wikimedia daily Top 1,000 feed for the selected edition and date |
| Filtering | MediaWiki namespace metadata excludes the edition's main page, missing pages and non-article namespaces |
| Measurement | Per-article daily histories with `all-access/user`, covering 60 days |
| Comparison | Current 1/7/30-day totals versus the preceding 1/7/30 days |
| Provenance | Original request URL, retrieval time and full SHA-256 of each cached response |
| Publication | Immutable edition JSON plus an atomically replaced edition manifest |

The article limit selects the highest chart-ranked eligible articles for the
end date. Longer windows describe those same articles. This is **not** a ranking
of every Wikipedia article over the longer period. Absence from a top chart is
never interpreted as zero views. Missing history days make the affected period
unavailable. A genuine zero prior total has no finite percentage change.

Wikimedia's `user` classification excludes traffic identified as automated;
it does not guarantee that every bot is removed. Views under alternate titles
and redirects are not automatically combined. Language editions are independent
and their counts are never pooled.

The collector retains successful raw responses and source hashes in SQLite.
`verify_wikipedia.py` checks every exported history and window against those
responses. The cache is local and ignored by Git; generated static samples are
included so the map works without API access.

Sources: [Analytics API](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/reference/page-views.html),
[pageview definition](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/concepts/page-views.html),
[access policy and CC0 data license](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/documentation/access-policy.html).

---

## Development and verification

```bash
pixi run test
npm ci
npm test
pixi run python scripts/verify_wikipedia.py
```

The Python suite checks source identities, namespaces, period arithmetic, missing
and zero values, retries, cache integrity and resume. The Node suite checks
pageview area ratios, color semantics, filtering, async edition switching and
the preserved Education implementation.

For browser checks, install Playwright's Chromium if it is not already available:

```bash
npx playwright install chromium
```

Then start a preview in one terminal and run checks in another:

```bash
pixi run python -m trendlab serve --port 8765
npm run test:browser
```

Browser checks exercise all collected editions and periods, exact totals and area
ratios, search, filters, keyboard interaction, the article inspector, unavailable
edition handling, mobile layout and light/dark themes. Screenshots go to `logs/`.
Set `TRENDLAB_PREVIEW_URL` to check another local preview URL.

After collecting the source cache, run the complete local acceptance command:

```bash
pixi run check
```

It runs both test suites, reconciles all exported values with cached sources,
starts an isolated preview on a free loopback port, runs browser checks and stops
the preview. Each subprocess has a watchdog. It saves logs, final input hashes
and the aggregate result in `logs/wikipedia-acceptance.json`; any failed check,
missing dependency or changed input makes the command fail.

| Path | Responsibility |
|---|---|
| `trendlab/wikipedia.py` | HTTP client, SQLite cache, validation, calculation and export |
| `trendlab/__main__.py` | Collection and local-server commands |
| `web/index.html`, `web/css/wiki.css` | Wikipedia dashboard structure and appearance |
| `web/js/wiki.js`, `web/js/wiki-metrics.js` | Browser behavior and measurement semantics |
| `web/js/treemap.js` | Shared linear squarified layout |
| `web/data/wikipedia/` | Generated static samples and edition manifest |
| `tests/`, `test/wiki_treemap.test.js` | Python and JavaScript checks |

---

## Prior Education prototype

The previous mobile-app collectors and tests remain available during migration.
Its separate dashboard is `web/education.html`; its CLI is `node bin/cli.js`.
Its SQLite database, JSON and operational scripts are separate from the Wikipedia
pipeline. Use the Python commands above for the current project.
