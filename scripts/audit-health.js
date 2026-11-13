#!/usr/bin/env node
'use strict';

// Read-only JSONL health check. No network, no database writes.
// Exit 0 = no critical error in interval; 2 = alerts/malformed logs;
// 1 = invalid invocation/filesystem issue. Freshness check is OPT-IN.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

function args(argv) {
  let hours = 24;
  let logDir = path.resolve(__dirname, '../logs');
  let requireCollector = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--hours') {
      hours = Number(argv[++i]);
      if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 365) {
        throw new Error('--hours must be in (0, 8760]');
      }
    } else if (arg === '--log-dir') {
      if (!argv[i + 1]) throw new Error('--log-dir requires a directory');
      logDir = path.resolve(argv[++i]);
    } else if (arg === '--require-collector') {
      requireCollector = true;
    } else {
      throw new Error('Unknown flag: ' + arg);
    }
  }
  return { hours, logDir, requireCollector };
}

const CRITICAL = new Set([
  'cli.command_failed', 'scheduler.cycle_error', 'monitor.cycle_error',
  'analytics.dataset_failed', 'collector.source_error', 'discovery.source_error',
  'export.failed'
]);

async function analyze({ hours, logDir, requireCollector }, now = Date.now()) {
  const since = new Date(now - hours * 3600000).toISOString();
  const counters = {};
  const issues = [];
  let parsedEvents = 0;
  let latestCollection = null;
  let invalidLines = 0;
  const files = fs.existsSync(logDir) ?
    fs.readdirSync(logDir).filter(name => /^events-\d{4}-\d\d-\d\d\.jsonl$/.test(name)).sort() : [];
  for (const name of files) {
    if (name.slice(7, 17) < since.slice(0, 10)) continue;
    const stream = readline.createInterface({
      input: fs.createReadStream(path.join(logDir, name), { encoding: 'utf8' }),
      crlfDelay: Infinity
    });
    for await (const line of stream) {
      if (!line.trim()) continue;
      let evt;
      try { evt = JSON.parse(line); }
      catch (_) { invalidLines++; continue; }
      const t = Date.parse(evt.ts);
      if (!Number.isFinite(t) || t < Date.parse(since) || t > now + 60000) continue;
      parsedEvents++;
      counters[evt.event] = (counters[evt.event] || 0) + 1;
      if (evt.event === 'scheduler.cycle_finished') {
        if (!latestCollection || t > latestCollection) latestCollection = t;
      }
      if (CRITICAL.has(evt.event) ||
          (evt.event === 'collector.batch_finished' && Number(evt.systemic_failures || 0) > 0)) {
        issues.push({
          ts: evt.ts, event: evt.event, platform: evt.platform || null,
          storefront: evt.storefront || null, run_id: evt.run_id || null,
          systemic_failures: Number(evt.systemic_failures || 0)
        });
      }
    }
  }
  const alerts = [];
  if (issues.length > 0) alerts.push('SOURCE_OR_COMMAND_ERRORS');
  if (invalidLines > 0) alerts.push('MALFORMED_JSONL');
  if (requireCollector && !latestCollection) alerts.push('NO_COLLECTION_CYCLE_IN_WINDOW');
  return {
    checked_at: new Date(now).toISOString(),
    since, log_dir: logDir, file_count: files.length,
    event_count: parsedEvents, counters,
    latest_collection_at: latestCollection ? new Date(latestCollection).toISOString() : null,
    invalid_lines: invalidLines, alert_count: issues.length,
    examples: issues.slice(-10), alerts,
    status: alerts.length ? 'ALERT' : parsedEvents ? 'OK' : 'NO_EVENTS'
  };
}

if (require.main === module) {
  (async () => {
    try {
      const report = await analyze(args(process.argv.slice(2)));
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      if (report.alerts.length) process.exitCode = 2;
    } catch (err) {
      process.stderr.write('audit-health: ' + err.message + '\n');
      process.exitCode = 1;
    }
  })();
}
module.exports = { analyze, args };
