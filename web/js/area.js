'use strict';

/**
 * A treemap's area is a direct encoding of its selected measurement.
 * Do not apply log, sqrt, +1, min-weight floors, or percentile normalization:
 * these erase the actual magnitude difference between apps.
 *
 * Each panel is platform-specific. Android maxInstalls and iOS US ratings are
 * different source units and MUST NOT be combined in a single panel.
 *
 * Metric scores are provisional, not verified physical/download quantities;
 * linear areas convey the numerical score ratios, NOT market share.
 */
const SOURCE_UNIT = Object.freeze({
  android: 'observed_install_counter',
  ios: 'observed_rating_count'
});

const METRIC_LABELS = Object.freeze({
  observed_scale: 'observed source counter',
  model_a_growth: 'observed source-counter increase',
  model_b_compounder: 'sustained growth model score',
  model_c_breakout: 'breakout model score',
  rating_velocity: 'ratings/day'
});

function metricValue(app, metric, windowType = '30d') {
  if (!app || !['android', 'ios'].includes(app.platform)) return null;
  if (metric === 'observed_scale') {
    if (app.volumeMetric !== SOURCE_UNIT[app.platform]) return null;
    return typeof app.rawVolume === 'number' && Number.isFinite(app.rawVolume)
      ? app.rawVolume : null;
  }
  // The UI calls this "Observed delta": do not accidentally use Model A's
  // log10(delta) scoring transform as the area. Use the measured raw delta.
  if (metric === 'model_a_growth') {
    const derived = app.metrics?.[windowType];
    const value = app.platform === 'android' ? derived?.deltaInstalls : derived?.deltaRatings;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
  if (metric === 'rating_velocity') {
    const value = app.metrics?.[windowType]?.ratingVelocity;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
  if (!Object.prototype.hasOwnProperty.call(METRIC_LABELS, metric)) return null;
  const value = app.scores?.[windowType]?.[metric]?.score;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Zero and negative values have no positive rectangle area. They are counted
 * separately, never fabricated into tiny positive tiles. Null is missing.
 * If multiple catalog rows share the same platform native ID, select a row
 * carrying a usable measurement before a row with no measurement. Among
 * equivalent candidates prefer the most recently observed row.
 */
function getAreaCandidates(apps, platform, metric = 'observed_scale', windowType = '30d') {
  if (!SOURCE_UNIT[platform]) throw new Error('Unsupported platform: ' + platform);
  const byNativeId = new Map();
  for (const app of apps) {
    if (app.platform !== platform) continue;
    const identity = app.nativeStoreId || app.id;
    const value = metricValue(app, metric, windowType);
    const quality = value === null ? 0 : value > 0 ? 3 : value === 0 ? 2 : 1;
    const prev = byNativeId.get(identity);
    if (!prev || quality > prev.quality ||
        (quality === prev.quality &&
          (app.lastObservedAt || '') > (prev.app.lastObservedAt || ''))) {
      byNativeId.set(identity, { app, value, quality });
    }
  }

  const items = [];
  let missing = 0, zero = 0, negative = 0;
  for (const record of byNativeId.values()) {
    const value = record.value;
    if (value === null) missing++;
    else if (value < 0) negative++;
    else if (value === 0) zero++;
    else items.push({ app: record.app, weight: value, value });
  }
  items.sort((a, b) => b.weight - a.weight ||
    (a.app.title || '').localeCompare(b.app.title || '') ||
    String(a.app.id).localeCompare(String(b.app.id)));
  return {
    platform, metric, windowType,
    items, missing, zero, negative,
    total: byNativeId.size
  };
}

if (typeof window !== 'undefined') {
  window.TrendLabArea = { metricValue, getAreaCandidates, SOURCE_UNIT, METRIC_LABELS };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { metricValue, getAreaCandidates, SOURCE_UNIT, METRIC_LABELS };
}
