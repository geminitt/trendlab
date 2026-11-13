const Repository = require('../storage/repository');
const AndroidCollector = require('./android_collector');
const IosCollector = require('./ios_collector');
const StoreSweeper = require('../catalog/store_sweeper');
const config = require('../../config/default.json');

class CollectionScheduler {
  constructor(repo = null) {
    this.repo = repo || new Repository();
    this.androidCollector = new AndroidCollector(this.repo);
    this.iosCollector = new IosCollector(this.repo);
    this.sweeper = new StoreSweeper(this.repo);
  }

  async runFullCycle({ androidLimit = 200, iosLimit = 200, storefront = config.catalog.researchMarket || 'vn' } = {}) {
    console.log('=== STARTING TRENDLAB FULL COLLECTION CYCLE ===');
    const auditId = this.repo.startAuditLog('FULL_COLLECTION_CYCLE');

    let totalAttempted = 0;
    let totalSucceeded = 0;
    let totalFailed = 0;

    try {
      // Catalog must be imported explicitly via import-catalog or sweep.
      // Never inject a curated list of famous apps into an otherwise empty dataset.
      const hasApps = this.repo.getPlatformApps({ limit: 1 }).length > 0;
      if (!hasApps) {
        console.warn('[Scheduler] Empty catalog. Run import-catalog --file PATH first.');
      }

      // 2. Run Android Collection
      const andRes = await this.androidCollector.collectAll({ limit: androidLimit, country: storefront });
      totalAttempted += andRes.attempted;
      totalSucceeded += andRes.succeeded;
      totalFailed += andRes.failed;

      // 3. Run iOS Collection
      const iosRes = await this.iosCollector.collectAll({ limit: iosLimit, storefront });
      totalAttempted += iosRes.attempted;
      totalSucceeded += iosRes.succeeded;
      totalFailed += iosRes.failed;

      this.repo.finishAuditLog(auditId, {
        status: totalFailed > 0 ? 'PARTIAL' : 'SUCCESS',
        attempted: totalAttempted,
        succeeded: totalSucceeded,
        failed: totalFailed
      });

      console.log('=== FULL COLLECTION CYCLE COMPLETED ===\n');
      return { status: totalFailed > 0 ? 'PARTIAL' : 'SUCCESS', totalAttempted, totalSucceeded, totalFailed };
    } catch (err) {
      console.error('[Scheduler] Fatal error during collection cycle:', err);
      this.repo.finishAuditLog(auditId, {
        status: 'FAILED',
        attempted: totalAttempted,
        succeeded: totalSucceeded,
        failed: totalFailed,
        errorSummary: err.message
      });
      throw err;
    }
  }
}

module.exports = CollectionScheduler;
