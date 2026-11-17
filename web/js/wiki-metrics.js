'use strict';

const WikiMetrics = (() => {
  function windowFor(article, days) { return article.windows?.[String(days)] || null; }

  function select(articles, days, search = '', trend = 'all') {
    const needle = search.toLocaleLowerCase().trim();
    const matches = articles.filter(article => {
      if (needle && !article.label.toLocaleLowerCase().includes(needle)) return false;
      const period = windowFor(article, days);
      if (trend === 'rising' && !(period?.delta > 0)) return false;
      if (trend === 'falling' && !(period?.delta < 0)) return false;
      if (trend === 'zero_baseline' && period?.status !== 'zero_baseline') return false;
      return true;
    });
    const items = matches.map(article => ({ article, weight: windowFor(article, days)?.views }))
      .filter(item => Number.isFinite(item.weight) && item.weight > 0)
      .sort((a, b) => b.weight - a.weight || a.article.title.localeCompare(b.article.title));
    return { items, matches,
      totalViews: items.reduce((total, item) => total + item.weight, 0),
      missing: matches.filter(a => !Number.isFinite(windowFor(a, days)?.views)).length,
      zero: matches.filter(a => windowFor(a, days)?.views === 0).length,
      rising: matches.filter(a => windowFor(a, days)?.delta > 0).length,
      falling: matches.filter(a => windowFor(a, days)?.delta < 0).length,
      incomparable: matches.filter(a => windowFor(a, days)?.status !== 'comparable').length };
  }

  function color(period) {
    if (!Number.isFinite(period?.changePct)) return '#53636a';
    const value = Math.max(-100, Math.min(100, period.changePct)) / 100;
    const neutral = [104, 112, 104];
    const end = value >= 0 ? [38, 121, 84] : [183, 72, 60];
    return 'rgb(' + neutral.map((v, i) => Math.round(v + (end[i] - v) * Math.abs(value))).join(',') + ')';
  }

  function changeLabel(period) {
    if (!period || period.status === 'missing_history') return 'Prior comparison unavailable';
    if (period.status === 'zero_baseline') return 'Zero prior views';
    if (!Number.isFinite(period.changePct)) return 'Prior comparison unavailable';
    return (period.changePct > 0 ? '+' : '') + new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 1 }).format(period.changePct) + '%';
  }

  function validateManifest(data) {
    if (data?.schemaVersion !== 1 || !Array.isArray(data.editions) || !data.editions.length) {
      throw new Error('No Wikipedia editions have been exported yet.');
    }
    const seen = new Set();
    for (const edition of data.editions) {
      if (!/^[a-z][a-z0-9-]{0,30}$/.test(edition.language) || seen.has(edition.language) ||
          !new RegExp('^' + edition.language + '-\\d{4}-\\d{2}-\\d{2}-[a-f0-9]{12}\\.json$').test(edition.file)) {
        throw new Error('Invalid edition manifest.');
      }
      seen.add(edition.language);
    }
    return data;
  }

  function validateDataset(data, edition) {
    if (data?.schemaVersion !== 1 || data.meta?.language !== edition.language ||
        data.meta?.project !== edition.language + '.wikipedia.org' ||
        data.meta?.endDate !== edition.endDate || !Array.isArray(data.articles)) {
      throw new Error('The dataset does not match the selected edition and date.');
    }
    for (const article of data.articles) {
      if (typeof article.title !== 'string' || typeof article.label !== 'string' ||
          !Array.isArray(article.history) || !article.windows ||
          !article.url.startsWith('https://' + edition.language + '.wikipedia.org/wiki/') ||
          !article.source?.url?.startsWith('https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/')) {
        throw new Error('Invalid article source record.');
      }
    }
    return data;
  }

  // A slow prior edition response must never replace a newer selection.
  class EditionLoader {
    constructor(fetcher = fetch) {
      this.fetcher = (...args) => fetcher(...args);
      this.generation = 0;
    }
    async load(edition) {
      const generation = ++this.generation;
      this.controller?.abort();
      this.controller = new AbortController();
      try {
        const response = await this.fetcher('data/wikipedia/' + edition.file,
          { signal: this.controller.signal });
        if (!response.ok) throw new Error('Dataset request failed: HTTP ' + response.status);
        const data = validateDataset(await response.json(), edition);
        return generation === this.generation ? data : null;
      } catch (error) {
        if (generation !== this.generation) return null;
        throw error;
      }
    }
  }

  return { windowFor, select, color, changeLabel, validateManifest, validateDataset, EditionLoader };
})();
if (typeof window !== 'undefined') window.WikiMetrics = WikiMetrics;
if (typeof module !== 'undefined' && module.exports) module.exports = WikiMetrics;
