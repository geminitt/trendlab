const crypto = require('node:crypto');
const { getDb } = require('./db');

class Repository {
  constructor(db = null) {
    this.db = db || getDb();
  }

  // --- PLATFORM APPLICATIONS ---
  upsertPlatformApp({
    id = null,
    canonicalId = null,
    platform,
    nativeStoreId,
    storefront = 'global',
    title,
    developerId = null,
    developerName = null,
    primaryGenre,
    genresJson = '[]',
    price = 0.0,
    currency = 'USD'
  }) {
    let existing = null;
    if (id) {
      existing = this.db.prepare('SELECT id, canonical_id FROM platform_applications WHERE id = ?').get(id);
    }
    if (!existing) {
      existing = this.db.prepare(
        'SELECT id, canonical_id FROM platform_applications WHERE platform = ? AND native_store_id = ? AND storefront = ?'
      ).get(platform, nativeStoreId, storefront);
    }

    const now = new Date().toISOString();

    if (existing) {
      this.db.prepare(`
        UPDATE platform_applications
        SET title = ?, developer_id = COALESCE(?, developer_id), developer_name = COALESCE(?, developer_name),
            primary_genre = COALESCE(?, primary_genre), genres_json = COALESCE(?, genres_json),
            price = COALESCE(?, price), currency = COALESCE(?, currency), last_crawled_at = ?
        WHERE id = ?
      `).run(title, developerId, developerName, primaryGenre, genresJson, price, currency, now, existing.id);
      return existing.id;
    } else {
      const assignedId = id || crypto.randomUUID();
      this.db.prepare(`
        INSERT INTO platform_applications (
          id, canonical_id, platform, native_store_id, storefront, title, developer_id, developer_name, primary_genre, genres_json, price, currency, is_active, first_seen_at, last_crawled_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(assignedId, canonicalId, platform, nativeStoreId, storefront, title, developerId, developerName, primaryGenre, genresJson, price, currency, now, now);
      return assignedId;
    }
  }

  getPlatformApps({ platform = null, limit = 500, offset = 0 } = {}) {
    if (platform) {
      return this.db.prepare(
        'SELECT * FROM platform_applications WHERE platform = ? AND is_active = 1 ORDER BY first_seen_at DESC LIMIT ? OFFSET ?'
      ).all(platform, limit, offset);
    }
    return this.db.prepare(
      'SELECT * FROM platform_applications WHERE is_active = 1 ORDER BY first_seen_at DESC LIMIT ? OFFSET ?'
    ).all(limit, offset);
  }

  getPlatformAppById(id) {
    return this.db.prepare('SELECT * FROM platform_applications WHERE id = ?').get(id);
  }

  // --- RAW SNAPSHOTS ---
  saveRawSnapshot({
    platformAppId,
    sourceName,
    fetchMethod,
    rawPayload,
    sourceUpdatedAt = null,
    observedAt = new Date().toISOString()
  }) {
    const id = crypto.randomUUID();
    const payloadStr = typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload);
    const hash = crypto.createHash('sha256').update(payloadStr).digest('hex');

    this.db.prepare(`
      INSERT INTO raw_snapshots (
        id, platform_app_id, observed_at, source_updated_at, source_name, fetch_method, payload_sha256, raw_payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, platformAppId, observedAt, sourceUpdatedAt, sourceName, fetchMethod, hash, payloadStr);

    return id;
  }

  // --- OBSERVED METRICS ---
  recordObservedMetrics({
    platformAppId,
    observedAt = new Date().toISOString(),
    installCounter = null,
    ratingCount = null,
    reviewCount = null,
    ratingScore = null,
    rank = null,
    rankChartType = null,
    storefront = 'global',
    flags = '[]'
  }) {
    const id = crypto.randomUUID();
    this.db.prepare(`
      INSERT INTO observed_metrics (
        id, platform_app_id, observed_at, observed_install_counter, observed_rating_count, observed_review_count, observed_rating_score, observed_rank, rank_chart_type, storefront, data_quality_flags
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, platformAppId, observedAt, installCounter, ratingCount, reviewCount, ratingScore, rank, rankChartType, storefront, flags);
    return id;
  }

  getMetricsSeries(platformAppId) {
    return this.db.prepare(
      'SELECT * FROM observed_metrics WHERE platform_app_id = ? ORDER BY observed_at ASC'
    ).all(platformAppId);
  }

  // --- DERIVED METRICS ---
  saveDerivedMetrics({
    platformAppId,
    windowType,
    windowStart,
    windowEnd,
    deltaInstalls = null,
    deltaRatings = null,
    ratingVelocityDaily = null,
    rankDelta = null,
    relativeGrowth = null,
    dampenedGrowth = null,
    momentumScore = null,
    accelerationScore = null,
    persistenceRatio = null,
    theilSenSlope = null,
    completeness = null,
    computedAt = new Date().toISOString()
  }) {
    const id = crypto.randomUUID();
    this.db.prepare(`
      INSERT INTO derived_window_metrics (
        id, platform_app_id, window_type, window_start, window_end, delta_install_counter, delta_rating_count, rating_velocity_daily, rank_delta, relative_growth, dampened_growth, momentum_score, acceleration_score, persistence_ratio, theil_sen_slope, observation_completeness, computed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, platformAppId, windowType, windowStart, windowEnd,
      // Preserve missing values as NULL and valid zeroes as zero. Never substitute 1 for 0.
      ...[deltaInstalls, deltaRatings, ratingVelocityDaily, rankDelta,
        relativeGrowth, dampenedGrowth, momentumScore, accelerationScore,
        persistenceRatio, theilSenSlope, completeness]
        .map(value => value === null || value === undefined ? null : Number(value)),
      computedAt
    );
    return id;
  }

  // --- TREND MODEL SCORES ---
  saveTrendScore({
    platformAppId,
    windowType,
    modelIdentifier,
    growthStrength = 0,
    momentumScore = 0,
    persistenceScore = 1,
    finalTrendScore = 0,
    trendRank = null,
    flags = '[]',
    evaluatedAt = new Date().toISOString()
  }) {
    const id = crypto.randomUUID();
    const cleanFinalScore = isNaN(Number(finalTrendScore)) ? 0.0 : Number(finalTrendScore);
    const cleanGrowth = isNaN(Number(growthStrength)) ? 0.0 : Number(growthStrength);
    const cleanMomentum = isNaN(Number(momentumScore)) ? 0.0 : Number(momentumScore);
    const cleanPersistence = isNaN(Number(persistenceScore)) ? 1.0 : Number(persistenceScore);

    this.db.prepare(`
      INSERT INTO trend_model_scores (
        id, platform_app_id, window_type, model_identifier, growth_strength, momentum_score, persistence_score, final_trend_score, trend_rank, evaluation_flags, evaluated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, platformAppId, windowType, modelIdentifier, cleanGrowth, cleanMomentum,
      cleanPersistence, cleanFinalScore, trendRank, flags, evaluatedAt
    );
    return id;
  }

  // --- AUDIT LOGS ---
  startAuditLog(jobType) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO collection_audit_logs (id, job_type, started_at, status)
      VALUES (?, ?, ?, 'RUNNING')
    `).run(id, jobType, now);
    return id;
  }

  finishAuditLog(id, { status = 'SUCCESS', attempted = 0, succeeded = 0, failed = 0, errorSummary = null } = {}) {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE collection_audit_logs
      SET completed_at = ?, status = ?, items_attempted = ?, items_succeeded = ?, items_failed = ?, error_summary = ?
      WHERE id = ?
    `).run(now, status, attempted, succeeded, failed, errorSummary, id);
  }
}

module.exports = Repository;
