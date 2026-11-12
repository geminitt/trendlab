const Repository = require('../storage/repository');
const config = require('../../config/default.json');

// Compute Theil-Sen Robust Slope (median of all pairwise slopes)
function computeTheilSenSlope(points) {
  if (points.length < 2) return 0.0;
  const slopes = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dt = (points[j].t - points[i].t) / (1000 * 3600 * 24); // days
      if (dt > 0) {
        slopes.push((points[j].val - points[i].val) / dt);
      }
    }
  }
  if (slopes.length === 0) return 0.0;
  slopes.sort((a, b) => a - b);
  const mid = Math.floor(slopes.length / 2);
  return slopes.length % 2 !== 0 ? slopes[mid] : (slopes[mid - 1] + slopes[mid]) / 2;
}

class DerivedMetricsCalculator {
  constructor(repo = null) {
    this.repo = repo || new Repository();
  }

  calculateForApp(platformApp, now = new Date()) {
    const series = this.repo.getMetricsSeries(platformApp.id);
    if (!series || series.length < 1) return [];

    const windows = [
      { name: '7d', days: 7 },
      { name: '14d', days: 14 },
      { name: '30d', days: 30 },
      { name: '90d', days: 90 },
      { name: 'all', days: 365 }
    ];

    const results = [];
    const nowMs = now.getTime();
    const isAndroid = platformApp.platform === 'android';

    for (const win of windows) {
      const startMs = nowMs - (win.days * 24 * 3600 * 1000);
      const windowStart = new Date(startMs).toISOString();
      const windowEnd = now.toISOString();

      // Filter snapshots falling into window
      const winPoints = series.filter(s => new Date(s.observed_at).getTime() >= startMs);
      const pointsToUse = winPoints.length > 0 ? winPoints : series;

      const first = pointsToUse[0];
      const last = pointsToUse[pointsToUse.length - 1];

      // Primary growth variable: installs for Android (if present), ratings for iOS
      const vStart = isAndroid ? (first.observed_install_counter || first.observed_rating_count || 0) : (first.observed_rating_count || 0);
      const vEnd = isAndroid ? (last.observed_install_counter || last.observed_rating_count || 0) : (last.observed_rating_count || 0);

      const deltaValue = Math.max(0, vEnd - vStart);
      const dtDays = Math.max(1, (new Date(last.observed_at).getTime() - new Date(first.observed_at).getTime()) / (1000 * 3600 * 24));

      // 1. Velocities
      const ratingVelocityDaily = isAndroid
        ? Math.max(0, (last.observed_rating_count || 0) - (first.observed_rating_count || 0)) / dtDays
        : deltaValue / dtDays;

      // 2. Growth metrics
      const relativeGrowth = vStart > 0 ? deltaValue / vStart : (deltaValue > 0 ? 1.0 : 0.0);
      const kPrior = config.analytics.priorShrinkage || 500.0;
      const dampenedGrowth = deltaValue / (vStart + kPrior);

      // 3. Acceleration & Momentum (split window in half if enough points)
      let momentumScore = 0.0;
      let accelerationScore = 0.0;
      let positiveSteps = 0;

      if (pointsToUse.length >= 3) {
        const midIdx = Math.floor(pointsToUse.length / 2);
        const midPoint = pointsToUse[midIdx];
        const vMid = isAndroid ? (midPoint.observed_install_counter || midPoint.observed_rating_count || 0) : (midPoint.observed_rating_count || 0);

        const dt1 = Math.max(1, (new Date(midPoint.observed_at).getTime() - new Date(first.observed_at).getTime()) / (1000 * 3600 * 24));
        const dt2 = Math.max(1, (new Date(last.observed_at).getTime() - new Date(midPoint.observed_at).getTime()) / (1000 * 3600 * 24));

        const vel1 = Math.max(0, vMid - vStart) / dt1;
        const vel2 = Math.max(0, vEnd - vMid) / dt2;

        momentumScore = vel2 - vel1;
        accelerationScore = (vel2 - vel1) / ((dt1 + dt2) / 2);

        // Directional persistence
        for (let i = 1; i < pointsToUse.length; i++) {
          const prevVal = isAndroid ? (pointsToUse[i-1].observed_install_counter || 0) : (pointsToUse[i-1].observed_rating_count || 0);
          const currVal = isAndroid ? (pointsToUse[i].observed_install_counter || 0) : (pointsToUse[i].observed_rating_count || 0);
          if (currVal >= prevVal) positiveSteps++;
        }
      }

      const persistenceRatio = pointsToUse.length > 1 ? positiveSteps / (pointsToUse.length - 1) : 1.0;

      // 4. Robust Theil-Sen Slope
      const timePoints = pointsToUse.map(p => ({
        t: new Date(p.observed_at).getTime(),
        val: isAndroid ? (p.observed_install_counter || p.observed_rating_count || 0) : (p.observed_rating_count || 0)
      }));
      const theilSenSlope = computeTheilSenSlope(timePoints);

      // 5. Completeness
      const completeness = Math.min(1.0, pointsToUse.length / Math.max(1, Math.min(win.days, 7)));

      const derivedObj = {
        platformAppId: platformApp.id,
        windowType: win.name,
        windowStart,
        windowEnd,
        deltaInstalls: isAndroid ? deltaValue : null,
        deltaRatings: !isAndroid ? deltaValue : Math.max(0, (last.observed_rating_count || 0) - (first.observed_rating_count || 0)),
        ratingVelocityDaily,
        rankDelta: 0,
        relativeGrowth,
        dampenedGrowth,
        momentumScore,
        accelerationScore,
        persistenceRatio,
        theilSenSlope,
        completeness
      };

      this.repo.saveDerivedMetrics(derivedObj);
      results.push(derivedObj);
    }

    return results;
  }

  calculateAll() {
    const apps = this.repo.getPlatformApps({ limit: 1000 });
    console.log(`[DerivedMetricsCalculator] Computing derived window metrics for ${apps.length} apps...`);
    let count = 0;
    for (const app of apps) {
      this.calculateForApp(app);
      count++;
    }
    console.log(`[DerivedMetricsCalculator] Completed metrics calculation for ${count} apps.`);
    return count;
  }
}

module.exports = DerivedMetricsCalculator;
