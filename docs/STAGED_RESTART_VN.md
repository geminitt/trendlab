# TrendLab VN — staged restart AFTER fresh reset and bounded manual probes

**Operator-only runbook.** GitHub code changes do not start systemd units, change the active SQLite file or delete logs. This guide starts from a stopped Ubuntu server after a verified backup, one VN-only sweep, a bounded collection and successful `analyze`/`export`.

## A. Why analytics scored 0 after the fresh start

The chart-only discovery created 100 Android + 100 iOS apps. The first bounded collection measured 8 Android + 8 iOS once. Trend scoring needs **at least three numeric observations per app**, from the correct metric for that platform and the exact `vn` storefront, plus sufficient time span in each analysis window.

After this change:

- `analytics.eligibility_summary`: market cohort size, count with numeric metrics, count with none, count below 3, count passing the gate.
- `analytics.app_ineligible`: each VN-evidenced application below the 3-sample gate, with `platform_app_id`, `platform`, `storefront`, `metric_observations` and explicit `reason` (`NO_MARKET_METRIC_OBSERVATIONS` or `INSUFFICIENT_OBSERVATIONS`).
- `analytics.window_skipped`: separate check for apps with >= 3 valid samples that fail a time window (insufficient span, stale latest snapshot, counter decrease, etc.).

Neither chart-only ranking rows nor US/JP observations can make an app eligible for VN trend scoring. This is NOT a claim of complete VN market coverage.

## B. Update the server while ALL automation remains stopped

Before touching services, check current local changes and protect the already reset VN database:

```bash
cd ~/trendlab
git status --short
git pull --ff-only origin main
npm ci
npm test
sqlite3 data/trendlab.sqlite 'PRAGMA integrity_check;'
systemctl list-timers --all | grep -i trendlab || true
systemctl is-active trendlab-monitor.service || true
```

Do not run `git reset --hard` or `git clean -fd` to force the pull; local `web/data/data.json` is expected to be modified after export. If `git pull` is blocked by that file, back up the export, then `git stash push -m 'save VN dashboard export' -- web/data/data.json`; do not `stash pop` into the new export unless you intentionally want the old file back. No database reset is required.

## C. Validate the new audit log BEFORE restarting anything

```bash
cd ~/trendlab
node bin/cli.js analyze
node bin/cli.js export

jq -c 'select(.event == "analytics.eligibility_summary")' logs/events-*.jsonl | tail -1
jq -c 'select(.event == "analytics.app_ineligible") |
  {platform_app_id, platform, storefront, metric_observations, reason}' logs/events-*.jsonl | tail -30
jq -c 'select(.event == "analytics.window_skipped") |
  {platform_app_id, window_type, reason, reason_context}' logs/events-*.jsonl | tail -20
jq -c 'select(.event == "cli.command_failed")' logs/events-*.jsonl | tail -20
```

For the 200 discovered apps / 16 distinct apps each with one numeric VN measurement state, expect approximately:
- `market_candidates=200`; `apps_with_metrics=16`; `apps_without_metrics=184`
- `apps_with_insufficient_observations=16`; `apps_eligible=0`; `apps_ineligible=200`

These numbers are based on the previous observed state, not invariant values. Do not require any 7-day score until there are >= 3 snapshots and sufficient elapsed days. A chart rank alone is not a numeric install/rating counter.

## D. Audit installed systemd definitions BEFORE enabling anything

The installed units are not automatically changed by this PR. Inspect their **effective** definitions and schedules, not just the old unit descriptions:

```bash
systemctl cat trendlab-monitor.service trendlab-discover.service \
  trendlab-discover.timer trendlab-analytics.service \
  trendlab-analytics.timer trendlab-backup.service trendlab-backup.timer
systemctl show trendlab-monitor.service -p ExecStart
systemctl show trendlab-discover.service -p ExecStart
systemctl show trendlab-analytics.service -p ExecStart
systemctl list-timers --all | grep -i trendlab || true
systemctl is-enabled trendlab-collect.timer
```

**Do not proceed** if effective monitor/discovery commands omit `vn` or contain extra countries, if the backup destination is unknown, if timer schedules overlap unintended jobs, or if `trendlab-collect.timer` is enabled. Correct the old unit/drop-in first and re-run `sudo systemctl daemon-reload` before starting anything.

## E. Stage one component at a time; stop on unexpected failures

**Stage 1: backup evidence.** Confirm the backup unit command and destination before manually invoking it:

```bash
sudo systemctl start trendlab-backup.service
journalctl -u trendlab-backup.service -n 60 --no-pager
ls -lh backups/
```

Confirm a newly created restorable backup; verify integrity/checksum where your backup unit supports it. Only then consider `sudo systemctl enable --now trendlab-backup.timer`. Retain the old pre-reset archive.

**Stage 2: discovery schedule.** You have already completed a manual VN sweep, so a second immediate sweep is not needed. Once the timer's configured cadence is confirmed, enable `trendlab-discover.timer` and check `systemctl list-timers --all`. Avoid triggering `trendlab-discover.service` repeatedly on the same chart day just to produce more logs.

**Stage 3: analytics and export schedule.** Confirm `trendlab-analytics.service` actually runs `analyze` and `export` in the expected order, and that its timer does not overlap other instances. Then enable `trendlab-analytics.timer`. Running `analyze` before any app has 3 valid points is expected to produce 0 trend scores; it should still generate an eligibility audit.

**Stage 4: collection.** First run one bounded manual one-shot while the legacy timer and continuous monitor remain OFF:

```bash
cd ~/trendlab
node bin/cli.js collect --android-limit 10 --ios-limit 10 --storefront vn
node bin/cli.js coverage
jq -c 'select(.event=="collector.batch_finished" or
  .event=="scheduler.cycle_finished" or .event=="scheduler.cycle_error" or
  .event=="collector.source_error")' logs/events-*.jsonl | tail -12
```

Inspect success/failure rates and count of first-time measured **distinct apps**, not raw attempts. If an upstream provider returns repeated 429/5xx, leave the monitor OFF and investigate backoff first.

Only when an unattended collector is warranted, verify its effective command once more and start **one** systemd worker:

```bash
sudo systemctl start trendlab-monitor.service
systemctl is-active trendlab-monitor.service
systemctl show trendlab-monitor.service -p ExecStart
journalctl -u trendlab-monitor.service -n 80 --no-pager
```

Keep `trendlab-collect.timer` **disabled**. The continuous worker and old hourly collector must never run simultaneously. The monitor should use conservative explicit `--storefronts vn`, limits and pause, without extra countries. If it misbehaves:

```bash
sudo systemctl stop trendlab-monitor.service
journalctl -u trendlab-monitor.service -n 120 --no-pager
```

Before considering a long-term always-on setup, establish storage retention/rotation for `logs/events-*.jsonl`, disk usage checks, off-server backup policy, and alerts on repeated `collector.source_error` or `cli.command_failed`. File JSONL is append-only and will grow; full raw source responses remain in SQLite snapshots, not JSONL.

## F. Minimal recurring verification

```bash
systemctl is-active trendlab-monitor.service
systemctl list-timers --all | grep -i trendlab || true
node bin/cli.js coverage
du -sh logs backups data
jq -c 'select(.event=="analytics.eligibility_summary" or
  .event=="collector.batch_finished" or .event=="export.finished")' \
  logs/events-*.jsonl | tail -15
```

An inactive `trendlab-discover.service` after successful one-shot execution is normal; its **timer** should be active only when its cadence is approved. No step above deletes or resets the new active database.
