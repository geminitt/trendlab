const gplayRaw = require('google-play-scraper');
const gplay = gplayRaw.default || gplayRaw;
const Repository = require('../storage/repository');
const config = require('../../config/default.json');

class AndroidCollector {
  constructor(repo = null) {
    this.repo = repo || new Repository();
  }

  async collectApp(platformApp) {
    const appId = platformApp.native_store_id;
    const t0 = Date.now();

    try {
      const result = await gplay.app({ appId, country: 'us', lang: 'en' });
      const observedAt = new Date().toISOString();

      // 1. Save immutable raw snapshot
      this.repo.saveRawSnapshot({
        platformAppId: platformApp.id,
        sourceName: 'google-play-scraper',
        fetchMethod: 'WEB_INTERNAL_PARSE',
        rawPayload: result,
        sourceUpdatedAt: result.updated ? new Date(result.updated).toISOString() : null,
        observedAt
      });

      // 2. Record observed numeric metric series
      // Use maxInstalls as verified in Phase 0 Feasibility
      const installCounter = typeof result.maxInstalls === 'number' ? result.maxInstalls : null;
      const flags = [];
      if (!installCounter && result.minInstalls) {
        flags.push('FALLBACK_MIN_INSTALLS');
      }

      this.repo.recordObservedMetrics({
        platformAppId: platformApp.id,
        observedAt,
        installCounter: installCounter || result.minInstalls || null,
        ratingCount: result.ratings || null,
        reviewCount: result.reviews || null,
        ratingScore: result.score || null,
        storefront: 'global',
        flags: JSON.stringify(flags)
      });

      // 3. Update app metadata
      this.repo.upsertPlatformApp({
        id: platformApp.id,
        platform: 'android',
        nativeStoreId: appId,
        title: result.title || platformApp.title,
        developerId: result.developerId,
        developerName: result.developer,
        primaryGenre: result.genreId || 'EDUCATION',
        genresJson: JSON.stringify([result.genre]),
        price: result.price || 0.0,
        currency: result.currency || 'USD'
      });

      return { success: true, appId, latency: Date.now() - t0 };
    } catch (err) {
      if (err.message && err.message.includes('404')) {
        return { success: false, appId, error: 'DELISTED_OR_NOT_FOUND', latency: Date.now() - t0 };
      }
      return { success: false, appId, error: err.message, latency: Date.now() - t0 };
    }
  }

  async collectAll({ limit = 100 } = {}) {
    const apps = this.repo.getPlatformApps({ platform: 'android', limit });
    console.log(`[AndroidCollector] Starting collection for ${apps.length} Android apps...`);

    let succeeded = 0;
    let failed = 0;
    const baseDelay = config.collector.android.requestDelayMs || 1500;
    const jitter = config.collector.android.randomJitterMs || 500;

    for (let i = 0; i < apps.length; i++) {
      const app = apps[i];
      const res = await this.collectApp(app);

      if (res.success) {
        succeeded++;
        console.log(`  [${i + 1}/${apps.length}] ${app.title} (${res.appId}) -> OK (${res.latency}ms)`);
      } else {
        failed++;
        console.warn(`  [${i + 1}/${apps.length}] ${app.title} (${res.appId}) -> FAILED: ${res.error}`);
      }

      // Respect rate-limiting with random jitter
      const delay = baseDelay + Math.floor(Math.random() * jitter);
      await new Promise(r => setTimeout(r, delay));
    }

    console.log(`[AndroidCollector] Finished: ${succeeded} succeeded, ${failed} failed.`);
    return { attempted: apps.length, succeeded, failed };
  }
}

module.exports = AndroidCollector;
