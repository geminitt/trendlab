'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { metricValue, getAreaCandidates } = require('../web/js/area');
const SquarifiedTreemap = require('../web/js/treemap');

const app = (id, platform, count, metric, extras = {}) => ({
  id, nativeStoreId: id, title: id, platform, rawVolume: count,
  volumeMetric: metric, lastObservedAt: '2026-11-13T00:00:00Z', ...extras
});
const geometryArea = rect => rect.rw * rect.rh;
const almost = (a, b, tolerance = 1e-9) =>
  assert.ok(Math.abs(a - b) / Math.max(1, Math.abs(b)) < tolerance,
    'expected ' + a + ' to be close to ' + b);

test('observed Android rectangles have the exact 996.1M / 34.5M ratio', () => {
  const duolingo = app('Duolingo', 'android', 996100000, 'observed_install_counter');
  const khan = app('Khan Academy', 'android', 34500000, 'observed_install_counter');
  const selected = getAreaCandidates([duolingo, khan], 'android', 'observed_scale');
  assert.equal(selected.items.length, 2);
  assert.deepEqual(selected.items.map(row => row.weight), [996100000, 34500000]);
  const tiles = SquarifiedTreemap.squarify(selected.items, 0, 0, 1000, 600);
  almost(geometryArea(tiles[0]) / geometryArea(tiles[1]), 996100000 / 34500000);
  almost(tiles.reduce((s, rect) => s + geometryArea(rect), 0), 600000);
});

test('switching to breakout scores controls area instead of install volume', () => {
  const large = app('Huge but flat', 'android', 996100000, 'observed_install_counter', {
    scores: { '30d': { model_c_breakout: { score: 20 } } }
  });
  const smaller = app('Small breakout', 'android', 34500000, 'observed_install_counter', {
    scores: { '30d': { model_c_breakout: { score: 80 } } }
  });
  const observed = getAreaCandidates([large, smaller], 'android', 'observed_scale');
  assert.equal(observed.items[0].app.id, 'Huge but flat');
  const breakout = getAreaCandidates([large, smaller], 'android', 'model_c_breakout', '30d');
  assert.deepEqual(breakout.items.map(row => row.app.id), ['Small breakout', 'Huge but flat']);
  const rects = SquarifiedTreemap.squarify(breakout.items, 0, 0, 1000, 600);
  almost(geometryArea(rects[0]) / geometryArea(rects[1]), 4);
  assert.equal(large.rawVolume, 996100000, 'UI scoring cannot mutate source data');
});

test('sustained model score and rating velocity retain numerical ratios', () => {
  const one = app('a', 'ios', 100, 'observed_rating_count', {
    scores: { '7d': { model_b_compounder: { score: 12.5 } } },
    metrics: { '7d': { ratingVelocity: 2.5 } }
  });
  const two = app('b', 'ios', 200, 'observed_rating_count', {
    scores: { '7d': { model_b_compounder: { score: 50 } } },
    metrics: { '7d': { ratingVelocity: 15 } }
  });
  assert.deepEqual(getAreaCandidates([one,two], 'ios', 'model_b_compounder', '7d').items.map(x=>x.weight), [50,12.5]);
  assert.deepEqual(getAreaCandidates([one,two], 'ios', 'rating_velocity', '7d').items.map(x=>x.weight), [15,2.5]);
  assert.equal(metricValue(one, 'model_b_compounder', '30d'), null, 'wrong time window must be missing');
});

test('zero, negative and missing metrics are distinctly counted and never drawn', () => {
  const items = [
    app('positive', 'android', 100, 'observed_install_counter', {
      scores: { '30d': { model_a_growth: { score: 4 } } }
    }),
    app('zero', 'android', 200, 'observed_install_counter', {
      scores: { '30d': { model_a_growth: { score: 0 } } }
    }),
    app('negative', 'android', 300, 'observed_install_counter', {
      scores: { '30d': { model_a_growth: { score: -3 } } }
    }),
    app('missing', 'android', 400, 'observed_install_counter'),
    app('invalid', 'android', 500, 'observed_install_counter', {
      scores: { '30d': { model_a_growth: { score: 'NaN' } } }
    })
  ];
  const r = getAreaCandidates(items, 'android', 'model_a_growth', '30d');
  assert.deepEqual([r.items.length, r.zero, r.negative, r.missing, r.total], [1,1,1,2,5]);
  assert.equal(r.items[0].weight, 4);
  assert.equal(SquarifiedTreemap.squarify([
    ...r.items, { app: { id: 'forbidden' }, weight: 0 },
    { app: { id: 'forbidden-negative' }, weight: -100 },
    { app: { id: 'forbidden-NaN' }, weight: NaN }
  ], 0, 0, 100, 100).length, 1);
  assert.equal(SquarifiedTreemap.squarify([{app:{}, weight:0}], 0, 0, 100, 100).length, 0);
});

test('platform-specific units cannot be mixed in one area selection', () => {
  const a = app('android', 'android', 100000, 'observed_install_counter');
  const i = app('ios', 'ios', 500000, 'observed_rating_count');
  const incompatible = app('unsupported-ios', 'ios', 200000, 'observed_install_counter');
  const apps = [a, i, incompatible];
  const android = getAreaCandidates(apps, 'android', 'observed_scale');
  const ios = getAreaCandidates(apps, 'ios', 'observed_scale');
  assert.equal(android.items.length, 1);
  assert.equal(android.items[0].app.id, 'android');
  assert.equal(ios.items.length, 1);
  assert.equal(ios.items[0].app.id, 'ios');
  assert.equal(ios.missing, 1);
});

test('native store ID deduplication prefers a real score over a missing latest row', () => {
  const older = app('old-row', 'ios', null, null, {
    nativeStoreId: '101', scores: { '30d': { model_c_breakout: { score: 17 } } },
    lastObservedAt: '2026-11-12T00:00:00Z'
  });
  const newer = app('new-row', 'ios', null, null, {
    nativeStoreId: '101', lastObservedAt: '2026-11-13T00:00:00Z'
  });
  const r = getAreaCandidates([older, newer], 'ios', 'model_c_breakout');
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].app.id, 'old-row');
  assert.equal(r.total, 1);
});
