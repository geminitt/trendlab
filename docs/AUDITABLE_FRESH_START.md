# TrendLab — auditable clean start (Vietnam / Education)

**Status:** This is a manual operator procedure. No GitHub PR directly stops services or deletes data on the Ubuntu server. The primary target is useful VN storefront evidence, truthful coverage and reproducible logs. The old imported global ID catalog is NOT a complete VN census.

The scripts deliberately keep a restorable copy of the old SQLite database, journald output, config and exported dashboard; the active database will be entirely fresh. **Do not confuse backup with an ongoing collection.**

## 0. Inventory every possible runner FIRST

From your shell on `gemini-server`:

```bash
cd /home/gemini/trendlab
systemctl list-units --all 'trendlab-*'
systemctl list-unit-files --all | grep -i trendlab || true
systemctl list-timers --all | grep -i trendlab || true
systemctl --user list-units --all | grep -i trendlab || true
systemctl --user list-timers --all | grep -i trendlab || true
ps -eo pid,ppid,args | grep -E '[n]ode .*bin/cli[.]js' || true
sudo ss -ltnp | grep ':8080' || true
crontab -l || true
sudo crontab -l || true
bash scripts/reset-vn-auditable.sh --inspect
```

Inspect Zellij sessions and any processes started manually. **An idle terminal, a live SSH tunnel or closing a browser does not prove the web server has stopped.**

## 1. Stop EVERY TrendLab automation (not other projects)

```bash
sudo systemctl disable --now \
  trendlab-monitor.service trendlab-collect.timer \
  trendlab-discover.timer trendlab-analytics.timer trendlab-backup.timer
sudo systemctl stop \
  trendlab-collect.service trendlab-discover.service \
  trendlab-analytics.service trendlab-backup.service
# Only if this optional unit exists:
sudo systemctl stop trendlab-web.service 2>/dev/null || true
sudo systemctl disable trendlab-web.service 2>/dev/null || true
```

Do not stop `systemd-journald`. Disable user-level TrendLab units or cron/at jobs **only if discovered**, after checking their exact commands. Check again:

```bash
systemctl list-timers --all | grep -i trendlab || true
pgrep -af '[n]ode .*bin/cli[.]js' || true
sudo ss -ltnp | grep ':8080' || true
```

For a remaining manual `node bin/cli.js serve`, identify it with `ps -fp PID`, then use **`kill PID`** (SIGTERM) only for the confirmed TrendLab PID. Do **not** use `pkill node` or `kill -9`; other apps may run Node. Preserve existing Zellij sessions.

If the old backup job is actively running, allow its SQLite `.backup` to finish before snapshot/reset. If workers persist, **do not reset**.

## 2. Merge the logging PR and verify code before any reset

```bash
cd /home/gemini/trendlab
git status --short
git pull --ff-only origin main
npm ci
npm test
bash scripts/reset-vn-auditable.sh --inspect
```

Do not discard local changes just to force `git pull`; resolve conflicts explicitly. Verify the `monitor/discover/analytics/backup/collect` units/timers are OFF and the CLI process list is empty.

## 3. Archive AND logically clear all existing application data

This action intentionally creates a new empty active database. It **does not** restart services, download apps or run a global catalog import.

```bash
bash scripts/reset-vn-auditable.sh --reset CONFIRM_FRESH_VN_DATABASE
```

The script refuses reset if known systemd units/timers or a CLI process are active, or if SQLite integrity checks fail. Its checks are a safeguard, not a substitute for the full inventory in step 0 (including user-level systemd and cron). It archives:

- `backups/reset-YYYYMMDDTHHMMSSZ/pre-reset.sqlite` (verified, with SHA-256).
- The former `trendlab.sqlite` plus `-wal/-shm` companions (if present).
- Accessible old `journalctl -o json` messages, effective unit definitions, process/timer inventory, Git revision and old `config/default.json`.
- Previous `logs/events-*.jsonl` moved into `previous-jsonl/`, plus the old `web/data/data.json`. The active `logs/` directory starts with fresh new-run events.

It then creates a fresh `data/trendlab.sqlite` via the application schema, exports an empty dataset, and keeps everything STOPPED. **Archived data can be restored, but no measurements are silently copied forward.**

```bash
node bin/cli.js coverage
sqlite3 data/trendlab.sqlite 'PRAGMA integrity_check;'
find backups -maxdepth 2 -name pre-reset.sqlite -print
ls -lh logs/events-*.jsonl
```

Expected: new DB contains no historical catalog rows, snapshots, raw responses, scores or collection cursors. The archived copy is retained separately for investigation.

## 4. Start with small, observable, MANUAL probes — no automatic schedules

