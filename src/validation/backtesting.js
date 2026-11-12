const Repository = require('../storage/repository');

// This module is a model-disagreement diagnostic, NOT a predictive backtest.
// A real walk-forward evaluation requires dated training cutoffs and future labels.
class BacktestingHarness {
  constructor(repo = null) {
    this.repo = repo || new Repository();
  }

  runWalkForwardValidation({ k = 10 } = {}) {
    if (!Number.isInteger(k) || k < 1) throw new RangeError('k must be a positive integer');
    const models = ['model_a_growth', 'model_b_compounder', 'model_c_breakout'];
    const summary = {};
    for (const model of models) {
      const rows = this.repo.db.prepare(`
        SELECT t.trend_rank, t.final_trend_score, p.title, p.platform, p.native_store_id
        FROM trend_model_scores t
        JOIN platform_applications p ON t.platform_app_id = p.id
        WHERE t.model_identifier = ? AND t.window_type = '30d'
        ORDER BY p.platform, t.trend_rank ASC
        LIMIT ?
      `).all(model, k);
      summary[model] = rows;
    }

    function overlap(a, b) {
      const idsA = new Set(a.map(row => row.platform + ':' + row.native_store_id));
      const idsB = new Set(b.map(row => row.platform + ':' + row.native_store_id));
      const intersection = [...idsA].filter(key => idsB.has(key)).length;
      const union = new Set([...idsA, ...idsB]).size;
      return { intersection, jaccard: union ? intersection / union : null };
    }
    const diagnostics = {
      model_a_vs_b: overlap(summary[models[0]], summary[models[1]]),
      model_a_vs_c: overlap(summary[models[0]], summary[models[2]]),
      model_b_vs_c: overlap(summary[models[1]], summary[models[2]])
    };
    console.log('[Diagnostics] Top-K model overlap:', JSON.stringify(diagnostics, null, 2));
    console.warn('[Diagnostics] Not a walk-forward backtest. No future-outcome labels were evaluated.');
    return {
      status: 'DIAGNOSTIC_ONLY',
      predictiveValidationPerformed: false,
      modelTopK: summary,
      overlap: diagnostics
    };
  }
}

module.exports = BacktestingHarness;
