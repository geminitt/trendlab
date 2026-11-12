'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../web/js/app.js'), 'utf8');
const scale = fs.readFileSync(path.join(__dirname, '../web/js/scale.js'), 'utf8');

test('research home is treemap-first without operations charts or mandatory directory', () => {
  assert.match(html, /id="treemapCanvas"/);
  assert.match(html, /id="kpiObserved"/);
  assert.match(html, /id="kpiCatalog"/);
  assert.match(html, /id="kpiScored"/);
  assert.match(html, /id="kpiFresh"/);
  assert.match(html, /id="colorSelect"/);
  assert.match(html, /id="platformToggle"/);
  assert.match(html, /class="active" data-platform="android"/);
  assert.doesNotMatch(html, /class="insight-pane"/);
  assert.doesNotMatch(html, /insightObservationsChart|insightSuccessChart|insightFreshnessChart/);
  assert.doesNotMatch(html, /id="directoryPanel"/);
  assert.match(html, /css\/karpathy-minimal\.css/);
  assert.doesNotMatch(html, /js\/insights\.js/);
});

test('no arbitrary top-24 cap in the default treemap', () => {
  assert.match(app, /this\.platform = 'android'/);
  assert.match(app, /getScaleCandidates\(apps, platform\)/);
  assert.match(scale, /LIMIT_PER_PLATFORM = Infinity/);
  assert.doesNotMatch(app, /top 24|top ' \+/);
});

test('all DOM IDs directly referenced by the app exist in document and are unique', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const set = new Set(ids);
  assert.equal(ids.length, set.size);
  const referenced = [...app.matchAll(/document\.getElementById\('([^']+)'\)/g)]
    .map(match => match[1]);
  for (const id of referenced) assert.ok(set.has(id), 'missing UI element ' + id);
});
