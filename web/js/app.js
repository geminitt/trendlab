'use strict';

class TrendLabApp {
  constructor() {
    this.dataset = null;
    this.window = '30d';
    this.platform = 'android';
    this.metric = 'observed_scale';
    this.search = '';
    this.rects = [];
    this.hovered = null;
    this.selected = null;
    this.canvasPane = document.getElementById('canvasPane');
    this.canvas = document.getElementById('treemapCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.tooltip = document.getElementById('canvasTooltip');
    this.legendCache = new Map();
    this.attachEvents();
    this.loadData();
  }

  attachEvents() {
    for (const name of ['platform', 'window']) {
      const element = document.getElementById(name + 'Toggle');
      element.addEventListener('click', e => {
        const button = e.target.closest('button[data-' + name + ']');
        if (!button) return;
        this[name] = button.dataset[name];
        for (const el of element.querySelectorAll('button')) el.classList.toggle('active', el === button);
        this.render();
      });
    }
    document.getElementById('colorSelect').addEventListener('change', e => {
      this.metric = e.target.value; this.render();
    });
    document.getElementById('searchInput').addEventListener('input', e => {
      this.search = e.target.value.toLocaleLowerCase().trim();
      this.render();
    });
    this.canvas.addEventListener('mousemove', e => this.onMouseMove(e));
    this.canvas.addEventListener('mouseleave', () => { this.hovered = null; this.tooltip.classList.add('hidden'); this.drawCanvas(); });
    this.canvas.addEventListener('click', () => { if (this.hovered) this.openApp(this.hovered.app); });
    document.getElementById('readinessScaleButton').addEventListener('click', () => {
      this.metric = 'observed_scale';
      document.getElementById('colorSelect').value = this.metric;
      this.render();
    });
    document.getElementById('drawerBackdrop').addEventListener('click', () => this.closeDrawer());
    document.getElementById('drawerClose').addEventListener('click', () => this.closeDrawer());
    window.addEventListener('keydown', e => { if (e.key === 'Escape') this.closeDrawer(); });
    window.addEventListener('resize', () => this.layoutAndDraw());
    if (window.ResizeObserver) new ResizeObserver(() => this.layoutAndDraw()).observe(this.canvasPane);
  }

  async loadData() {
    try {
      const response = await fetch('data/data.json?t=' + Date.now());
      if (!response.ok) throw new Error('HTTP ' + response.status);
      this.dataset = await response.json();
      this.render();
    } catch (error) {
      document.getElementById('emptyMessage').textContent = 'Unable to load data.json — run the export command first.';
      document.getElementById('emptyMessage').classList.remove('hidden');
      console.error('[TrendLab] Dataset:', error);
    }
  }

  formatCount(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(Number(value));
  }

  compact(value) {
    if (!Number.isFinite(Number(value)) || value === null) return '—';
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value));
  }

  isScaleMode() { return this.metric === 'observed_scale'; }

  getScore(app) {
    if (this.isScaleMode()) return null;
    if (this.metric === 'rating_velocity') {
      const m = app.metrics && app.metrics[this.window];
      return m && Number.isFinite(m.ratingVelocity) ? m.ratingVelocity : null;
    }
    const value = app.scores && app.scores[this.window] && app.scores[this.window][this.metric];
    return value && Number.isFinite(value.score) ? value.score : null;
  }

  filtered() {
    return (this.dataset?.apps || []).filter(app => {
      if (this.platform !== 'all' && app.platform !== this.platform) return false;
      if (!this.search) return true;
      return (app.title || '').toLocaleLowerCase().includes(this.search) ||
        (app.developer || '').toLocaleLowerCase().includes(this.search);
    });
  }

  getRange(platform) {
    const key = this.window + ':' + this.metric + ':' + platform;
    if (this.legendCache.has(key)) return this.legendCache.get(key);
    const values = (this.dataset?.apps || []).filter(a => a.platform === platform)
      .map(a => this.getScore(a)).filter(v => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
    // Trim extreme outliers to preserve resolution for typical values.
    const value = values.length < 2 ? null : {
      low: values[Math.floor((values.length - 1) * 0.05)],
      high: values[Math.floor((values.length - 1) * 0.95)]
    };
    this.legendCache.set(key, value);
    return value;
  }

  colorFor(app) {
    if (this.isScaleMode()) return TrendLabScale.scaleColor(app);
    const score = this.getScore(app);
    if (score === null) return '#34424e';
    const range = this.getRange(app.platform);
    const normalized = range && range.high > range.low ?
      Math.min(1, Math.max(0, (score - range.low) / (range.high - range.low))) : 0.55;
    // Sequential palette: low signal is muted ochre, high is green.
    const stops = [
      [100, 84, 60],
      [107, 112, 60],
      [48, 132, 84],
      [28, 107, 69]
    ];
    const t = normalized * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(t));
    const blend = t - i;
    return 'rgb(' + stops[i].map((v, k) =>
      Math.round(v + (stops[i + 1][k] - v) * blend)).join(',') + ')';
  }

  render() {
    if (!this.dataset) return;
    this.legendCache.clear();
    const apps = this.filtered();
    const uniqueApps = ['android', 'ios'].flatMap(platform =>
      TrendLabScale.dedupePlatformApps(apps, platform));
    const catalog = this.dataset.meta?.catalogApps || 0;
    const observed = this.dataset.meta?.totalApps || this.dataset.apps.length;
    const ready = uniqueApps.filter(app => {
      const models = app.scores?.[this.window];
      return models && Object.values(models).some(entry => Number.isFinite(entry?.score));
    }).length;
    const scored = uniqueApps.filter(app => this.getScore(app) !== null).length;
    const fresh = (this.dataset.apps || []).filter(app =>
      app.lastObservedAt && Date.now() - Date.parse(app.lastObservedAt) <= 48 * 3600000 &&
      Date.now() - Date.parse(app.lastObservedAt) >= 0).length;

    document.getElementById('kpiCatalog').textContent = this.compact(catalog);
    document.getElementById('kpiObserved').textContent = this.compact(observed);
    document.getElementById('kpiScored').textContent = this.formatCount(ready);
    document.getElementById('kpiCoverage').textContent =
      catalog ? (100 * observed / catalog).toFixed(2) + '%' : '—';
    document.getElementById('kpiFresh').textContent = this.formatCount(fresh);
    document.getElementById('metaLastUpdated').textContent = this.dataset.meta?.generatedAt ?
      'Exported ' + new Date(this.dataset.meta.generatedAt).toLocaleString() : 'No export date';
    document.getElementById('visibleCount').textContent = this.formatCount(uniqueApps.length) +
      ' distinct observed apps in filter';
    document.getElementById('qualityCount').textContent = this.isScaleMode() ?
      'snapshot scale, not download growth' : this.formatCount(scored) + ' with selected signal';
    document.getElementById('areaExplanation').textContent = this.isScaleMode() ?
      (this.platform === 'all' ?
        'Two separate treemaps: Android maxInstalls and iOS US rating count cannot share one area scale.' :
        this.platform === 'android' ?
          'Area = log² of public Android maxInstalls (semantics unverified). Color = user stars.' :
          'Area = log² of US App Store rating count. Color = US user stars.') :
      'Color = provisional trend signal only when sufficient observations exist; not a verified download forecast.';

    this.layoutAndDraw(apps);
  }

  // Show a truthful readiness dashboard while the selected window cannot
  // support a meaningful cross-app trend comparison.
  renderReadiness(apps, scoredApps) {
    const usingReadiness = !this.isScaleMode() && scoredApps.length < 8;
    document.getElementById('readinessSurface').classList.toggle('hidden', !usingReadiness);
    this.canvas.classList.toggle('hidden', usingReadiness);
    document.getElementById('mapFooter').classList.toggle('hidden', usingReadiness);
    if (!usingReadiness) return false;
    this.tooltip.classList.add('hidden');
    this.hovered = null;
    this.rects = [];
    document.getElementById('readinessScored').textContent = this.formatCount(scoredApps.length);
    document.getElementById('readinessTotal').textContent = this.formatCount(
      ['android', 'ios'].reduce((n, platform) =>
        n + TrendLabScale.dedupePlatformApps(apps, platform).length, 0));
    return true;
  }

  layoutAndDraw(apps = this.filtered()) {
    if (!this.dataset) return;
    const scoredApps = apps.filter(app => this.getScore(app) !== null);
    const readiness = this.renderReadiness(apps, scoredApps);
    const isScale = this.isScaleMode();
    const mapHeader = document.getElementById('mapHeading');
    const subtitle = document.getElementById('mapSubheading');
    mapHeader.textContent = isScale ?
      (this.platform === 'all' ? 'OBSERVED APPS · SEPARATE UNITS' :
        this.platform.toUpperCase() + ' · OBSERVED APPLICATIONS') :
      readiness ? 'COLLECTION READINESS' : 'TREND MAP / ' + this.window.toUpperCase();
    if (readiness) {
      subtitle.textContent = this.formatCount(apps.length - scoredApps.length) + ' apps without trend evidence';
      return;
    }

    const w = this.canvasPane.clientWidth;
    const h = this.canvasPane.clientHeight;
    if (!w || !h) return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.rects = [];
    this.mapGroups = [];
    this.hovered = null;
    this.tooltip.classList.add('hidden');

    if (isScale) {
      const platforms = this.platform === 'all' ? ['android', 'ios'] : [this.platform];
      const gap = 6;
      const usableW = w - gap * (platforms.length + 1);
      const panelWidth = usableW / platforms.length;
      const top = platforms.length > 1 ? 35 : 3;
      for (let index = 0; index < platforms.length; index++) {
        const platform = platforms[index];
        const x = gap + index * (panelWidth + gap);
        const selections = TrendLabScale.getScaleCandidates(apps, platform);
        const totalEligible = TrendLabScale.getScaleCandidates(apps, platform, Infinity).length;
        this.mapGroups.push({ platform, x, width: panelWidth, count: selections.length, totalEligible });
        if (!selections.length) continue;
        const items = selections.map(app => ({ app, weight: TrendLabScale.tileWeight(app) }));
        const rects = SquarifiedTreemap.squarify(items, x, top, panelWidth, Math.max(1, h - top - 4));
        this.rects.push(...rects);
      }
      subtitle.textContent = this.formatCount(this.rects.length) + ' distinct measured apps shown · no Top-N cutoff';
      document.getElementById('mapLegend').textContent =
        'AREA · log² source count    COLOR · user star rating (purple → green; gray = unavailable)';
      document.getElementById('mapFooterNote').textContent =
        'Android = unverified maxInstalls · iOS = US rating count · do not compare areas across panels';
    } else {
      const items = scoredApps.map(app => ({
        app, weight: this.platform === 'all' ? 1 : Math.max(1, Number(app.volumeScale) || 1)
      })).sort((a, b) => b.weight - a.weight || a.app.title.localeCompare(b.app.title));
      this.rects = SquarifiedTreemap.squarify(items, 2, 2, w - 4, h - 4);
      subtitle.textContent = this.formatCount(scoredApps.length) + ' scored apps';
      document.getElementById('mapLegend').textContent = 'PROVISIONAL MODEL SIGNAL · relative within platform';
      document.getElementById('mapFooterNote').textContent = 'Unscored apps excluded · not a forecast';
    }
    this.drawCanvas();
  }

  truncate(text, width) {
    const s = String(text || '');
    if (this.ctx.measureText(s).width <= width) return s;
    let lo = 0, hi = s.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.ctx.measureText(s.slice(0, mid) + '…').width <= width) lo = mid;
      else hi = mid - 1;
    }
    return lo ? s.slice(0, lo) + '…' : '';
  }

  drawCanvas() {
    if (!this.dataset) return;
    const ctx = this.ctx;
    const w = this.canvas.width / (this.dpr || 1);
    const h = this.canvas.height / (this.dpr || 1);
    ctx.setTransform(this.dpr || 1, 0, 0, this.dpr || 1, 0, 0);
    ctx.fillStyle = '#121416';
    ctx.fillRect(0, 0, w, h);
    if (this.isScaleMode() && Array.isArray(this.mapGroups) && this.mapGroups.length > 1) {
      for (const group of this.mapGroups) {
        ctx.fillStyle = '#202523';
        ctx.fillRect(group.x, 3, group.width, 28);
        ctx.fillStyle = '#ecf7f5';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.font = '700 11px system-ui, sans-serif';
        const descriptor = group.platform === 'android' ?
          'ANDROID  ·  MAXINSTALLS COUNTER' : 'iOS  ·  US RATING COUNTS';
        ctx.fillText(this.truncate(descriptor, Math.max(0, group.width - 105)), group.x + 10, 17);
        ctx.font = '500 10px system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillStyle = '#9eb8bf';
        ctx.fillText(group.count + '/' + group.totalEligible, group.x + group.width - 9, 17);
        ctx.textAlign = 'left';
        if (group.count === 0) {
          ctx.fillStyle = '#879da8';
          ctx.font = '12px system-ui, sans-serif';
          ctx.fillText('No measured source counters in this filter', group.x + 12, 65);
        }
      }
    }
    for (const r of this.rects) {
      const gap = 3;
      const x = r.rx + gap / 2, y = r.ry + gap / 2;
      const rw = r.rw - gap, rh = r.rh - gap;
      if (rw <= 0 || rh <= 0) continue;
      const hovered = r === this.hovered;
      ctx.fillStyle = this.colorFor(r.app);
      ctx.fillRect(x, y, rw, rh);
      if (hovered) {
        ctx.strokeStyle = '#f6fff7';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, rw - 2, rh - 2);
      }
      if (rw < 52 || rh < 28) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 4, y + 3, rw - 8, rh - 6);
      ctx.clip();
      const size = Math.min(14, Math.max(10, Math.min(rw / 10, rh / 3)));
      ctx.font = '700 ' + size + 'px system-ui, sans-serif';
      ctx.fillStyle = '#f3f7f9';
      ctx.textBaseline = 'top';
      const label = this.truncate(r.app.title, rw - 13);
      ctx.fillText(label, x + 6, y + 6);
      if (rh > 44 && rw > 65) {
        // Bottom-right numeric labels match the supplied reference.
        // Units remain explicit in each header, tooltip and inspector.
        ctx.font = '600 ' + Math.max(10, size - 1) + 'px system-ui, sans-serif';
        ctx.fillStyle = '#f7faf8';
        const score = this.getScore(r.app);
        const value = this.isScaleMode() ? this.compact(r.app.rawVolume) :
          score === null ? 'N/A' : score.toFixed(1);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(this.truncate(value, rw - 13), x + rw - 7, y + rh - 6);
        ctx.textAlign = 'left';
      }
      ctx.restore();
    }
  }

  onMouseMove(event) {
    const bounds = this.canvas.getBoundingClientRect();
    const x = event.clientX - bounds.left, y = event.clientY - bounds.top;
    const found = this.rects.find(r =>
      x >= r.rx && x <= r.rx + r.rw && y >= r.ry && y <= r.ry + r.rh) || null;
    if (found !== this.hovered) {
      this.hovered = found;
      if (!found) this.tooltip.classList.add('hidden');
      else {
        const app = found.app;
        this.tooltip.replaceChildren();
        const title = document.createElement('div');
        title.className = 'tip-title';
        title.textContent = app.title;
        const desc = document.createElement('div');
        desc.className = 'tip-muted';
        desc.textContent = (app.developer || 'Unknown developer') + ' · ' + app.platform.toUpperCase();
        const info = document.createElement('div');
        info.className = 'tip-value';
        const score = this.getScore(app);
        info.textContent = this.isScaleMode() ?
          (app.platform === 'android' ? 'Public maxInstalls counter: ' : 'US storefront rating count: ') +
          this.formatCount(app.rawVolume) :
          score === null ? 'Insufficient trend data' : 'Provisional signal: ' + score.toFixed(2);
        const stars = TrendLabScale.getLatestStarRating(app);
        if (this.isScaleMode() && stars !== null) {
          info.textContent += ' · ' + stars.toFixed(1) + '★';
        }
        const freshness = document.createElement('div');
        freshness.className = 'tip-muted';
        freshness.textContent = 'Latest: ' + (app.lastObservedAt ?
          new Date(app.lastObservedAt).toLocaleDateString() : 'Unknown');
        this.tooltip.append(title, desc, info, freshness);
        this.tooltip.classList.remove('hidden');
      }
      this.drawCanvas();
    }
    if (found) {
      const maxX = bounds.width - 285;
      this.tooltip.style.left = Math.max(8, Math.min(x + 18, maxX)) + 'px';
      this.tooltip.style.top = Math.max(8, Math.min(y + 16, bounds.height - 110)) + 'px';
    }
  }

  setText(id, value) {
    document.getElementById(id).textContent = value === undefined || value === null ? '—' : String(value);
  }

  openApp(app) {
    this.selected = app;
    this.setText('modalTitle', app.title);
    this.setText('modalDeveloper', app.developer || 'Unknown developer');
    this.setText('modalPlatform', app.platform.toUpperCase() +
      (app.platform === 'ios' ? ' · Storefront ' + (app.storefront === 'global' ? 'US signal' : app.storefront) : ''));
    const score = this.getScore(app);
    const metric = app.metrics && app.metrics[this.window];
    const hasEvidence = score !== null;
    const notice = document.getElementById('modalNotice');
    notice.classList.toggle('unknown', !hasEvidence);
    notice.textContent = this.isScaleMode() ?
      'Observed scale snapshot only. Android values are install thresholds; iOS values are storefront rating counts. Tile area uses a visual transform, not source-unit market share. None of these values proves download growth.' :
      hasEvidence ? 'Provisional signal calculated from observed changes. This is not a verified download forecast or a validated growth ranking.' :
      'Insufficient history for this selected signal and time window. No trend conclusion is available; N/A is not a zero score.';
    this.setText('modalVolume', this.formatCount(app.rawVolume));
    this.setText('modalVolumeType', app.volumeMetric ?
      app.volumeMetric.replaceAll('_', ' ') : 'No observed counter');
    const starRating = TrendLabScale.getLatestStarRating(app);
    this.setText('modalScore', this.isScaleMode() ?
      (starRating === null ? 'N/A' : starRating.toFixed(1) + '★') :
      score === null ? 'N/A' : score.toFixed(2));
    this.setText('modalScoreType', this.isScaleMode() ?
      'Observed user star rating · not growth' :
      this.metric.replaceAll('_', ' ') + ' · ' + this.window);
    this.setText('modalVelocity', metric && Number.isFinite(metric.ratingVelocity) ?
      metric.ratingVelocity.toFixed(2) + '/d' : 'N/A');
    this.setText('modalCompleteness', metric && Number.isFinite(metric.completeness) ?
      (metric.completeness * 100).toFixed(0) + '%' : 'N/A');
    this.setText('modalHistoryCount', this.formatCount(app.observationCount || app.history?.length || 0) + ' observations');

    const provenance = app.provenance;
    this.setText('modalSource', provenance?.sourceName || 'Chart / observation only');
    this.setText('modalMethod', provenance?.fetchMethod || 'No raw payload metadata');
    this.setText('modalLastObserved', app.lastObservedAt ?
      new Date(app.lastObservedAt).toLocaleString() : 'N/A');
    this.setText('modalSha', provenance?.sha256 || 'N/A');
    const link = document.getElementById('modalStoreLink');
    link.href = app.platform === 'android' ?
      'https://play.google.com/store/apps/details?id=' + encodeURIComponent(app.nativeStoreId) :
      'https://apps.apple.com/app/id' + encodeURIComponent(app.nativeStoreId);
    this.renderHistory(app);
    document.getElementById('drawerOverlay').classList.remove('hidden');
    document.getElementById('drawerClose').focus();
  }

  renderHistory(app) {
    const chart = document.getElementById('historyChart');
    chart.replaceChildren();
    const history = (app.history || []).filter(point => app.platform !== 'ios' ||
      point.storefront === 'us' || point.storefront === app.storefront);
    const field = app.platform === 'android' && history.some(p => Number.isFinite(p.installs)) ?
      'installs' : 'ratings';
    const valid = history.filter(p => Number.isFinite(p[field])).sort((a, b) =>
      Date.parse(a.t) - Date.parse(b.t));
    if (valid.length < 2) {
      chart.textContent = 'More dated observations are needed to draw a trend.';
    } else {
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 440 105');
      svg.setAttribute('preserveAspectRatio', 'none');
      const values = valid.map(p => p[field]);
      const min = Math.min(...values), max = Math.max(...values), diff = Math.max(1, max - min);
      const firstTime = Date.parse(valid[0].t), lastTime = Date.parse(valid[valid.length - 1].t);
      const duration = Math.max(1, lastTime - firstTime);
      const points = valid.map(p => {
        const x = 12 + (Date.parse(p.t) - firstTime) / duration * 416;
        const y = 88 - (p[field] - min) / diff * 66;
        return x.toFixed(2) + ',' + y.toFixed(2);
      }).join(' ');
      const grid = document.createElementNS(NS, 'line');
      grid.setAttribute('x1', '12'); grid.setAttribute('y1', '90');
      grid.setAttribute('x2', '428'); grid.setAttribute('y2', '90');
      grid.setAttribute('stroke', '#415462');
      const polyline = document.createElementNS(NS, 'polyline');
      polyline.setAttribute('points', points);
      polyline.setAttribute('fill', 'none');
      polyline.setAttribute('stroke', '#9fcf94');
      polyline.setAttribute('stroke-width', '2.5');
      polyline.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.append(grid, polyline); chart.append(svg);
    }
    const container = document.getElementById('historyTableContainer');
    container.replaceChildren();
    const table = document.createElement('table');
    table.className = 'history-table';
    const head = document.createElement('tr');
    for (const col of ['Observed at', 'Storefront', 'Value / rank']) {
      const th = document.createElement('th'); th.textContent = col; head.append(th);
    }
    table.append(head);
    for (const point of history.slice(-12).reverse()) {
      const row = document.createElement('tr');
      const pieces = [
        new Date(point.t).toLocaleString(),
        point.storefront || '—',
        Number.isFinite(point[field]) ? this.formatCount(point[field]) :
          (point.rank !== null && point.rank !== undefined ? '#' + point.rank : '—')
      ];
      for (const value of pieces) {
        const td = document.createElement('td'); td.textContent = value; row.append(td);
      }
      table.append(row);
    }
    container.append(table);
  }

  closeDrawer() { document.getElementById('drawerOverlay').classList.add('hidden'); }
}

window.addEventListener('DOMContentLoaded', () => { window.trendlab = new TrendLabApp(); });
