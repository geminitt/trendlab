'use strict';

/**
 * Append-only structured audit log, intentionally OUTSIDE data/trendlab.sqlite.
 * One JSON line per event. UTC daily files are never overwritten by a DB reset.
 *
 * Runtime contract:
 * - All events include ts, run_id, pid, command, event, schema_version.
 * - Never put provider raw bodies, secrets or request headers into audit lines.
 *   Full successful store response bodies are preserved in raw_snapshots in SQLite.
 * - Write failures propagate to the caller: it must not silently collect
 *   unaudited data. Systemd/journald also receives the same JSON line.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const RUN_ID = crypto.randomUUID();
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const LOG_DIR = path.resolve(process.env.TRENDLAB_LOG_DIR || path.join(PROJECT_ROOT, 'logs'));
const MAX_ERROR = 1800;
const PRIVATE_KEY = /(password|secret|token|authorization|cookie|api[_-]?key|credential)/i;

function sanitized(value, depth = 0) {
  if (value === undefined) return null;
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return typeof value === 'number' && !Number.isFinite(value) ? null : value;
  }
  if (typeof value === 'string') return value.length > MAX_ERROR ?
    value.slice(0, MAX_ERROR) + '…[truncated]' : value;
  if (value instanceof Error) return {
    name: sanitized(value.name),
    message: sanitized(value.message),
    code: sanitized(value.code || null)
  };
  if (Array.isArray(value)) {
    if (depth >= 3) return '[nested array omitted]';
    return value.slice(0, 50).map(v => sanitized(v, depth + 1));
  }
  if (typeof value === 'object') {
    if (depth >= 3) return '[nested object omitted]';
    return Object.fromEntries(
      Object.entries(value).slice(0, 60).map(([k, v]) =>
        [k, PRIVATE_KEY.test(k) ? '[REDACTED]' : sanitized(v, depth + 1)]));
  }
  return String(value);
}

/**
 * @param {string} event Stable dot-separated event name, e.g. collector.attempt
 * @param {object} detail Flat, auditable metadata only (no provider payload).
 */
function audit(event, detail = {}) {
  if (!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*)+$/.test(event)) {
    throw new Error('Invalid audit event name: ' + event);
  }
  const ts = new Date().toISOString();
  const entry = {
    schema_version: 1,
    ts,
    run_id: RUN_ID,
    pid: process.pid,
    command: process.argv[2] || 'unknown',
    event,
    ...sanitized(detail)
  };
  const row = JSON.stringify(entry) + '\n';
  fs.mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
  const output = path.join(LOG_DIR, 'events-' + ts.slice(0, 10) + '.jsonl');
  fs.appendFileSync(output, row, { encoding: 'utf8', mode: 0o600, flag: 'a' });
  // Journald receives full structured events too. No console interception.
  process.stdout.write(row);
  return entry;
}

module.exports = { audit, RUN_ID, LOG_DIR, sanitized };
