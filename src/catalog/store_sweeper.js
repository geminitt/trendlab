const gplayRaw = require('google-play-scraper');
const gplay = gplayRaw.default || gplayRaw;
const storeRaw = require('app-store-scraper');
const store = storeRaw.default || storeRaw;
const Repository = require('../storage/repository');
const config = require('../../config/default.json');

class StoreSweeper {
  constructor(repo = null) {
    this.repo = repo || new Repository();
  }

  // Sweep Apple App Store Top Free/Paid in Education (Genre 6017) across global storefronts
  async sweepAppleEducationCharts(storefronts = ['us', 'vn', 'gb', 'de', 'jp', 'in', 'ca', 'au', 'fr']) {
    console.log(`[StoreSweeper] Sweeping Apple App Store Education Charts across ${storefronts.length} storefronts...`);
    let totalDiscovered = 0;

    for (const sf of storefronts) {
      try {
        console.log(`  Querying Apple Top Free Education for storefront [${sf.toUpperCase()}]...`);
        const apps = await store.list({
          category: config.catalog.educationGenreIdIos || 6017,
          collection: store.collection.TOP_FREE_IOS || store.collection.TOP_FREE,
          num: 100, // fetch up to 100 per storefront
          country: sf
        });

        console.log(`    -> Received ${apps.length} apps from [${sf.toUpperCase()}].`);
        for (const item of apps) {
          this.repo.upsertPlatformApp({
            platform: 'ios',
            nativeStoreId: String(item.id),
            title: item.title,
            developerName: item.developer,
            primaryGenre: 'Education',
            storefront: sf,
            price: item.price || 0.0
          });
          totalDiscovered++;
        }

        // Slight pause between storefront queries
        await new Promise(r => setTimeout(r, 600));
      } catch (err) {
        console.warn(`    Warning on storefront ${sf}:`, err.message);
      }
    }

    console.log(`[StoreSweeper] Apple sweep completed: ${totalDiscovered} total app-storefront mappings registered.`);
    return totalDiscovered;
  }

  // Sweep Google Play Top Free Education + Search Facets
  async sweepGooglePlayEducationCharts(countries = config.catalog.surveyedStorefronts || ['us']) {
    console.log(`[StoreSweeper] Sweeping Google Play Education Apps...`);
    let totalDiscovered = 0;

    // Top chart discovery is capped and country-specific; it is never market coverage.
    for (const country of countries) {
      try {
        const apps = await gplay.list({
          category: gplay.category.EDUCATION,
          collection: gplay.collection.TOP_FREE,
          num: 100,
          country
        });
        console.log(`  Google Play Top Free Education [${country}]: ${apps.length} rows`);
        for (const item of apps) {
          if (!item.appId || !item.title) continue;
          this.repo.upsertPlatformApp({
            platform: 'android',
            nativeStoreId: item.appId,
            title: item.title,
            developerName: item.developer,
            developerId: item.developerId,
            primaryGenre: 'EDUCATION',
            storefront: 'global',
            price: item.price || 0.0
          });
          totalDiscovered++;
        }
      } catch (err) {
        console.warn(`  Google Play chart failed [${country}]:`, err.message);
      }
      await new Promise(r => setTimeout(r, 1200));
    }

    // Keyword-based discovery is intentionally removed: a few English terms
    // cannot represent the worldwide official Education category.

    console.log(`[StoreSweeper] Google Play sweep completed: ${totalDiscovered} apps registered.`);
    return totalDiscovered;
  }
}

module.exports = StoreSweeper;
