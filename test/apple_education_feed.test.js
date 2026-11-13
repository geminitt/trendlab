'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const Repository = require('../src/storage/repository');
const StoreSweeper = require('../src/catalog/store_sweeper');
const { chartUrl, parseAppleChart, getAppleEducationTopFree } =
  require('../src/catalog/apple_education_feed');

function fixture(items) {
  return { feed: { entry: items.map(({id,title,artist}, i) => ({
    id: { attributes: { 'im:id': String(id) } },
    'im:name': { label: title },
    'im:artist': { label: artist },
    'im:price': { attributes: { amount: '0.00000' } },
    'im:releaseDate': { label: '2026-11-13' }
  })) } };
}

test('Apple chart URL locks to VN storefront and Education genre, rejects bad inputs', () => {
  assert.equal(chartUrl('vn'), 'https://itunes.apple.com/vn/rss/topfreeapplications/limit=100/genre=6017/json');
  assert.throws(() => chartUrl('vn.example.com'), /Invalid/);
  assert.throws(() => chartUrl('../us'), /Invalid/);
  assert.throws(() => chartUrl('vn', 6017, 101), /limit/);
});

test('Apple RSS JSON parser preserves feed order and does not silently invent ranks', async () => {
  const feed = fixture([
    {id: 123, title: 'First Education', artist: 'First Studio'},
    {id: 456, title: 'Second Education', artist: 'Second Studio'}
  ]);
  const apps = await getAppleEducationTopFree('vn', 6017, 100, async url => {
    assert.match(url, /\/vn\/rss\/topfreeapplications\/limit=100\/genre=6017\/json$/);
    return feed;
  });
  assert.deepEqual(apps, [
    {id: '123', title: 'First Education', developer: 'First Studio', price: 0},
    {id: '456', title: 'Second Education', developer: 'Second Studio', price: 0}
  ]);
  assert.throws(() => parseAppleChart({feed: {entry: []}}), /nonempty/);
  assert.throws(() => parseAppleChart(fixture([
    {id: 123, title: 'One'}, {id: 123, title: 'Duplicate'}
  ])), /duplicate/);
  assert.throws(() => parseAppleChart(fixture([{id: 'invalid', title: 'Bad'}])), /Malformed/);
});

test('VN iOS discovery stores correctly ordered chart ranks using replacement RSS provider', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '../src/storage/schema.sql'), 'utf8'));
  const repo = new Repository(db);
  const apps = parseAppleChart(fixture([
    {id: 123, title: 'First Education', artist: 'First Studio'},
    {id: 456, title: 'Second Education', artist: 'Second Studio'}
  ]));
  try {
    const sweeper = new StoreSweeper(repo, {
      fetchAppleChart: async (country, genreId, limit) => {
        assert.equal(country, 'vn');
        assert.equal(genreId, 6017);
        assert.equal(limit, 100);
        return apps;
      }
    });
    assert.equal(await sweeper.sweepAppleEducationCharts(['vn']), 2);
    const result = db.prepare(`
      SELECT p.native_store_id, m.observed_rank, m.storefront
      FROM observed_metrics m
      JOIN platform_applications p ON p.id = m.platform_app_id
      WHERE m.observed_rank IS NOT NULL
      ORDER BY m.observed_rank
    `).all();
    assert.deepEqual(result.map(row => [row.native_store_id, row.observed_rank, row.storefront]),
      [['123', 1, 'vn'], ['456', 2, 'vn']]);
  } finally {
    db.close();
  }
});

test('malformed Apple RSS does not write fake discovery ranks', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '../src/storage/schema.sql'), 'utf8'));
  try {
    const repo = new Repository(db);
    const sweeper = new StoreSweeper(repo, {
      fetchAppleChart: async () => parseAppleChart({feed: {entry: []}})
    });
    assert.equal(await sweeper.sweepAppleEducationCharts(['vn']), 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM observed_metrics').get().n, 0);
  } finally {
    db.close();
  }
});
