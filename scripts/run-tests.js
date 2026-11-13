'use strict';

// Running tests must not contaminate production logs/events-*.jsonl.
// No shell-specific environment syntax; works with Node on Linux/macOS/Windows.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'trendlab-unit-test-audit-'));
let result;
try {
  result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2)], {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit',
    env: { ...process.env, TRENDLAB_LOG_DIR: scratch }
  });
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
if (result.error) {
  process.stderr.write(String(result.error) + '\n');
  process.exitCode = 1;
} else {
  process.exitCode = result.status === null ? 1 : result.status;
}
