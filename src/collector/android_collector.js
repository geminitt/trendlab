const gplayRaw = require('google-play-scraper');
const gplay = gplayRaw.default || gplayRaw;
const Repository = require('../storage/repository');
const config = require('../../config/default.json');

class AndroidCollector {
  constructor(repo = null) {
    this.repo = repo || new Repository();
  }

  async collectApp(platformApp, country = config.collector.android.country || 'vn') {
    const appId = platformApp.native_store_id;
    const t0 = Date.now();

    try {
      const result = await gplay.app({ appId, country, lang: country === 'vn' ? 'vi' : 'en' });
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
      // google-play-scraper may expose a detailed maxInstalls counter;
      // minInstalls is only a rounded install threshold, NOT a valid fallback.
      const installCounter = Number.isSafeInteger(result.maxInstalls) && result.maxInstalls >= 0
        ? result.maxInstalls : null;
      const flags = ['INSTALL_COUNTER_SEMANTICS_UNVERIFIED'];
      if (installCounter === null) flags.push('INSTALL_COUNTER_MISSING');

      this.repo.recordObservedMetrics({
        platformAppId: platformApp.id,
        observedAt,
        installCounter,
        ratingCount: result.ratings ?? null,
        reviewCount: result.reviews ?? null,
        ratingScore: result.score ?? null,
        storefront: country,
        flags: JSON.stringify([...flags, 'SOURCE_COUNTER_NOT_VN_SPECIFIC'])
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
        return { success: false, appId, error: 'NOT_AVAILABLE_IN_' + country.toUpperCase() + '_OR_UNLISTED', latency: Date.now() - t0 };
      }
      return { success: false, appId, error: err.message, latency: Date.now() - t0 };
    }
  }

  async collectAll({ limit = 100, country = config.collector.android.country || 'vn' } = {}) {
    const apps = country === (config.catalog.researchMarket || 'vn')
      ? this.repo.getDueMarketApps({ platform: 'android', storefront: country, limit,
        explorationShare: config.collector.marketExplorationShare ?? 0.2 })
      : this.repo.getDuePlatformApps({ platform: 'android', storefront: country, limit });
    console.log(`[AndroidCollector] Starting collection for ${apps.length} Android apps...`);

    let succeeded = 0;
    let failed = 0;
    let attempted = 0;
    let consecutiveRateLimits = 0;
    let systemicFailures = 0;
    const baseDelay = config.collector.android.requestDelayMs || 1500;
    const jitter = config.collector.android.randomJitterMs || 500;

    for (let i = 0; i < apps.length; i++) {
      const app = apps[i];
      const res = await this.collectApp(app, country);
      attempted++;

      this.repo.recordCollectionAttempt({
        platformAppId: app.id, storefront: country,
        succeeded: res.success, error: res.error,
        retryHours: !res.success && /^NOT_AVAILABLE_IN_/.test(String(res.error)) ?
          (config.collector.regionNotFoundRetryHours ?? 168) : 1,
        maxRetryHours: 720,
        refreshHours: config.collector.android.refreshHours ?? 24
      });

      if (res.success) {
        consecutiveRateLimits = 0;
        succeeded++;
        console.log(`  [${i + 1}/${apps.length}] ${app.title} (${res.appId}) -> OK (${res.latency}ms)`);
      } else {
        failed++;
        if (!/^NOT_AVAILABLE_IN_/.test(String(res.error))) systemicFailures++;
        consecutiveRateLimits = /(?:429|rate.?limit|too many requests)/i.test(String(res.error)) ?
          consecutiveRateLimits + 1 : 0;
        console.warn(`  [${i + 1}/${apps.length}] ${app.title} (${res.appId}) -> FAILED: ${res.error}`);
        if (consecutiveRateLimits >= (config.collector.android.maxConsecutiveErrors ?? 5)) {
          console.warn('[AndroidCollector] Halting batch after repeated rate-limit responses.');
          break;
        }
      }

      // Respect rate-limiting with random jitter
      if (i < apps.length - 1) {
        const delay = baseDelay + Math.floor(Math.random() * jitter);
        await new Promise(r => setTimeout(r, delay));
      }
    }

    console.log(`[AndroidCollector] Finished: ${succeeded} succeeded, ${failed} failed.`);
    return { attempted, succeeded, failed, systemicFailures };
  }
}

module.exports = AndroidCollector;
