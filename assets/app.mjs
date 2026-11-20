/* Resolved-markets page module (ES module, loaded by resolved.html).
 *
 * Shows markets whose official result is set (YES / NO) for the five tracked topics:
 *   1. the Actions-verified snapshot (data/resolved.json — collected by scripts/collect.py
 *      from the official demo API, every row carrying the request URL it came from);
 *   2. a live refresh of the newest settled in-scope markets straight from
 *      GET /markets?status=settled (documented status filter).
 *
 * Every value shown is returned by the official demo API. Nothing is inferred:
 * a market with no official yes/no result is not listed, and the counts of the
 * snapshot (how many settled markets exist vs how many are shown) are printed
 * so the size of the window is never implied.
 *
 * Sources:
 *   https://docs.kalshi.com/getting_started/market_lifecycle   (statuses, filters)
 *   https://docs.kalshi.com/api-reference/market/get-markets    (fields)
 *   https://external-api.demo.kalshi.co/trade-api/v2             (demo REST API)
 */
import { API_BASES } from './lib.mjs';

const BASE = API_BASES.demo;
const ROOT = new URL('../', import.meta.url);          // site root (this file is in /assets)
const TOPIC_IDS = ['gas-prices', 'elections', 'culture', 'crypto', 'golf'];
const TOPIC_LABEL = {
  'gas-prices': 'Gas prices', elections: 'Elections', culture: 'Culture',
  crypto: 'Crypto', golf: 'Golf'
};
const REFRESH_MS = 60000;

const NAV = [
  ['index.html', 'Home'], ['executive-summary.html', 'Summary'], ['dashboard.html', 'Dashboard'],
  ['trades.html', 'Strategy lab'], ['demo-account/', 'Demo Account'], ['portfolio.html', 'Portfolio'],
  ['topics/gas-prices.html', 'Gas'], ['topics/elections.html', 'Elections'],
  ['topics/culture.html', 'Culture'], ['topics/crypto.html', 'Crypto'], ['topics/golf.html', 'Golf'],
  ['data.html', 'Data'], ['methods.html', 'Methods'], ['suggestions.html', 'Ideas'],
  ['flagged.html', 'Flagged'], ['sources.html', 'Sources']
];

const state = {
  rows: [],            // merged rows (snapshot first, live rows marked)
  snapshot: null,      // data/resolved.json
  seriesTopic: new Map(),   // series ticker -> topic id (from the topic snapshots)
  seriesTitle: new Map(),   // series ticker -> series title
  liveCount: 0,
  lastLive: null,
  error: ''
};

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function $(sel) { return document.querySelector(sel); }
function ts(s) { return s ? String(s).slice(0, 19).replace('T', ' ') + 'Z' : '—'; }
function apiMarketUrl(ticker) { return BASE + '/markets/' + encodeURIComponent(String(ticker || '')); }
function apiTickersUrl(tickers) { return BASE + '/markets?tickers=' + encodeURIComponent(String(tickers || '')); }
function seriesUrl(series) { return series ? 'https://kalshi.com/markets/' + encodeURIComponent(String(series).toLowerCase()) : ''; }

/* Kalshi's ticker format is {SERIES}-{EVENT}-{STRIKE}; the series is the part before
 * the first "-" (the same rule the CI ledger uses; the series page URL shape is the one
 * shown in the official Quick Start guide). */
function seriesPrefix(ticker) {
  const t = String(ticker || '');
  const i = t.indexOf('-');
  return i === -1 ? t : t.slice(0, i);
}

function buildNav() {
  const nav = $('#nav');
  if (!nav) return;
  if (nav.querySelector('nav.mainnav')) return;   // the page ships its own navigation
  const here = (location.pathname.split('/').pop() || 'index.html');
  nav.className = 'top';
  nav.innerHTML = '<div class="brand"><div class="mark">K</div><div><h1>Kalshi Demo Monitor</h1>' +
    '<p>Live dashboard, alerting, and strategy lab on the official Kalshi demo Trade API</p></div></div>' +
    '<nav class="mainnav">' + NAV.map(([href, label]) =>
      '<a href="' + ROOT.pathname + href + '"' + (here === href ? ' class="active"' : '') + '>' + label + '</a>'
    ).join('') + '</nav>';
}

async function loadTopics() {
  for (const id of TOPIC_IDS) {
    try {
      const res = await fetch(new URL('data/topics/' + id + '.json', ROOT), { cache: 'no-store' });
      if (!res.ok) continue;
      const doc = await res.json();
      for (const ev of doc.events || []) {
        const series = ev.series_ticker;
        if (!series) continue;
        if (!state.seriesTopic.has(series)) state.seriesTopic.set(series, id);
        if (!state.seriesTitle.has(series)) state.seriesTitle.set(series, ev.title || series);
      }
    } catch (e) { /* topic snapshot unavailable - the live refresh simply has no scope filter */ }
  }
}

