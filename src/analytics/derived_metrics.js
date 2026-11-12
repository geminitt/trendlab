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
  // A window's score must represent most of the selected window, not just
  // three measurements within the last two days of a 90-day window.
  const minimumSpanDays = window.days === null ? 2 : window.days * 0.6;
  if (duration < minimumSpanDays) return null;
  // Avoid assigning current trend labels to a stale observation series.
  if (endMs - last.t > 48 * 60 * 60 * 1000) return null;

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

  calculateAll(now = new Date()) {
    // Scan observed_metrics instead of querying all catalog apps individually.
    // On a catalog of 330k apps with <1k observed, this removes hundreds of
    // thousands of pointless per-app SELECTs.
    const db = this.repo.db;
    const eligibleApps = db.prepare(`
      SELECT p.*
      FROM (
        SELECT platform_app_id
        FROM observed_metrics
        WHERE observed_install_counter IS NOT NULL
           OR observed_rating_count IS NOT NULL
        GROUP BY platform_app_id
        HAVING COUNT(*) >= 3
      ) candidates
      JOIN platform_applications p ON p.id = candidates.platform_app_id
      WHERE p.is_active = 1
      ORDER BY p.id
    `).all();

    // Rebuild as a single transaction so errors cannot leave partial derived
    // results. Old results for apps that no longer qualify are removed too.
    let scoredApps = 0;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('DELETE FROM trend_model_scores; DELETE FROM derived_window_metrics;');
      for (const app of eligibleApps) {
        if (this.calculateForApp(app, now).length > 0) scoredApps++;
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    console.log(`[DerivedMetricsCalculator] ${eligibleApps.length} candidates (>=3 observations), ${scoredApps} apps with valid windows.`);
    return scoredApps;
  }
}

module.exports = DerivedMetricsCalculator;
module.exports.calculateWindow = calculateWindow;
module.exports.computeTheilSenSlope = computeTheilSenSlope;
