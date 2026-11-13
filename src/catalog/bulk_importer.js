'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const Repository = require('../storage/repository');
const { audit } = require('../observability/audit');

// AppGoblin's public TSV columns are documented at
// https://github.com/appgoblin-dev/appgoblin-data
// Bulk imports are catalog discovery only: do not treat dump metrics as time-series observations.
function normalizePlatform(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'google' || v === 'android' || v === 'google_play') return 'android';
  if (v === 'apple' || v === 'ios' || v === 'app_store') return 'ios';
  return null;
}

function parseCatalogRow(line, columns) {
  const fields = line.split('\t');
  const get = name => {
    const idx = columns.get(name);
    return idx === undefined ? '' : String(fields[idx] || '').trim();
  };
  const platform = normalizePlatform(get('store'));
  const category = get('app_category').toLowerCase();
  // Exact official category only. No substring matching (e.g., education_games).
  if (category !== 'education') return null;
  const nativeStoreId = get('store_id');
  const title = get('app_name');
  if (!platform || !nativeStoreId || !title) return null;
  if (platform === 'ios' && !/^\d+$/.test(nativeStoreId)) return null;
  return {
    platform,
    nativeStoreId,
    title,
    developerId: get('developer_id') || null,
    developerName: get('developer_name') || null,
    primaryGenre: platform === 'android' ? 'EDUCATION' : 'Education',
    // Unknown territory in the dump. Use 'global' as a catalog placeholder,
    // NOT evidence that the app is available in every storefront.
    storefront: 'global'
  };
}

function openTsv(inputPath) {
  const filePath = path.resolve(inputPath);
  if (!fs.existsSync(filePath)) throw new Error('Dataset not found: ' + filePath);
  if (!filePath.endsWith('.xz')) return { input: fs.createReadStream(filePath), process: null };
  // Supports .xz without adding a native Node dependency. WSL/Linux users
  // generally have xz; on other systems install xz or decompress to .tsv first.
  const child = spawn('xz', ['-dc', filePath], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  const completed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  return { input: child.stdout, process: child, completed, getError: () => stderr };
}

class BulkCatalogImporter {
  constructor(repo = null) {
    this.repo = repo || new Repository();
  }

  async importFile(filePath, { maxApps = Infinity } = {}) {
    if (!(maxApps === Infinity || (Number.isSafeInteger(maxApps) && maxApps > 0))) {
      throw new RangeError('maxApps must be a positive integer or Infinity');
    }
    const started = Date.now();
    audit('catalog.import_started', {
      source: path.resolve(filePath), max_apps: maxApps === Infinity ? null : maxApps
    });
    const source = openTsv(filePath);
    const lines = readline.createInterface({ input: source.input, crlfDelay: Infinity });
    const summary = {
      source: path.resolve(filePath),
      rowsRead: 0,
      educationRows: 0,
      imported: 0,
      duplicatesInFile: 0,
      invalidEducationRows: 0
    };
    const seen = new Set();
    let columns = null;
    let earlyStop = false;
    let streamError = null;
    let transactionOpen = false;
    let pendingRows = 0;
    const database = this.repo.db;
    const transactionsEnabled = database && typeof database.exec === 'function';
    const commit = () => {
      if (transactionOpen) {
        database.exec('COMMIT');
        transactionOpen = false;
        pendingRows = 0;
      }
    };
    source.input.on('error', error => { streamError = error; });
    if (source.process) source.process.on('error', error => { streamError = error; });

    try {
      for await (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, '');
        if (!line.trim()) continue;
        if (!columns) {
          const headers = line.replace(/^\uFEFF/, '').split('\t').map(s => s.trim().toLowerCase());
          columns = new Map(headers.map((header, i) => [header, i]));
          for (const required of ['store', 'store_id', 'app_name', 'app_category']) {
            if (!columns.has(required)) throw new Error('Missing required AppGoblin column: ' + required);
          }
          continue;
        }
        summary.rowsRead++;
        const values = line.split('\t');
        const category = values[columns.get('app_category')]?.trim().toLowerCase();
        if (category !== 'education') continue;
        summary.educationRows++;
        const app = parseCatalogRow(line, columns);
        if (!app) {
          summary.invalidEducationRows++;
          continue;
        }
        const key = app.platform + ':' + app.nativeStoreId;
        if (seen.has(key)) {
          summary.duplicatesInFile++;
          continue;
        }
        seen.add(key);
        if (transactionsEnabled && !transactionOpen) {
          database.exec('BEGIN');
          transactionOpen = true;
        }
        this.repo.upsertPlatformApp(app);
        summary.imported++;
        if (++pendingRows >= 500) commit();
        if (summary.imported >= maxApps) {
          earlyStop = true;
          break;
        }
      }
      if (streamError) throw streamError;
      if (source.process && !earlyStop) {
      // Promise is registered before streaming so a fast xz process cannot
      // close before the listener is attached.
      const exitCode = await source.completed;
        if (exitCode !== 0) throw new Error('xz failed: ' + (source.getError() || 'exit ' + exitCode));
      }
      if (!columns) throw new Error('Empty TSV dataset');
      commit();
      audit('catalog.import_finished', {
        ...summary, elapsed_ms: Date.now() - started
      });
      return summary;
    } catch (error) {
      audit('catalog.import_failed', {
        source: path.resolve(filePath), rows_read: summary.rowsRead,
        imported: summary.imported, elapsed_ms: Date.now() - started, error
      });
      if (transactionOpen) database.exec('ROLLBACK');
      throw error;
    } finally {
      lines.close();
      if (earlyStop && source.process) source.process.kill();
      if (earlyStop && !source.process) source.input.destroy();
    }
  }
}

module.exports = BulkCatalogImporter;
module.exports.parseCatalogRow = parseCatalogRow;
module.exports.normalizePlatform = normalizePlatform;
