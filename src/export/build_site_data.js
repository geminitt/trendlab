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

    const apps = this.repo.getPlatformApps({ limit: 1000 });
    const compiledApps = [];

    for (const app of apps) {
      // 1. Get raw history for sparklines
      const historyRows = this.repo.getMetricsSeries(app.id);
      const history = historyRows.map(r => ({
        t: r.observed_at,
        installs: r.observed_install_counter,
        ratings: r.observed_rating_count,
        score: r.observed_rating_score
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
      let rawVolume = 100;
      if (latestPoint) {
        if (app.platform === 'android' && latestPoint.observed_install_counter) {
          rawVolume = latestPoint.observed_install_counter;
        } else if (latestPoint.observed_rating_count) {
          rawVolume = latestPoint.observed_rating_count;
        }
      }
      const volumeScale = Math.max(1.0, Math.log10(rawVolume + 1));

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
        windows: ['7d', '14d', '30d', '90d', 'all'],
        models: [
          { id: 'model_c_breakout', name: 'Emerging Breakouts (Mode A)' },
          { id: 'model_b_compounder', name: 'Sustained Growth (Mode B)' },
          { id: 'model_a_growth', name: 'Absolute Volume (Model A)' }
        ],
        areaDimensionDefinition: 'Log10(Observed Installs / Ratings + 1) — Proxy for Observed Scale (NOT market share)',
        colorDimensionDefinition: 'Selected Model Trend Score (Purple: negative / neutral, Gray: baseline, Green: high breakout momentum)'
      },
      apps: compiledApps
    };

    fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`[SiteDataBuilder] Successfully generated ${targetPath} (${compiledApps.length} apps, ${(fs.statSync(targetPath).size / 1024).toFixed(1)} KB).`);
    return targetPath;
  }
}

module.exports = SiteDataBuilder;
