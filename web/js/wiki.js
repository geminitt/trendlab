'use strict';

class WikipediaMap {
  constructor() {
    this.days = 1;
    this.view = 'map';
    this.data = null;
    this.rects = [];
    this.hovered = null;
    this.keyboardIndex = -1;
    this.selected = null;
    this.loader = new WikiMetrics.EditionLoader();
    this.canvas = this.el('wikiCanvas');
    this.context = this.canvas.getContext('2d');
    this.stage = this.el('mapStage');
    this.attach();
    this.ready = this.initialize();
  }

  el(id) { return document.getElementById(id); }
  text(id, value) { this.el(id).textContent = value; }
  number(value) { return Number.isFinite(value) ? new Intl.NumberFormat('en-US').format(value) : 'Unavailable'; }
  compact(value) { return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value); }
  theme(token) { return getComputedStyle(document.documentElement).getPropertyValue(token).trim(); }

  status(message, error = false) {
    this.el('status').hidden = !message;
    this.el('status').classList.toggle('error', error);
    this.text('status', message);
  }

  attach() {
    this.el('languageSelect').addEventListener('change', () => this.loadEdition(this.el('languageSelect').value));
    this.el('periodControl').addEventListener('click', event => {
      const button = event.target.closest('button[data-days]');
      if (!button) return;
      this.days = Number(button.dataset.days);
      for (const item of this.el('periodControl').querySelectorAll('button')) {
        item.setAttribute('aria-pressed', String(item === button));
      }
      this.render();
      if (this.selected && this.el('articleDialog').open) this.openArticle(this.selected);
    });
    this.el('viewControl').addEventListener('click', event => {
      const button = event.target.closest('button[data-view]');
      if (!button) return;
      this.view = button.dataset.view;
      for (const item of this.el('viewControl').querySelectorAll('button')) {
        item.setAttribute('aria-pressed', String(item === button));
      }
      this.render();
    });
    this.el('searchInput').addEventListener('input', () => this.render());
    this.el('trendSelect').addEventListener('change', () => this.render());
    this.canvas.addEventListener('mousemove', event => {
      const bounds = this.canvas.getBoundingClientRect();
      this.hovered = this.hit(event.clientX - bounds.left, event.clientY - bounds.top);
      this.tooltip(event.clientX - bounds.left, event.clientY - bounds.top);
      this.draw();
    });
    this.canvas.addEventListener('mouseleave', () => {
      this.hovered = null; this.el('tooltip').hidden = true; this.draw();
    });
    this.canvas.addEventListener('click', event => {
      const bounds = this.canvas.getBoundingClientRect();
      const item = this.hit(event.clientX - bounds.left, event.clientY - bounds.top);
      if (item) this.openArticle(item.article);
    });
    this.canvas.addEventListener('keydown', event => {
      if (!this.rects.length) return;
      if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        const delta = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
        this.keyboardIndex = (this.keyboardIndex + delta + this.rects.length) % this.rects.length;
        this.hovered = this.rects[this.keyboardIndex];
        this.tooltip(this.hovered.rx, this.hovered.ry); this.draw();
      } else if (['Enter', ' '].includes(event.key) && this.hovered) {
        event.preventDefault(); this.openArticle(this.hovered.article);
      }
    });
    this.el('closeDialog').addEventListener('click', () => this.el('articleDialog').close());
    this.el('articleDialog').addEventListener('click', event => {
      if (event.target !== this.el('articleDialog')) return;
      const box = this.el('articleDialog').getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) {
        this.el('articleDialog').close();
      }
    });
    new ResizeObserver(() => this.layout()).observe(this.stage);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      this.draw(); if (this.selected) this.history(this.selected);
    });
  }

  async initialize() {
    try {
      const response = await fetch('data/wikipedia/manifest.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error('Wikipedia data has not been exported.');
      this.manifest = WikiMetrics.validateManifest(await response.json());
      const select = this.el('languageSelect');
      select.replaceChildren();
      for (const edition of this.manifest.editions) {
        const option = document.createElement('option');
        option.value = edition.language; option.textContent = edition.label + ' · ' + edition.language;
        select.append(option);
      }
      select.disabled = false;
      const requested = new URLSearchParams(location.search).get('language');
      const language = this.manifest.editions.some(e => e.language === requested) ? requested : this.manifest.editions[0].language;
      select.value = language;
      await this.loadEdition(language);
    } catch (error) {
      this.status(error.message + ' Run the Python collection command, then reload.', true);
      this.text('emptyText', 'No exported Wikipedia dataset is available.');
      this.el('emptyState').hidden = false;
    }
  }

  async loadEdition(language) {
    const edition = this.manifest.editions.find(row => row.language === language);
    if (!edition) return;
    this.data = null; this.selection = null;
    this.rects = []; this.hovered = null; this.selected = null;
    if (this.el('articleDialog').open) this.el('articleDialog').close();
    this.el('tooltip').hidden = true;
    this.el('articleRows').replaceChildren();
    for (const id of ['totalViews', 'articleCount', 'movementCount', 'dataDate',
      'periodDates', 'sampleCount', 'comparisonDates']) this.text(id, '—');
    this.text('mapTitle', edition.label.toLocaleUpperCase() + ' WIKIPEDIA');
    this.text('qualityNote', 'Waiting for the selected edition’s pageview data.');
    this.el('emptyState').hidden = true;
    this.status('Loading ' + edition.label + ' Wikipedia…');
    this.draw();
    try {
      const data = await this.loader.load(edition);
      if (!data) return;
      this.data = data;
      const url = new URL(location.href);
      url.searchParams.set('language', language);
      history.replaceState(null, '', url);
      this.status(data.meta.failures.length ? data.meta.failures.length + ' article histories could not be collected. This sample is partial.' : '');
      this.render();
    } catch (error) {
      if (error.name === 'AbortError' || this.el('languageSelect').value !== language) return;
      this.status(error.message + ' Choose another edition or refresh the data.', true);
      this.text('emptyText', 'This edition could not be loaded.');
      this.el('emptyState').hidden = false;
    }
  }

  render() {
    if (!this.data) return;
    const selection = WikiMetrics.select(this.data.articles, this.days,
      this.el('searchInput').value, this.el('trendSelect').value);
    this.selection = selection;
    const meta = this.data.meta;
    const example = this.data.articles[0]?.windows[String(this.days)];
    this.text('totalViews', this.compact(selection.totalViews));
    this.text('periodDates', example ? example.start + ' → ' + example.end : 'No dated period');
    this.text('articleCount', this.number(selection.items.length));
    this.text('sampleCount', 'From ' + meta.exportedArticles + ' collected articles · daily Top ' + meta.chartEntries);
    this.text('movementCount', this.number(selection.rising) + ' / ' + this.number(selection.falling));
    this.text('dataDate', meta.endDate);
    this.text('comparisonDates', example ? 'Prior: ' + example.previousStart + ' → ' + example.previousEnd : '');
    this.text('mapTitle', meta.label.toLocaleUpperCase() + ' WIKIPEDIA');
    this.text('qualityNote', selection.missing + ' matching articles lack a complete selected period; ' +
      selection.zero + ' have zero views. ' + selection.incomparable + ' lack a finite percentage comparison. ' +
      'Zero and missing values receive no tile area. Views use Wikimedia’s user traffic classification.');
    this.canvas.setAttribute('aria-label', meta.label + ' Wikipedia: ' + selection.items.length +
      ' articles, ' + this.number(selection.totalViews) + ' pageviews, period ending ' + meta.endDate);
    this.stage.hidden = this.view !== 'map';
    this.el('listPanel').hidden = this.view !== 'list';
    this.el('emptyState').hidden = selection.items.length > 0;
    this.text('emptyText', 'Change the search, filter or period. Missing histories and zero views do not create tile area.');
    this.el('tooltip').hidden = true;
    this.hovered = null; this.keyboardIndex = -1;
    this.list(selection);
    this.layout();
  }

  list(selection) {
    const body = this.el('articleRows'); body.replaceChildren();
    for (const { article, weight } of selection.items) {
      const row = document.createElement('tr');
      const title = document.createElement('td');
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = article.label;
      button.addEventListener('click', () => this.openArticle(article)); title.append(button);
      const views = document.createElement('td'); views.textContent = this.number(weight);
      const change = document.createElement('td');
      change.textContent = WikiMetrics.changeLabel(WikiMetrics.windowFor(article, this.days));
      row.append(title, views, change); body.append(row);
    }
    if (!selection.items.length) {
      const row = document.createElement('tr'); const cell = document.createElement('td');
      cell.colSpan = 3; cell.textContent = 'No articles with positive, complete pageviews match this filter.';
      row.append(cell); body.append(row);
    }
  }

  layout() {
    if (!this.selection || this.stage.hidden) return;
    const width = this.stage.clientWidth, height = this.stage.clientHeight;
    if (!width || !height) return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    const focusedTitle = this.hovered?.article.title;
    this.rects = SquarifiedTreemap.squarify(this.selection.items, 4, 4, width - 8, height - 8);
    this.keyboardIndex = this.rects.findIndex(item => item.article.title === focusedTitle);
    this.hovered = this.rects[this.keyboardIndex] || null;
    this.el('tooltip').hidden = true;
    this.draw();
  }

  shorten(text, width) {
    if (this.context.measureText(text).width <= width) return text;
    let value = text;
    while (value.length && this.context.measureText(value + '…').width > width) value = value.slice(0, -1);
    return value ? value + '…' : '';
  }

  draw() {
    const ctx = this.context, dpr = this.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.theme('--map');
    ctx.fillRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);
    for (const item of this.rects) {
      const { rx, ry, rw, rh, article } = item;
      const period = WikiMetrics.windowFor(article, this.days);
      // A stroke separates tiles without subtracting a minimum pixel area.
      ctx.fillStyle = WikiMetrics.color(period); ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = this.theme('--map'); ctx.lineWidth = .8; ctx.strokeRect(rx, ry, rw, rh);
      if (item === this.hovered) {
        ctx.strokeStyle = this.theme('--hover'); ctx.lineWidth = 2; ctx.strokeRect(rx + 1, ry + 1, Math.max(0, rw - 2), Math.max(0, rh - 2));
      }
      if (rw < 45 || rh < 22) continue;
      ctx.save(); ctx.beginPath(); ctx.rect(rx + 4, ry + 3, rw - 8, rh - 6); ctx.clip();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      const size = Math.min(16, Math.max(10, Math.min(rw / 11, rh / 3)));
      ctx.font = '600 ' + size + 'px system-ui, sans-serif';
      ctx.fillText(this.shorten(article.label, rw - 15), rx + 7, ry + 6);
      if (rh > 46 && rw > 80) {
        ctx.font = '11px ui-monospace, monospace';
        ctx.fillText(this.shorten(this.compact(item.weight) + ' views', rw - 15), rx + 7, ry + 10 + size);
        if (rh > 70) {
          ctx.textBaseline = 'bottom';
          ctx.fillText(this.shorten(WikiMetrics.changeLabel(period), rw - 15), rx + 7, ry + rh - 7);
        }
      }
      ctx.restore();
    }
  }

  hit(x, y) { return this.rects.find(r => x >= r.rx && x < r.rx + r.rw && y >= r.ry && y < r.ry + r.rh) || null; }

  tooltip(x, y) {
    const tip = this.el('tooltip'); tip.replaceChildren(); tip.hidden = !this.hovered;
    if (!this.hovered) return;
    const article = this.hovered.article;
    const period = WikiMetrics.windowFor(article, this.days);
    const title = document.createElement('strong'); title.textContent = article.label;
    const views = document.createElement('span'); views.textContent = this.number(period.views) + ' pageviews';
    const change = document.createElement('span'); change.textContent = WikiMetrics.changeLabel(period) + ' vs prior period';
    tip.append(title, views, change);
    tip.style.left = Math.max(8, Math.min(x + 15, this.stage.clientWidth - 280)) + 'px';
    tip.style.top = Math.max(8, Math.min(y + 15, this.stage.clientHeight - 130)) + 'px';
  }

  openArticle(article) {
    this.selected = article;
    const period = WikiMetrics.windowFor(article, this.days);
    this.text('articleEdition', this.data.meta.label.toLocaleUpperCase() + ' WIKIPEDIA');
    this.text('articleTitle', article.label);
    this.text('articlePeriod', period.start + ' → ' + period.end + ' · UTC');
    this.text('articleViews', this.number(period.views));
    this.text('articlePrevious', this.number(period.previousViews));
    this.text('articleChange', WikiMetrics.changeLabel(period));
    this.text('articleNotice', period.status === 'zero_baseline' ?
      'The prior period has zero recorded views. A percentage change is undefined.' :
      period.status === 'missing_history' ?
        'Some daily observations are missing. Incomplete periods are unavailable; missing days are not zeroes.' :
        'Compared with ' + period.previousStart + ' → ' + period.previousEnd + '. Tile area is proportional to recorded pageviews.');
    this.text('sourceFetched', article.source.fetchedAt);
    this.text('sourceHash', article.source.sha256);
    this.el('articleLink').href = article.url;
    this.el('sourceLink').href = article.source.url;
    this.history(article);
    if (!this.el('articleDialog').open) this.el('articleDialog').showModal();
  }

  history(article) {
    const history = article.history;
    this.text('historyDates', history[0]?.date + ' → ' + history.at(-1)?.date);
    const root = this.el('historyChart'); root.replaceChildren();
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 620 150');
    svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Daily pageviews. Gaps indicate missing observations.');
    const max = Math.max(1, ...history.map(point => point.views ?? 0));
    const grid = document.createElementNS(NS, 'path'); grid.setAttribute('d', 'M40 15H610M40 70H610M40 125H610');
    grid.setAttribute('stroke', this.theme('--line')); grid.setAttribute('fill', 'none'); svg.append(grid);
    for (const [label, y] of [[this.compact(max), 20], ['0', 128]]) {
      const text = document.createElementNS(NS, 'text'); text.setAttribute('x', '2'); text.setAttribute('y', String(y)); text.textContent = label; svg.append(text);
    }
    let points = [];
    const flush = () => {
      if (points.length) {
        const line = document.createElementNS(NS, 'polyline'); line.setAttribute('points', points.join(' '));
        line.setAttribute('fill', 'none'); line.setAttribute('stroke', this.theme('--accent'));
        line.setAttribute('stroke-width', '2'); svg.append(line);
        if (points.length === 1) {
          const [cx, cy] = points[0].split(','); const dot = document.createElementNS(NS, 'circle');
          dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('r', '2'); dot.setAttribute('fill', this.theme('--accent')); svg.append(dot);
        }
      }
      points = [];
    };
    history.forEach((point, index) => {
      if (!Number.isFinite(point.views)) { flush(); return; }
      points.push((40 + index / Math.max(1, history.length - 1) * 570).toFixed(2) + ',' + (125 - point.views / max * 110).toFixed(2));
    }); flush(); root.append(svg);
    const rows = this.el('historyRows'); rows.replaceChildren();
    for (const point of [...history].reverse()) {
      const row = document.createElement('tr');
      const day = document.createElement('td'); day.textContent = point.date;
      const views = document.createElement('td'); views.textContent = this.number(point.views);
      row.append(day, views); rows.append(row);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => { window.wikipediaMap = new WikipediaMap(); });
