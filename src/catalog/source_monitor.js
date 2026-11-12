'use strict';

// The GitHub-hosted AppGoblin file is an optional, versioned input, not proof
// of global market coverage. Never import a stale dump without explicit opt-in.
const fs = require('node:fs');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const crypto = require('node:crypto');
const BulkCatalogImporter = require('./bulk_importer');
const config = require('../../config/default.json');

const SOURCE_ID = 'appgoblin-github-live-education';
const FILE_NAME = 'live_store_apps.tsv.xz';
const SOURCE_URL = 'https://github.com/appgoblin-dev/appgoblin-data/blob/main/data/live_store_apps.tsv.xz';
const CONTENTS_API = 'https://api.github.com/repos/appgoblin-dev/appgoblin-data/contents/data/live_store_apps.tsv.xz?ref=main';
const COMMITS_API = 'https://api.github.com/repos/appgoblin-dev/appgoblin-data/commits?path=data/live_store_apps.tsv.xz&per_page=1';
const RAW_URL = 'https://raw.githubusercontent.com/appgoblin-dev/appgoblin-data/main/data/live_store_apps.tsv.xz';
const MAX_BYTES = 150 * 1024 * 1024;
const HEADER = { 'User-Agent': 'TrendLab-Research/1.0', Accept: 'application/vnd.github+json' };

async function jsonResponse(fetchImpl, url) {
  const response = await fetchImpl(url, { headers: HEADER, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Source metadata HTTP ' + response.status);
  return response.json();
}

async function fetchGithubSource(fetchImpl = fetch) {
  const [item, commits] = await Promise.all([
    jsonResponse(fetchImpl, CONTENTS_API),
    jsonResponse(fetchImpl, COMMITS_API)
  ]);
  const modifiedAt = commits?.[0]?.commit?.committer?.date || commits?.[0]?.commit?.author?.date;
  if (item.type !== 'file' || !item.sha || !Number.isFinite(item.size) ||
      item.size <= 0 || item.size > MAX_BYTES || !modifiedAt ||
      !Number.isFinite(Date.parse(modifiedAt))) {
    throw new Error('Source metadata missing valid SHA, size, or update date');
  }
  return { version: item.sha, size: item.size, modifiedAt, url: RAW_URL };
}

async function downloadGithubFile({ fetchImpl = fetch, url, target, maxBytes = MAX_BYTES }) {
  if (url !== RAW_URL) throw new Error('Unapproved dataset URL');
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  const temp = target + '.download-' + process.pid;
  const hash = crypto.createHash('sha256');
  let size = 0;
  try {
    const response = await fetchImpl(url, {
      headers: HEADER,
      signal: AbortSignal.timeout(10 * 60 * 1000)
    });
    if (!response.ok || !response.body) throw new Error('Dataset download HTTP ' + response.status);
    const remoteHost = new URL(response.url || url).hostname;
    if (!['raw.githubusercontent.com', 'objects.githubusercontent.com', 'github.com'].includes(remoteHost)) {
      throw new Error('Unexpected dataset download host');
    }
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length;
        if (size > maxBytes) return callback(new Error('Dataset exceeds max download size'));
        hash.update(chunk);
        callback(null, chunk);
      }
    });
    await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(temp, { flags: 'wx', mode: 0o600 }));
    if (!size) throw new Error('Empty dataset download');
    await fs.promises.rename(temp, target);
    return { file: target, bytes: size, sha256: hash.digest('hex') };
  } catch (error) {
    await fs.promises.rm(temp, { force: true });
    throw error;
  }
}

class CatalogSourceMonitor {
  constructor(repo, { metadata = fetchGithubSource, download = downloadGithubFile,
                       importer = new BulkCatalogImporter(repo),
                       dataDir = path.dirname(path.resolve(config.system.dbPath)) } = {}) {
    this.repo = repo;
    this.metadata = metadata;
    this.download = download;
    this.importer = importer;
    this.dataDir = dataDir;
  }

  getState() {
    return this.repo.db.prepare('SELECT * FROM catalog_source_sync WHERE source_id = ?').get(SOURCE_ID) || null;
  }

