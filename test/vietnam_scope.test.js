'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const Repository = require('../src/storage/repository');
const SiteDataBuilder = require('../src/export/build_site_data');
const { calculateWindow } = require('../src/analytics/derived_metrics');
const config = require('../config/default.json');

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.resolve(__dirname, '../src/storage/schema.sql'), 'utf8'));
  return { db, repo: new Repository(db) };
}
function add(repo, storeId, platform = 'android') {
  return repo.upsertPlatformApp({
    platform, nativeStoreId: String(storeId),
    title: 'Education ' + storeId, primaryGenre: platform === 'android' ? 'EDUCATION' : 'Education'
  });
}

test('Vietnam is the single configured research storefront across platform collectors', () => {
  assert.equal(config.catalog.researchMarket, 'vn');
  assert.deepEqual(config.catalog.surveyedStorefronts, ['vn']);
  assert.equal(config.collector.android.country, 'vn');
  assert.equal(config.collector.ios.country, 'vn');
  assert.equal(config.collector.marketExplorationShare, 0.2);
});

test('VN market scheduler focuses 80% on regional evidence and caps unknown-catalog probes', () => {
  const { db, repo } = setup();
  try {
    const ids = Array.from({length: 40}, (_, i) => add(repo, 'bulk' + i));
    const charted = ids.slice(0, 4);
    charted.forEach((id, i) => repo.recordObservedMetrics({
      platformAppId: id, observedAt: '2026-11-12T08:00:00.000Z',
      storefront: 'vn', rank: i + 1, rankChartType: 'TOP_FREE_EDUCATION'
    }));
    // These are NOT VN evidence, even though they are observed elsewhere.
    repo.recordObservedMetrics({
      platformAppId: ids[4], observedAt: '2026-11-12T08:00:00.000Z',
      storefront: 'us', installCounter: 1000000
    });
    const candidates = repo.getDueMarketApps({
      platform: 'android', storefront: 'vn', limit: 10,
      now: '2026-11-13T00:00:00.000Z'
    });
    assert.equal(candidates.length, 6, '4 VN evidenced + 2 exploration, no global flood');
    assert.equal(candidates.filter(a => charted.includes(a.id)).length, 4);
    assert.equal(candidates.filter(a => !charted.includes(a.id)).length, 2);
    assert.equal(new Set(candidates.map(a => a.id)).size, 6);

    for (const item of charted) repo.recordCollectionAttempt({
      platformAppId: item, storefront: 'vn', succeeded: true,
      observedAt: '2026-11-12T09:00:00.000Z', refreshHours: 24
    });
    const due = repo.getDueMarketApps({
      platform: 'android', storefront: 'vn', limit: 10,
      now: '2026-11-13T10:00:00.000Z'
    });
    assert.equal(due.filter(a => charted.includes(a.id)).length, 4,
      'VN chart apps must be revisited even with many unverified catalog IDs');
    assert.equal(due.length, 6);
  } finally { db.close(); }
});

test('regional absence retry is seven days; a previous US success never counts as VN availability', () => {
  const { db, repo } = setup();
  try {
    const id = add(repo, 'us-only');
    repo.recordObservedMetrics({
      platformAppId: id, observedAt: '2026-11-10T00:00:00.000Z',
      storefront: 'us', installCounter: 1000
    });
    repo.recordCollectionAttempt({
      platformAppId: id, storefront: 'vn', succeeded: false,
      error: 'NOT_AVAILABLE_IN_VN_OR_UNLISTED',
      observedAt: '2026-11-13T00:00:00.000Z', retryHours: 168, maxRetryHours: 720
    });
    const retry = db.prepare(
      'SELECT next_due_at, last_error FROM collection_state WHERE platform_app_id = ? AND storefront = ?'
    ).get(id, 'vn');
    assert.equal(retry.next_due_at, '2026-11-20T00:00:00.000Z');
    assert.equal(retry.last_error, 'NOT_AVAILABLE_IN_VN_OR_UNLISTED');
    assert.ok(!repo.getDueMarketApps({ platform: 'android', storefront: 'vn',
      limit: 10, now: '2026-11-14T00:00:00.000Z' }).some(a => a.id === id));
  } finally { db.close(); }
});

test('VN export excludes unverified global-only apps and US/JP metrics and preserves raw VN source', () => {
  const { db, repo } = setup();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trendlab-vn-export-'));
  try {
    const id = add(repo, 'vn-id', 'ios');
    const globalOnly = add(repo, 'us-only', 'ios');
    repo.recordObservedMetrics({
      platformAppId: id, observedAt: '2026-11-11T00:00:00.000Z',
      storefront: 'us', ratingCount: 900000, ratingScore: 5
    });
    repo.recordObservedMetrics({
      platformAppId: id, observedAt: '2026-11-12T00:00:00.000Z',
      storefront: 'vn', ratingCount: 123, ratingScore: 4.2
    });
    repo.recordObservedMetrics({
      platformAppId: globalOnly, observedAt: '2026-11-12T00:00:00.000Z',
      storefront: 'us', ratingCount: 300000
    });
    const chartOnly = add(repo, 'chart-only', 'ios');
    repo.recordObservedMetrics({
      platformAppId: chartOnly, observedAt: '2026-11-12T00:00:00.000Z',
      storefront: 'vn', rank: 1, rankChartType: 'TOP_FREE_EDUCATION'
    });
    const target = path.join(directory, 'site.json');
    new SiteDataBuilder(repo).build(target);
    const data = JSON.parse(fs.readFileSync(target, 'utf8'));
    assert.equal(data.meta.researchMarket, 'vn');
    assert.equal(data.meta.importedCandidateCatalogApps, 3);
    assert.equal(data.meta.marketCandidateApps, 2);
    assert.equal(data.meta.marketMeasuredApps, 1);
    assert.equal(data.apps.length, 2);
    const measured = data.apps.find(a => a.id === id);
    assert.equal(measured.rawVolume, 123);
    assert.deepEqual(measured.history.map(p => p.storefront), ['vn']);
    const chart = data.apps.find(a => a.id === chartOnly);
    assert.equal(chart.rawVolume, null);
    const coverage = repo.getCoverageReport();
    assert.equal(coverage.researchMarket, 'vn');
    assert.equal(coverage.marketByPlatform[0].market_candidates, 2);
    assert.equal(coverage.marketByPlatform[0].apps_with_market_metrics, 1);
    assert.equal(coverage.marketByPlatform[0].charted_market_apps, 1);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('analytics never mixes US chart/ratings with VN time-series even within same app', () => {
  const now = new Date('2026-11-13T00:00:00.000Z');
  const series = [
    { observed_at: '2026-11-08T00:00:00.000Z', observed_rating_count: 50, storefront: 'vn' },
    { observed_at: '2026-11-09T00:00:00.000Z', observed_rating_count: 10000, storefront: 'us' },
    { observed_at: '2026-11-10T00:00:00.000Z', observed_rating_count: 70, storefront: 'vn' },
    { observed_at: '2026-11-12T00:00:00.000Z', observed_rating_count: 90, storefront: 'vn' }
  ];
  const vn = calculateWindow(series, 'ios', { name: '7d', days: 7 }, now, 500, 'vn');
  assert.ok(vn);
  assert.equal(vn.deltaRatings, 40);
  const unscoped = calculateWindow(series, 'ios', { name: '7d', days: 7 }, now, 500, 'us');
  assert.equal(unscoped, null, 'one US snapshot is insufficient');
});
