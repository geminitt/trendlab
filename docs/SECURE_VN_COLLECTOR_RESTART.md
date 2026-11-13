# VN source security and guarded collector restart (post-PR rollout)

**This PR changes GitHub code only. Nothing on gemini-server has been started, deleted, or reset.** Use these operator steps *after the PR is merged*. Preserve the fresh SQLite database, existing backup/archive directories, and enabled backup/analytics timers.

## What changed and what is not yet proven

- Removed `app-store-scraper` (which imported the deprecated `request`, `form-data`, `qs`, `tough-cookie` and `uuid` advisory chain) and its unused lockfile tree.
- iOS discovery now uses the **category-specific legacy Apple iTunes RSS** `/vn/rss/topfreeapplications/limit=100/genre=6017/json`. This is not interchangeable with the overall modern Marketing Tools Top Free chart, which is not Education-filtered.
- Parser rejects malformed/empty/duplicate entries instead of writing fabricated chart ranks. Errors are logged as `discovery.source_error`. Existing sweep code catches provider errors, **so CLI exit code 0 alone does NOT prove iOS discovery succeeded**.
- iOS numeric metrics still use the separate native `itunes-lookup` collector; Android continues using `google-play-scraper`. This change does not rewrite historical data.
- `npm test` writes audit JSONL into an isolated OS temporary directory; it must no longer add synthetic `analytics.app_ineligible` records to production `logs/`.
- `scripts/audit-health.js`: read-only inspection of errors and optional collection freshness, exit 2 on alerts; it does NOT send email or create automation.
- `scripts/archive-audit-logs.sh`: archives log files older than 8 days with compressed checksum-verified **copies**. It never deletes source logs; no automatic scheduled action is created.
- CLI `collect-loop --max-cycles N` for finite controlled trials; optional `--error-pause-seconds N`.

The Apple RSS source has unit tests and published examples, but its **actual connectivity and shape from gemini-server must still be checked** before discovery automation. GitHub CI is not a substitute for a production connectivity test. Verify remaining dependency issues with `npm audit --omit=dev`, not assumptions.

## 1. Deploy safely; keep collection automation off

```bash
cd ~/trendlab
git status --short
git pull --ff-only origin main
npm ci
npm test
npm audit --omit=dev
npm ls app-store-scraper request form-data || true

systemctl is-enabled trendlab-collect.timer
systemctl is-active trendlab-monitor.service || true
systemctl is-enabled trendlab-backup.timer trendlab-analytics.timer
sqlite3 data/trendlab.sqlite 'PRAGMA integrity_check;'
```

If the pull is blocked by tracked `web/data/data.json`, preserve that file and stash only it; **never** use `git reset --hard` or `git clean -fd`. Never run `npm audit fix --force` without impact analysis.

Expected: npm's full test suite passes; `app-store-scraper` and `request` are not installed. A blank `npm ls` of packages that were intentionally removed is not a problem. If `npm audit` still reports vulnerable transitive packages, stop here and investigate.

## 2. First probe Apple Education chart WITHOUT writing the DB

```bash
cd ~/trendlab
node <<'NODE'
const { getAppleEducationTopFree } = require('./src/catalog/apple_education_feed');
getAppleEducationTopFree('vn').then(apps => {
  console.log(JSON.stringify({
    source: 'apple-itunes-rss', storefront: 'vn',
    chart: 'TOP_FREE_EDUCATION', received: apps.length,
    first_three: apps.slice(0, 3)
  }, null, 2));
}).catch(e => { console.error('APPLE RSS PROBE FAILED:', e.message); process.exitCode = 1; });
NODE
```

Expect between 1 and 100 distinct apps with numeric store IDs and real titles. If it fails or unexpectedly returns different categories, **do not enable discovery**. Check the source shape and endpoint explicitly; do not silently fall back to an unfiltered overall chart. Apple can change public RSS availability at any time.

Once the non-writing probe succeeds, a single manual sweep may be run to confirm DB writes and audit events:

```bash
node bin/cli.js sweep --storefronts vn
jq -c 'select(.event=="discovery.chart_response" or .event=="discovery.source_error")' logs/events-*.jsonl | tail -8
node bin/cli.js coverage
```

