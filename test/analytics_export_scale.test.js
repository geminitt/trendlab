const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const Repository = require('../src/storage/repository');
const DerivedMetricsCalculator = require('../src/analytics/derived_metrics');
const SiteDataBuilder = require('../src/export/build_site_data');

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.resolve(__dirname, '../src/storage/schema.sql'), 'utf8'));
  return { db, repo: new Repository(db) };
}

function insertCatalog(db, count) {
  const stmt = db.prepare(`
    INSERT INTO platform_applications
      (id, platform, native_store_id, storefront, title, primary_genre, first_seen_at)
    VALUES (?, 'android', ?, 'global', ?, 'EDUCATION', ?)
  `);
  db.exec('BEGIN');
  try {
    for (let i = 0; i < count; i++) {
      stmt.run('id-' + i, 'com.example.edu' + i, 'Education ' + i, '2026-11-01T00:00:00Z');
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

test('analyze skips the catalog and evaluates only apps with 3 observed samples', () => {
  const { db, repo } = setup();
  try {
    insertCatalog(db, 1200);
    const now = new Date('2026-11-13T00:00:00.000Z');
    for (const [appId, values] of [
      ['id-0', [100, 110, 130]],
      ['id-1', [150, 160]]
    ]) {
      for (let i = 0; i < values.length; i++) {
        repo.recordObservedMetrics({
          platformAppId: appId,
          observedAt: new Date(now.getTime() - (values.length - 1 - i) * 3 * 86400000).toISOString(),
          installCounter: values[i]
        });
      }
    }
    // Stale derived data must disappear for apps that no longer qualify.
    repo.saveDerivedMetrics({
      platformAppId: 'id-1', windowType: '7d',
      windowStart: now.toISOString(), windowEnd: now.toISOString()
    });

    const originalGetSeries = repo.getMetricsSeries.bind(repo);
    const scanned = [];
    repo.getMetricsSeries = id => {
      scanned.push(id);
      return originalGetSeries(id);
    };
    repo.getPlatformApps = () => { throw new Error('should never scan the full catalog'); };

    const evaluated = new DerivedMetricsCalculator(repo).calculateAll(now);
    assert.equal(evaluated, 1);
    assert.deepEqual(scanned, ['id-0']);
    assert.equal(db.prepare(
      'SELECT COUNT(*) AS count FROM derived_window_metrics WHERE platform_app_id = ?'
    ).get('id-1').count, 0);
    assert.ok(db.prepare(
      'SELECT COUNT(*) AS count FROM derived_window_metrics WHERE platform_app_id = ?'
    ).get('id-0').count > 0);
  } finally {
    db.close();
  }
});

test('export includes all observed apps beyond 1000 without exporting unobserved catalog', () => {
  const { db, repo } = setup();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'trendlab-export-'));
  try {
    insertCatalog(db, 1042);
    db.exec('BEGIN');
    try {
      const insertObserved = db.prepare(`
        INSERT INTO observed_metrics
          (id, platform_app_id, observed_at, observed_install_counter, storefront)
        VALUES (?, ?, '2026-11-12T12:00:00.000Z', ?, 'global')
      `);
      for (let i = 0; i < 1002; i++) {
        insertObserved.run('metric-' + i, 'id-' + i, i === 0 ? null : i);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    const output = path.join(temp, 'data.json');
    new SiteDataBuilder(repo).build(output);
    const payload = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(payload.meta.catalogApps, 1042);
    assert.equal(payload.meta.totalApps, 1002);
    assert.equal(payload.apps.length, 1002);
    assert.equal(payload.meta.activity.daily.length, 30);
    assert.ok(payload.meta.activity.daily.every(row =>
      /^\\d{4}-\\d{2}-\\d{2}$/.test(row.date) &&
      Number.isInteger(row.observationRows) && row.observationRows >= 0));
    const noCounter = payload.apps.find(a => a.id === 'id-0');
    assert.equal(noCounter.rawVolume, null);
    assert.equal(noCounter.volumeMetric, null);
    const zeroCounter = payload.apps.find(a => a.id === 'id-1');
    assert.equal(zeroCounter.rawVolume, 1);
    assert.equal(zeroCounter.volumeMetric, 'observed_install_counter');
    assert.equal(fs.readdirSync(temp).length, 1);
  } finally {
    db.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('iOS display scale selects US ratings, not a larger value from another storefront', () => {
  const { db, repo } = setup();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'trendlab-export-us-'));
  try {
    const id = repo.upsertPlatformApp({
      platform: 'ios', nativeStoreId: '1234567890', storefront: 'global',
      title: 'Education Example', primaryGenre: 'Education'
    });
    const t = new Date().toISOString();
    repo.recordObservedMetrics({
      platformAppId: id, observedAt: new Date(Date.parse(t) - 2000).toISOString(),
      storefront: 'us', ratingCount: 1000
    });
    repo.recordObservedMetrics({
      platformAppId: id, observedAt: t,
      storefront: 'jp', ratingCount: 9000
    });
    const output = path.join(temp, 'site.json');
    new SiteDataBuilder(repo).build(output);
    const app = JSON.parse(fs.readFileSync(output, 'utf8')).apps[0];
    assert.equal(app.rawVolume, 1000);
    assert.equal(app.volumeMetric, 'observed_rating_count');
  } finally {
    db.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
