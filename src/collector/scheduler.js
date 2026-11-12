const Repository = require('../storage/repository');
const AndroidCollector = require('./android_collector');
const IosCollector = require('./ios_collector');
const StoreSweeper = require('../catalog/store_sweeper');
const SeedImporter = require('../catalog/seed_importer');

class CollectionScheduler {
  constructor(repo = null) {
    this.repo = repo || new Repository();
    this.androidCollector = new AndroidCollector(this.repo);
    this.iosCollector = new IosCollector(this.repo);
    this.sweeper = new StoreSweeper(this.repo);
    this.seedImporter = new SeedImporter(this.repo);
  }

  async runFullCycle({ androidLimit = 50, iosLimit = 100 } = {}) {
    console.log('=== STARTING TRENDLAB FULL COLLECTION CYCLE ===');
    const auditId = this.repo.startAuditLog('FULL_COLLECTION_CYCLE');

    let totalAttempted = 0;
    let totalSucceeded = 0;
    let totalFailed = 0;

    try {
      // 1. Ensure seeds exist
      const existingApps = this.repo.getPlatformApps({ limit: 10 });
      if (existingApps.length === 0) {
        console.log('[Scheduler] No apps found in catalog. Initializing seeds...');
        this.seedImporter.importCuratedSeeds();
      }

      // 2. Run Android Collection
      const andRes = await this.androidCollector.collectAll({ limit: androidLimit });
      totalAttempted += andRes.attempted;
      totalSucceeded += andRes.succeeded;
      totalFailed += andRes.failed;

      // 3. Run iOS Collection
      const iosRes = await this.iosCollector.collectAll({ limit: iosLimit, storefront: 'us' });
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
      return { status: 'SUCCESS', totalAttempted, totalSucceeded, totalFailed };
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
