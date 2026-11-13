'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const iso = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trendlab-audit-ops-'));
  const logs = path.join(dir, 'logs');
  const archive = path.join(dir, 'archive');
  fs.mkdirSync(logs);
  return {dir, logs, archive};
};

test('audit-health reports errors without confusing absence of collection for a failure unless explicitly requested', () => {
  const {dir, logs} = iso();
  try {
    const filename = 'events-' + new Date().toISOString().slice(0,10) + '.jsonl';
    const filepath = path.join(logs, filename);
    const run = (...extra) => spawnSync(process.execPath,
      ['scripts/audit-health.js', '--log-dir', logs, '--hours', '24', ...extra], {
      cwd: ROOT, encoding: 'utf8'
    });
    const empty = run();
    assert.equal(empty.status, 0);
    assert.equal(JSON.parse(empty.stdout).status, 'NO_EVENTS');
    const withFreshness = run('--require-collector');
    assert.equal(withFreshness.status, 2);
    assert.deepEqual(JSON.parse(withFreshness.stdout).alerts, ['NO_COLLECTION_CYCLE_IN_WINDOW']);

    fs.writeFileSync(filepath,
      JSON.stringify({ts:new Date().toISOString(),event:'scheduler.cycle_finished',
        run_id:'test', attempted:1, succeeded:1, failed:0}) + '\n');
    const success = run('--require-collector');
    assert.equal(success.status, 0);
    assert.equal(JSON.parse(success.stdout).status, 'OK');

    fs.appendFileSync(filepath,
      JSON.stringify({ts:new Date().toISOString(),event:'collector.source_error',
        run_id:'test', platform:'ios',storefront:'vn'})+'\n');
    const error = run('--require-collector');
    assert.equal(error.status, 2);
    const json = JSON.parse(error.stdout);
    assert.ok(json.alerts.includes('SOURCE_OR_COMMAND_ERRORS'));
    assert.equal(json.alert_count, 1);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('audit archiver creates a checksummed copy without deleting source; repeat is safe', () => {
  const {dir,logs,archive} = iso();
  try {
    const file = path.join(logs, 'events-2026-01-01.jsonl');
    fs.writeFileSync(file, '{"event":"monitor.cycle_finished"}\n');
    const old = new Date(Date.now() - 14 * 86400000);
    fs.utimesSync(file, old, old);
    const run = mode => spawnSync('bash', ['scripts/archive-audit-logs.sh', mode], {
      cwd:ROOT, encoding:'utf8',
      env:{...process.env,TRENDLAB_LOG_DIR:logs,TRENDLAB_AUDIT_ARCHIVE_DIR:archive}
    });
    assert.equal(run('--inspect').status, 0);
    assert.ok(!fs.existsSync(archive), 'inspect is read-only');
    const archiveResult = run('--archive');
    assert.equal(archiveResult.status, 0, archiveResult.stderr);
    assert.ok(fs.existsSync(file), 'source must survive archiving');
    const zip = path.join(archive, path.basename(file) + '.gz');
    assert.ok(fs.existsSync(zip));
    assert.ok(fs.existsSync(zip + '.sha256'));
    assert.equal(run('--archive').status, 0, 'repeat must not overwrite or fail');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
