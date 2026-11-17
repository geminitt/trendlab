'use strict';

// Start `python -m trendlab serve --port 8765` before running this check.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const base = process.env.TRENDLAB_PREVIEW_URL || 'http://127.0.0.1:8765';
const dataDirectory = path.join(root, 'web/data/wikipedia');
const manifest = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'manifest.json')));
const failures = [];

async function check() {
  const browser = await chromium.launch({ headless: true });
  let page;
  try {
    page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, colorScheme: 'light' });
    page.setDefaultTimeout(12000);
    page.on('pageerror', error => failures.push(error.message));
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.wikipediaMap?.data);
    assert.match(await page.title(), /Wikipedia Attention Map/);
    assert.equal(await page.locator('#languageSelect option').count(), manifest.editions.length);
    let checks = 0;
    for (const edition of manifest.editions) {
      const exported = JSON.parse(fs.readFileSync(path.join(dataDirectory, edition.file)));
      await page.selectOption('#languageSelect', edition.language);
      await page.waitForFunction(language => window.wikipediaMap?.data?.meta.language === language, edition.language);
      for (const days of [1, 7, 30]) {
        await page.click('button[data-days="' + days + '"]');
        const expected = exported.articles.filter(a => Number.isFinite(a.windows[String(days)].views) && a.windows[String(days)].views > 0);
        const actual = await page.evaluate(() => ({
          language: window.wikipediaMap.data.meta.language,
          count: window.wikipediaMap.rects.length,
          views: window.wikipediaMap.selection.totalViews,
          weights: window.wikipediaMap.rects.map(r => r.weight),
          areas: window.wikipediaMap.rects.map(r => r.rw * r.rh),
          overflow: document.documentElement.scrollWidth > innerWidth
        }));
        assert.equal(actual.language, edition.language);
        assert.equal(actual.count, expected.length);
        assert.equal(actual.views, expected.reduce((n, a) => n + a.windows[String(days)].views, 0));
        assert.equal(actual.overflow, false);
        if (actual.weights.length > 1) {
          const ratio = actual.areas[0] / actual.areas.at(-1);
          const expectedRatio = actual.weights[0] / actual.weights.at(-1);
          assert.ok(Math.abs(ratio - expectedRatio) / expectedRatio < 1e-8);
        }
        checks++;
      }
      await page.click('button[data-days="1"]');
      const firstTitle = exported.articles[0].label;
      await page.fill('#searchInput', firstTitle);
      assert.ok((await page.evaluate(() => window.wikipediaMap.rects.length)) >= 1);
      await page.fill('#searchInput', 'no-matching-article-9f36b10d');
      assert.equal(await page.evaluate(() => window.wikipediaMap.rects.length), 0);
      assert.equal(await page.locator('#emptyState').isVisible(), true);
      await page.fill('#searchInput', '');
      await page.selectOption('#trendSelect', 'falling');
      assert.equal(await page.evaluate(() => window.wikipediaMap.rects.every(r => r.article.windows['1'].delta < 0)), true);
      await page.selectOption('#trendSelect', 'all');
    }
    await page.click('button[data-view="list"]');
    assert.equal(await page.locator('#listPanel').isVisible(), true);
    assert.ok(await page.locator('#articleRows button').count() > 0);
    await page.locator('#articleRows button').first().click();
    assert.equal(await page.locator('#articleDialog').isVisible(), true);
    assert.match(await page.locator('#articleLink').getAttribute('href'), /^https:\/\/[a-z-]+\.wikipedia.org\/wiki\//);
    assert.equal(await page.locator('#historyRows tr').count(), 60);
    assert.ok(await page.locator('#historyChart svg polyline').count() > 0);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#articleDialog').isVisible(), false);
    await page.click('button[data-view="map"]');
    await page.locator('#wikiCanvas').focus();
    await page.keyboard.press('ArrowRight');
    // ResizeObserver can relayout between keyboard selection and Enter.
    await page.evaluate(() => window.wikipediaMap.layout());
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#articleDialog').isVisible(), true);
    await page.click('#closeDialog');

    fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'logs/wikipedia-desktop.png'), fullPage: true });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: path.join(root, 'logs/wikipedia-dark.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.ok(await page.evaluate(() => window.wikipediaMap.rects.length) > 0);
    await page.screenshot({ path: path.join(root, 'logs/wikipedia-mobile.png'), fullPage: true });

    // An unavailable edition must not leave the old edition's tiles under its name.
    if (manifest.editions.length > 1) {
      const unavailable = manifest.editions.find(e => e.language !== new URL(page.url()).searchParams.get('language'));
      await page.route('**/' + unavailable.file, route => route.abort('failed'));
      await page.selectOption('#languageSelect', unavailable.language);
      await page.waitForFunction(() => document.getElementById('status').classList.contains('error'));
      await page.evaluate(() => window.wikipediaMap.layout());
      assert.equal(await page.evaluate(() => window.wikipediaMap.data), null);
      assert.equal(await page.evaluate(() => window.wikipediaMap.rects.length), 0);
    }
    assert.deepEqual(failures, []);
    console.log(JSON.stringify({ status: 'passed', editions: manifest.editions.map(e => e.language),
      editionPeriodChecks: checks, checks: ['pageview totals', 'exact area ratios', 'edition switching',
        'periods', 'search', 'empty state', 'trend filters', 'list', 'inspector', 'keyboard',
        'history', 'light/dark', 'mobile overflow', 'failed edition isolation'], pageErrors: failures }, null, 2));
  } catch (error) {
    if (page) {
      console.error('Browser failure context:', JSON.stringify({
        url: page.url(), pageErrors: failures,
        status: await page.locator('#status').textContent().catch(() => null),
        overflow: await page.evaluate(() => [...document.querySelectorAll('body *')]
          .filter(element => element.getBoundingClientRect().right > innerWidth + 1)
          .slice(0, 12).map(element => ({ tag: element.tagName, id: element.id,
            className: element.className, right: element.getBoundingClientRect().right,
            width: element.getBoundingClientRect().width })))
      }));
      await page.screenshot({ path: path.join(root, 'logs/wikipedia-browser-failure.png'), fullPage: true });
    }
    throw error;
  } finally {
    await browser.close();
  }
}

check().catch(error => { console.error(error); process.exitCode = 1; });
