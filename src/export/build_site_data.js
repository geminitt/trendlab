const fs = require('node:fs');
const path = require('node:path');
const Repository = require('../storage/repository');
const config = require('../../config/default.json');
const crypto = require('node:crypto');
const { audit } = require('../observability/audit');

class SiteDataBuilder {
  constructor(repo = null) {
    this.repo = repo || new Repository();
  }

  build(outputPath = null) {
    console.log('[SiteDataBuilder] Building static site dataset (data.json)...');
    const started = Date.now();
    audit('export.started', { research_market: config.catalog.researchMarket });
    const targetPath = outputPath || path.resolve(__dirname, '../../web/data/data.json');
    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Vietnam-market output is restricted to actual VN observed evidence
    // (local Education top charts or successful VN storefront lookups).
    // The imported global catalog remains intact in SQLite as a candidate pool,
    // but it is NOT counted as a Vietnam-market population.
    const market = config.catalog.researchMarket || 'vn';
    const apps = this.repo.db.prepare(`
      SELECT p.* FROM (
        SELECT platform_app_id, MAX(observed_at) AS last_observed_at
        FROM observed_metrics WHERE storefront = ?
        GROUP BY platform_app_id
      ) seen
      JOIN platform_applications p ON p.id = seen.platform_app_id
      WHERE p.is_active = 1
      ORDER BY seen.last_observed_at DESC, p.id
    `).all(market);
    const catalogSize = this.repo.db.prepare(
      'SELECT COUNT(*) AS count FROM platform_applications WHERE is_active = 1'
    ).get().count;
    const measuredMarketApps = this.repo.db.prepare(`
      SELECT COUNT(DISTINCT o.platform_app_id) AS count
      FROM observed_metrics o
      JOIN platform_applications p ON p.id = o.platform_app_id
      WHERE o.storefront = ? AND p.is_active = 1
        AND (o.observed_install_counter IS NOT NULL
          OR o.observed_rating_count IS NOT NULL)
    `).get(market).count;
    // Sparse, auditable aggregates for the dashboard. An observation row is
    // not a download, and an audit success is not a unique app.
    const now = new Date();
    const days = Array.from({ length: 30 }, (_, index) =>
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (29 - index)))
        .toISOString().slice(0, 10));
    const start = days[0] + 'T00:00:00.000Z';
    const dailyRows = this.repo.db.prepare(`
      SELECT substr(observed_at, 1, 10) AS day, COUNT(*) AS observationRows,
             COUNT(DISTINCT platform_app_id) AS observedApps
      FROM observed_metrics WHERE observed_at >= ? AND storefront = ?
      GROUP BY substr(observed_at, 1, 10)
    `).all(start, market);
    const firstSeenRows = this.repo.db.prepare(`
      SELECT substr(first_observed, 1, 10) AS day, COUNT(*) AS newlyObserved
      FROM (
        SELECT platform_app_id, MIN(observed_at) AS first_observed
        FROM observed_metrics WHERE storefront = ?
        GROUP BY platform_app_id
      )
      WHERE first_observed >= ?
      GROUP BY substr(first_observed, 1, 10)
    `).all(market, start);
    const auditRows = this.repo.db.prepare(`
      SELECT substr(completed_at, 1, 10) AS day,
             SUM(items_attempted) AS attempts,
             SUM(items_succeeded) AS succeeded,
             SUM(items_failed) AS failed
      FROM collection_audit_logs
      WHERE completed_at >= ? AND completed_at IS NOT NULL
      GROUP BY substr(completed_at, 1, 10)
    `).all(start);
    const toMap = rows => new Map(rows.map(r => [r.day, r]));
    const observedMap = toMap(dailyRows);
    const firstMap = toMap(firstSeenRows);
    const auditMap = toMap(auditRows);
    const activity = {
      source: 'VN observed_metrics (market only); collection_audit_logs (historically mixed markets, not VN-specific); UTC dates',
      daily: days.map(date => ({
        date,
        observationRows: observedMap.get(date)?.observationRows || 0,
        observedApps: observedMap.get(date)?.observedApps || 0,
        newlyObserved: firstMap.get(date)?.newlyObserved || 0,
        attempts: auditMap.get(date)?.attempts || 0,
        succeeded: auditMap.get(date)?.succeeded || 0,
        failed: auditMap.get(date)?.failed || 0
      }))
    };
    const compiledApps = [];

    for (const app of apps) {
      // 1. Get raw history for sparklines
      const historyRows = this.repo.getMetricsSeries(app.id)
        .filter(row => row.storefront === market);
      const history = historyRows.map(r => ({
        t: r.observed_at,
        installs: r.observed_install_counter,
        ratings: r.observed_rating_count,
        score: r.observed_rating_score,
        rank: r.observed_rank,
        storefront: r.storefront,
        chart: r.rank_chart_type
      }));

      // 2. Get latest snapshot for provenance
      const latestSnapshot = this.repo.db.prepare(
        `SELECT rs.observed_at, rs.source_name, rs.fetch_method, rs.payload_sha256
         FROM raw_snapshots rs
         WHERE rs.platform_app_id = ?
           AND EXISTS (SELECT 1 FROM observed_metrics m
             WHERE m.platform_app_id = rs.platform_app_id
               AND m.observed_at = rs.observed_at AND m.storefront = ?)
         ORDER BY rs.observed_at DESC LIMIT 1`
      ).get(app.id, market);

      // 3. Get derived metrics across windows
      const derivedRows = this.repo.db.prepare(
        'SELECT * FROM derived_window_metrics WHERE platform_app_id = ?'
      ).all(app.id);

      const metricsMap = {};
      for (const d of derivedRows) {
        metricsMap[d.window_type] = {
          deltaInstalls: d.delta_install_counter,
          deltaRatings: d.delta_rating_count,
          ratingVelocity: d.rating_velocity_daily,
          relativeGrowth: d.relative_growth,
          dampenedGrowth: d.dampened_growth,
          momentumScore: d.momentum_score,
          accelerationScore: d.acceleration_score,
          persistenceRatio: d.persistence_ratio,
          theilSenSlope: d.theil_sen_slope,
          completeness: d.observation_completeness
        };
      }

      // 4. Get model scores across windows
      const scoreRows = this.repo.db.prepare(
        'SELECT window_type, model_identifier, final_trend_score, trend_rank FROM trend_model_scores WHERE platform_app_id = ?'
      ).all(app.id);

      const scoresMap = {};
      for (const s of scoreRows) {
        if (!scoresMap[s.window_type]) scoresMap[s.window_type] = {};
        scoresMap[s.window_type][s.model_identifier] = {
          score: s.final_trend_score,
          rank: s.trend_rank
        };
      }

      // 5. Export original source counters for LINEAR area mapping in the UI.
      // volumeScale below is a legacy export field; NOT used as tile weight.
      const latestPoint = historyRows.length > 0 ? historyRows[historyRows.length - 1] : null;
      // A missing counter must not be presented as a fabricated "100".
      // Android scale is install counter if present, otherwise rating count,
      // but the source metric is explicitly recorded.
      let rawVolume = null;
      let volumeMetric = null;
      for (let i = historyRows.length - 1; i >= 0; i--) {
        const row = historyRows[i];
        if (app.platform === 'android' && Number.isFinite(row.observed_install_counter)) {
          rawVolume = row.observed_install_counter;
          volumeMetric = 'observed_install_counter';
          break;
        }
        // iOS rating counts are VN-storefront-specific, never US/global.
        if (app.platform === 'ios' && row.storefront === market &&
            Number.isFinite(row.observed_rating_count)) {
          rawVolume = row.observed_rating_count;
          volumeMetric = 'observed_rating_count';
          break;
        }
      }
      const volumeScale = rawVolume === null ? 1.0
        : Math.max(1.0, Math.log10(rawVolume + 1));

      compiledApps.push({
        id: app.id,
        title: app.title,
        platform: app.platform,
        nativeStoreId: app.native_store_id,
        storefront: app.storefront,
        developer: app.developer_name || app.developer_id || 'Unknown Developer',
        primaryGenre: app.primary_genre,
        price: app.price,
        volumeScale: Math.round(volumeScale * 100) / 100,
        rawVolume,
        volumeMetric,
        observationCount: historyRows.length,
        lastObservedAt: historyRows.length ? historyRows[historyRows.length - 1].observed_at : null,
        history,
        metrics: metricsMap,
        scores: scoresMap,
        provenance: latestSnapshot ? {
          sourceName: latestSnapshot.source_name,
          fetchMethod: latestSnapshot.fetch_method,
          lastObservedAt: latestSnapshot.observed_at,
          sha256: latestSnapshot.payload_sha256.slice(0, 12) + '...'
        } : null
      });
    }

    const payload = {
      meta: {
        system: 'TrendLab Vietnam Education App Research',
        researchMarket: market,
        marketScope: 'Only apps with observed VN storefront evidence; not a census of all Education apps available in Vietnam.',
        importedCandidateCatalogApps: catalogSize,
        marketCandidateApps: compiledApps.length,
        marketMeasuredApps: measuredMarketApps,
        generatedAt: new Date().toISOString(),
        totalApps: compiledApps.length,
        catalogApps: compiledApps.length,
        scoredApps30d: compiledApps.filter(app => app.scores?.['30d'] &&
          Object.keys(app.scores['30d']).length > 0).length,
        platformCounts: {
          android: compiledApps.filter(app => app.platform === 'android').length,
          ios: compiledApps.filter(app => app.platform === 'ios').length
        },
        activity,
        exportScope: 'VN storefront observations only, including VN Education chart ranks. Existing US/other-market metrics and global-only candidates are excluded.',
        windows: ['7d', '14d', '30d', '90d', 'all'],
        models: [
          { id: 'model_c_breakout', name: 'Emerging Breakouts (Mode A)' },
          { id: 'model_b_compounder', name: 'Sustained Growth (Mode B)' },
          { id: 'model_a_growth', name: 'Absolute Volume (Model A)' }
        ],
        areaDimensionDefinition: 'VN storefront evidence only. Linear area by selected positive metric; Android public maxInstalls is not VN-specific installs, iOS VN user ratings are storefront-specific. No cross-platform comparison.',
        colorDimensionDefinition: 'Relative percentile per platform for available signals; gray = insufficient evidence. Scores are provisional.'
      },
      apps: compiledApps
    };

    // Atomic replacement ensures the web server never reads a half-written JSON.
    const tmpPath = targetPath + '.tmp-' + process.pid;
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(payload), 'utf8');
      fs.renameSync(tmpPath, targetPath);
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
    const sha256 = crypto.createHash('sha256')
      .update(fs.readFileSync(targetPath)).digest('hex');
    audit('export.finished', {
      output: targetPath, research_market: market,
      exported_apps: compiledApps.length, measured_apps: measuredMarketApps,
      candidate_catalog_apps: catalogSize,
      bytes: fs.statSync(targetPath).size, sha256,
      elapsed_ms: Date.now() - started
    });
    console.log(`[SiteDataBuilder] Successfully generated ${targetPath} (${compiledApps.length} apps, ${(fs.statSync(targetPath).size / 1024).toFixed(1)} KB).`);
    return targetPath;
  }
}

module.exports = SiteDataBuilder;
