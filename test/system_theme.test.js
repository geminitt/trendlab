'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

const html = read('web/index.html');
const theme = read('web/css/system-theme.css');
const app = read('web/js/app.js');
const scale = read('web/js/scale.js');
const area = read('web/js/area.js');

test('system theme is loaded after existing styles and advertises light/dark browser chrome', () => {
  const base = html.indexOf('css/style.css');
  const minimal = html.indexOf('css/karpathy-minimal.css');
  const system = html.indexOf('css/system-theme.css');
  assert.ok(base >= 0 && minimal > base && system > minimal);
  assert.match(html, /meta name="color-scheme" content="light dark"/);
  assert.match(html, /name="theme-color" media="\(prefers-color-scheme: light\)"/);
  assert.match(html, /name="theme-color" media="\(prefers-color-scheme: dark\)"/);
  assert.doesNotMatch(html, /id="themeToggle"/, 'theme must follow the OS automatically');
});

test('light mode overrides UI surfaces and readable text, including details, tooltips and readiness', () => {
  assert.match(theme, /@media\s*\(prefers-color-scheme:\s*light\)/);
  assert.match(theme, /color-scheme:\s*light/);
  for (const name of [
    '.topbar', '.research-intro p', '.segmented button', 'select', '.search-field',
    '.research-stat', '.map-header', '.canvas-frame', '.canvas-tooltip',
    '.minimal-readiness', '.drawer', '.detail-stat', '.history-chart',
    '.source-grid', '.store-link'
  ]) {
    assert.ok(theme.includes(name), 'light theme is missing ' + name);
  }
  for (const token of [
    '--treemap-canvas-bg', '--treemap-group-bg', '--treemap-group-text',
    '--treemap-group-meta', '--treemap-group-empty',
    '--treemap-hover-outline', '--treemap-tile-text',
    '--history-grid', '--history-line'
  ]) {
    assert.ok(theme.includes(token), 'missing Canvas palette ' + token);
  }
});

test('browser theme changes repaint canvas without rebuilding the metric dataset', () => {
  assert.match(app, /matchMedia\?\.\('\(prefers-color-scheme: dark\)'\)/);
  assert.match(app, /addEventListener\('change',\s*\(\) => this\.drawCanvas\(\)\)/);
  assert.match(app, /themeColor\(token, fallback\)/);
  assert.match(app, /getComputedStyle\(this\.canvasPane\)/);
  assert.match(app, /themeColor\('--treemap-canvas-bg'/);
  assert.match(app, /themeColor\('--treemap-group-text'/);
  assert.match(app, /themeColor\('--history-line'/);
  // Theme customization must not touch actual area weights or star-rating thresholds.
  assert.match(area, /items\.sort\(/);
  assert.match(scale, /function scaleColor\(app\)/);
  assert.doesNotMatch(area, /prefers-color-scheme/);
  assert.doesNotMatch(scale, /prefers-color-scheme/);
});
