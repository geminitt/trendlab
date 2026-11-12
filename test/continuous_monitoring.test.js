const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const Repository = require('../src/storage/repository');
const ContinuousCollector = require('../src/collector/continuous');
const { calculateWindow } = require('../src/analytics/derived_metrics');

function makeRepo() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.resolve(__dirname, '../src/storage/schema.sql'), 'utf8'));
  return { db, repo: new Repository(db) };
}

test('revisits receive reserved capacity even with thousands of untouched apps', () => {
  const { db, repo } = makeRepo();
  try {
    const statement = db.prepare(`INSERT INTO platform_applications
      (id, platform, native_store_id, storefront, title, primary_genre, first_seen_at)
      VALUES (?, 'android', ?, 'global', ?, 'EDUCATION', ?)`);
    db.exec('BEGIN');
    for (let i = 0; i < 220; i++) {
      statement.run('a' + i, 'com.test.edu' + i, 'Education ' + i, '2026-11-01T00:00:00Z');
    }
    db.exec('COMMIT');
    const now = '2026-11-13T12:00:00Z';
    for (let i = 0; i < 8; i++) {
      repo.recordCollectionAttempt({
        platformAppId: 'a' + i, succeeded: true,
        observedAt: '2026-11-11T00:00:00Z', refreshHours: 24
      });
    }
    const due = repo.getDuePlatformApps({ platform: 'android', limit: 10, now });
    assert.equal(due.length, 10);
    assert.equal(due.filter(a => Number(a.id.slice(1)) < 8).length, 5);
    assert.equal(new Set(due.map(a => a.id)).size, due.length);
  } finally { db.close(); }
});

test('due scheduling fills vacant slots when no unseen apps remain', () => {
  const { db, repo } = makeRepo();
  try {
    for (let i = 0; i < 5; i++) {
      const id = repo.upsertPlatformApp({
        platform: 'ios', nativeStoreId: String(1000000 + i),
        title: 'Example ' + i, primaryGenre: 'Education'
      });
      repo.recordCollectionAttempt({
        platformAppId: id, storefront: 'us',
        succeeded: true, observedAt: '2026-11-01T00:00:00Z'
      });
    }
    assert.equal(repo.getDuePlatformApps({
      platform: 'ios', storefront: 'us', limit: 5,
      now: '2026-11-13T00:00:00Z'
    }).length, 5);
  } finally { db.close(); }
});

test('long-running worker rotates storefronts, slows down on errors and stops', async () => {
  const calls = [], pauses = [];
  const worker = new ContinuousCollector({
    scheduler: {
      async runFullCycle(args) {
        calls.push(args);
        return { status: calls.length === 2 ? 'PARTIAL' : 'SUCCESS',
          totalAttempted: 10, totalFailed: calls.length === 2 ? 8 : 0 };
      }
    },
    wait: async ms => { pauses.push(ms); },
    logger: { error() {} }
  });
  const count = await worker.run({
    androidLimit: 5, iosLimit: 10,
    storefronts: ['us', 'vn', 'jp'], pauseSeconds: 2,
    errorPauseSeconds: 30, maxCycles: 4
  });
  assert.equal(count, 4);
  assert.deepEqual(calls.map(c => c.storefront), ['us', 'vn', 'jp', 'us']);
  assert.deepEqual(pauses, [2000, 30000, 2000]);
});

test('two days of data cannot be labeled a 90-day trend', () => {
  const now = new Date('2026-11-13T00:00:00Z');
  const series = [2, 1, 0].map((days, i) => ({
    observed_at: new Date(now.getTime() - days * 86400000).toISOString(),
    observed_install_counter: 100 + i * 20, storefront: 'global'
  }));
  assert.equal(calculateWindow(series, 'android', { name: '90d', days: 90 }, now, 500), null);
  assert.equal(calculateWindow(series, 'android', { name: '7d', days: 7 }, now, 500), null);
  assert.ok(calculateWindow(series, 'android', { name: 'all', days: null }, now, 500));
});

test('outdated series cannot receive a current trend score', () => {
  const now = new Date('2026-11-13T00:00:00Z');
  const series = [15, 10, 5].map((days, i) => ({
    observed_at: new Date(now.getTime() - days * 86400000).toISOString(),
    observed_rating_count: 100 + i * 20, storefront: 'us'
  }));
  assert.equal(calculateWindow(series, 'ios', { name: '30d', days: 30 }, now, 500, 'us'), null);
});
