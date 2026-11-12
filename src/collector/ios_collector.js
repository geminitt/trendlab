const https = require('node:https');
const Repository = require('../storage/repository');
const config = require('../../config/default.json');

function fetchJson(url, userAgent) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': userAgent } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('Apple Lookup HTTP ' + res.statusCode));
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON response: ${data.slice(0, 100)}`));
        }
      });
    }).on('error', reject);
    request.setTimeout(15000, () => request.destroy(new Error('Apple Lookup timeout')));
  });
}

class IosCollector {
  constructor(repo = null) {
    this.repo = repo || new Repository();
  }

  async collectBatch(apps, storefront = 'us') {
    if (!apps || apps.length === 0) return { succeeded: 0, failed: 0 };

    const ids = apps.map(a => a.native_store_id).join(',');
    const url = `https://itunes.apple.com/lookup?id=${ids}&country=${storefront}`;
    const userAgent = config.collector.ios.userAgent || 'TrendLab/1.0';
    const t0 = Date.now();

    try {
      const payload = await fetchJson(url, userAgent);
      const observedAt = new Date().toISOString();
      const resultMap = new Map();

      if (payload.results && Array.isArray(payload.results)) {
        for (const item of payload.results) {
          resultMap.set(String(item.trackId), item);
        }
      }

      let succeeded = 0;
      let failed = 0;

      for (const app of apps) {
        const item = resultMap.get(String(app.native_store_id));
        if (item) {
          if (String(item.primaryGenreId) !== '6017') {
            // The listing can change category. Do not mislabel a non-Education app.
            failed++;
            this.repo.recordCollectionAttempt({
              platformAppId: app.id, storefront, succeeded: false,
              error: 'NOT_EDUCATION',
              retryHours: 24
            });
            continue;
          }
          succeeded++;
          // 1. Save raw snapshot
          this.repo.saveRawSnapshot({
            platformAppId: app.id,
            sourceName: 'itunes-lookup',
            fetchMethod: 'BATCH_API',
            rawPayload: item,
            sourceUpdatedAt: item.currentVersionReleaseDate || null,
            observedAt
          });

          // 2. Record observed numeric metrics
          this.repo.recordObservedMetrics({
            platformAppId: app.id,
            observedAt,
            installCounter: null, // Apple does not disclose installs
            ratingCount: item.userRatingCount ?? null,
            reviewCount: null,
            ratingScore: item.averageUserRating ?? null,
            storefront,
            flags: '[]'
          });

          // 3. Update app metadata
          this.repo.upsertPlatformApp({
            id: app.id,
            platform: 'ios',
            nativeStoreId: String(item.trackId),
            storefront: app.storefront || storefront,
            title: item.trackName || app.title,
            developerId: String(item.artistId || ''),
            developerName: item.artistName || '',
            primaryGenre: item.primaryGenreName || 'Education',
            genresJson: JSON.stringify(item.genres || []),
            price: item.price || 0.0,
            currency: item.currency || 'USD'
          });
          this.repo.recordCollectionAttempt({
            platformAppId: app.id, storefront, succeeded: true,
            refreshHours: config.collector.ios.refreshHours ?? 24
          });
        } else {
          failed++;
          this.repo.recordCollectionAttempt({
            platformAppId: app.id, storefront, succeeded: false,
            error: 'NOT_FOUND_IN_STOREFRONT'
          });
        }
      }

      console.log(`  [IosCollector] Batch lookup ${apps.length} apps -> ${succeeded} updated, ${failed} missing (${Date.now() - t0}ms)`);
      return { succeeded, failed };
    } catch (err) {
      console.error(`  [IosCollector] Batch failed:`, err.message);
      for (const app of apps) {
        this.repo.recordCollectionAttempt({
          platformAppId: app.id, storefront, succeeded: false, error: err.message
        });
      }
      return { succeeded: 0, failed: apps.length, error: err.message };
    }
  }

  async collectAll({ limit = 200, storefront = 'us' } = {}) {
    const apps = this.repo.getDuePlatformApps({ platform: 'ios', storefront, limit });
    console.log(`[IosCollector] Starting batch collection for ${apps.length} iOS apps (Storefront: ${storefront.toUpperCase()})...`);

    const batchSize = config.collector.ios.lookupBatchSize || 50;
    let totalSucceeded = 0;
    let totalFailed = 0;

    for (let i = 0; i < apps.length; i += batchSize) {
      const chunk = apps.slice(i, i + batchSize);
      const res = await this.collectBatch(chunk, storefront);
      totalSucceeded += res.succeeded;
      totalFailed += res.failed;

      // Rate limit delay between batches
      if (i + batchSize < apps.length) {
        const delay = (config.collector.ios.requestDelayMs || 3500) +
          Math.floor(Math.random() * (config.collector.ios.randomJitterMs || 300));
        await new Promise(r => setTimeout(r, delay));
      }
    }

    console.log(`[IosCollector] Finished: ${totalSucceeded} succeeded, ${totalFailed} failed.`);
    return { attempted: apps.length, succeeded: totalSucceeded, failed: totalFailed };
  }
}

module.exports = IosCollector;
