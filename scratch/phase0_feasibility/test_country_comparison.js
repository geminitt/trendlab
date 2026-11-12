const gplayRaw = require('google-play-scraper');
const gplay = gplayRaw.default || gplayRaw;

const testPackages = [
  'com.duolingo',
  'org.khanacademy.android',
  'com.quizlet.quizletandroid',
  'vn.elsa',
  'co.brainly',
  'org.coursera.android'
];

async function compareCountries() {
  console.log('=== EXPERIMENT: COMPARING maxInstalls ACROSS STOREFRONTS (US, VN, IN, DE) ===\n');
  
  for (const appId of testPackages) {
    try {
      const us = await gplay.app({ appId, country: 'us' });
      await new Promise(r => setTimeout(r, 800));
      const vn = await gplay.app({ appId, country: 'vn' });
      await new Promise(r => setTimeout(r, 800));
      const in_c = await gplay.app({ appId, country: 'in' });
      await new Promise(r => setTimeout(r, 800));
      const de = await gplay.app({ appId, country: 'de' });
      
      console.log(`App: ${appId} ("${us.title}")`);
      console.log(`  US: min=${us.minInstalls}, max=${us.maxInstalls}, display="${us.installs}", ratings=${us.ratings}`);
      console.log(`  VN: min=${vn.minInstalls}, max=${vn.maxInstalls}, display="${vn.installs}", ratings=${vn.ratings}`);
      console.log(`  IN: min=${in_c.minInstalls}, max=${in_c.maxInstalls}, display="${in_c.installs}", ratings=${in_c.ratings}`);
      console.log(`  DE: min=${de.minInstalls}, max=${de.maxInstalls}, display="${de.installs}", ratings=${de.ratings}`);
      
      const isIdenticalInstalls = (us.maxInstalls === vn.maxInstalls) && (vn.maxInstalls === in_c.maxInstalls) && (in_c.maxInstalls === de.maxInstalls);
      const isIdenticalRatings = (us.ratings === vn.ratings) && (vn.ratings === in_c.ratings) && (in_c.ratings === de.ratings);
      
      console.log(`  => maxInstalls identical across all 4 countries? ${isIdenticalInstalls}`);
      console.log(`  => ratings identical across all 4 countries? ${isIdenticalRatings}\n`);
      
      await new Promise(r => setTimeout(r, 1200));
    } catch (err) {
      console.error(`Error for ${appId}:`, err.message);
    }
  }
}

compareCountries();
