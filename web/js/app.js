// TrendLab Interactive Canvas Treemap & Dashboard Controller (Karpathy Jobs Style)

class TrendLabApp {
  constructor() {
    this.dataset = null;
    this.currentWindow = '30d';
    this.currentPlatform = 'all';
    this.currentColor = 'model_c_breakout';
    this.searchQuery = '';
    this.viewMode = 'treemap'; // 'treemap' | 'split' | 'table'

    this.rects = [];
    this.hovered = null;
    this.dpr = window.devicePixelRatio || 1;

    // Elements
    this.mainViewport = document.getElementById('mainViewport');
    this.canvasPane = document.getElementById('canvasPane');
    this.canvas = document.getElementById('treemapCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.tooltip = document.getElementById('canvasTooltip');

    this.leaderboardBody = document.getElementById('leaderboardBody');
    this.tableCount = document.getElementById('tableCount');
    this.drawerOverlay = document.getElementById('drawerOverlay');

    this.initEvents();
    this.loadData();
  }

  initEvents() {
    // View Toggles (Treemap, Split, Table)
    document.getElementById('btnViewTreemap').addEventListener('click', () => this.setViewMode('treemap'));
    document.getElementById('btnViewSplit').addEventListener('click', () => this.setViewMode('split'));
    document.getElementById('btnViewTable').addEventListener('click', () => this.setViewMode('table'));

    // Window Toggles (7d, 14d, 30d, 90d, all)
    document.querySelectorAll('#windowToggle .toggle-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('#windowToggle .toggle-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        this.currentWindow = e.target.dataset.window;
        this.render();
      });
    });

    // Platform Toggles (all, android, ios)
    document.querySelectorAll('#platformToggle .toggle-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('#platformToggle .toggle-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        this.currentPlatform = e.target.dataset.platform;
        this.render();
      });
    });

    // Color Signal Selector
    document.getElementById('colorSelect').addEventListener('change', (e) => {
      this.currentColor = e.target.value;
      this.render();
    });

    // Search Input
    document.getElementById('searchInput').addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase().trim();
      this.render();
    });

    // Canvas Mouse Interactions
    this.canvas.addEventListener('mousemove', (e) => this.handleCanvasMouseMove(e));
    this.canvas.addEventListener('mouseleave', () => this.handleCanvasMouseLeave());
    this.canvas.addEventListener('click', (e) => this.handleCanvasClick(e));

    // Drawer Close
    document.getElementById('drawerClose').addEventListener('click', () => {
      this.drawerOverlay.classList.add('hidden');
    });

    this.drawerOverlay.addEventListener('click', (e) => {
      if (e.target === this.drawerOverlay) {
        this.drawerOverlay.classList.add('hidden');
      }
    });

    // Window Resize Handling (Fluid full-window scaling)
    window.addEventListener('resize', () => {
      this.layoutAndDrawCanvas();
    });

    // ResizeObserver on canvas pane for robust sub-pixel tracking
    if (window.ResizeObserver) {
      new ResizeObserver(() => {
        this.layoutAndDrawCanvas();
      }).observe(this.canvasPane);
    }
  }

  setViewMode(mode) {
    this.viewMode = mode;
    this.mainViewport.className = `main-viewport view-${mode}`;

    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    if (mode === 'treemap') document.getElementById('btnViewTreemap').classList.add('active');
    if (mode === 'split') document.getElementById('btnViewSplit').classList.add('active');
    if (mode === 'table') document.getElementById('btnViewTable').classList.add('active');

    setTimeout(() => this.layoutAndDrawCanvas(), 50);
  }

  async loadData() {
    try {
      const res = await fetch('data/data.json?t=' + Date.now());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.dataset = await res.json();

      document.getElementById('metaTotalApps').textContent = `Catalog: ${this.dataset.meta.totalApps} Apps`;
      document.getElementById('metaLastUpdated').textContent = `Updated: ${new Date(this.dataset.meta.generatedAt).toLocaleDateString()}`;

      this.render();
    } catch (err) {
      console.error('Failed to load data.json:', err);
    }
  }

  getFilteredApps() {
    if (!this.dataset || !this.dataset.apps) return [];

    return this.dataset.apps.filter(app => {
      // Platform filter
      if (this.currentPlatform !== 'all' && app.platform !== this.currentPlatform) {
        return false;
      }
      // Search filter
      if (this.searchQuery) {
        const matchesTitle = app.title.toLowerCase().includes(this.searchQuery);
        const matchesDev = (app.developer || '').toLowerCase().includes(this.searchQuery);
        if (!matchesTitle && !matchesDev) return false;
      }
      return true;
    });
  }

  getAppScore(app) {
    if (this.currentColor === 'rating_velocity') {
      const metrics = app.metrics && app.metrics[this.currentWindow];
      return metrics ? Number(metrics.ratingVelocity) || 0 : 0;
    }
    const scores = app.scores && app.scores[this.currentWindow];
    if (scores && scores[this.currentColor]) {
      return Number(scores[this.currentColor].score) || 0;
    }
    return 0;
  }

  getColorForScore(score, minScore, maxScore, isHovered = false) {
    if (maxScore <= minScore) return isHovered ? '#475569' : '#334155';
    const norm = Math.max(0, Math.min(1, (score - minScore) / (maxScore - minScore)));

    // Multi-stop Karpathy color scale:
    // Purple (0.0) -> Slate (0.4) -> Teal (0.7) -> Emerald Green (1.0)
    let r, g, b;
    if (norm < 0.4) {
      const t = norm / 0.4;
      r = Math.round(76 + t * (55 - 76));
      g = Math.round(29 + t * (65 - 29));
      b = Math.round(149 + t * (81 - 149));
    } else if (norm < 0.7) {
      const t = (norm - 0.4) / 0.3;
      r = Math.round(55 + t * (15 - 55));
      g = Math.round(65 + t * (118 - 65));
      b = Math.round(81 + t * (110 - 81));
    } else {
      const t = (norm - 0.7) / 0.3;
      r = Math.round(15 + t * (16 - 15));
      g = Math.round(118 + t * (185 - 118));
      b = Math.round(110 + t * (129 - 110));
    }

    if (isHovered) {
      r = Math.min(255, r + 40);
      g = Math.min(255, g + 40);
      b = Math.min(255, b + 40);
    }

    return `rgb(${r}, ${g}, ${b})`;
  }

  render() {
    this.layoutAndDrawCanvas();
    this.renderLeaderboard();
  }

  layoutAndDrawCanvas() {
    if (this.viewMode === 'table') return;

    const w = this.canvasPane.clientWidth;
    const h = this.canvasPane.clientHeight;
    if (w <= 0 || h <= 0) return;

    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;

    const apps = this.getFilteredApps();
    if (apps.length === 0) {
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.ctx.fillStyle = '#0a0c10';
      this.ctx.fillRect(0, 0, w, h);
      this.ctx.fillStyle = '#8b949e';
      this.ctx.font = '14px -apple-system, sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.fillText('No apps matching current filters', w / 2, h / 2);
      this.rects = [];
      return;
    }

    // Weight is Log10(volume + 1)
    const items = apps.map(app => ({
      app,
      weight: Math.max(0.5, app.volumeScale || 1.0)
    }));

    // Squarified layout padding
    const PADDING = 4;
    this.rects = SquarifiedTreemap.squarify(
      items,
      PADDING,
      PADDING,
      w - PADDING * 2,
      h - PADDING * 2
    );

    this.drawCanvas();
  }

  drawCanvas() {
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;

    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.fillStyle = '#0a0c10';
    this.ctx.fillRect(0, 0, w, h);

    const scores = this.rects.map(r => this.getAppScore(r.app));
    const minScore = scores.length > 0 ? Math.min(...scores) : 0;
    const maxScore = scores.length > 0 ? Math.max(...scores) : 100;

    const GAP = 2;

    for (const r of this.rects) {
      const rx = r.rx + GAP / 2;
      const ry = r.ry + GAP / 2;
      const rw = r.rw - GAP;
      const rh = r.rh - GAP;

      if (rw <= 0 || rh <= 0) continue;

      const isHovered = (this.hovered && this.hovered.app.id === r.app.id);
      const score = this.getAppScore(r.app);
      const fillStyle = this.getColorForScore(score, minScore, maxScore, isHovered);

      // Draw Rectangle
      this.ctx.fillStyle = fillStyle;
      this.ctx.fillRect(rx, ry, rw, rh);

      // Stroke / Border
      if (isHovered) {
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(rx, ry, rw, rh);
      } else {
        this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(rx, ry, rw, rh);
      }

      // Draw Labels if rectangle is large enough
      if (rw > 35 && rh > 20) {
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(rx + 2, ry + 2, rw - 4, rh - 4);
        this.ctx.clip();

        const fontSize = Math.min(12, Math.max(9, Math.min(rw / 10, rh / 3)));
        this.ctx.font = `600 ${fontSize}px -apple-system, sans-serif`;
        this.ctx.fillStyle = isHovered ? '#ffffff' : 'rgba(255, 255, 255, 0.95)';
        this.ctx.textBaseline = 'top';
        this.ctx.textAlign = 'left';
        this.ctx.fillText(r.app.title, rx + 4, ry + 4);

        if (rh > 36 && rw > 55) {
          this.ctx.font = `500 ${Math.max(8, fontSize - 2)}px -apple-system, sans-serif`;
          this.ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
          const platformLabel = r.app.platform.toUpperCase();
          this.ctx.fillText(`${platformLabel} · ${score.toFixed(1)}`, rx + 4, ry + 4 + fontSize + 3);
        }

        this.ctx.restore();
      }
    }
  }

  handleCanvasMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    let found = null;
    for (const r of this.rects) {
      if (x >= r.rx && x <= r.rx + r.rw && y >= r.ry && y <= r.ry + r.rh) {
        found = r;
        break;
      }
    }

    if (found !== this.hovered) {
      this.hovered = found;
      this.drawCanvas();

      if (found) {
        const app = found.app;
        const score = this.getAppScore(app);
        const volumeStr = (app.rawVolume || 0).toLocaleString();

        this.tooltip.innerHTML = `
          <div class="tooltip-title">${app.title}</div>
          <div class="tooltip-dev">${app.developer} (${app.platform.toUpperCase()})</div>
          <div class="tooltip-stat">
            <span>Trend Score:</span>
            <strong style="color: #4ade80;">${score.toFixed(1)}</strong>
          </div>
          <div class="tooltip-stat">
            <span>Observed Volume:</span>
            <strong>${volumeStr}</strong>
          </div>
        `;
        this.tooltip.classList.remove('hidden');
      } else {
        this.tooltip.classList.add('hidden');
      }
    }

    if (found) {
      // Keep tooltip inside canvas pane
      const paneW = this.canvasPane.clientWidth;
      const paneH = this.canvasPane.clientHeight;
      let tx = x + 16;
      let ty = y + 16;
      if (tx + 240 > paneW) tx = x - 250;
      if (ty + 100 > paneH) ty = y - 110;
      this.tooltip.style.left = `${Math.max(8, tx)}px`;
      this.tooltip.style.top = `${Math.max(8, ty)}px`;
    }
  }

  handleCanvasMouseLeave() {
    this.hovered = null;
    this.tooltip.classList.add('hidden');
    this.drawCanvas();
  }

  handleCanvasClick(e) {
    if (this.hovered) {
      this.openAppInspection(this.hovered.app);
    }
  }

  renderLeaderboard() {
    const apps = this.getFilteredApps();
    this.tableCount.textContent = `${apps.length} apps`;

    // Sort descending by selected score
    apps.sort((a, b) => this.getAppScore(b) - this.getAppScore(a));

    this.leaderboardBody.innerHTML = '';
    apps.forEach((app, idx) => {
      const score = this.getAppScore(app);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight: 700; color: #388bfd;">#${idx + 1}</td>
        <td>
          <div style="font-weight: 600; color: #fff;">${app.title}</div>
          <div style="font-size: 10px; color: #8b949e;">${app.developer}</div>
        </td>
        <td><span class="badge badge-${app.platform}">${app.platform.toUpperCase()}</span></td>
        <td style="font-weight: 700; color: #4ade80;">${score.toFixed(1)}</td>
        <td style="color: #cbd5e1;">${(app.rawVolume || 0).toLocaleString()}</td>
      `;
      tr.addEventListener('click', () => this.openAppInspection(app));
      this.leaderboardBody.appendChild(tr);
    });
  }

  openAppInspection(app) {
    document.getElementById('modalTitle').textContent = app.title;
    document.getElementById('modalDeveloper').textContent = app.developer;

    const platBadge = document.getElementById('modalPlatform');
    platBadge.textContent = app.platform.toUpperCase();
    platBadge.className = `badge badge-${app.platform}`;

    document.getElementById('modalVolume').textContent = (app.rawVolume || 0).toLocaleString();
    document.getElementById('modalScore').textContent = this.getAppScore(app).toFixed(2);

    const metrics = app.metrics && app.metrics[this.currentWindow];
    document.getElementById('modalVelocity').textContent = metrics ? `${Number(metrics.ratingVelocity).toFixed(1)}/day` : 'N/A';
    document.getElementById('modalCompleteness').textContent = metrics ? `${Math.round(Number(metrics.completeness) * 100)}%` : '100%';

    const prov = app.provenance;
    document.getElementById('modalSource').textContent = prov ? prov.sourceName : 'Store API';
    document.getElementById('modalMethod').textContent = prov ? prov.fetchMethod : 'Direct Ingestion';
    document.getElementById('modalSha').textContent = prov ? prov.sha256 : 'N/A';
    document.getElementById('modalLastObserved').textContent = prov ? new Date(prov.lastObservedAt).toLocaleString() : 'N/A';

    const storeLink = document.getElementById('modalStoreLink');
    if (app.platform === 'android') {
      storeLink.href = `https://play.google.com/store/apps/details?id=${app.nativeStoreId}`;
    } else {
      storeLink.href = `https://apps.apple.com/${app.storefront || 'us'}/app/id${app.nativeStoreId}`;
    }

    const historyContainer = document.getElementById('historyTableContainer');
    if (app.history && app.history.length > 0) {
      let rowsHtml = '<table class="leaderboard-table" style="font-size: 10px;"><thead><tr><th>Timestamp</th><th>Observed Value</th><th>Rating</th></tr></thead><tbody>';
      app.history.forEach(h => {
        const val = h.installs || h.ratings || 0;
        rowsHtml += `<tr>
          <td>${new Date(h.t).toLocaleString()}</td>
          <td>${val.toLocaleString()}</td>
          <td>${h.score ? h.score.toFixed(2) : '-'}</td>
        </tr>`;
      });
      rowsHtml += '</tbody></table>';
      historyContainer.innerHTML = rowsHtml;
    } else {
      historyContainer.innerHTML = '<div style="color: #8b949e; font-size: 11px;">No historical snapshots recorded yet.</div>';
    }

    this.drawerOverlay.classList.remove('hidden');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new TrendLabApp();
});
