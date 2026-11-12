'use strict';

/**
 * Small truthful research charts, inspired by the user-provided reference.
 * These show SQLite observation and collection activity, NOT user traffic,
 * installations, daily downloads, or forecasted growth.
 */
const TrendLabInsights = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const COLORS = { green: '#20c878', teal: '#38c5bd', blue: '#45b7e9', amber: '#e9a94c', magenta: '#a84c97', gray: '#53606b' };
  const number = value => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
  const sum = (rows, key) => rows.reduce((total, row) => total + number(row[key]), 0);
  const compact = value => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);

  function summarize(meta, apps, now = Date.now()) {
    const activity = meta?.activity;
    const daily = Array.isArray(activity?.daily) ? activity.daily : null;
    const appRows = Array.isArray(apps) ? apps : [];
    const buckets = [0, 0, 0, 0];
    for (const app of appRows) {
      const t = Date.parse(app.lastObservedAt || '');
      if (!Number.isFinite(t) || t > now) continue;
      const ageHours = (now - t) / 3600000;
      buckets[ageHours <= 24 ? 0 : ageHours <= 72 ? 1 : ageHours <= 168 ? 2 : 3]++;
    }
    const attempts = daily ? sum(daily, 'attempts') : 0;
    const succeeded = daily ? sum(daily, 'succeeded') : 0;
    return {
      daily,
      observations: daily ? sum(daily, 'observationRows') : null,
      firstSeen: daily ? sum(daily, 'newlyObserved') : null,
      attempts,
      succeeded,
      failed: daily ? sum(daily, 'failed') : 0,
      successRate: attempts ? Math.min(100, 100 * succeeded / attempts) : null,
      buckets,
      fresh24: buckets[0],
      freshnessCount: buckets.reduce((s, x) => s + x, 0)
    };
  }

  function node(tag, attrs = {}, text = null) {
    const el = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
    if (text !== null) el.textContent = text;
    return el;
  }
  function chartRoot(containerId) {
    const container = document.getElementById(containerId);
    container.replaceChildren();
    const svg = node('svg', { viewBox: '0 0 400 112', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    container.appendChild(svg);
    return { container, svg };
  }
  function empty(container, text) {
    const el = document.createElement('div');
    el.className = 'insight-empty';
    el.textContent = text;
    container.replaceChildren(el);
  }
  function axes(svg) {
    for (const y of [24, 56, 88]) svg.appendChild(node('line', {
      x1: 8, y1: y, x2: 392, y2: y, stroke: '#292e30', 'stroke-width': 1
    }));
    svg.append(
      node('text', { x: 8, y: 108, fill: '#7f888b', 'font-size': 10 }, '30D AGO'),
      node('text', { x: 392, y: 108, fill: '#7f888b', 'font-size': 10, 'text-anchor': 'end' }, 'TODAY')
    );
  }
  function lineChart(containerId, daily, key, color, gradientId) {
    const { container, svg } = chartRoot(containerId);
    if (!daily) { empty(container, 'Activity export not available'); return; }
    if (!daily.length || !daily.some(x => number(x[key]) > 0)) {
      empty(container, 'No recorded activity in this period'); return;
    }
    axes(svg);
    const values = daily.map(row => number(row[key]));
    const max = Math.max(1, ...values);
    const positions = values.map((value, i) => [
      8 + (i / Math.max(1, values.length - 1)) * 384,
      88 - (value / max) * 67
    ]);
    const points = positions.map(([x, y]) => x.toFixed(2) + ',' + y.toFixed(2)).join(' ');
    const defs = node('defs');
    const gradient = node('linearGradient', { id: gradientId, x1: '0', y1: '0', x2: '0', y2: '1' });
    gradient.append(node('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': 0.32 }),
      node('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': 0 }));
    defs.appendChild(gradient); svg.appendChild(defs);
    const area = 'M' + positions.map(([x, y]) => x.toFixed(2) + ',' + y.toFixed(2)).join(' L') +
      ' L392,88 L8,88 Z';
    svg.append(
      node('path', { d: area, fill: 'url(#' + gradientId + ')' }),
      node('polyline', { points, stroke: color, 'stroke-width': 2.3, fill: 'none',
        'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }),
      node('circle', { cx: positions[positions.length - 1][0], cy: positions[positions.length - 1][1], r: 3, fill: color })
    );
    const last = daily[daily.length - 1];
    svg.appendChild(node('title', {}, 'Latest date ' + last.date + ': ' + number(last[key]) + ' ' + key));
  }
  function reliabilityChart(containerId, daily) {
    const { container, svg } = chartRoot(containerId);
    if (!daily) { empty(container, 'Activity export not available'); return; }
    if (!daily.some(row => number(row.attempts) > 0)) {
      empty(container, 'No completed collection jobs in this period'); return;
    }
    axes(svg);
    const max = Math.max(1, ...daily.map(row => number(row.attempts)));
    daily.forEach((row, i) => {
      const x = 8 + (i / Math.max(1, daily.length - 1)) * 376;
      const success = (number(row.succeeded) / max) * 66;
      const failed = (number(row.failed) / max) * 66;
      const group = node('g');
      if (success) group.appendChild(node('rect', { x, y: 88 - success, width: 7, height: success, rx: 1, fill: COLORS.green }));
      if (failed) group.appendChild(node('rect', { x, y: 88 - success - failed, width: 7, height: failed, rx: 1, fill: COLORS.magenta }));
      group.appendChild(node('title', {}, row.date + ': ' + number(row.succeeded) + ' succeeded, ' +
        number(row.failed) + ' failed, ' + number(row.attempts) + ' attempted'));
      svg.appendChild(group);
    });
  }
  function freshnessChart(containerId, buckets) {
    const { container, svg } = chartRoot(containerId);
    const total = buckets.reduce((s, x) => s + x, 0);
    if (!total) { empty(container, 'No dated observations available'); return; }
    const labels = ['≤24H', '1–3D', '3–7D', '>7D'];
    const colors = [COLORS.green, COLORS.teal, COLORS.amber, COLORS.magenta];
    let offset = 0;
    buckets.forEach((count, i) => {
      const width = count / total * 384;
      if (width > 0) svg.appendChild(node('rect', { x: 8 + offset, y: 26, width, height: 23, fill: colors[i] }));
      offset += width;
    });
    buckets.forEach((count, i) => {
      const x = 8 + i * 98;
      svg.append(
        node('rect', { x, y: 71, width: 7, height: 7, rx: 1, fill: colors[i] }),
        node('text', { x: x + 12, y: 78, fill: '#b3b8bc', 'font-size': 10 }, labels[i]),
        node('text', { x, y: 97, fill: '#ecf1ef', 'font-size': 12, 'font-weight': 600 }, compact(count))
      );
    });
    svg.appendChild(node('title', {}, 'Observed IDs by age of latest observation; missing catalog IDs excluded'));
  }
  function setText(id, value) { document.getElementById(id).textContent = value; }

  function render(meta, apps) {
    const report = summarize(meta, apps);
    setText('insightObservationsValue', report.observations === null ? '—' : compact(report.observations));
    setText('insightFirstSeenValue', report.firstSeen === null ? '—' : compact(report.firstSeen));
    setText('insightSuccessValue', report.successRate === null ? '—' : report.successRate.toFixed(1) + '%');
    setText('insightFreshValue', compact(report.fresh24));
    setText('insightObservationsNote', report.daily ? 'Metric rows, including chart observations · 30 days' : 'Run export after updating code');
    setText('insightFirstSeenNote', report.daily ? 'First observed in TrendLab, not newly published' : 'Run export after updating code');
    setText('insightSuccessNote', report.daily ? compact(report.succeeded) + ' succeeded / ' +
      compact(report.attempts) + ' attempted in completed cycles' : 'Run export after updating code');
    setText('insightFreshNote', 'Latest snapshot ≤24 hours · ' + compact(report.freshnessCount) + ' dated IDs');
    lineChart('insightObservationsChart', report.daily, 'observationRows', COLORS.green, 'obsFill');
    lineChart('insightFirstSeenChart', report.daily, 'newlyObserved', COLORS.blue, 'firstFill');
    reliabilityChart('insightSuccessChart', report.daily);
    freshnessChart('insightFreshnessChart', report.buckets);
  }

  return { summarize, render };
})();
if (typeof window !== 'undefined') window.TrendLabInsights = TrendLabInsights;
if (typeof module !== 'undefined' && module.exports) module.exports = TrendLabInsights;
