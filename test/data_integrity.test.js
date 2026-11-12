const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateWindow } = require('../src/analytics/derived_metrics');
const TrendScoringEngine = require('../src/analytics/trend_models');

const window = { name: '7d', days: 7 };
const now = new Date('2026-11-12T00:00:00.000Z');
function metric(daysAgo, value, field = 'observed_install_counter', storefront = 'global') {
  return {
    observed_at: new Date(now.getTime() - daysAgo * 86400000).toISOString(),
    [field]: value,
    storefront
  };
}

test('does not substitute old snapshots for missing requested window', () => {
  const old = [metric(30, 100), metric(29, 200), metric(28, 300)];
  assert.equal(calculateWindow(old, 'android', window, now, 500), null);
});

test('does not treat install thresholds or rating counts as missing Android counters', () => {
  const series = [metric(6, null), metric(3, null), metric(0, null)]
    .map(p => ({ ...p, observed_rating_count: 300 }));
  assert.equal(calculateWindow(series, 'android', window, now, 500), null);
});

test('needs three valid observations before computing a trend', () => {
  assert.equal(calculateWindow([metric(6, 100), metric(0, 200)], 'android', window, now, 500), null);
});

test('returns real zero persistence for flat cumulative counter', () => {
  const out = calculateWindow([metric(6, 100), metric(3, 100), metric(0, 100)],
    'android', window, now, 500);
  assert.equal(out.deltaInstalls, 0);
  assert.equal(out.persistenceRatio, 0);
  assert.equal(out.rankDelta, null);
});

test('rejects counter decreases rather than hiding them', () => {
  const out = calculateWindow([metric(6, 100), metric(3, 80), metric(0, 130)],
    'android', window, now, 500);
  assert.equal(out, null);
});

test('does not mix iOS rating counts from different storefronts', () => {
  const series = [
    metric(6, 100, 'observed_rating_count', 'us'),
    metric(3, 150, 'observed_rating_count', 'us'),
    metric(0, 200, 'observed_rating_count', 'us'),
    metric(2, 10000, 'observed_rating_count', 'jp')
  ];
  const out = calculateWindow(series, 'ios', window, now, 500, 'us');
  assert.equal(out.deltaRatings, 100);
  assert.equal(out.deltaInstalls, null);
  assert.equal(out.ratingVelocityDaily, 100 / 6);
});

test('momentum distinguishes accelerating from decelerating counters', () => {
  const fast = calculateWindow([metric(6, 100), metric(3, 110), metric(0, 180)],
    'android', window, now, 500);
  const slow = calculateWindow([metric(6, 100), metric(3, 170), metric(0, 180)],
    'android', window, now, 500);
  assert.ok(fast.momentumScore > 0);
  assert.ok(slow.momentumScore < 0);
});

test('score model preserves zero persistence and rejects missing values', () => {
  const engine = new TrendScoringEngine({});
  const row = {
    dampened_growth: 0.5,
    persistence_ratio: 0,
    observation_completeness: 0
  };
  assert.equal(engine.evaluateModelB(row).persistenceScore, 0);
  assert.equal(engine.evaluateModelB({ ...row, persistence_ratio: null }), null);
  assert.equal(engine.evaluateModelA({ delta_install_counter: null, delta_rating_count: null }), null);
});
