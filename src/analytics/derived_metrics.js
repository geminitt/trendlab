const Repository = require('../storage/repository');
const config = require('../../config/default.json');

const DAY_MS = 86400000;
const WINDOWS = [
  { name: '7d', days: 7 },
  { name: '14d', days: 14 },
  { name: '30d', days: 30 },
  { name: '90d', days: 90 },
  { name: 'all', days: null }
];

function validCounter(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function computeTheilSenSlope(points) {
  if (points.length < 2) return null;
  const slopes = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const elapsed = (points[j].t - points[i].t) / DAY_MS;
      if (elapsed > 0) slopes.push((points[j].val - points[i].val) / elapsed);
    }
  }
  if (!slopes.length) return null;
  slopes.sort((a, b) => a - b);
  const mid = Math.floor(slopes.length / 2);
  return slopes.length % 2 ? slopes[mid] : (slopes[mid - 1] + slopes[mid]) / 2;
}

function calculateWindow(series, platform, window, now, priorShrinkage, storefront = null) {
  const endMs = now.getTime();
  const startMs = window.days === null ? -Infinity : endMs - window.days * DAY_MS;
  const field = platform === 'android' ? 'observed_install_counter' : 'observed_rating_count';
  // Never silently replace a missing install counter with ratings: these are different signals.
  // For iOS, count only one storefront per series, otherwise rating totals get mixed.
  const parsed = series.map(s => ({
    ...s,
    t: Date.parse(s.observed_at),
    val: s[field]
  })).filter(s => Number.isFinite(s.t) && s.t >= startMs && s.t <= endMs && validCounter(s.val)
    && (platform !== 'ios' || s.storefront === storefront));
  parsed.sort((a, b) => a.t - b.t);
  // Collapse duplicate timestamps, preferring the most recently loaded row.
  const points = parsed.filter((p, i) => i === 0 || p.t !== parsed[i - 1].t);
  if (points.length < 3) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const duration = (last.t - first.t) / DAY_MS;
  if (duration <= 0) return null;

  const intervals = [];
  for (let i = 1; i < points.length; i++) {
    const elapsed = (points[i].t - points[i - 1].t) / DAY_MS;
    const delta = points[i].val - points[i - 1].val;
    if (elapsed <= 0 || delta < 0) return null; // Counter reset/revision requires separate investigation.
    intervals.push({ delta, days: elapsed, velocity: delta / elapsed });
  }

  const totalDelta = last.val - first.val;
  const meanVelocity = totalDelta / duration;
  const mid = points[Math.floor(points.length / 2)];
  const earlyDays = (mid.t - first.t) / DAY_MS;
  const lateDays = (last.t - mid.t) / DAY_MS;
  if (earlyDays <= 0 || lateDays <= 0) return null;
  const earlyVelocity = (mid.val - first.val) / earlyDays;
  const lateVelocity = (last.val - mid.val) / lateDays;

  // Sustained velocity: fraction of observed intervals with a rate at least
  // half the mean rate. This is NOT a count of non-decreasing cumulative values.
  const persistence = meanVelocity > 0
    ? intervals.filter(i => i.velocity >= meanVelocity * 0.5).length / intervals.length
    : 0;
  const observedDays = new Set(points.map(p => new Date(p.t).toISOString().slice(0, 10))).size;
  const expectedDays = window.days === null ? Math.max(1, Math.ceil(duration)) : window.days;
  const completeness = Math.min(1, observedDays / Math.max(1, expectedDays));

  // The field's semantics remain an observed counter, not verified daily downloads.
  return {
    deltaInstalls: platform === 'android' ? totalDelta : null,
    deltaRatings: platform === 'ios' ? totalDelta : null,
    ratingVelocityDaily: platform === 'ios' ? meanVelocity : null,
    rankDelta: null, // Rankings require a separate storefront/chart-specific history.
    relativeGrowth: first.val > 0 ? totalDelta / first.val : null,
    dampenedGrowth: totalDelta / (first.val + priorShrinkage),
    momentumScore: lateVelocity - earlyVelocity,
    accelerationScore: (lateVelocity - earlyVelocity) / (duration / 2),
    persistenceRatio: persistence,
    theilSenSlope: computeTheilSenSlope(points.map(p => ({ t: p.t, val: p.val }))),
    completeness,
    windowStart: window.days === null ? new Date(first.t).toISOString() : new Date(startMs).toISOString(),
    windowEnd: now.toISOString()
  };
}

class DerivedMetricsCalculator {
  constructor(repo = null) {
    this.repo = repo || new Repository();
  }

  calculateForApp(platformApp, now = new Date()) {
    const series = this.repo.getMetricsSeries(platformApp.id) || [];
    if (!series.length) return [];
    const results = [];
    const prior = config.analytics.priorShrinkage ?? 500;
    // iOS rating counts are storefront-specific. Until the schema supports
    // separate derived storefront series, only score the app's selected storefront.
    const storefront = platformApp.platform === 'ios'
      ? (platformApp.storefront && platformApp.storefront !== 'global' ? platformApp.storefront : 'us')
      : null;
    // Clear prior calculations for this app, including windows that no longer qualify.
    if (this.repo.db?.prepare) {
      this.repo.db.prepare('DELETE FROM derived_window_metrics WHERE platform_app_id = ?').run(platformApp.id);
    }
    for (const window of WINDOWS) {
      const metrics = calculateWindow(series, platformApp.platform, window, now, prior, storefront);
      if (!metrics) continue; // Insufficient / invalid evidence must not become a zero score.
      const row = {
        platformAppId: platformApp.id,
        windowType: window.name,
        ...metrics
      };
      this.repo.saveDerivedMetrics(row);
      results.push(row);
    }
    return results;
  }

  calculateAll() {
    let offset = 0;
    let count = 0;
    const batchSize = 500;
    while (true) {
      const apps = this.repo.getPlatformApps({ limit: batchSize, offset });
      if (!apps.length) break;
      for (const app of apps) {
        this.calculateForApp(app);
        count++;
      }
      offset += apps.length;
    }
    return count;
  }
}

module.exports = DerivedMetricsCalculator;
module.exports.calculateWindow = calculateWindow;
module.exports.computeTheilSenSlope = computeTheilSenSlope;
