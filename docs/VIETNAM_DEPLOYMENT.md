# TrendLab — Safe Vietnam-market rollout on Ubuntu

**Scope:** Vietnam (VN) Education storefront on Google Play AND Apple App Store. This release preserves the old SQLite history and existing backup/analytics services. The globally imported ~331k-app catalog is only an unverified candidate pool, NOT a VN app census.

**Do NOT run the legacy hourly collector and continuous monitor together.** The two currently installed systemd services can contain hard-coded `--storefronts us,vn,gb,de,jp,in` flags. Changing `config/default.json` alone does not override those flags! The new CLI intentionally rejects all non-VN storefronts.

## 1. Merge the PR, validate and back up

On `gemini-server`, after merging the pull request:

```bash
cd /home/gemini/trendlab
git pull --ff-only origin main
npm ci
npm test

# Keep existing backup/analytics timers enabled.
systemctl is-active trendlab-backup.timer
systemctl is-active trendlab-analytics.timer
systemctl is-enabled trendlab-collect.timer
```

The old hourly collection timer must remain disabled. **Pause the continuous collector and discovery timer while applying the new settings**:

```bash
sudo systemctl stop trendlab-monitor.service
sudo systemctl stop trendlab-discover.timer
# If a sweep is already running, allow it to finish; check before continuing:
systemctl is-active trendlab-discover.service
```

Create a restorable SQLite backup while no collector/sweep is writing:

```bash
cd /home/gemini/trendlab
mkdir -p backups
sqlite3 data/trendlab.sqlite ".backup 'backups/pre-vn-$(date -u +%Y%m%dT%H%M%SZ).sqlite'"
sqlite3 data/trendlab.sqlite 'PRAGMA integrity_check;'
```

Expected integrity result: `ok`. **Do not remove previous observation data, DROP tables or edit the live SQLite file directly.**

## 2. Override both installed systemd commands to use VN

Drop-ins preserve existing unit files and their restart policies:

```bash
sudo mkdir -p /etc/systemd/system/trendlab-monitor.service.d
sudo tee /etc/systemd/system/trendlab-monitor.service.d/10-vietnam.conf >/dev/null <<'EOF'
[Service]
ExecStart=
ExecStart=/usr/bin/node /home/gemini/trendlab/bin/cli.js collect-loop --android-limit 20 --ios-limit 25 --storefronts vn --pause-seconds 180
EOF

sudo mkdir -p /etc/systemd/system/trendlab-discover.service.d
sudo tee /etc/systemd/system/trendlab-discover.service.d/10-vietnam.conf >/dev/null <<'EOF'
[Service]
ExecStart=
ExecStart=/usr/bin/node /home/gemini/trendlab/bin/cli.js sweep --storefronts vn
EOF

sudo systemctl daemon-reload
systemctl show trendlab-monitor.service -p ExecStart
systemctl show trendlab-discover.service -p ExecStart
```

Both effective commands must contain **only** `vn`, not `us,gb,de,jp,in`. The old units may still be present beneath these drop-ins; their effective `ExecStart` is overridden.

## 3. Initialize VN chart evidence and regenerate VN-only analytics

Run a **single bounded VN chart sweep** *before* resuming continuous collection, so the scheduler can prioritize real VN chart entries:

```bash
sudo systemctl start trendlab-discover.service
journalctl -u trendlab-discover.service -n 70 --no-pager
```

Then rebuild derived metrics. This is essential: old model rows may have been generated from US history, and the new calculator clears/recomputes them using VN observations only.

```bash
cd /home/gemini/trendlab
node bin/cli.js analyze
node bin/cli.js export
node bin/cli.js coverage
```

The updated `coverage` has a **`marketByPlatform`** section with VN-evidenced apps, numeric metrics, VN chart apps and recent VN successes. Legacy `byPlatform` still describes historical mixed-country catalog progress and should not be read as VN coverage.

With no previous VN numeric time series, the VN dashboard may initially show few apps and **0 scored 7/14/30/90-day trends**. That is legitimate, not a data reset or collector bug. It takes repeated VN observations over time to establish a trend.

## 4. Resume unattended collection and discovery

```bash
sudo systemctl start trendlab-monitor.service
sudo systemctl enable --now trendlab-discover.timer

systemctl status trendlab-monitor.service --no-pager
systemctl list-timers --all | grep trendlab
journalctl -u trendlab-monitor.service -n 60 --no-pager
```

The collector still uses bounded batches of **up to 20 Android and 25 iOS apps per cycle**, delays between calls and a 180-second pause. Most batch capacity is reserved for **VN-evidenced** apps that need collection/refresh; a capped 20% lane probes previously unverified catalog IDs. Unused capacity is intentionally **not** spent on a flood of arbitrary foreign IDs. Regional misses receive a longer per-app retry; genuine network/rate-limit failures still slow the worker.

The dashboard server remains bound to `127.0.0.1:8080`. Its existing process does not need a restart; open via the usual SSH tunnel from Windows and press Ctrl+Shift+R.

## 5. Check success and measured throughput

```bash
cd /home/gemini/trendlab
node bin/cli.js coverage
journalctl -u trendlab-monitor.service --since "1 hour ago" --no-pager
journalctl -u trendlab-discover.service --since "1 day ago" --no-pager
```

Measure real VN progress with a **distinct app** count, not raw attempts:

```bash
sqlite3 -header -column data/trendlab.sqlite <<'SQL'
WITH first_vn AS (
  SELECT platform_app_id, MIN(observed_at) AS first_observed
  FROM observed_metrics
  WHERE storefront = 'vn'
    AND (observed_install_counter IS NOT NULL OR observed_rating_count IS NOT NULL)
  GROUP BY platform_app_id
)
SELECT p.platform,
       COUNT(*) AS measured_vn_apps,
       SUM(CASE WHEN first_observed >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-24 hours')
           THEN 1 ELSE 0 END) AS new_measured_vn_24h
FROM first_vn
JOIN platform_applications p ON p.id = first_vn.platform_app_id
GROUP BY p.platform;
SQL
```

Do not claim any 24-hour revisit SLA until actual market-specific throughput and error rates support it. Android `maxInstalls` returned from a VN lookup is **not** Vietnam-only download count.

## Rollback (without losing data)

Stop the monitor, remove the two `10-vietnam.conf` drop-ins, reload systemd and restart previously approved units **only if you deliberately want to resume their older country scope**. The historical SQLite backup remains available. A code rollback with old non-VN service arguments is not safe to assume; check effective `ExecStart` before starting any worker.

Do not delete historical US/JP records to "speed up" a VN source lookup. A database reset does not improve provider latency. Backups/analytics timers remain independent and must not be disabled in this rollout.
