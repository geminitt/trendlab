'use strict';

// A count of distinct UTC days carrying the SAME valid source metric used by
// the trend model. Rank-only observations do not make growth scores eligible.
function countMetricDays(app, windowType, nowMs = Date.now()) {
  const source = app?.platform === 'ios' ? 'ratings' : 'installs';
  const selectedStorefront = app?.storefront && app.storefront !== 'global'
    ? app.storefront : 'us';
  const days = windowType === 'all' ? Infinity : Number.parseInt(windowType, 10);
  if (!(days === Infinity || Number.isFinite(days) && days > 0)) return 0;
  const earliest = days === Infinity ? -Infinity : nowMs - days * 86400000;
  const uniqueDays = new Set();

  for (const row of app?.history || []) {
    const time = Date.parse(row.t);
    if (!Number.isFinite(time) || time < earliest || time > nowMs) continue;
    if (app.platform === 'ios' && row.storefront !== selectedStorefront) continue;
    const count = row[source];
    if (!Number.isFinite(count) || count < 0) continue;
    uniqueDays.add(new Date(time).toISOString().slice(0, 10));
  }
  return uniqueDays.size;
}

function summarizeReadiness(apps, windowType, nowMs = Date.now()) {
  const buckets = [0, 0, 0, 0];
  for (const app of apps) {
    const count = countMetricDays(app, windowType, nowMs);
    buckets[Math.min(3, count)]++;
  }
  return { total: apps.length, buckets };
}

if (typeof window !== 'undefined') {
  window.TrendLabReadiness = { countMetricDays, summarizeReadiness };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { countMetricDays, summarizeReadiness };
}
