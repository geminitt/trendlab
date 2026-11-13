const crypto = require('node:crypto');
const { getDb } = require('./db');
const { audit } = require('../observability/audit');

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
  // Reserve capacity for first observations AND for recurring observations.
  // Otherwise a large imported catalog starves refreshes indefinitely.
  getDuePlatformApps({ platform, storefront = 'global', limit = 100,
                       now = new Date().toISOString(), newShare = 0.5,
                       preferStorefront = null } = {}) {
    if (!['android', 'ios'].includes(platform)) throw new Error('Unknown platform');
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('limit must be positive');
    if (!Number.isFinite(newShare) || newShare < 0 || newShare > 1) {
      throw new RangeError('newShare must be in [0, 1]');
    }
    // In a single-market study, collect apps observed in that country's
    // Education charts before exploring the unverified bulk catalog backlog.
    // Use an indexed EXISTS check; do not drop or delete other catalog entries.
    const preferred = preferStorefront ?
      `CASE WHEN EXISTS (
        SELECT 1 FROM observed_metrics m
        WHERE m.platform_app_id = p.id AND m.storefront = ?
          AND m.observed_rank IS NOT NULL
      ) THEN 0 ELSE 1 END,` : '';
    const newArgs = (max) => preferStorefront ?
      [storefront, platform, preferStorefront, max] : [storefront, platform, max];
    const newlySeen = this.db.prepare(`
      SELECT p.* FROM platform_applications p
      LEFT JOIN collection_state c
        ON c.platform_app_id = p.id AND c.storefront = ?
      WHERE p.platform = ? AND p.is_active = 1 AND c.last_attempted_at IS NULL
      ORDER BY ${preferred} p.first_seen_at DESC, p.id ASC LIMIT ?
    `);
    const revisits = this.db.prepare(`
      SELECT p.* FROM platform_applications p
      JOIN collection_state c
        ON c.platform_app_id = p.id AND c.storefront = ?
      WHERE p.platform = ? AND p.is_active = 1
        AND c.last_attempted_at IS NOT NULL AND c.next_due_at <= ?
      ORDER BY c.next_due_at ASC, c.last_attempted_at ASC, p.id ASC
      LIMIT ?
    `);
    const newQuota = Math.ceil(limit * newShare);
    const oldQuota = limit - newQuota;
    const fresh = newlySeen.all(...newArgs(newQuota));
    const recurring = revisits.all(storefront, platform, now, oldQuota);
    // Fill unused capacity from either pool without repeating an app.
    if (fresh.length < newQuota) {
      recurring.push(...revisits.all(storefront, platform, now, limit - fresh.length)
        .slice(recurring.length));
    } else if (recurring.length < oldQuota) {
      fresh.push(...newlySeen.all(...newArgs(limit - recurring.length))
        .slice(fresh.length));
    }
    // Alternate so long-running collection proceeds fairly through both pools.
    const selection = [];
    while (fresh.length || recurring.length) {
      if (recurring.length) selection.push(recurring.shift());
      if (fresh.length && selection.length < limit) selection.push(fresh.shift());
      if (selection.length >= limit) break;
    }
    return selection;
  }

  // Vietnam research scheduler: spend most API capacity on apps with verified
  // VN chart/lookup evidence and a small fixed lane on never-tried catalog IDs.
  // The global AppGoblin catalog is only a candidate pool, NOT a VN app census.
  // Deliberately do not fill idle capacity with unbounded global probes.
  getDueMarketApps({ platform, storefront = 'vn', limit = 100,
                     explorationShare = 0.2, now = new Date().toISOString() } = {}) {
    if (!['android', 'ios'].includes(platform)) throw new Error('Unknown platform');
    if (!/^[a-z]{2}$/.test(storefront)) throw new Error('Invalid storefront');
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('Invalid limit');
    if (!Number.isFinite(explorationShare) ||
        explorationShare < 0 || explorationShare > 1) throw new RangeError('Invalid exploration share');

    const exploreLimit = explorationShare === 0 ? 0 :
      Math.max(1, Math.floor(limit * explorationShare));
    const focusLimit = limit - exploreLimit;

    const focused = focusLimit ? this.db.prepare(`
      SELECT p.* FROM platform_applications p
      JOIN (
        SELECT DISTINCT platform_app_id
        FROM observed_metrics
        WHERE storefront = ?
          AND (observed_rank IS NOT NULL
            OR observed_install_counter IS NOT NULL
            OR observed_rating_count IS NOT NULL)
      ) vn ON vn.platform_app_id = p.id
      LEFT JOIN collection_state c ON c.platform_app_id = p.id AND c.storefront = ?
      WHERE p.is_active = 1 AND p.platform = ?
        AND (c.last_attempted_at IS NULL OR c.next_due_at <= ?)
      ORDER BY CASE WHEN c.last_attempted_at IS NULL THEN 0 ELSE 1 END,
               c.next_due_at ASC, p.id ASC
      LIMIT ?
    `).all(storefront, storefront, platform, now, focusLimit) : [];

    const exploratory = exploreLimit ? this.db.prepare(`
      SELECT p.* FROM platform_applications p
      LEFT JOIN collection_state c ON c.platform_app_id = p.id AND c.storefront = ?
      WHERE p.platform = ? AND p.is_active = 1
        AND c.last_attempted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM observed_metrics m
          WHERE m.platform_app_id = p.id AND m.storefront = ?
            AND (m.observed_rank IS NOT NULL
              OR m.observed_install_counter IS NOT NULL
              OR m.observed_rating_count IS NOT NULL)
        )
      ORDER BY p.first_seen_at DESC, p.id
      LIMIT ?
    `).all(storefront, platform, storefront, exploreLimit) : [];

    // Alternate lanes to keep early progress visible while preserving VN
    // chart evidence freshness. No double selection between the two lanes.
    const result = [];
    const max = Math.max(focused.length, exploratory.length);
    for (let i = 0; i < max; i++) {
      if (i < focused.length) result.push(focused[i]);
      if (i < exploratory.length) result.push(exploratory[i]);
    }
    return result;
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
    audit('collection.attempt', {
      platform_app_id: platformAppId, storefront, succeeded: !!succeeded,
      error_code: succeeded ? null : String(error || 'UNKNOWN'),
      consecutive_failures: failures, backoff_hours: backoff,
      next_due_at: nextDue, observed_at: observedAt
    });
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
    // VN-specific progress is independent of the historic imported worldwide catalog.
    // Chart-only evidence is separately visible; it is not counted as numeric metrics.
    const market = 'vn';
    const marketSummary = this.db.prepare(`
      SELECT p.platform,
        COUNT(DISTINCT o.platform_app_id) AS market_candidates,
        COUNT(DISTINCT CASE WHEN o.observed_install_counter IS NOT NULL
          OR o.observed_rating_count IS NOT NULL THEN o.platform_app_id END)
          AS apps_with_market_metrics,
        COUNT(DISTINCT CASE WHEN o.observed_rank IS NOT NULL
          THEN o.platform_app_id END) AS charted_market_apps
      FROM platform_applications p
      JOIN observed_metrics o ON o.platform_app_id = p.id AND o.storefront = ?
      WHERE p.is_active = 1
      GROUP BY p.platform ORDER BY p.platform
    `).all(market);
    const marketSuccess = this.db.prepare(`
      SELECT p.platform, COUNT(*) AS successful_last_24h
      FROM collection_state c
      JOIN platform_applications p ON p.id = c.platform_app_id
      WHERE c.storefront = ? AND p.is_active = 1
        AND c.last_success_at >= ?
      GROUP BY p.platform
    `).all(market, new Date(Date.parse(now) - 24 * 3600000).toISOString());
    const recentMarket = new Map(marketSuccess.map(r => [r.platform, r.successful_last_24h]));
    for (const row of marketSummary) {
      row.successful_last_24h = recentMarket.get(row.platform) || 0;
    }
    const audit = this.db.prepare(`
      SELECT job_type, started_at, completed_at, status,
        items_attempted, items_succeeded, items_failed, error_summary
      FROM collection_audit_logs ORDER BY started_at DESC LIMIT 10
    `).all();
    return {
      generatedAt: now,
      researchMarket: market,
      coverageMeaning: 'byPlatform is historical mixed-country local catalog coverage, NOT Vietnam coverage. marketByPlatform counts apps with VN chart/lookup evidence only; not a census of all VN Education apps.',
      byPlatform: summary,
      marketByPlatform: marketSummary,
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
    audit('snapshot.saved', {
      snapshot_id: id, platform_app_id: platformAppId, observed_at: observedAt,
      source_updated_at: sourceUpdatedAt, source_name: sourceName,
      fetch_method: fetchMethod, sha256: hash, payload_bytes: Buffer.byteLength(payloadStr)
    });
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
    audit('observation.saved', {
      observation_id: id, platform_app_id: platformAppId, observed_at: observedAt,
      storefront, install_counter: installCounter, rating_count: ratingCount,
      review_count: reviewCount, rating_score: ratingScore,
      rank, rank_chart_type: rankChartType, quality_flags: flags
    });
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
    audit('analytics.window_saved', {
      metric_id: id, platform_app_id: platformAppId, window_type: windowType,
      window_start: windowStart, window_end: windowEnd,
      delta_installs: deltaInstalls, delta_ratings: deltaRatings,
      rating_velocity_daily: ratingVelocityDaily, relative_growth: relativeGrowth,
      dampened_growth: dampenedGrowth, momentum: momentumScore,
      acceleration: accelerationScore, persistence: persistenceRatio,
      completeness, computed_at: computedAt
    });
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
    audit('analytics.score_saved', {
      score_id: id, platform_app_id: platformAppId,
      window_type: windowType, model: modelIdentifier,
      score: cleanFinalScore, growth: cleanGrowth, momentum: cleanMomentum,
      persistence: cleanPersistence, rank: trendRank, evaluated_at: evaluatedAt
    });
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
    audit('job.started', { job_id: id, job_type: jobType, started_at: now });
    return id;
  }

  finishAuditLog(id, { status = 'SUCCESS', attempted = 0, succeeded = 0, failed = 0, errorSummary = null } = {}) {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE collection_audit_logs
      SET completed_at = ?, status = ?, items_attempted = ?, items_succeeded = ?, items_failed = ?, error_summary = ?
      WHERE id = ?
    `).run(now, status, attempted, succeeded, failed, errorSummary, id);
    audit('job.finished', { job_id: id, status,
      attempted, succeeded, failed, error: errorSummary, completed_at: now });
  }
}

module.exports = Repository;
