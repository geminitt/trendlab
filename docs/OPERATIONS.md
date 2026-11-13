> **Updated 2026-11-13: Vietnam-only research scope.** The old multi-country examples below are historical and must NOT be used. Follow [VIETNAM_DEPLOYMENT.md](VIETNAM_DEPLOYMENT.md) for the tested systemd rollout, and see [REQUIREMENTS_ACCEPTANCE.md](REQUIREMENTS_ACCEPTANCE.md) for binding VN-only requirements.

# TrendLab — Ubuntu operating guide (continuous collection)

This rollout is opt-in. Nothing in this PR edits the existing Ubuntu server,
systemd units, or the on-disk SQLite data. **Do not run the old hourly timer and
the continuous worker simultaneously**: two writers can overlap and slow down
the same SQLite database. Existing database backups should be kept.

## What changed

- `collect`: still one bounded batch for manual runs.
- `collect-loop`: repeated bounded batches, rotating configured storefronts,
  respecting collector delays, escalating cool-down on high failure rates.
- Due-app selection reserves approximately half of each batch for previously
  collected apps that are ready for another observation. New apps cannot starve
  24-hour refreshes forever, though a daily refresh is **not guaranteed**.
- `sweep`: imports apps appearing in sampled Education Top Charts and stores
  the observed rank and country. These charts are Top-K only, **not a complete
  Vietnam app census**.
- Existing AppGoblin bulk files can be re-imported idempotently whenever a newer
  legal export is available. The project **does not claim** that an unlimited,
  automatically updated AppGoblin feed exists.
- Dashboard uses missing-value states; available Android/iOS signals are not
  summed or scored on a shared absolute scale.

## Step A — validate after pulling / merging the PR

```bash
cd /home/gemini/trendlab
npm ci
npm test
node bin/cli.js coverage
node bin/cli.js analyze
node bin/cli.js export
```

Optional manual discovery:

```bash
node bin/cli.js sweep --storefronts vn
```

Country availability, source response formats and access rules should be
verified with small workloads. 429 errors are signals to slow down.

## Step B — replace hourly collection timer

Keep the working backup and analytics timers. Do not stop an in-progress
collector by killing SQLite or manually replacing its data file.

```bash
sudo systemctl disable --now trendlab-collect.timer
systemctl status trendlab-collect.service
```

If the old one-shot collector is still active, allow it to finish before
starting the new service.

Create `/etc/systemd/system/trendlab-monitor.service`:

```ini
[Unit]
Description=TrendLab Continuous Collector
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=gemini
WorkingDirectory=/home/gemini/trendlab
ExecStart=/usr/bin/node /home/gemini/trendlab/bin/cli.js collect-loop --android-limit 25 --ios-limit 50 --storefronts vn --pause-seconds 120
Restart=on-failure
RestartSec=120
TimeoutStopSec=180
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now trendlab-monitor.service
systemctl status trendlab-monitor.service
journalctl -u trendlab-monitor.service -f
```

The conservative limits are a starting point, not a promise that the store
providers permit the full request rate. If 429/403 errors rise, stop or slow
the collector and check the provider's access terms; do not evade blocking.

## Step C — daily discovery from Top Charts

Create `/etc/systemd/system/trendlab-discover.service`:

```ini
[Unit]
Description=TrendLab Sampled Education Top Charts Discovery
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=gemini
WorkingDirectory=/home/gemini/trendlab
ExecStart=/usr/bin/node /home/gemini/trendlab/bin/cli.js sweep --storefronts vn
TimeoutStartSec=20min
```

Create `/etc/systemd/system/trendlab-discover.timer`:

```ini
[Unit]
Description=Daily Sampled Top Chart Discovery

[Timer]
OnCalendar=*-*-* 04:00:00
Persistent=true
RandomizedDelaySec=10min
Unit=trendlab-discover.service

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now trendlab-discover.timer
```

This helps discover newly charting applications, not necessarily newly
published applications outside chart coverage. For more complete catalog
refresh, periodically import a newly obtained AppGoblin TSV/XZ file:

```bash
node bin/cli.js import-catalog --file /path/to/new/live_store_apps.tsv.xz
```

A periodic full provider file downloader is intentionally not included
without a verified stable update endpoint and usage terms.

## Step D — dashboard (optional, private)

The `serve` command now binds to `127.0.0.1` by default, and should
remain private until there is real authentication and authorization.

```bash
node bin/cli.js serve
```

From another machine:

```bash
ssh -N -L 8080:127.0.0.1:8080 gemini@YOUR_SERVER_IP
```

Open `http://localhost:8080` on that machine.

## Monitor, don't assume

```bash
node bin/cli.js coverage
systemctl list-timers --all | grep trendlab
journalctl -u trendlab-monitor.service -n 80 --no-pager
journalctl -u trendlab-backup.service -n 40 --no-pager
```

AppGoblin's catalog is a list of *known IDs*, not an audited count of
all live Education apps. Data coverage should be described as a fraction
of the local known catalog. A “24-hour refresh” is an aspiration constrained
by source access and runtime, never a guarantee. Region-specific Apple
ratings remain distinct.

Keep daily SQLite backups and periodic off-server copies. Existing backup
and analytics timers do not need to be replaced by this PR.