  record({ status, checkedAt, sourceVersion = null, sourceUpdatedAt = null,
           newApps = null, error = null, imported = false }) {
    const prior = this.getState();
    this.repo.db.prepare(`
      INSERT INTO catalog_source_sync (
        source_id, source_url, last_checked_at, source_version, last_source_updated_at,
        last_imported_version, last_imported_at, last_status, new_apps, last_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id) DO UPDATE SET
        source_url=excluded.source_url, last_checked_at=excluded.last_checked_at,
        source_version=excluded.source_version, last_source_updated_at=excluded.last_source_updated_at,
        last_imported_version=excluded.last_imported_version,
        last_imported_at=excluded.last_imported_at, last_status=excluded.last_status,
        new_apps=excluded.new_apps, last_error=excluded.last_error
    `).run(SOURCE_ID, SOURCE_URL, checkedAt,
      sourceVersion || prior?.source_version || null,
      sourceUpdatedAt || prior?.last_source_updated_at || null,
      imported ? sourceVersion : prior?.last_imported_version || null,
      imported ? checkedAt : prior?.last_imported_at || null,
      status, newApps, error);
  }

  async run({ now = new Date(), maxAgeDays = 30, allowStale = false } = {}) {
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Invalid date');
    if (!Number.isSafeInteger(maxAgeDays) || maxAgeDays < 1) throw new RangeError('Invalid maxAgeDays');
    const checkedAt = now.toISOString();
    let upstream = null;
    try {
      upstream = await this.metadata();
      const ageDays = (now.getTime() - Date.parse(upstream.modifiedAt)) / 86400000;
      if (!Number.isFinite(ageDays) || ageDays < -1) throw new Error('Invalid upstream timestamp');
      const info = {
        source: SOURCE_ID, checkedAt, upstreamVersion: upstream.version,
        upstreamUpdatedAt: upstream.modifiedAt, ageDays: Math.round(ageDays * 10) / 10
      };
      if (ageDays > maxAgeDays && !allowStale) {
        this.record({ status: 'STALE_SOURCE', checkedAt, sourceVersion: upstream.version,
          sourceUpdatedAt: upstream.modifiedAt });
        return { ...info, status: 'STALE_SOURCE', imported: false,
          reason: 'Upstream catalog export is too old for automatic discovery.' };
      }
      if (this.getState()?.last_imported_version === upstream.version) {
        this.record({ status: 'UNCHANGED', checkedAt, sourceVersion: upstream.version,
          sourceUpdatedAt: upstream.modifiedAt });
        return { ...info, status: 'UNCHANGED', imported: false };
      }

      const target = path.join(this.dataDir, 'external', 'appgoblin-' + upstream.version + '-' + FILE_NAME);
      const downloaded = await this.download({ url: upstream.url, target });
      if (upstream.size && downloaded.bytes !== upstream.size) {
        throw new Error('Downloaded file byte count differs from GitHub metadata');
      }
      const count = () => this.repo.db.prepare(
        'SELECT COUNT(*) AS n FROM platform_applications WHERE is_active=1'
      ).get().n;
      const before = count();
      const importReport = await this.importer.importFile(downloaded.file);
      const newApps = Math.max(0, count() - before);
      this.record({ status: 'IMPORTED', checkedAt, sourceVersion: upstream.version,
        sourceUpdatedAt: upstream.modifiedAt, newApps, imported: true });
      return { ...info, status: 'IMPORTED', imported: true, newApps, importReport,
        downloadedBytes: downloaded.bytes, datasetSha256: downloaded.sha256 };
    } catch (error) {
      this.record({ status: 'FAILED', checkedAt,
        sourceVersion: upstream?.version, sourceUpdatedAt: upstream?.modifiedAt,
        error: String(error.message || error).slice(0, 1000) });
      throw error;
    }
  }
}

module.exports = { CatalogSourceMonitor, fetchGithubSource, downloadGithubFile,
  SOURCE_ID, SOURCE_URL, CONTENTS_API, COMMITS_API, RAW_URL };
