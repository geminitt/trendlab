const Repository = require('../storage/repository');

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

class TrendScoringEngine {
  constructor(repo = null) {
    this.repo = repo || new Repository();
  }

  // Model A: Baseline Pure Growth
  evaluateModelA(derived) {
    const rawDelta = derived.delta_install_counter !== null && derived.delta_install_counter !== undefined
      ? finiteOrNull(derived.delta_install_counter)
      : finiteOrNull(derived.delta_rating_count);
    if (rawDelta === null || rawDelta < 0) return null;
    const score = Math.log10(Math.max(1, rawDelta));
    return {
      modelIdentifier: 'model_a_growth',
      growthStrength: isNaN(score) ? 0 : score,
      momentumScore: 0.0,
      persistenceScore: 1.0,
      finalTrendScore: isNaN(score) ? 0 : Math.round(score * 100) / 100
    };
  }

  // Model B: Sustained Growth (Compounders)
  evaluateModelB(derived) {
    const dampened = finiteOrNull(derived.dampened_growth);
    const persistence = finiteOrNull(derived.persistence_ratio);
    const completeness = finiteOrNull(derived.observation_completeness);
    if ([dampened, persistence, completeness].some(v => v === null)) return null;

    const growth = Math.min(10.0, Math.max(0, dampened * 100));
    const finalScore = (growth * 0.5) + (persistence * 25) + (completeness * 25);

    return {
      modelIdentifier: 'model_b_compounder',
      growthStrength: Math.round(growth * 100) / 100,
      momentumScore: Number(derived.theil_sen_slope) || 0,
      persistenceScore: Math.round(persistence * 100) / 100,
      finalTrendScore: isNaN(finalScore) ? 0 : Math.round(finalScore * 100) / 100
    };
  }

  // Model C: Emerging Trends (Breakout Detection)
  evaluateModelC(derived) {
    const dampened = finiteOrNull(derived.dampened_growth);
    const rawMomentum = finiteOrNull(derived.momentum_score);
    const rawAcceleration = finiteOrNull(derived.acceleration_score);
    if ([dampened, rawMomentum, rawAcceleration].some(v => v === null)) return null;
    const momentum = Math.max(-10, Math.min(50, rawMomentum));
    const acceleration = Math.max(-5, Math.min(20, rawAcceleration));

    const growth = Math.min(10.0, Math.max(0, dampened * 100));
    const breakoutBoost = acceleration > 0 ? (acceleration * 2.0) : 0;
    const finalScore = (growth * 4.0) + (momentum * 0.8) + breakoutBoost;

    return {
      modelIdentifier: 'model_c_breakout',
      growthStrength: Math.round(growth * 100) / 100,
      momentumScore: Math.round(momentum * 100) / 100,
      persistenceScore: finiteOrNull(derived.persistence_ratio),
      finalTrendScore: isNaN(finalScore) ? 0 : Math.round(Math.max(0, finalScore) * 100) / 100
    };
  }

  evaluateAllForWindow(windowType = '30d') {
    const rows = this.repo.db.prepare(
      `SELECT d.*, p.platform AS platform FROM derived_window_metrics d
       JOIN platform_applications p ON p.id = d.platform_app_id
       INNER JOIN (
         SELECT platform_app_id, MAX(computed_at) AS latest_computed
         FROM derived_window_metrics WHERE window_type = ?
         GROUP BY platform_app_id
       ) latest ON d.platform_app_id = latest.platform_app_id
         AND d.computed_at = latest.latest_computed
       WHERE d.window_type = ?`
    ).all(windowType, windowType);
    // Rebuild rankings, rather than accumulating stale scores from prior runs.
    this.repo.db.prepare('DELETE FROM trend_model_scores WHERE window_type = ?').run(windowType);

    console.log(`[TrendScoringEngine] Scoring ${rows.length} apps for window '${windowType}'...`);

    const models = ['model_a_growth', 'model_b_compounder', 'model_c_breakout'];
    const modelScores = {
      model_a_growth: [],
      model_b_compounder: [],
      model_c_breakout: []
    };

    for (const d of rows) {
      const mA = this.evaluateModelA(d);
      const mB = this.evaluateModelB(d);
      const mC = this.evaluateModelC(d);

      if (mA) modelScores.model_a_growth.push({ derived: d, eval: mA });
      if (mB) modelScores.model_b_compounder.push({ derived: d, eval: mB });
      if (mC) modelScores.model_c_breakout.push({ derived: d, eval: mC });
    }

    // Rank and save each model
    for (const modelKey of models) {
      const list = modelScores[modelKey];
      // Scores are ranked separately within each platform; cross-platform numbers
      // are not directly comparable because Android and iOS use different signals.
      list.sort((a, b) => a.derived.platform.localeCompare(b.derived.platform) ||
        b.eval.finalTrendScore - a.eval.finalTrendScore);
      const platformRanks = new Map();
      for (const item of list) {
        const platform = item.derived.platform;
        const rank = (platformRanks.get(platform) || 0) + 1;
        platformRanks.set(platform, rank);
        this.repo.saveTrendScore({
          platformAppId: item.derived.platform_app_id,
          windowType,
          modelIdentifier: item.eval.modelIdentifier,
          growthStrength: item.eval.growthStrength,
          momentumScore: item.eval.momentumScore,
          persistenceScore: item.eval.persistenceScore,
          finalTrendScore: item.eval.finalTrendScore,
          trendRank: rank
        });
      }
    }

    console.log(`[TrendScoringEngine] Successfully generated trend scores and rankings for window '${windowType}'.`);
  }

  evaluateAllWindows() {
    const windows = ['7d', '14d', '30d', '90d', 'all'];
    for (const w of windows) {
      this.evaluateAllForWindow(w);
    }
  }
}

module.exports = TrendScoringEngine;
