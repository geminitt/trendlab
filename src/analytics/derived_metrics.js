const Repository = require('../storage/repository');
const { audit } = require('../observability/audit');
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

function calculateWindow(series, platform, window, now, priorShrinkage, storefront = null, onReject = null) {
  const reject = (reason, context = {}) => {
    if (typeof onReject === 'function') onReject(reason, context);
    return null;
  };
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
    && (storefront === null || s.storefront === storefront));
  parsed.sort((a, b) => a.t - b.t);
  // Collapse duplicate timestamps, preferring the most recently loaded row.
  const points = parsed.filter((p, i) => i === 0 || p.t !== parsed[i - 1].t);
  if (points.length < 3) return reject('INSUFFICIENT_POINTS', { valid_points: points.length, minimum: 3 });
  const first = points[0];
  const last = points[points.length - 1];
  const duration = (last.t - first.t) / DAY_MS;
  if (duration <= 0) return reject('NON_POSITIVE_SPAN', { span_days: duration });
  // A window's score must represent most of the selected window, not just
  // three measurements within the last two days of a 90-day window.
  const minimumSpanDays = window.days === null ? 2 : window.days * 0.6;
  if (duration < minimumSpanDays) return reject('INSUFFICIENT_TIME_COVERAGE', {
    span_days: duration, required_span_days: minimumSpanDays
  });
  // Avoid assigning current trend labels to a stale observation series.
  if (endMs - last.t > 48 * 60 * 60 * 1000) return reject('STALE_LATEST_SNAPSHOT', {
    latest_observed_at: last.observed_at, age_hours: (endMs - last.t) / 3600000
  });

  const intervals = [];
  for (let i = 1; i < points.length; i++) {
    const elapsed = (points[i].t - points[i - 1].t) / DAY_MS;
    const delta = points[i].val - points[i - 1].val;
    if (elapsed <= 0 || delta < 0) return reject('COUNTER_RESET_OR_INVALID_INTERVAL', {
      interval_index: i, delta, interval_days: elapsed
    }); // A revised counter needs investigation; do not invent growth.
    intervals.push({ delta, days: elapsed, velocity: delta / elapsed });
  }

  const totalDelta = last.val - first.val;
  const meanVelocity = totalDelta / duration;
  const mid = points[Math.floor(points.length / 2)];
  const earlyDays = (mid.t - first.t) / DAY_MS;
  const lateDays = (last.t - mid.t) / DAY_MS;
  if (earlyDays <= 0 || lateDays <= 0) return reject('INVALID_MOMENTUM_SPLIT', {
    early_days: earlyDays, late_days: lateDays
  });
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
    // This research deployment scores VN-only observations on BOTH platforms.
    // Android public maxInstalls is NOT country-specific: VN identifies where
    // the listing was successfully observed, not where installs occurred.
    // Storefront-specific iOS rating counts are never mixed with US/JP data.
    const storefront = config.catalog.researchMarket || 'vn';
    // Clear prior calculations for this app, including windows that no longer qualify.
    if (this.repo.db?.prepare) {
      this.repo.db.prepare('DELETE FROM derived_window_metrics WHERE platform_app_id = ?').run(platformApp.id);
    }
    for (const window of WINDOWS) {
      let rejection = null;
      const metrics = calculateWindow(series, platformApp.platform, window, now, prior, storefront,
        (reason, context) => { rejection = { reason, context }; });
      if (!metrics) {
        audit('analytics.window_skipped', {
          platform_app_id: platformApp.id, platform: platformApp.platform,
          storefront, window_type: window.name,
          total_observation_rows: series.length,
          scoped_observations: series.filter(row => row.storefront === storefront &&
            (platformApp.platform === 'android' ?
              Number.isFinite(row.observed_install_counter) :
              Number.isFinite(row.observed_rating_count))).length,
          reason: rejection?.reason || 'INSUFFICIENT_OR_INVALID_WINDOW',
          reason_context: rejection?.context || null,
          evaluated_at: now.toISOString()
        });
        continue;
      }
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
    // Only enumerate apps with actual VN storefront evidence. A large global
    // imported ID catalog must not cause per-app audit spam, and US/JP samples
    // must NEVER qualify an app for a VN trend.
    const db = this.repo.db;
    const market = config.catalog.researchMarket || 'vn';
    const marketCohort = db.prepare(`
      SELECT p.*,
             COUNT(*) AS market_observation_rows,
             SUM(CASE
               WHEN (p.platform = 'android'
                 AND m.observed_install_counter IS NOT NULL
                 AND m.observed_install_counter >= 0)
                 OR (p.platform = 'ios'
                 AND m.observed_rating_count IS NOT NULL
                 AND m.observed_rating_count >= 0)
               THEN 1 ELSE 0 END) AS metric_observations
      FROM observed_metrics m
      JOIN platform_applications p ON p.id = m.platform_app_id
      WHERE m.storefront = ?
        AND p.is_active = 1
        AND p.platform IN ('android', 'ios')
        AND (m.observed_rank IS NOT NULL
          OR m.observed_install_counter IS NOT NULL
          OR m.observed_rating_count IS NOT NULL)
      GROUP BY p.id
      ORDER BY p.id
    `).all(market);
    const eligibleApps = marketCohort.filter(app => app.metric_observations >= 3);
    const measuredApps = marketCohort.filter(app => app.metric_observations > 0).length;
    const noMetrics = marketCohort.length - measuredApps;
    const insufficient = measuredApps - eligibleApps.length;

    audit('analytics.eligibility_summary', {
      storefront: market,
      market_candidates: marketCohort.length,
      apps_with_metrics: measuredApps,
      apps_without_metrics: noMetrics,
      apps_with_insufficient_observations: insufficient,
      apps_eligible: eligibleApps.length,
      apps_ineligible: marketCohort.length - eligibleApps.length,
      minimum_observations: 3,
      at: now.toISOString()
    });
    for (const app of marketCohort) {
      if (app.metric_observations >= 3) continue;
      audit('analytics.app_ineligible', {
        platform_app_id: app.id, platform: app.platform, storefront: market,
        metric_observations: app.metric_observations,
        market_observation_rows: app.market_observation_rows,
        required_observations: 3,
        reason: app.metric_observations === 0 ?
          'NO_MARKET_METRIC_OBSERVATIONS' : 'INSUFFICIENT_OBSERVATIONS',
        evaluated_at: now.toISOString()
      });
    }

    audit('analytics.dataset_started', {
      source_market: market,
      candidate_apps: eligibleApps.length,
      total_market_candidates: marketCohort.length,
      apps_with_metrics: measuredApps,
      at: now.toISOString()
    });
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
      audit('analytics.dataset_finished', { candidate_apps: eligibleApps.length, scored_apps: scoredApps });
    } catch (error) {
      db.exec('ROLLBACK');
      audit('analytics.dataset_failed', { candidate_apps: eligibleApps.length, error });
      throw error;
    }

    console.log(`[DerivedMetricsCalculator] ${eligibleApps.length} candidates (>=3 observations), ${scoredApps} apps with valid windows.`);
    return scoredApps;
  }
}

module.exports = DerivedMetricsCalculator;
module.exports.calculateWindow = calculateWindow;
module.exports.computeTheilSenSlope = computeTheilSenSlope;
