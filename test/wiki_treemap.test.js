'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Wiki = require('../web/js/wiki-metrics');
const Treemap = require('../web/js/treemap');

function article(title, views, previousViews = 100) {
  const comparable = Number.isFinite(views) && Number.isFinite(previousViews);
  return { title, label: title, url: 'https://en.wikipedia.org/wiki/' + title,
    history: [{ date: '2026-11-14', views }],
    source: { url: 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia.org/all-access/user/' + title },
    windows: { '1': { views, previousViews,
      delta: comparable ? views - previousViews : null,
      changePct: comparable && previousViews > 0 ? 100 * (views - previousViews) / previousViews : null,
      status: !comparable ? 'missing_history' : previousViews === 0 ? 'zero_baseline' : 'comparable' } } };
}

function edition(language = 'en') {
  return { language, label: language, endDate: '2026-11-14', file: language + '-2026-11-14-123456abcdef.json' };
}

function dataset(language = 'en') {
  return { schemaVersion: 1, meta: { language, project: language + '.wikipedia.org', endDate: '2026-11-14' }, articles: [] };
}

test('Wikipedia area has exact pageview ratios without compression or minimum floors', () => {
  const rows = [article('Large', 10000), article('Small', 25), article('Zero', 0), article('Missing', null)];
  const selected = Wiki.select(rows, 1);
  assert.equal(selected.totalViews, 10025);
  assert.equal(selected.missing, 1);
  assert.equal(selected.zero, 1);
  const tiles = Treemap.squarify(selected.items, 0, 0, 1200, 700);
  assert.equal(tiles.length, 2);
  assert.ok(Math.abs(tiles[0].rw * tiles[0].rh / (tiles[1].rw * tiles[1].rh) - 400) < 1e-8);
});

test('change colors use a fixed scale, including the difference between missing and zero', () => {
  assert.notEqual(Wiki.color({ changePct: 0 }), Wiki.color({ changePct: null }));
  assert.equal(Wiki.color({ changePct: 100 }), Wiki.color({ changePct: 5000 }));
  assert.notEqual(Wiki.color({ changePct: 50 }), Wiki.color({ changePct: -50 }));
  assert.equal(Wiki.changeLabel(article('new', 50, 0).windows['1']), 'Zero prior views');
  assert.equal(Wiki.changeLabel(article('flat', 100, 100).windows['1']), '0%');
  assert.equal(Wiki.changeLabel(article('missing', 50, null).windows['1']), 'Prior comparison unavailable');
});

test('white article labels remain readable across the complete color scale', () => {
  const luminance = color => {
    const channels = color.startsWith('#') ? color.slice(1).match(/../g).map(x => parseInt(x, 16)) :
      color.match(/\d+/g).map(Number);
    const linear = channels.map(channel => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  for (const changePct of [null, ...Array.from({ length: 201 }, (_, i) => i - 100)]) {
    const contrast = 1.05 / (luminance(Wiki.color({ changePct })) + 0.05);
    assert.ok(contrast >= 4.5, 'Low label contrast for ' + changePct + ': ' + contrast);
  }
});

test('search, periods, rising and falling filters use the same actual totals', () => {
  const rows = [article('Alpha', 200), article('Beta', 50), article('New', 30, 0)];
  assert.deepEqual(Wiki.select(rows, 1, '', 'rising').items.map(r => r.article.title), ['Alpha', 'New']);
  assert.deepEqual(Wiki.select(rows, 1, '', 'falling').items.map(r => r.article.title), ['Beta']);
  assert.equal(Wiki.select(rows, 1, 'ALP').totalViews, 200);
  assert.equal(Wiki.select(rows, 7).items.length, 0, 'A missing period is not replaced by another period');
  assert.equal(Wiki.select(rows, 1, '', 'zero_baseline').items[0].weight, 30);
});

test('editions and dates cannot be silently mixed or loaded through arbitrary manifest paths', () => {
  assert.throws(() => Wiki.validateDataset(dataset('vi'), edition('en')), /does not match/);
  const wrong = dataset(); wrong.meta.endDate = '2026-11-13';
  assert.throws(() => Wiki.validateDataset(wrong, edition()), /does not match/);
  assert.throws(() => Wiki.validateManifest({ schemaVersion: 1, editions: [{ ...edition(), file: '../data.json' }] }), /Invalid/);
  assert.throws(() => Wiki.validateManifest({ schemaVersion: 1, editions: [edition(), edition()] }), /Invalid/);
  assert.equal(Wiki.validateManifest({ schemaVersion: 1, editions: [edition(), edition('vi')] }).editions.length, 2);
});

test('late edition responses cannot replace the latest selected language', async () => {
  let resolveFirst;
  const loader = new Wiki.EditionLoader(url => url.includes('/en-') ? new Promise(resolve => { resolveFirst = resolve; }) :
    Promise.resolve({ ok: true, json: async () => dataset('vi') }));
  const first = loader.load(edition());
  const second = await loader.load(edition('vi'));
  resolveFirst({ ok: true, json: async () => dataset() });
  assert.equal(second.meta.language, 'vi');
  assert.equal(await first, null);
});

test('the fetch callback is not rebound to the loader instance (browser fetch contract)', async () => {
  const loader = new Wiki.EditionLoader(function () {
    assert.equal(this, undefined, 'Passing the loader as this causes illegal browser fetch invocation');
    return Promise.resolve({ ok: true, json: async () => dataset() });
  });
  assert.equal((await loader.load(edition())).meta.language, 'en');
});

test('a stale failed request cannot surface an error over a newer successful selection', async () => {
  let rejectFirst;
  const loader = new Wiki.EditionLoader(url => url.includes('/en-') ? new Promise((resolve, reject) => { rejectFirst = reject; }) :
    Promise.resolve({ ok: true, json: async () => dataset('vi') }));
  const first = loader.load(edition());
  await loader.load(edition('vi'));
  rejectFirst(new Error('Old request timed out'));
  assert.equal(await first, null);
});

test('new home and article inspector have all referenced elements and local assets', () => {
  const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '../web/js/wiki.js'), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(x => x[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const match of script.matchAll(/this\.(?:el|text)\('([^']+)'/g)) {
    assert.ok(ids.includes(match[1]), 'Missing element: ' + match[1]);
  }
  for (const match of html.matchAll(/(?:src|href)="((?:js|css)\/[^\"]+)"/g)) {
    assert.ok(fs.existsSync(path.join(__dirname, '../web', match[1])));
  }
  assert.match(html, /<dialog[^>]*id="articleDialog"/);
  assert.doesNotMatch(html, /google-play|App Store|Education App/);
});
