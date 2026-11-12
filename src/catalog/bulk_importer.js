'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const Repository = require('../storage/repository');

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
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  return { input: child.stdout, process: child, getError: () => stderr };
}

class BulkCatalogImporter {
  constructor(repo = null) {
    this.repo = repo || new Repository();
  }

  async importFile(filePath, { maxApps = Infinity } = {}) {
    if (!(maxApps === Infinity || (Number.isSafeInteger(maxApps) && maxApps > 0))) {
      throw new RangeError('maxApps must be a positive integer or Infinity');
    }
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
        this.repo.upsertPlatformApp(app);
        summary.imported++;
        if (summary.imported >= maxApps) {
          earlyStop = true;
          break;
        }
      }
    } finally {
      lines.close();
      if (earlyStop && source.process) source.process.kill();
      if (earlyStop && !source.process) source.input.destroy();
    }
    if (streamError) throw streamError;
    if (source.process && !earlyStop) {
      // Wait for decompressor exit; truncated/corrupt .xz is a failed import.
      const exitCode = source.process.exitCode !== null
        ? source.process.exitCode
        : await new Promise((resolve, reject) => {
          source.process.once('error', reject);
          source.process.once('close', resolve);
        });
      if (exitCode !== 0) throw new Error('xz failed: ' + (source.getError() || 'exit ' + exitCode));
    }
    if (!columns) throw new Error('Empty TSV dataset');
    return summary;
  }
}

module.exports = BulkCatalogImporter;
module.exports.parseCatalogRow = parseCatalogRow;
module.exports.normalizePlatform = normalizePlatform;
