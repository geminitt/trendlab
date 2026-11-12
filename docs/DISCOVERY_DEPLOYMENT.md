# Daily supplemental catalog discovery on Ubuntu

**Read AGENTS.md and docs/REQUIREMENTS_ACCEPTANCE.md.** This adds unattended Top-Chart discovery only. It **does not** automatically import a fresh AppGoblin dataset, discover every new Education app, or satisfy R1.

Existing `trendlab-monitor.service` remains in place. Do **not** restart or edit it to deploy this feature. Keep backup and analytics timers enabled.

After merging the PR, on the Ubuntu server:

```bash
cd ~/trendlab
git pull --ff-only origin main
npm ci
npm test
sudo install -m 0644 deploy/systemd/trendlab-discover.service /etc/systemd/system/
sudo install -m 0644 deploy/systemd/trendlab-discover.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now trendlab-discover.timer
systemctl list-timers --all | grep trendlab
```

Test one discovery cycle (optional, starts a separate lightweight chart sweep):

```bash
sudo systemctl start trendlab-discover.service
journalctl -u trendlab-discover.service -n 100 --no-pager
node bin/cli.js coverage
```

The daily timer operates in **UTC**. It queries **Top Free** Education charts in US, VN, GB, DE, JP and IN on both stores (subject to scraper availability). Each chart is bounded (up to 100 per country), which is why this **cannot** discover the long tail, all newly published apps, or prove worldwide completeness.

When investigating failures, check `journalctl -u trendlab-discover.service` and provider 403/429 responses. Slow down or halt where required. Do not attempt to bypass provider limitations.

Rollback without deleting data:

```bash
sudo systemctl disable --now trendlab-discover.timer
```

For real catalog expansion, a verified regularly published and legally accessible bulk catalog feed still needs an automated importer plus measured provenance, versioning, deduplication and daily delta reports. These are subsequent R1 work items.
