const test = require('node:test');
const assert = require('node:assert/strict');
const TrendLabInsights = require('../web/js/insights');

test('overview distinguishes observed rows, first observations and collection attempts', () => {
  const now = Date.parse('2026-11-13T12:00:00Z');
  const meta = { activity: { daily: [
    { date: '2026-11-12', observationRows: 32, newlyObserved: 8, attempts: 20, succeeded: 15, failed: 5 },
    { date: '2026-11-13', observationRows: 21, newlyObserved: 3, attempts: 10, succeeded: 9, failed: 1 }
  ] } };
  const apps = [
    { lastObservedAt: '2026-11-13T07:00:00Z' }, // <= 24h
    { lastObservedAt: '2026-11-11T00:00:00Z' }, // 1-3d
    { lastObservedAt: '2026-11-09T00:00:00Z' }, // 3-7d
    { lastObservedAt: '2026-10-20T00:00:00Z' }, // > 7d
    { lastObservedAt: null } // Missing != stale or zero
  ];
  const result = TrendLabInsights.summarize(meta, apps, now);
  assert.equal(result.observations, 53);
  assert.equal(result.firstSeen, 11);
  assert.equal(result.attempts, 30);
  assert.equal(result.succeeded, 24);
  assert.equal(result.failed, 6);
  assert.equal(result.successRate, 80);
  assert.deepEqual(result.buckets, [1, 1, 1, 1]);
});

test('absent activity payload is unknown, not fabricated zero readings', () => {
  const result = TrendLabInsights.summarize({}, []);
  assert.equal(result.daily, null);
  assert.equal(result.observations, null);
  assert.equal(result.firstSeen, null);
  assert.equal(result.successRate, null);
  assert.deepEqual(result.buckets, [0, 0, 0, 0]);
});

test('zero attempts leave reliability unknown rather than presenting 0% failure', () => {
  const result = TrendLabInsights.summarize({ activity: { daily: [
    { date: '2026-11-13', observationRows: 0, newlyObserved: 0, attempts: 0, succeeded: 0, failed: 0 }
  ] } }, []);
  assert.equal(result.observations, 0);
  assert.equal(result.successRate, null);
});
