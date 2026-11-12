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

  // --- FAIR, RESUMABLE COLLECTION SCHEDULING ---
  // Without a row in collection_state the app has never been collected.
  // Due rows precede retried/previously collected rows, with deterministic ties.
  getDuePlatformApps({ platform, storefront = 'global', limit = 100, now = new Date().toISOString() }) {
    if (!['android', 'ios'].includes(platform)) throw new Error('Unknown platform');
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('limit must be positive');
    return this.db.prepare(`
      SELECT p.* FROM platform_applications p
      LEFT JOIN collection_state c
        ON c.platform_app_id = p.id AND c.storefront = ?
      WHERE p.platform = ? AND p.is_active = 1
        AND (c.next_due_at IS NULL OR c.next_due_at <= ?)
      ORDER BY
        CASE WHEN c.last_attempted_at IS NULL THEN 0 ELSE 1 END,
        COALESCE(c.next_due_at, '') ASC,
        COALESCE(c.last_attempted_at, '') ASC,
        p.id ASC
      LIMIT ?
    `).all(storefront, platform, now, limit);
  }

  recordCollectionAttempt({
    platformAppId, storefront = 'global', succeeded, error = null,
    observedAt = new Date().toISOString(), refreshHours = 24,
    retryHours = 1, maxRetryHours = 24
  }) {
    const previous = this.db.prepare(`
      SELECT consecutive_failures FROM collection_state
      WHERE platform_app_id = ? AND storefront = ?
    `).get(platformAppId, storefront);
    const failures = succeeded ? 0 : (previous?.consecutive_failures || 0) + 1;
    const backoff = succeeded ? refreshHours
      : Math.min(maxRetryHours, retryHours * Math.pow(2, Math.min(failures - 1, 20)));
    const nextDue = new Date(Date.parse(observedAt) + backoff * 3600000).toISOString();
    this.db.prepare(`
      INSERT INTO collection_state
        (platform_app_id, storefront, last_attempted_at, last_success_at,
         next_due_at, consecutive_failures, last_error)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(platform_app_id, storefront) DO UPDATE SET
        last_attempted_at = excluded.last_attempted_at,
        last_success_at = CASE WHEN excluded.consecutive_failures = 0
          THEN excluded.last_success_at ELSE collection_state.last_success_at END,
        next_due_at = excluded.next_due_at,
        consecutive_failures = excluded.consecutive_failures,
        last_error = excluded.last_error
    `).run(platformAppId, storefront, observedAt, succeeded ? observedAt : null,
      nextDue, failures, succeeded ? null : String(error || 'UNKNOWN').slice(0, 1000));
  }

  getCoverageReport({ now = new Date().toISOString() } = {}) {
    const summary = this.db.prepare(`
      SELECT p.platform, COUNT(*) AS catalog_apps,
        SUM(CASE WHEN o.platform_app_id IS NOT NULL THEN 1 ELSE 0 END) AS apps_with_observations,
        SUM(CASE WHEN c.last_success_at >= ? THEN 1 ELSE 0 END) AS recently_collected,
        SUM(CASE WHEN c.next_due_at <= ? OR c.next_due_at IS NULL THEN 1 ELSE 0 END) AS due
      FROM platform_applications p
      LEFT JOIN (
        SELECT DISTINCT platform_app_id FROM observed_metrics
      ) o ON o.platform_app_id = p.id
      LEFT JOIN (
        SELECT platform_app_id, MAX(last_success_at) AS last_success_at,
          MIN(next_due_at) AS next_due_at
        FROM collection_state GROUP BY platform_app_id
      ) c ON c.platform_app_id = p.id
      WHERE p.is_active = 1
      GROUP BY p.platform ORDER BY p.platform
    `).all(new Date(Date.parse(now) - 24 * 3600000).toISOString(), now);
    const audit = this.db.prepare(`
      SELECT job_type, started_at, completed_at, status,
        items_attempted, items_succeeded, items_failed, error_summary
      FROM collection_audit_logs ORDER BY started_at DESC LIMIT 10
    `).all();
    return {
      generatedAt: now,
      coverageMeaning: 'Counts only apps present in local catalog, not all global Education apps.',
      byPlatform: summary,
      recentJobs: audit
    };
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
