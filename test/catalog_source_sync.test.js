'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { execFileSync } = require('node:child_process');
const Repository = require('../src/storage/repository');
const { CatalogSourceMonitor, SOURCE_ID, RAW_URL } = require('../src/catalog/source_monitor');

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '../src/storage/schema.sql'), 'utf8'));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'trendlab-sync-'));
  return { db, repo: new Repository(db), temp,
    close() { db.close(); fs.rmSync(temp, { force: true, recursive: true }); } };
}

const NOW = new Date('2026-11-13T00:00:00.000Z');
const TSV = [
  'store\tstore_id\tapp_name\tapp_category',
  'google\tcom.example.newedu\tNew Education\teducation',
  'apple\t123456789\tNew iOS Education\teducation',
  'google\tcom.example.game\tGame\tgame_educational',
  ''
].join('\n');
const COMPRESSED = execFileSync('xz', ['-zc'], { input: TSV });

function createMonitor({ repo, temp }, { age = '2026-11-12T00:00:00Z', version = 'abc-v1',
                                  failures = false, onDownload = () => {} } = {}) {
  const bytes = COMPRESSED.length;
  return new CatalogSourceMonitor(repo, {
    dataDir: temp,
    metadata: async () => ({ version, size: bytes, modifiedAt: age, url: RAW_URL }),
    download: async ({ target, url }) => {
      onDownload();
      assert.equal(url, RAW_URL);
      if (failures) throw new Error('Network unavailable');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, COMPRESSED);
      return { file: target, bytes, sha256: 'fixture-sha256' };
    }
  });
}

test('fresh upstream source is imported exactly once, with provenance and new-app count', async () => {
  const ctx = setup();
  try {
    let downloads = 0;
    const monitor = createMonitor(ctx, { onDownload: () => { downloads++; } });
    const first = await monitor.run({ now: NOW });
    assert.equal(first.status, 'IMPORTED');
    assert.equal(first.newApps, 2);
    assert.equal(first.importReport.educationRows, 2);
    assert.equal(downloads, 1);
    const second = await monitor.run({ now: NOW });
    assert.equal(second.status, 'UNCHANGED');
    assert.equal(downloads, 1);
    assert.equal(ctx.repo.getCoverageReport({ now: NOW.toISOString() })
      .catalogSources[0].last_status, 'UNCHANGED');
    assert.equal(monitor.getState().last_imported_version, 'abc-v1');
  } finally { ctx.close(); }
});

test('old public catalog dump is NOT imported as if it provided new apps', async () => {
  const ctx = setup();
  try {
    let downloads = 0;
    const monitor = createMonitor(ctx, {
      age: '2025-11-17T07:10:39Z', onDownload: () => { downloads++; }
    });
    const result = await monitor.run({ now: NOW, maxAgeDays: 30 });
    assert.equal(result.status, 'STALE_SOURCE');
    assert.equal(result.imported, false);
    assert.equal(downloads, 0);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM platform_applications').get().n, 0);
    assert.equal(monitor.getState().last_status, 'STALE_SOURCE');
  } finally { ctx.close(); }
});

test('source failure is auditable and never marked imported', async () => {
  const ctx = setup();
  try {
    const monitor = createMonitor(ctx, { failures: true });
    await assert.rejects(monitor.run({ now: NOW }), /Network unavailable/);
    assert.equal(monitor.getState().last_status, 'FAILED');
    assert.equal(monitor.getState().last_imported_version, null);
    assert.match(monitor.getState().last_error, /Network unavailable/);
  } finally { ctx.close(); }
});

test('a newer GitHub blob gets imported without deleting pre-existing observations', async () => {
  const ctx = setup();
  try {
    await createMonitor(ctx).run({ now: NOW });
    const id = ctx.db.prepare('SELECT id FROM platform_applications WHERE native_store_id = ?')
      .get('com.example.newedu').id;
    ctx.repo.recordObservedMetrics({
      platformAppId: id, observedAt: '2026-11-12T12:00:00Z', installCounter: 100
    });
    const newVersion = await createMonitor(ctx, { version: 'abc-v2' }).run({ now: NOW });
    assert.equal(newVersion.status, 'IMPORTED');
    assert.equal(newVersion.newApps, 0);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM observed_metrics').get().n, 1);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM catalog_source_sync WHERE source_id = ?')
      .get(SOURCE_ID).n, 1);
  } finally { ctx.close(); }
});

test('per-storefront freshness is different from number of known apps', () => {
  const ctx = setup();
  try {
    const id = ctx.repo.upsertPlatformApp({
      platform: 'ios', nativeStoreId: '11223344',
      title: 'Study', primaryGenre: 'Education'
    });
    ctx.repo.recordCollectionAttempt({
      platformAppId: id, storefront: 'us', succeeded: true,
      observedAt: '2026-11-12T12:00:00Z', refreshHours: 24
    });
    ctx.repo.recordCollectionAttempt({
      platformAppId: id, storefront: 'jp', succeeded: false,
      observedAt: '2026-11-12T12:00:00Z', retryHours: 1
    });
    const report = ctx.repo.getCoverageReport({ now: NOW.toISOString() });
    assert.equal(report.byStorefront.find(x => x.storefront === 'us').fresh_success_24h, 1);
    assert.equal(report.byStorefront.find(x => x.storefront === 'jp').fresh_success_24h, 0);
    assert.equal(report.byStorefront.find(x => x.storefront === 'jp').overdue, 1);
    assert.match(report.coverageMeaning, /local catalog/);
  } finally { ctx.close(); }
});
