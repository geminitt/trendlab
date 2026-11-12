'use strict';

/**
 * Snapshot-based exploration, separate from unvalidated trend inference.
 * Each platform retains its own source unit; Android public maxInstalls values are
 * never added to or directly sized against iOS storefront rating counts.
 */
// No UI-only Top-N cutoff: include every distinct eligible, observed app.
// Optional explicit limit remains available for future user-selected views.
const LIMIT_PER_PLATFORM = Infinity;
const UNIT = {
  android: 'observed_install_counter',
  ios: 'observed_rating_count'
};

function getLatestStarRating(app) {
  const history = Array.isArray(app.history) ? app.history : [];
  // The snapshot scale on iOS uses the US rating counter, so its color
  // must use the US star rating too, even if the catalog row came from JP/VN.
  const storefront = 'us';
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (app.platform === 'ios' && h.storefront !== storefront) continue;
    if (typeof h.score === 'number' && Number.isFinite(h.score) && h.score >= 1 && h.score <= 5) return h.score;
  }
  return null;
}

// One native-store app can appear in multiple catalog storefront rows.
// Prefer a measured source-counter record and the latest observation.
// Keep Android and iOS identities separate.
function dedupePlatformApps(apps, platform) {
  const byId = new Map();
  for (const app of apps) {
    if (app.platform !== platform) continue;
    const key = app.nativeStoreId || app.id;
    const existing = byId.get(key);
    const rank = item => {
      const valid = item.volumeMetric === UNIT[platform] &&
        typeof item.rawVolume === 'number' && Number.isFinite(item.rawVolume) &&
        item.rawVolume >= 0;
      return valid ? 1 : 0;
    };
    if (!existing || rank(app) > rank(existing) ||
        (rank(app) === rank(existing) &&
          (app.lastObservedAt || '') > (existing.lastObservedAt || ''))) {
      byId.set(key, app);
    }
  }
  return [...byId.values()];
}

function getScaleCandidates(apps, platform, limit = LIMIT_PER_PLATFORM) {
  return dedupePlatformApps(apps, platform).filter(app =>
    app.volumeMetric === UNIT[platform] &&
    typeof app.rawVolume === 'number' && Number.isFinite(app.rawVolume) &&
    app.rawVolume >= 0
  ).sort((a, b) => b.rawVolume - a.rawVolume || a.title.localeCompare(b.title))
    .slice(0, limit);
}

function tileWeight(app) {
  // Historical helper for snapshot area: exact observed-source magnitude.
  // No display compression; callers must omit zero/negative/missing values.
  return typeof app?.rawVolume === 'number' && Number.isFinite(app.rawVolume) &&
    app.rawVolume > 0 ? app.rawVolume : 0;
}

function scaleColor(app) {
  const score = getLatestStarRating(app);
  if (score === null) return '#3b4a56';
  // A fixed anchored 1–5 star scale. No automatic min/max stretching.
  // Low-to-high ratings use a Karpathy-style sequential red→gold→green scale.
  // These bands represent user sentiment, never app growth.
  if (score < 3) return '#8c251c';
  if (score < 3.5) return '#9e4d20';
  if (score < 4) return '#807319';
  if (score < 4.5) return '#437d30';
  return '#176431';
}

if (typeof window !== 'undefined') {
  window.TrendLabScale = { getScaleCandidates, dedupePlatformApps, tileWeight, scaleColor, getLatestStarRating, LIMIT_PER_PLATFORM };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getScaleCandidates, dedupePlatformApps, tileWeight, scaleColor, getLatestStarRating, LIMIT_PER_PLATFORM };
}