```bash
# Exact Vietnam market, max 100 chart rows per platform (not a market census).
node bin/cli.js sweep --storefronts vn
node bin/cli.js coverage

# Small one-shot probe; 80% focused VN evidence / 20% new-catalog candidates.
node bin/cli.js collect --android-limit 10 --ios-limit 10 --storefront vn
node bin/cli.js coverage
node bin/cli.js analyze
node bin/cli.js export
```

These single bounded probes must be reviewed with their logs before any continuous worker is re-enabled. A freshly empty catalog contains only chart-discovered candidates, so the exploratory lane may initially be empty. **This will not find apps outside VN Top 100 without an additional candidate source.**

For broader discovery, either:
- Import a fresh, verified Education TSV/XZ candidate catalog using `node bin/cli.js import-catalog --file PATH`; do not call the file a VN app list unless its provenance supports this.
- Or make an explicit, separately audited decision to repopulate **only application ID metadata** from the archived catalog, without copying observation/state/scores. This is NOT part of the reset script and must be recorded.

## 5. Log architecture and how to investigate

Every application run uses a unique `run_id`, and every structured event has `ts` (UTC ISO-8601), `pid`, `command`, `schema_version` and `event`. Records append to `logs/events-YYYY-MM-DD.jsonl`, retained **outside SQLite**. The same JSON is emitted to stderr for systemd-journald; normal CLI stdout remains parsable. Logs rotate to a new file automatically each UTC day and are **not** deleted automatically.

| Stage | Event types and evidence |
|---|---|
| CLI / web | `cli.command_started/finished/failed`, `web.started/stopped` |
| Catalog import | `catalog.import_started/finished/failed` (filename, row counts) |
| VN discovery | `discovery.sweep_started`, `discovery.chart_response`, `discovery.chart_entry`, errors and finish |
| Scheduler | `scheduler.cycle_started/finished/error`, `job.started/finished`, market and batch counts |
| Source lookups | `collector.batch_started/finished`, `collector.source_response/error`, `collector.lookup_result` |
| Collection state | `collection.attempt` including app ID, outcome, error, consecutive failures, next due |
| Data evidence | `snapshot.saved` including SHA-256, `observation.saved` with all stored numeric counters and chart rank |
| Analytics / models | `analytics.dataset_started/finished/failed`, `analytics.window_skipped/window_saved`, `analytics.score_saved`, `model.window_started/finished` |
| Export | `export.started/finished` including output SHA-256 and row counts |
| Backup/OS | Existing `journalctl -u trendlab-backup.service`, full old journal archive, reset SHA-256 |

Sample queries with `jq` (if installed):

```bash
# All failed lookups, correlated by run_id and native_store_id
jq -c 'select(.event=="collector.lookup_result" and .outcome!="success")' logs/events-*.jsonl

# Retry scheduling and backoff
jq -c 'select(.event=="collection.attempt" and .succeeded==false)' logs/events-*.jsonl

# A specific run, across stages
RUN_ID='replace-with-run-uuid'
jq -c --arg id "$RUN_ID" 'select(.run_id==$id)' logs/events-*.jsonl

# Completeness and skipped windows
jq -c 'select(.event=="analytics.window_skipped")' logs/events-*.jsonl

# Latest export hash, so dashboard data can be verified
jq -c 'select(.event=="export.finished")' logs/events-*.jsonl | tail -1

# Live systemd log stream, if services have later been re-enabled
journalctl -u trendlab-monitor.service -f --no-pager
```

**Sensitive data / storage warning:** JSONL files may reveal app IDs, titles, source error messages and system paths. Treat `logs/`, `backups/` and raw snapshots as private, archive off-server as appropriate, keep disk space monitored. Provider response bodies and authentication secrets must not be written into JSONL; successful response bodies already live in SQLite raw snapshots. Do not commit the logs to Git.

`journalctl` may only retain as much history as your systemd-journald retention allows. The script exports what is available; a previous volatile boot log that has already disappeared cannot be recovered.

## 6. Later: enable one worker only AFTER evaluating manual evidence

Before re-enabling automation, compare VN discovery numbers, unique first-measured apps, per-source failures and latency across runs. Keep explicit country `vn`, conservative limits and no duplicated hourly timer:

```bash
systemctl show trendlab-monitor.service -p ExecStart
systemctl show trendlab-discover.service -p ExecStart
```

A safe staged restart is possible only after choosing a collection cadence and log-retention/disk-space policy. **This reset procedure intentionally does not start any timers.**

## Rollback / recover evidence

Do not replace a live SQLite DB while processes have it open. Stop all workers/web and verify file locks first. Restore from a verified `pre-reset.sqlite` into a *separate test directory* to inspect; moving a snapshot back into the live DB is a distinct operator decision. Check its SHA-256 from `sha256.txt` and `PRAGMA integrity_check` first.
