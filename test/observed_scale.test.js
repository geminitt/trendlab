const test = require('node:test');
const assert = require('node:assert/strict');
const { getScaleCandidates, dedupePlatformApps, tileWeight, scaleColor, getLatestStarRating } =
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

test('scale map keeps every distinct measured app by default and allows explicit UI limits', () => {
  const apps = Array.from({length: 100}, (_, i) =>
    app('app' + i, 'android', i * 100, 'observed_install_counter'));
  const all = getScaleCandidates(apps, 'android');
  assert.equal(all.length, 100);
  assert.equal(all[0].rawVolume, 9900);
  assert.equal(all.at(-1).rawVolume, 0);
  assert.ok(tileWeight(all[0]) > tileWeight(all.at(-1)));
  assert.equal(getScaleCandidates(apps, 'android', 24).length, 24);
  assert.equal(apps.length, 100, 'visual selection cannot mutate collected datasets');
});

test('rating color has fixed anchored thresholds and missing ratings remain neutral', () => {
  assert.equal(scaleColor(app('x', 'ios', 100, 'observed_rating_count', 4.9)), '#176431');
  assert.equal(scaleColor(app('x', 'ios', 100, 'observed_rating_count', 2.3)), '#8c251c');
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

test('treemap and directory deduplicate app identities across storefront rows', () => {
  const first = app('first-row', 'ios', 10000, 'observed_rating_count', 4.8);
  first.nativeStoreId = '12345';
  first.lastObservedAt = '2026-11-12T00:00:00Z';
  const duplicate = app('second-row', 'ios', 10000, 'observed_rating_count', 4.8);
  duplicate.nativeStoreId = '12345';
  duplicate.lastObservedAt = '2026-11-13T00:00:00Z';
  const other = app('other-row', 'ios', 2000, 'observed_rating_count', 4.5);
  other.nativeStoreId = '67890';
  const apps = [first, duplicate, other];
  assert.equal(dedupePlatformApps(apps, 'ios').length, 2);
  assert.deepEqual(getScaleCandidates(apps, 'ios').map(a => a.id), ['second-row', 'other-row']);
});

test('duplicates without a compatible source metric do not hide observed source counts', () => {
  const measured = app('counted', 'ios', 900, 'observed_rating_count');
  measured.nativeStoreId = '12345';
  measured.lastObservedAt = '2026-11-10T00:00:00Z';
  const otherStore = app('rank-only', 'ios', null, null);
  otherStore.nativeStoreId = '12345';
  otherStore.lastObservedAt = '2026-11-13T00:00:00Z';
  assert.deepEqual(getScaleCandidates([measured, otherStore], 'ios').map(a => a.id), ['counted']);
});

test('US star color remains aligned with US rating counter for non-US catalog row', () => {
  const item = app('jp-catalog', 'ios', 6000, 'observed_rating_count');
  item.storefront = 'jp';
  item.history = [
    { storefront: 'jp', score: 1.0 },
    { storefront: 'us', score: 4.7 }
  ];
  assert.equal(getLatestStarRating(item), 4.7);
  assert.equal(scaleColor(item), '#176431');
});
