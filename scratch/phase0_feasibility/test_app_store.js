const storeRaw = require('app-store-scraper');
const store = storeRaw.default || storeRaw;

async function testAppStoreScraper() {
  console.log('=== EXPERIMENT: APP-STORE-SCRAPER & CATEGORY RANKINGS ===\n');

  try {
    // Test 1: Fetch Top Free in Education category (genre 6017) in US
    console.log('1. Fetching Top Free in Category 6017 (Education) in US...');
    const t0 = Date.now();
    const listUs = await store.list({
      category: 6017, // Education
      collection: store.collection.TOP_FREE_IOS || store.collection.TOP_FREE,
      num: 25,
      country: 'us'
    });
    console.log(`   Fetched ${listUs.length} apps in ${Date.now() - t0}ms`);
    if (listUs.length > 0) {
      console.log('   Top 3 US Education Apps:');
      listUs.slice(0, 3).forEach((app, idx) => {
        console.log(`     #${idx + 1}: ${app.title} (ID: ${app.id}, Developer: ${app.developer}, Score: ${app.score})`);
      });
    }

    // Test 2: Fetch Top Free in Education in VN
    console.log('\n2. Fetching Top Free in Category 6017 (Education) in VN...');
    const listVn = await store.list({
      category: 6017,
      collection: store.collection.TOP_FREE_IOS || store.collection.TOP_FREE,
      num: 25,
      country: 'vn'
    });
    console.log(`   Fetched ${listVn.length} apps`);
    if (listVn.length > 0) {
      console.log('   Top 3 VN Education Apps:');
      listVn.slice(0, 3).forEach((app, idx) => {
        console.log(`     #${idx + 1}: ${app.title} (ID: ${app.id}, Developer: ${app.developer}, Score: ${app.score})`);
      });
    }

    // Test 3: Check app details with granular ratings
    const sampleId = listUs[0].id;
    console.log(`\n3. Fetching App Details + Ratings Histogram for App ID ${sampleId} ("${listUs[0].title}")...`);
    const appDetail = await store.app({ id: sampleId, ratings: true, country: 'us' });
    console.log(`   Title: ${appDetail.title}`);
    console.log(`   Score: ${appDetail.score}`);
    console.log(`   Reviews / Ratings Count: ${appDetail.reviews}`);
    console.log(`   Ratings Histogram:`, appDetail.ratings);
    console.log(`   Primary Genre: ${appDetail.primaryGenre} (ID: ${appDetail.primaryGenreId})`);
    console.log(`   Genres:`, appDetail.genres);

  } catch (err) {
    console.error('Error in App Store Scraper:', err);
  }
}

testAppStoreScraper();
