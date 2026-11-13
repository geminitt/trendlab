'use strict';

// Public Apple Top Free iPhone Education chart, scoped by country and genre.
// This deliberately avoids app-store-scraper -> deprecated request/form-data.
// Legacy iTunes RSS remains category-aware; the newer Marketing Tools v2
// "top-free" feed is NOT interchangeable because it lacks genre filtering.
const https = require('node:https');

const BASE_HOST = 'itunes.apple.com';
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 15000;

function chartUrl(storefront, genreId = 6017, limit = 100) {
  if (typeof storefront !== 'string' || !/^[a-z]{2}$/.test(storefront)) {
    throw new Error('Invalid Apple chart storefront');
  }
  if (!Number.isSafeInteger(genreId) || genreId < 1) throw new Error('Invalid Apple genre');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Apple chart limit must be 1..100');
  }
  return `https://${BASE_HOST}/${storefront}/rss/topfreeapplications/limit=${limit}/genre=${genreId}/json`;
}

function parseAppleChart(payload) {
  if (!payload || !payload.feed || !Array.isArray(payload.feed.entry) ||
      payload.feed.entry.length === 0 || payload.feed.entry.length > 100) {
    throw new Error('Apple Education chart has no valid nonempty feed.entry array');
  }
  const seen = new Set();
  return payload.feed.entry.map((entry, index) => {
    const id = entry?.id?.attributes?.['im:id'];
    const title = entry?.['im:name']?.label;
    const developer = entry?.['im:artist']?.label || null;
    if (!/^\d+$/.test(String(id || '')) || typeof title !== 'string' ||
        !title.trim() || seen.has(String(id))) {
      throw new Error('Malformed or duplicate Apple chart entry at rank ' + (index + 1));
    }
    seen.add(String(id));
    const value = Number(entry?.['im:price']?.attributes?.amount);
    return {
      id: String(id),
      title,
      developer,
      // The requested chart is Top Free. Do not trust missing price metadata
      // to infer a paid price; preserve the original zero default.
      price: Number.isFinite(value) && value >= 0 ? value : 0
    };
  });
}

function fetchJson(url, redirects = 0) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== BASE_HOST) {
    return Promise.reject(new Error('Refusing non-Apple RSS origin'));
  }
  if (redirects > 2) return Promise.reject(new Error('Too many Apple RSS redirects'));
  return new Promise((resolve, reject) => {
    const request = https.get(parsed, {
      headers: {
        'User-Agent': 'TrendLab/1.0',
        Accept: 'application/json'
      }
    }, response => {
      const status = response.statusCode || 0;
      if ([301, 302, 307, 308].includes(status)) {
        const destination = response.headers.location;
        response.resume();
        if (!destination) return reject(new Error('Apple RSS redirect without Location'));
        const nextUrl = new URL(destination, parsed).toString();
        fetchJson(nextUrl, redirects + 1).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error('Apple RSS HTTP ' + status));
        return;
      }
      let size = 0;
      const chunks = [];
      response.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          response.destroy(new Error('Apple RSS response exceeds 4 MiB'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (error) {
          reject(new Error('Apple RSS returned invalid JSON: ' + error.message));
        }
      });
      response.on('error', reject);
    });
    request.on('error', reject);
    request.setTimeout(TIMEOUT_MS, () => request.destroy(new Error('Apple RSS timeout')));
  });
}

async function getAppleEducationTopFree(storefront, genreId = 6017, limit = 100, requestJson = fetchJson) {
  const payload = await requestJson(chartUrl(storefront, genreId, limit));
  return parseAppleChart(payload);
}

module.exports = { chartUrl, parseAppleChart, getAppleEducationTopFree };
