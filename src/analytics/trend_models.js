const Repository = require('../storage/repository');

class TrendScoringEngine {
  constructor(repo = null) {
    this.repo = repo || new Repository();
  }

  // Model A: Baseline Pure Growth
  evaluateModelA(derived) {
    const rawDelta = derived.delta_install_counter !== null && derived.delta_install_counter !== undefined
      ? Number(derived.delta_install_counter)
      : (Number(derived.delta_rating_count) || 0);
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
    const dampened = Number(derived.dampened_growth) || 0;
    const persistence = Number(derived.persistence_ratio) || 1.0;
    const completeness = Number(derived.observation_completeness) || 1.0;

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
    const dampened = Number(derived.dampened_growth) || 0;
    const momentum = Math.max(-10, Math.min(50, Number(derived.momentum_score) || 0));
    const acceleration = Math.max(-5, Math.min(20, Number(derived.acceleration_score) || 0));

    const growth = Math.min(10.0, Math.max(0, dampened * 100));
    const breakoutBoost = acceleration > 0 ? (acceleration * 2.0) : 0;
    const finalScore = (growth * 4.0) + (momentum * 0.8) + breakoutBoost;

    return {
      modelIdentifier: 'model_c_breakout',
      growthStrength: Math.round(growth * 100) / 100,
      momentumScore: Math.round(momentum * 100) / 100,
      persistenceScore: Number(derived.persistence_ratio) || 1.0,
      finalTrendScore: isNaN(finalScore) ? 0 : Math.round(Math.max(0, finalScore) * 100) / 100
    };
  }

  evaluateAllForWindow(windowType = '30d') {
    const rows = this.repo.db.prepare(
      'SELECT * FROM derived_window_metrics WHERE window_type = ?'
    ).all(windowType);

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

      modelScores.model_a_growth.push({ derived: d, eval: mA });
      modelScores.model_b_compounder.push({ derived: d, eval: mB });
      modelScores.model_c_breakout.push({ derived: d, eval: mC });
    }

    // Rank and save each model
    for (const modelKey of models) {
      const list = modelScores[modelKey];
      list.sort((a, b) => b.eval.finalTrendScore - a.eval.finalTrendScore);

      for (let rank = 0; rank < list.length; rank++) {
        const item = list[rank];
        this.repo.saveTrendScore({
          platformAppId: item.derived.platform_app_id,
          windowType,
          modelIdentifier: item.eval.modelIdentifier,
          growthStrength: item.eval.growthStrength,
          momentumScore: item.eval.momentumScore,
          persistenceScore: item.eval.persistenceScore,
          finalTrendScore: item.eval.finalTrendScore,
          trendRank: rank + 1
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
