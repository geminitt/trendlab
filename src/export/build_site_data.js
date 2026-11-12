const fs = require('node:fs');
const path = require('node:path');
const Repository = require('../storage/repository');

class SiteDataBuilder {
  constructor(repo = null) {
    this.repo = repo || new Repository();
  }

  build(outputPath = null) {
    console.log('[SiteDataBuilder] Building static site dataset (data.json)...');
    const targetPath = outputPath || path.resolve(__dirname, '../../web/data/data.json');
    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Export the complete observed subset, not the first 1,000 catalog entries.
    // Unobserved catalog entries do not belong in a time-series visualization.
    const apps = this.repo.db.prepare(`
      SELECT p.*
      FROM (
        SELECT platform_app_id, MAX(observed_at) AS last_observed_at
        FROM observed_metrics GROUP BY platform_app_id
      ) seen
      JOIN platform_applications p ON p.id = seen.platform_app_id
      WHERE p.is_active = 1
      ORDER BY seen.last_observed_at DESC, p.id
    `).all();
    const catalogSize = this.repo.db.prepare(
      'SELECT COUNT(*) AS count FROM platform_applications WHERE is_active = 1'
    ).get().count;
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
      FROM observed_metrics WHERE observed_at >= ?
      GROUP BY substr(observed_at, 1, 10)
    `).all(start);
    const firstSeenRows = this.repo.db.prepare(`
      SELECT substr(first_observed, 1, 10) AS day, COUNT(*) AS newlyObserved
      FROM (
        SELECT platform_app_id, MIN(observed_at) AS first_observed
        FROM observed_metrics GROUP BY platform_app_id
      )
      WHERE first_observed >= ?
      GROUP BY substr(first_observed, 1, 10)
    `).all(start);
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
      source: 'observed_metrics and collection_audit_logs (SQLite); UTC calendar dates',
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
      const historyRows = this.repo.getMetricsSeries(app.id);
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
        'SELECT observed_at, source_name, fetch_method, payload_sha256 FROM raw_snapshots WHERE platform_app_id = ? ORDER BY observed_at DESC LIMIT 1'
      ).get(app.id);

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

      // 5. Compute Treemap Area Dimension (Observed Volume Scale)
      // As specified: Log10 of installs/ratings, NEVER assuming market share!
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
        // The visible iOS treemap is explicitly US rating counts; never
        // silently choose a larger figure from a different storefront.
        if (app.platform === 'ios' && row.storefront === 'us' &&
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
        system: 'TrendLab Global Education Discovery',
        generatedAt: new Date().toISOString(),
        totalApps: compiledApps.length,
        catalogApps: catalogSize,
        scoredApps30d: compiledApps.filter(app => app.scores?.['30d'] &&
          Object.keys(app.scores['30d']).length > 0).length,
        platformCounts: {
          android: compiledApps.filter(app => app.platform === 'android').length,
          ios: compiledApps.filter(app => app.platform === 'ios').length
        },
        activity,
        exportScope: 'Observed applications only; catalog entries without snapshots excluded.',
        windows: ['7d', '14d', '30d', '90d', 'all'],
        models: [
          { id: 'model_c_breakout', name: 'Emerging Breakouts (Mode A)' },
          { id: 'model_b_compounder', name: 'Sustained Growth (Mode B)' },
          { id: 'model_a_growth', name: 'Absolute Volume (Model A)' }
        ],
        areaDimensionDefinition: 'Observed scale: separate Android and iOS treemaps, top 64 distinct native IDs per platform. Tile weight = log10(source count + 10)^2; NOT proportional market share.',
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
    console.log(`[SiteDataBuilder] Successfully generated ${targetPath} (${compiledApps.length} apps, ${(fs.statSync(targetPath).size / 1024).toFixed(1)} KB).`);
    return targetPath;
  }
}

module.exports = SiteDataBuilder;
