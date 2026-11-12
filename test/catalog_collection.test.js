const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const BulkCatalogImporter = require('../src/catalog/bulk_importer');
const Repository = require('../src/storage/repository');

function makeRepo() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '../src/storage/schema.sql'), 'utf8'));
  const repo = new Repository(db);
  return { db, repo };
}

test('AppGoblin TSV importer accepts official Education and rejects category substrings', async () => {
  const { db, repo } = makeRepo();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trendlab-import-'));
  const file = path.join(directory, 'sample.tsv');
  try {
    fs.writeFileSync(file, [
      'store\tstore_id\tapp_name\tapp_category\tdeveloper_id\tdeveloper_name',
      'google\tcom.test.study\tStudy\teducation\tdev-a\tStudy Inc',
      'apple\t123456789\tStudy iOS\tEducation\tdev-b\tStudy iOS Inc',
      'google\tcom.test.other\tOther\tgame_educational\tdev-c\tOther Inc',
      'google\tcom.test.study\tStudy\teducation\tdev-a\tStudy Inc',
      'something\tcom.test.unknown\tUnknown\teducation\tdev-d\tUnknown',
      'apple\tinvalid-id\tInvalid\teducation\tdev-e\tInvalid Inc',
      ''
    ].join('\n'));
    const importer = new BulkCatalogImporter(repo);
    const report = await importer.importFile(file);
    assert.equal(report.rowsRead, 6);
    assert.equal(report.educationRows, 5);
    assert.equal(report.imported, 2);
    assert.equal(report.duplicatesInFile, 1);
    assert.equal(report.invalidEducationRows, 2);
    assert.deepEqual(
      repo.getPlatformApps({ limit: 20 }).map(p => p.native_store_id).sort(),
      ['123456789', 'com.test.study']
    );
    // Reimport should not create new catalog rows.
    await importer.importFile(file);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_applications').get().n, 2);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('AppGoblin importer rejects incompatible headers explicitly', async () => {
  const { db, repo } = makeRepo();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trendlab-header-'));
  const file = path.join(directory, 'bad.tsv');
  try {
    fs.writeFileSync(file, 'foo\tbar\nfirst\tsecond\n');
    await assert.rejects(new BulkCatalogImporter(repo).importFile(file),
      /Missing required AppGoblin column/);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('due scheduling advances fairly across catalog and remembers failures', () => {
  const { db, repo } = makeRepo();
  try {
    for (let i = 0; i < 5; i++) {
      repo.upsertPlatformApp({
        platform: 'android', nativeStoreId: 'com.example.' + i,
        title: 'Example ' + i, primaryGenre: 'EDUCATION'
      });
    }
    const now = '2026-11-12T00:00:00.000Z';
    const batch1 = repo.getDuePlatformApps({ platform: 'android', limit: 2, now });
    assert.equal(batch1.length, 2);
    for (const app of batch1) {
      repo.recordCollectionAttempt({
        platformAppId: app.id, succeeded: true, observedAt: now, refreshHours: 24
      });
    }
    const batch2 = repo.getDuePlatformApps({ platform: 'android', limit: 2, now });
    assert.equal(batch2.length, 2);
    assert.ok(batch2.every(a => !batch1.some(b => a.id === b.id)));
    const failed = batch2[0];
    repo.recordCollectionAttempt({
      platformAppId: failed.id, succeeded: false,
      error: 'HTTP 429', observedAt: now, retryHours: 1
    });
    assert.equal(db.prepare(
      'SELECT consecutive_failures FROM collection_state WHERE platform_app_id = ?'
    ).get(failed.id).consecutive_failures, 1);
    assert.ok(!repo.getDuePlatformApps({ platform: 'android', limit: 10, now })
      .some(a => a.id === failed.id));
    assert.ok(repo.getDuePlatformApps({
      platform: 'android', limit: 10, now: '2026-11-12T01:00:01.000Z'
    }).some(a => a.id === failed.id));
  } finally {
    db.close();
  }
});

test('coverage reports local denominator rather than claiming whole global market', () => {
  const { db, repo } = makeRepo();
  try {
    const id = repo.upsertPlatformApp({
      platform: 'android', nativeStoreId: 'com.example.education',
      title: 'Education', primaryGenre: 'EDUCATION'
    });
    const report0 = repo.getCoverageReport();
    assert.equal(report0.byPlatform[0].catalog_apps, 1);
    assert.equal(report0.byPlatform[0].apps_with_observations, 0);
    assert.match(report0.coverageMeaning, /local catalog/);
    repo.recordObservedMetrics({
      platformAppId: id, installCounter: 100,
      observedAt: '2026-11-12T00:00:00.000Z'
    });
    const report1 = repo.getCoverageReport();
    assert.equal(report1.byPlatform[0].apps_with_observations, 1);
  } finally {
    db.close();
  }
});
