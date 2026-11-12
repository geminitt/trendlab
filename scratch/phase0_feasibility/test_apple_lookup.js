const https = require('https');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${data.slice(0, 100)}`));
        }
      });
    }).on('error', reject);
  });
}

async function testAppleBatchLookup() {
  console.log('=== EXPERIMENT: APPLE ITUNES LOOKUP API BATCHING ===\n');

  // Step 1: Get 100 app IDs from Apple RSS Feed
  const rssUrl = 'https://rss.marketingtools.apple.com/api/v2/us/apps/top-free/100/apps.json';
  console.log(`1. Fetching Top 100 Apps from Apple RSS: ${rssUrl}`);
  const rssData = await fetchJson(rssUrl);
  const appIds = rssData.feed.results.map(r => r.id);
  console.log(`   Retrieved ${appIds.length} app IDs from RSS feed.`);

  // Step 2: Test Batch sizes [10, 50, 100, 200]
  const testBatchSizes = [10, 50, 100];
  
  for (const size of testBatchSizes) {
    const batch = appIds.slice(0, size);
    const lookupUrl = `https://itunes.apple.com/lookup?id=${batch.join(',')}&country=us`;
    
    console.log(`\n2. Testing Lookup with Batch Size = ${size}`);
    const t0 = Date.now();
    const result = await fetchJson(lookupUrl);
    const elapsed = Date.now() - t0;
    
    console.log(`   Latency: ${elapsed}ms`);
    console.log(`   Requested IDs: ${size}, Returned Results: ${result.resultCount}`);
    
    if (result.results && result.results.length > 0) {
      const sample = result.results[0];
      console.log(`   Sample App Fields:`);
      console.log(`     trackId: ${sample.trackId}`);
      console.log(`     trackName: "${sample.trackName}"`);
      console.log(`     artistName: "${sample.artistName}"`);
      console.log(`     bundleId: "${sample.bundleId}"`);
      console.log(`     primaryGenreId: ${sample.primaryGenreId} ("${sample.primaryGenreName}")`);
      console.log(`     genres: ${JSON.stringify(sample.genres)}`);
      console.log(`     userRatingCount: ${sample.userRatingCount}`);
      console.log(`     averageUserRating: ${sample.averageUserRating}`);
      console.log(`     version: "${sample.version}"`);
      console.log(`     currentVersionReleaseDate: "${sample.currentVersionReleaseDate}"`);
    }
  }

  // Step 3: Test Storefront difference in iTunes Lookup
  console.log('\n3. Testing Storefront Difference for a single App (US vs VN vs GB)');
  const testId = appIds[3]; // e.g., ChatGPT or TikTok
  const usLookup = await fetchJson(`https://itunes.apple.com/lookup?id=${testId}&country=us`);
  const vnLookup = await fetchJson(`https://itunes.apple.com/lookup?id=${testId}&country=vn`);
  const gbLookup = await fetchJson(`https://itunes.apple.com/lookup?id=${testId}&country=gb`);

  const usApp = usLookup.results[0];
  const vnApp = vnLookup.results[0];
  const gbApp = gbLookup.results[0];

  console.log(`App: "${usApp.trackName}" (ID: ${testId})`);
  console.log(`  US Storefront: userRatingCount = ${usApp.userRatingCount}, avgRating = ${usApp.averageUserRating}`);
  console.log(`  VN Storefront: userRatingCount = ${vnApp ? vnApp.userRatingCount : 'N/A'}, avgRating = ${vnApp ? vnApp.averageUserRating : 'N/A'}`);
  console.log(`  GB Storefront: userRatingCount = ${gbApp ? gbApp.userRatingCount : 'N/A'}, avgRating = ${gbApp ? gbApp.averageUserRating : 'N/A'}`);
  console.log(`  => Are iOS ratings storefront-specific? ${usApp.userRatingCount !== (vnApp && vnApp.userRatingCount)}`);
}

testAppleBatchLookup().catch(console.error);
