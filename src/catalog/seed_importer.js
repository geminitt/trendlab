const fs = require('node:fs');
const https = require('node:https');
const { spawn } = require('node:child_process');
const Repository = require('../storage/repository');

// Curated seed list of high-diversity Global Education apps
// Covers established leaders, emerging AI tools, language apps, STEM, and regional educators
const CURATED_EDUCATION_SEEDS = [
  // Android
  { platform: 'android', nativeStoreId: 'com.duolingo', title: 'Duolingo: Learn Languages', primaryGenre: 'EDUCATION' },
  { platform: 'android', nativeStoreId: 'org.khanacademy.android', title: 'Khan Academy', primaryGenre: 'EDUCATION' },
  { platform: 'android', nativeStoreId: 'com.quizlet.quizletandroid', title: 'Quizlet: More than Flashcards', primaryGenre: 'EDUCATION' },
  { platform: 'android', nativeStoreId: 'com.google.android.apps.classroom', title: 'Google Classroom', primaryGenre: 'EDUCATION' },
  { platform: 'android', nativeStoreId: 'co.brainly', title: 'Brainly: AI Homework Helper', primaryGenre: 'EDUCATION' },
  { platform: 'android', nativeStoreId: 'org.coursera.android', title: 'Coursera: Grow your career', primaryGenre: 'EDUCATION' },
  { platform: 'android', nativeStoreId: 'org.edx.mobile', title: 'edX online learning', primaryGenre: 'EDUCATION' },
  { platform: 'android', nativeStoreId: 'com.babbel.mobile.android.en', title: 'Babbel - Learn Languages', primaryGenre: 'EDUCATION' },
  { platform: 'android', nativeStoreId: 'com.sololearn', title: 'Sololearn: Learn Python & Code', primaryGenre: 'EDUCATION' },
  { platform: 'android', nativeStoreId: 'com.mimo.android', title: 'Mimo: Learn to Code', primaryGenre: 'EDUCATION' },
  { platform: 'android', nativeStoreId: 'com.busuu.android.enc', title: 'Busuu: Learn Languages', primaryGenre: 'EDUCATION' },
  { platform: 'android', nativeStoreId: 'com.photomath.android', title: 'Photomath', primaryGenre: 'EDUCATION' },
  { platform: 'android', nativeStoreId: 'com.brilliant.android', title: 'Brilliant: Learn STEM', primaryGenre: 'EDUCATION' },
  { platform: 'android', nativeStoreId: 'com.memrise.android.memrisecompanion', title: 'Memrise Easy Language Learning', primaryGenre: 'EDUCATION' },
  { platform: 'android', nativeStoreId: 'com.remind101', title: 'Remind: School Communication', primaryGenre: 'EDUCATION' },
  { platform: 'android', nativeStoreId: 'com.lingodeer', title: 'LingoDeer - Learn Languages', primaryGenre: 'EDUCATION' },
  { platform: 'android', nativeStoreId: 'com.lingokids.learning', title: 'Lingokids - Play and Learn', primaryGenre: 'EDUCATION' },
  { platform: 'android', nativeStoreId: 'com.kahoot.android', title: 'Kahoot! Play & Create Quizzes', primaryGenre: 'EDUCATION' },
  { platform: 'android', nativeStoreId: 'com.mathway.android', title: 'Mathway: Math Problem Solver', primaryGenre: 'EDUCATION' },
  { platform: 'android', nativeStoreId: 'com.chegg', title: 'Chegg Study - Homework Help', primaryGenre: 'EDUCATION' },

  // iOS (Adam IDs)
  { platform: 'ios', nativeStoreId: '570060128', title: 'Duolingo: Learn Languages', primaryGenre: 'Education' },
  { platform: 'ios', nativeStoreId: '546512042', title: 'Quizlet: More than Flashcards', primaryGenre: 'Education' },
  { platform: 'ios', nativeStoreId: '924620140', title: 'Google Classroom', primaryGenre: 'Education' },
  { platform: 'ios', nativeStoreId: '469337564', title: 'Khan Academy', primaryGenre: 'Education' },
  { platform: 'ios', nativeStoreId: '919450302', title: 'Photomath', primaryGenre: 'Education' },
  { platform: 'ios', nativeStoreId: '664538396', title: 'Brainly: AI Homework Helper', primaryGenre: 'Education' },
  { platform: 'ios', nativeStoreId: '733682246', title: 'Coursera: Learn career skills', primaryGenre: 'Education' },
  { platform: 'ios', nativeStoreId: '883324060', title: 'edX: Courses by Harvard & MIT', primaryGenre: 'Education' },
  { platform: 'ios', nativeStoreId: '1133960732', title: 'Mimo: Learn to Code & AI', primaryGenre: 'Education' },
  { platform: 'ios', nativeStoreId: '6478287397', title: 'Learna: Speak & Learn English', primaryGenre: 'Education' },
  { platform: 'ios', nativeStoreId: '1445023295', title: 'Deepstash: Smarter Every Day!', primaryGenre: 'Education' },
  { platform: 'ios', nativeStoreId: '1448464007', title: 'vnEdu Connect', primaryGenre: 'Education' },
  { platform: 'ios', nativeStoreId: '715394226', title: 'Ôn thi GPLX 2026 - 600 Câu', primaryGenre: 'Education' },
  { platform: 'ios', nativeStoreId: '6740868842', title: 'Ôn thi GPLX 2026', primaryGenre: 'Education' },
  { platform: 'ios', nativeStoreId: '1035541295', title: 'Kahoot! Play & Create Quizzes', primaryGenre: 'Education' },
  { platform: 'ios', nativeStoreId: '900353109', title: 'Brilliant: Learn STEM', primaryGenre: 'Education' },
  { platform: 'ios', nativeStoreId: '1001429933', title: 'Remind: School Communication', primaryGenre: 'Education' },
  { platform: 'ios', nativeStoreId: '379693831', title: 'Babbel - Learn Languages', primaryGenre: 'Education' },
  { platform: 'ios', nativeStoreId: '479516143', title: 'Busuu: Language Learning', primaryGenre: 'Education' },
  { platform: 'ios', nativeStoreId: '6480372438', title: 'SMMS Mobile App', primaryGenre: 'Education' }
];

