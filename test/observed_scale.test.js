const test = require('node:test');
const assert = require('node:assert/strict');
const { getScaleCandidates, tileWeight, scaleColor, getLatestStarRating } =
  require('../web/js/scale');

function app(id, platform, count, metric, stars = 4.5) {
  return {
    id, title: id, platform, rawVolume: count, volumeMetric: metric,
    storefront: 'global',
    history: [{ score: stars, storefront: platform === 'ios' ? 'us' : 'global' }]
  };
}

test('Android and iOS observed source counters are never mixed into one group', () => {
  const apps = [
    app('a', 'android', 1000000, 'observed_install_counter'),
    app('b', 'android', 9000000, 'observed_rating_count'),
    app('c', 'ios', 2000, 'observed_rating_count'),
    app('d', 'ios', 5000000, 'observed_install_counter')
  ];
  assert.deepEqual(getScaleCandidates(apps, 'android').map(a => a.id), ['a']);
  assert.deepEqual(getScaleCandidates(apps, 'ios').map(a => a.id), ['c']);
});

test('scale map shows top measured apps and weights grow monotonically', () => {
  const apps = Array.from({length: 100}, (_, i) =>
    app('app' + i, 'android', i * 100, 'observed_install_counter'));
  const top = getScaleCandidates(apps, 'android');
  assert.equal(top.length, 64);
  assert.equal(top[0].rawVolume, 9900);
  assert.ok(tileWeight(top[0]) > tileWeight(top[63]));
});

test('rating color has fixed anchored thresholds and missing ratings remain neutral', () => {
  assert.equal(scaleColor(app('x', 'ios', 100, 'observed_rating_count', 4.9)), '#216a50');
  assert.equal(scaleColor(app('x', 'ios', 100, 'observed_rating_count', 2.3)), '#80513c');
  assert.equal(scaleColor(app('x', 'ios', 100, 'observed_rating_count', null)), '#3b4a56');
});

test('rating star score is isolated by Apple storefront', () => {
  const a = app('x', 'ios', 100, 'observed_rating_count');
  a.history = [
    { score: 5.0, storefront: 'jp' },
    { score: 4.1, storefront: 'us' },
    { score: 1.2, storefront: 'jp' }
  ];
  assert.equal(getLatestStarRating(a), 4.1);
});
