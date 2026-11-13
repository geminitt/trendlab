'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('audit entries have a stable run ID, UTC time, and secret redaction', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trendlab-audit-'));
  const previousDir = process.env.TRENDLAB_LOG_DIR;
  try {
    process.env.TRENDLAB_LOG_DIR = tmp;
    const { audit, RUN_ID, LOG_DIR } = require('../src/observability/audit');
    assert.equal(LOG_DIR, tmp);
    const entry = audit('collector.test_event', {
      platform: 'android', storefront: 'vn',
      platform_app_id: 'app-123', elapsed_ms: 153,
      status: 'success', api_key: 'super-secret',
      headers: { authorization: 'Bearer fake', acceptable: 'yes' }
    });
    assert.match(entry.ts, /^\d{4}-\d\d-\d\dT\d\d:/);
    assert.equal(entry.run_id, RUN_ID);
    assert.equal(entry.platform, 'android');
    assert.equal(entry.api_key, '[REDACTED]');
    assert.equal(entry.headers.authorization, '[REDACTED]');
    const files = fs.readdirSync(tmp).filter(name => name.endsWith('.jsonl'));
    assert.equal(files.length, 1);
    const lines = fs.readFileSync(path.join(tmp, files[0]), 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    const logged = JSON.parse(lines[0]);
    assert.equal(logged.event, 'collector.test_event');
    assert.equal(logged.platform_app_id, 'app-123');
    assert.ok(!JSON.stringify(logged).includes('super-secret'));
    assert.ok(!JSON.stringify(logged).includes('Bearer fake'));
    assert.throws(() => audit('bad_event', {}), /Invalid audit event/);
  } finally {
    if (previousDir === undefined) delete process.env.TRENDLAB_LOG_DIR;
    else process.env.TRENDLAB_LOG_DIR = previousDir;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI coverage stdout remains parseable JSON despite structured audit logging', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trendlab-audit-cli-'));
  const root = path.resolve(__dirname, '..');
  try {
    const result = spawnSync(process.execPath, [path.join(root, 'bin/cli.js'), 'coverage'], {
      cwd: tmp, encoding: 'utf8',
      env: { ...process.env, TRENDLAB_LOG_DIR: path.join(tmp, 'logs') }
    });
    assert.equal(result.status, 0, result.stderr);
    const coverage = JSON.parse(result.stdout);
    assert.equal(coverage.researchMarket, 'vn');
    assert.deepEqual(coverage.byPlatform, []);
    assert.match(result.stderr, /cli\.command_started/);
    assert.match(result.stderr, /cli\.command_finished/);
    assert.ok(fs.existsSync(path.join(tmp, 'data', 'trendlab.sqlite')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('reset script is a guarded operator action, not an automatic deletion', () => {
  const root = path.resolve(__dirname, '..');
  const scriptPath = path.join(root, 'scripts/reset-vn-auditable.sh');
  const script = fs.readFileSync(scriptPath, 'utf8');
  const shell = spawnSync('bash', ['-n', scriptPath], { encoding: 'utf8' });
  assert.equal(shell.status, 0, shell.stderr);
  assert.match(script, /ensure_quiescent/);
  assert.match(script, /CONFIRM_FRESH_VN_DATABASE/);
  assert.match(script, /PRAGMA integrity_check/);
  assert.match(script, /\.backup/);
  assert.match(script, /pre-reset\.sqlite/);
  assert.match(script, /journal-before-reset\.jsonl/);
  assert.match(script, /sha256sum/);
  assert.match(script, /mv "\$DB"/);
  assert.doesNotMatch(script, /rm -rf/);
});

test('analytics rejects insufficient coverage with a specific, reviewable reason', () => {
  const { calculateWindow } = require('../src/analytics/derived_metrics');
  const now = new Date('2026-11-13T00:00:00.000Z');
  const series = [
    { observed_at: '2026-11-11T00:00:00.000Z', observed_install_counter: 100, storefront: 'vn' },
    { observed_at: '2026-11-12T00:00:00.000Z', observed_install_counter: 120, storefront: 'vn' },
    { observed_at: '2026-11-12T12:00:00.000Z', observed_install_counter: 140, storefront: 'vn' }
  ];
  let rejection = null;
  const result = calculateWindow(series, 'android', { name:'7d', days:7 }, now, 500, 'vn',
    (reason, context) => { rejection = { reason, context }; });
  assert.equal(result, null);
  assert.equal(rejection.reason, 'INSUFFICIENT_TIME_COVERAGE');
  assert.ok(rejection.context.required_span_days > rejection.context.span_days);
});
