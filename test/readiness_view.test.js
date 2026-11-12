const test = require('node:test');
const assert = require('node:assert/strict');
const { countMetricDays, summarizeReadiness } = require('../web/js/readiness');

const NOW = Date.parse('2026-11-13T12:00:00.000Z');
const at = (daysAgo, hour = 0) =>
  new Date(NOW - daysAgo * 86400000 + hour * 3600000).toISOString();

test('one busy day with multiple snapshots is still one metric-day', () => {
  const app = { platform: 'android', history: [
    { t: at(1), installs: 100, storefront: 'global' },
    { t: at(1, 3), installs: 101, storefront: 'global' },
    { t: at(1, 4), installs: null, storefront: 'global', rank: 30 }
  ] };
  assert.equal(countMetricDays(app, '7d', NOW), 1);
});

test('Apple US rating days do not mix with JP ratings, or chart-only rows', () => {
  const app = { platform: 'ios', storefront: 'global', history: [
    { t: at(1), ratings: 100, storefront: 'us' },
    { t: at(2), ratings: 110, storefront: 'jp' },
    { t: at(3), ratings: null, storefront: 'us', rank: 12 },
    { t: at(4), ratings: 90, storefront: 'us' }
  ] };
  assert.equal(countMetricDays(app, '7d', NOW), 2);
});

test('future and out-of-window observations are ignored', () => {
  const app = { platform: 'android', history: [
    { t: at(9), installs: 100 },
    { t: at(4), installs: 102 },
    { t: at(-1), installs: 140 }
  ] };
  assert.equal(countMetricDays(app, '7d', NOW), 1);
  assert.equal(countMetricDays(app, 'all', NOW), 2);
});

test('readiness buckets count no metric, 1d, 2d, 3+d distinctly', () => {
  const app = n => ({
    platform: 'android',
    history: Array.from({ length: n }, (_, i) =>
      ({ t: at(i), installs: i * 100 }))
  });
  assert.deepEqual(summarizeReadiness(
    [app(0), app(1), app(2), app(3), app(7)], '7d', NOW),
    { total: 5, buckets: [1, 1, 1, 2] });
});

test('missing and invalid metric values are not counted', () => {
  assert.equal(countMetricDays({ platform: 'android', history: [
    { t: at(2), installs: null, ratings: 1 },
    { t: at(1), installs: -5 },
    { t: at(0), installs: '100' }
  ] }, '7d', NOW), 0);
});