class SeedImporter {
  constructor(repo = null) {
    this.repo = repo || new Repository();
  }

  importCuratedSeeds() {
    console.log(`[SeedImporter] Importing ${CURATED_EDUCATION_SEEDS.length} curated global Education apps...`);
    let count = 0;
    for (const app of CURATED_EDUCATION_SEEDS) {
      this.repo.upsertPlatformApp({
        platform: app.platform,
        nativeStoreId: app.nativeStoreId,
        title: app.title,
        primaryGenre: app.primaryGenre,
        storefront: app.platform === 'ios' ? 'us' : 'global'
      });
      count++;
    }
    console.log(`[SeedImporter] Successfully imported ${count} seed apps.`);
    return count;
  }

  // Stream-based importer for AppGoblin TSV dump
  async importFromAppGoblinStream(maxApps = 200) {
    console.log(`[SeedImporter] Streaming Education apps from AppGoblin dump (limit: ${maxApps})...`);
    const dumpUrl = 'https://raw.githubusercontent.com/ddxv/appgoblin-data/main/data/live_store_apps.tsv.xz';

    return new Promise((resolve, reject) => {
      https.get(dumpUrl, (res) => {
        if (res.statusCode !== 200) {
          return reject(new Error(`Failed to fetch AppGoblin dump: HTTP ${res.statusCode}`));
        }

        const xz = spawn('xzcat', []);
        res.pipe(xz.stdin);

        let buffer = '';
        let count = 0;
        let isHeader = true;

        xz.stdout.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop(); // keep last incomplete line

          for (const line of lines) {
            if (isHeader) {
              isHeader = false;
              continue;
            }

            const parts = line.split('\t');
            if (parts.length >= 5) {
              const [store, storeId, appName, devId, category] = parts;
              if (category && category.toLowerCase().includes('education')) {
                const platform = store.toLowerCase().includes('google') ? 'android' : 'ios';
                this.repo.upsertPlatformApp({
                  platform,
                  nativeStoreId: storeId,
                  title: appName || 'Unknown Education App',
                  developerId: devId,
                  primaryGenre: 'Education',
                  storefront: platform === 'ios' ? 'us' : 'global'
                });
                count++;
                if (count >= maxApps) {
                  xz.kill();
                  res.destroy();
                  return resolve(count);
                }
              }
            }
          }
        });

        xz.on('close', () => resolve(count));
        xz.on('error', reject);
        res.on('error', reject);
      });
    });
  }
}

module.exports = SeedImporter;
