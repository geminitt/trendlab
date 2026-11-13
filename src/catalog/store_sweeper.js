const gplayRaw = require('google-play-scraper');
const gplay = gplayRaw.default || gplayRaw;
const { getAppleEducationTopFree } = require('./apple_education_feed');
const Repository = require('../storage/repository');
const config = require('../../config/default.json');
const { audit } = require('../observability/audit');

class StoreSweeper {
  constructor(repo = null, { fetchAppleChart = getAppleEducationTopFree } = {}) {
    this.repo = repo || new Repository();
    this.fetchAppleChart = fetchAppleChart;
  }

  // Sweep Vietnam App Store Education Top Free chart (Genre 6017) by default
  async sweepAppleEducationCharts(storefronts = config.catalog.surveyedStorefronts) {
    console.log(`[StoreSweeper] Sweeping Apple App Store Education Charts across ${storefronts.length} storefronts...`);
    let totalDiscovered = 0;
    audit('discovery.sweep_started', { platform: 'ios', storefronts, chart: 'TOP_FREE_EDUCATION', limit: 100 });
    for (const sf of storefronts) {
      try {
        const started = Date.now();
        console.log(`  Querying Apple Top Free Education for storefront [${sf.toUpperCase()}]...`);
        const apps = await this.fetchAppleChart(sf, config.catalog.educationGenreIdIos || 6017, 100);

        console.log(`    -> Received ${apps.length} apps from [${sf.toUpperCase()}].`);
        audit('discovery.chart_response', {
          platform: 'ios', storefront: sf, received: apps.length,
          source: 'apple-itunes-rss', elapsed_ms: Date.now() - started
        });
        // A single iOS app identity is shared by storefronts. Store chart
        // observations separately so that its country-specific rank is retained.
        const observedAt = new Date().toISOString();
        for (const [index, item] of apps.entries()) {
          if (!item.id || !item.title) continue;
          const platformAppId = this.repo.upsertPlatformApp({
            platform: 'ios',
            nativeStoreId: String(item.id),
            title: item.title,
            developerName: item.developer,
            primaryGenre: 'Education',
            storefront: 'global',
            price: item.price ?? 0
          });
          this.repo.recordObservedMetrics({
            platformAppId,
            observedAt,
            storefront: sf,
            rank: index + 1,
            rankChartType: 'TOP_FREE_EDUCATION',
            flags: JSON.stringify(['TOP_CHART_LIMITED_DISCOVERY'])
          });
          totalDiscovered++;
          audit('discovery.chart_entry', {
            platform: 'ios', storefront: sf, platform_app_id: platformAppId,
            native_store_id: String(item.id), title: item.title,
            chart: 'TOP_FREE_EDUCATION', rank: index + 1, observed_at: observedAt
          });
        }

        // Slight pause between storefront queries
        await new Promise(r => setTimeout(r, 600));
      } catch (err) {
        audit('discovery.source_error', {
          platform: 'ios', storefront: sf, source: 'apple-itunes-rss', error: err
        });
        console.warn(`    Warning on storefront ${sf}:`, err.message);
      }
    }

    console.log(`[StoreSweeper] Apple sweep completed: ${totalDiscovered} total app-storefront mappings registered.`);
    audit('discovery.sweep_finished', {
      platform: 'ios', storefronts, chart: 'TOP_FREE_EDUCATION', stored: totalDiscovered
    });
    return totalDiscovered;
  }

  // Sweep Google Play Top Free Education + Search Facets
  async sweepGooglePlayEducationCharts(countries = config.catalog.surveyedStorefronts || ['vn']) {
    console.log(`[StoreSweeper] Sweeping Google Play Education Apps...`);
    let totalDiscovered = 0;
    audit('discovery.sweep_started', {
      platform: 'android', storefronts: countries, chart: 'TOP_FREE_EDUCATION', limit: 100
    });

    // Top chart discovery is capped and country-specific; it is never market coverage.
    for (const country of countries) {
      try {
        const started = Date.now();
        const apps = await gplay.list({
          category: gplay.category.EDUCATION,
          collection: gplay.collection.TOP_FREE,
          num: 100,
          country
        });
        console.log(`  Google Play Top Free Education [${country}]: ${apps.length} rows`);
        audit('discovery.chart_response', {
          platform: 'android', storefront: country, received: apps.length,
          source: 'google-play-scraper', elapsed_ms: Date.now() - started
        });
        const observedAt = new Date().toISOString();
        for (const [index, item] of apps.entries()) {
          if (!item.appId || !item.title) continue;
          const platformAppId = this.repo.upsertPlatformApp({
            platform: 'android',
            nativeStoreId: item.appId,
            title: item.title,
            developerName: item.developer,
            developerId: item.developerId,
            primaryGenre: 'EDUCATION',
            storefront: 'global',
            price: item.price ?? 0
          });
          this.repo.recordObservedMetrics({
            platformAppId,
            observedAt,
            storefront: country,
            rank: index + 1,
            rankChartType: 'TOP_FREE_EDUCATION',
            flags: JSON.stringify(['TOP_CHART_LIMITED_DISCOVERY'])
          });
          totalDiscovered++;
          audit('discovery.chart_entry', {
            platform: 'android', storefront: country, platform_app_id: platformAppId,
            native_store_id: String(item.appId), title: item.title,
            chart: 'TOP_FREE_EDUCATION', rank: index + 1, observed_at: observedAt
          });
        }
      } catch (err) {
        audit('discovery.source_error', {
          platform: 'android', storefront: country, source: 'google-play-scraper', error: err
        });
        console.warn(`  Google Play chart failed [${country}]:`, err.message);
      }
      await new Promise(r => setTimeout(r, 1200));
    }

    // Keyword-based discovery is intentionally removed: a few English terms
    // cannot represent the worldwide official Education category.

    console.log(`[StoreSweeper] Google Play sweep completed: ${totalDiscovered} apps registered.`);
    audit('discovery.sweep_finished', {
      platform: 'android', storefronts: countries, chart: 'TOP_FREE_EDUCATION', stored: totalDiscovered
    });
    return totalDiscovered;
  }
}

module.exports = StoreSweeper;