Confirm a fresh `platform="ios", storefront="vn", source="apple-itunes-rss"` response with nonzero received count **and no new iOS source_error for that run**. A sweep can also refresh Android top-chart ranks; it is not a market census.

## 3. Verify log retention and health without changing schedules

```bash
bash scripts/archive-audit-logs.sh --inspect
bash scripts/archive-audit-logs.sh --archive
node scripts/audit-health.js --hours 24
du -sh logs backups data
```

Archives older than 8 days only; for a freshly reset system there may be **zero eligible logs**. No original JSONL is deleted. Restore a copy with `gzip -cd backups/audit-jsonl/events-YYYY-MM-DD.jsonl.gz > /tmp/restored-events.jsonl` if needed. Archiving and copies are NOT off-host disaster recovery; keep the existing verified SQLite backups and later add off-server storage.

Health check exit code: 0 means no listed alert within the selected interval; 2 means report contains `alerts` (including failed provider operations or bad JSONL); 1 means usage/runtime error. It is a diagnostic tool, not a notification system and not proof that collection is running unless `--require-collector` is specified.

## 4. Bounded monitor TEST — ONE cycle, no service or timer

```bash
node bin/cli.js collect-loop \
  --android-limit 4 --ios-limit 4 \
  --storefronts vn --pause-seconds 300 \
  --error-pause-seconds 900 --max-cycles 1
node bin/cli.js coverage
jq -c 'select(.event=="monitor.cycle_finished" or .event=="monitor.cycle_error" or .event=="monitor.stopped")' \
  logs/events-*.jsonl | tail -6
```

This will perform at most one selected bounded VN cycle and exit (no hidden background worker). Confirm it logs `monitor.stopped` and never touches other countries. If provider/systemic failures or 429s appear, keep the monitor OFF and inspect logs.

## 5. Only then enable the single systemd continuous worker

**Do not enable the legacy trendlab-collect.timer.** Inspect the effective monitor command before starting it. For a conservative, explicit VN-only configuration, update the existing drop-in deliberately:

```bash
sudo cp -a /etc/systemd/system/trendlab-monitor.service.d/10-vietnam.conf \
  /etc/systemd/system/trendlab-monitor.service.d/10-vietnam.conf.previous

sudo tee /etc/systemd/system/trendlab-monitor.service.d/10-vietnam.conf >/dev/null <<'EOF'
[Service]
ExecStart=
ExecStart=/usr/bin/node /home/gemini/trendlab/bin/cli.js collect-loop --android-limit 10 --ios-limit 10 --storefronts vn --pause-seconds 600 --error-pause-seconds 1800
EOF

sudo systemctl daemon-reload
systemctl show trendlab-monitor.service -p ExecStart --full --no-pager
systemctl is-enabled trendlab-collect.timer
```

Only start after all earlier gates succeed:

```bash
sudo systemctl start trendlab-monitor.service
systemctl is-active trendlab-monitor.service
journalctl -u trendlab-monitor.service -n 70 --no-pager
node scripts/audit-health.js --hours 2 --require-collector
```

Note that `--require-collector` will alert until the first full collection cycle finishes. A timer for periodic health alerts is **NOT** installed by this PR. For problems:

```bash
sudo systemctl stop trendlab-monitor.service
journalctl -u trendlab-monitor.service -n 150 --no-pager
```

Do not enable `trendlab-monitor.service` at boot until manual observation is satisfactory. Leave the already enabled backup and analytics timers untouched. After security/network verification, the **discovery timer** can be enabled separately and observed, taking into account `Persistent=true` and the current configured 04:00 UTC plus randomized 10-minute delay.

## Operator checklist

- New Apple RSS probe and real VN sweep succeeded and returned proper genre Top Free.
- `npm test` and `npm audit --omit=dev` checked; any remaining critical advisory investigated.
- All services' effective ExecStart flags contain only `vn`; no second worker.
- Backup `backup.sh` local retention setting and previously verified archive preserved.
- No deletion, database reset, global catalog import, or auto-enable of monitoring in this rollout.