async function loadSnapshot() {
  try {
    const res = await fetch(new URL('data/resolved.json', ROOT), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const doc = await res.json();
    state.snapshot = doc;
    for (const m of doc.markets || []) {
      state.rows.push({
        ticker: m.ticker, event_ticker: m.event_ticker, title: m.title,
        series: seriesPrefix(m.ticker), topic: m._topic || null,
        result: m.result, settlement_ts: m.settlement_ts, status: m.status,
        source: apiMarketUrl(m.ticker), live: false
      });
    }
  } catch (e) {
    state.error = 'snapshot unavailable: ' + e.message;
  }
}

/* Live refresh: the newest settled markets across the exchange, kept only when their
 * series is one of the in-scope series (taken from the committed topic snapshots). */
async function pollLive() {
  if (!state.seriesTopic.size) return;
  const url = BASE + '/markets?status=settled&limit=1000&mve_filter=exclude';
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const doc = await res.json();
    const seen = new Set(state.rows.map(r => r.ticker));
    let added = 0;
    for (const m of doc.markets || []) {
      if (!m.ticker || seen.has(m.ticker)) continue;
      if (m.result !== 'yes' && m.result !== 'no') continue;
      const series = seriesPrefix(m.ticker);
      const topic = state.seriesTopic.get(series);
      if (!topic) continue;
      seen.add(m.ticker);
      state.rows.unshift({
        ticker: m.ticker, event_ticker: m.event_ticker, title: m.title,
        series, topic, result: m.result, settlement_ts: m.settlement_ts, status: m.status,
        source: apiMarketUrl(m.ticker), live: true
      });
      added++;
    }
    state.liveCount += added;
    state.lastLive = new Date().toISOString();
    state.error = '';
    if (added) render();
  } catch (e) {
    state.error = 'live refresh failed: ' + e.message;
  }
}

function render() {
  const body = $('#resolvedBody');
  const count = $('#resolvedCount');
  const note = $('#resolvedNote');
  if (count) {
    count.textContent = state.rows.length + ' shown';
  }
  if (note) {
    const snap = state.snapshot || {};
    const bits = [];
    if (snap.generated_at) bits.push('snapshot collected ' + ts(snap.generated_at).replace('Z', ''));
    if (snap.in_scope_count !== undefined) {
      bits.push('the snapshot holds the newest <b>' + (snap.markets || []).length + '</b> of <b>' +
        snap.in_scope_count + '</b> in-scope markets settled in the last ' +
        (String(snap.window || '').match(/last\s+(.+)$/) || [, '72 h'])[1] +
        (snap.settled_total !== undefined ? ' (' + snap.settled_total + ' settled markets on the exchange in that window)' : ''));
    }
    if (state.liveCount) bits.push('<b>' + state.liveCount + '</b> newer in-scope resolutions added live');
    if (state.lastLive) bits.push('last live check ' + ts(state.lastLive).replace('Z', ''));
    if (state.error) bits.unshift('<span class="warn">' + esc(state.error) + '</span>');
    note.innerHTML = bits.join(' · ');
  }
  if (!body) return;
  body.innerHTML = state.rows.map(r => {
    const k = seriesUrl(r.series);
    const topic = r.topic ? (TOPIC_LABEL[r.topic] || r.topic) : '—';
    return '<tr>' +
      '<td>' + (k ? '<a href="' + esc(k) + '" target="_blank" rel="noopener">' + esc(r.title || r.ticker) + '</a>' : esc(r.title || r.ticker)) +
      ' · <a class="small" href="' + esc(apiMarketUrl(r.ticker)) + '" target="_blank" rel="noopener">API</a>' +
      '<br><small class="muted">' + esc(r.ticker) + (r.live ? ' · live' : '') + '</small></td>' +
      '<td>' + esc(topic) + '</td>' +
      '<td><span class="badge ' + (r.result === 'yes' ? 'yes' : 'no') + '">' + esc(String(r.result || '').toUpperCase()) + '</span></td>' +
      '<td class="muted">' + esc(ts(r.settlement_ts)) + '</td>' +
      '<td class="muted">' + esc(r.status || '') + '</td>' +
      '<td class="src"><a href="' + esc(r.source) + '" target="_blank" rel="noopener">API</a></td>' +
      '</tr>';
  }).join('') || '<tr><td colspan="6" class="empty">No resolved in-scope markets in the snapshot yet.</td></tr>';
}

(async function boot() {
  buildNav();
  await loadTopics();
  await loadSnapshot();
  render();
  await pollLive();
  setInterval(pollLive, REFRESH_MS);
})();
