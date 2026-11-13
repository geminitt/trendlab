'use strict';

const CollectionScheduler = require('./scheduler');
const config = require('../../config/default.json');
const { audit } = require('../observability/audit');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class ContinuousCollector {
  constructor({ scheduler = new CollectionScheduler(), wait = sleep, logger = console } = {}) {
    this.scheduler = scheduler;
    this.wait = wait;
    this.logger = logger;
    this.stopping = false;
  }

  stop() { this.stopping = true; }

  async run({
    androidLimit = 100,
    iosLimit = 100,
    storefronts = config.catalog.surveyedStorefronts,
    pauseSeconds = 30,
    errorPauseSeconds = 300,
    maxCycles = Infinity
  } = {}) {
    if (!Array.isArray(storefronts) || storefronts.length === 0 ||
        storefronts.some(s => !/^[a-z]{2}$/.test(s))) throw new Error('Invalid storefront list');
    if (!(pauseSeconds >= 1 && errorPauseSeconds >= pauseSeconds)) {
      throw new RangeError('Invalid pause values');
    }
    let cycles = 0;
    audit('monitor.started', { storefronts, android_limit: androidLimit,
      ios_limit: iosLimit, pause_seconds: pauseSeconds, error_pause_seconds: errorPauseSeconds });
    while (!this.stopping && cycles < maxCycles) {
      const storefront = storefronts[cycles % storefronts.length];
      let hadError = false;
      const started = Date.now();
      audit('monitor.cycle_started', { cycle: cycles + 1, storefront, android_limit: androidLimit, ios_limit: iosLimit });
      try {
        const report = await this.scheduler.runFullCycle({ androidLimit, iosLimit, storefront });
        // A VN-specific 404/absence is NOT proof of rate limiting.
        // Only provider/network failures should slow the whole worker;
        // per-app storefront misses are individually backed off for 7+ days.
        hadError = report.status === 'FAILED' ||
          (report.totalAttempted > 0 &&
            (report.totalSystemicFailures || 0) / report.totalAttempted >= 0.25);
        audit('monitor.cycle_finished', {
          cycle: cycles + 1, storefront, elapsed_ms: Date.now() - started,
          attempted: report.totalAttempted, succeeded: report.totalSucceeded,
          failed: report.totalFailed, systemic_failures: report.totalSystemicFailures,
          status: report.status, systemic_cooldown: hadError
        });
      } catch (error) {
        hadError = true;
        audit('monitor.cycle_error', { cycle: cycles + 1, storefront, elapsed_ms: Date.now() - started, error });
        this.logger.error('[ContinuousCollector] Cycle failed:', error);
      }
      cycles++;
      if (!this.stopping && cycles < maxCycles) {
        const delay = (hadError ? errorPauseSeconds : pauseSeconds) * 1000;
        audit('monitor.sleep', { cycle: cycles, storefront, delay_ms: delay, systemic_cooldown: hadError });
        await this.wait(delay);
      }
    }
    audit('monitor.stopped', { cycles, requested_stop: this.stopping });
    return cycles;
  }
}

module.exports = ContinuousCollector;
