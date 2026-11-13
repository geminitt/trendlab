'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('VN analytics emits per-app audit reasons, counts only platform-specific VN metrics, and ignores US-only apps', () => {
  const root = path.resolve(__dirname, '..');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trendlab-eligibility-audit-'));
  try {
    const source = `
      const fs = require('node:fs');
      const { DatabaseSync } = require('node:sqlite');
      const Repository = require('./src/storage/repository');
      const DerivedMetricsCalculator = require('./src/analytics/derived_metrics');
      const db = new DatabaseSync(':memory:');
      db.exec(fs.readFileSync('./src/storage/schema.sql', 'utf8'));
      const repo = new Repository(db);
      function add(name, platform) {
        return repo.upsertPlatformApp({
          platform, nativeStoreId: name, storefront: 'global',
          title: name, primaryGenre: 'Education'
        });
      }
      const eligible = add('eligible', 'android');
      const sparse = add('sparse', 'ios');
      const chart = add('chart-only', 'android');
      const usOnly = add('us-only', 'ios');
      const wrongCounter = add('wrong-counter', 'android');
      const now = new Date('2026-11-13T00:00:00.000Z');
      for (const [i, ts] of ['2026-11-07', '2026-11-10', '2026-11-12'].entries()) {
        repo.recordObservedMetrics({
          platformAppId: eligible, storefront: 'vn',
          observedAt: ts + 'T00:00:00.000Z', installCounter: 100 + 10 * i
        });
        repo.recordObservedMetrics({
          platformAppId: usOnly, storefront: 'us',
          observedAt: ts + 'T00:00:00.000Z', ratingCount: 200 + 100 * i
        });
      }
      repo.recordObservedMetrics({ platformAppId: sparse, storefront: 'vn',
        observedAt: '2026-11-12T00:00:00.000Z', ratingCount: 32 });
      repo.recordObservedMetrics({ platformAppId: sparse, storefront: 'us',
        observedAt: '2026-11-11T00:00:00.000Z', ratingCount: 500 });
      repo.recordObservedMetrics({ platformAppId: sparse, storefront: 'us',
        observedAt: '2026-11-10T00:00:00.000Z', ratingCount: 520 });
      repo.recordObservedMetrics({ platformAppId: chart, storefront: 'vn',
        observedAt: '2026-11-12T00:00:00.000Z', rank: 5, rankChartType: 'TOP_FREE_EDUCATION' });
      repo.recordObservedMetrics({ platformAppId: wrongCounter, storefront: 'vn',
        observedAt: '2026-11-12T00:00:00.000Z', ratingCount: 900 });
      const scored = new DerivedMetricsCalculator(repo).calculateAll(now);
      console.log(JSON.stringify({ scored, ids: { eligible, sparse, chart, usOnly, wrongCounter } }));
      db.close();
    `;
    const result = spawnSync(process.execPath, ['-e', source], {
      cwd: root, encoding: 'utf8',
      env: { ...process.env, TRENDLAB_LOG_DIR: directory }
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout.trim().split('\n').at(-1));
    assert.equal(report.scored, 1);

    const entries = fs.readdirSync(directory).filter(x => x.endsWith('.jsonl'))
      .flatMap(file => fs.readFileSync(path.join(directory, file), 'utf8')
        .trim().split('\n').filter(Boolean).map(line => JSON.parse(line)));
    const summary = entries.find(e => e.event === 'analytics.eligibility_summary');
    assert.ok(summary);
    assert.equal(summary.storefront, 'vn');
    assert.equal(summary.market_candidates, 4);
    assert.equal(summary.apps_with_metrics, 2);
    assert.equal(summary.apps_without_metrics, 2);
    assert.equal(summary.apps_with_insufficient_observations, 1);
    assert.equal(summary.apps_eligible, 1);
    assert.equal(summary.apps_ineligible, 3);
    const exclusions = entries.filter(e => e.event === 'analytics.app_ineligible');
    assert.equal(exclusions.length, 3);
    assert.equal(exclusions.find(e => e.platform_app_id === report.ids.sparse)?.reason,
      'INSUFFICIENT_OBSERVATIONS');
    assert.equal(exclusions.find(e => e.platform_app_id === report.ids.sparse)?.metric_observations, 1);
    assert.equal(exclusions.find(e => e.platform_app_id === report.ids.chart)?.reason,
      'NO_MARKET_METRIC_OBSERVATIONS');
    assert.equal(exclusions.find(e => e.platform_app_id === report.ids.wrongCounter)?.reason,
      'NO_MARKET_METRIC_OBSERVATIONS');
    assert.ok(!entries.some(e => e.event === 'analytics.app_ineligible' &&
      e.platform_app_id === report.ids.usOnly));
    assert.equal(entries.filter(e => e.event === 'analytics.dataset_finished').at(-1)?.scored_apps, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
