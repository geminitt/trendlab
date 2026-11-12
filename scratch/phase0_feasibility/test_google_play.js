const gplayRaw = require('google-play-scraper');
const gplay = gplayRaw.default || gplayRaw;

const testApps = [
  'com.duolingo',
  'org.khanacademy.android',
  'com.quizlet.quizletandroid',
  'com.google.android.apps.classroom',
  'com.elsaspeak',
  'com.brainly',
  'com.coursera.android',
  'org.edx.mobile',
  'com.babbel.mobile.android.en',
  'com.sololearn'
];

async function runTest() {
  console.log('=== EXPERIMENT: GOOGLE PLAY REALINSTALLS & METADATA ===');
  
  for (const appId of testApps) {
    try {
      const t0 = Date.now();
      const appUs = await gplay.app({ appId, country: 'us', lang: 'en' });
      const elapsedUs = Date.now() - t0;
      
      // Delay slightly
      await new Promise(r => setTimeout(r, 1200));
      
      const appVn = await gplay.app({ appId, country: 'vn', lang: 'en' });
      
      console.log(`\n--- App: ${appId} ---`);
      console.log(`Title: ${appUs.title}`);
      console.log(`Developer: ${appUs.developer} (Id: ${appUs.developerId})`);
      console.log(`Genre: ${appUs.genre} (GenreId: ${appUs.genreId})`);
      console.log(`Score: ${appUs.score}, Ratings: ${appUs.ratings}, Reviews: ${appUs.reviews}`);
      console.log(`[US] installs display: "${appUs.installs}"`);
      console.log(`[US] minInstalls: ${appUs.minInstalls}, maxInstalls: ${appUs.maxInstalls}`);
      console.log(`[US] realInstalls: ${appUs.realInstalls}`);
      console.log(`[VN] realInstalls: ${appVn.realInstalls}`);
      console.log(`Diff (US - VN realInstalls): ${appUs.realInstalls - appVn.realInstalls}`);
      console.log(`Updated timestamp: ${appUs.updated}`);
      console.log(`Query Latency: ${elapsedUs}ms`);
      
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      console.error(`Error querying ${appId}:`, err.message);
    }
  }
}

runTest();
