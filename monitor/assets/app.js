/* Kalshi Demo Monitor — shared client engine
 * Architecture: 100% client-side. The browser talks directly to the official
 * Kalshi demo REST API (public, unauthenticated market-data endpoints only).
 * No credentials are requested, stored, or transmitted. Paper trading is
 * simulated locally and never sends orders to the exchange.
 * Data verification policy: every displayed live value comes from a response
 * fetched at view time from the official API; every committed snapshot value
 * carries the request URL that produced it (see site/data/*.json).
 */
(() => {
'use strict';

/* ============================== 1. CONFIG ============================== */
const API = 'https://external-api.demo.kalshi.co/trade-api/v2';
const DEMO_SITE = 'https://demo.kalshi.co/';
const DOCS = {
  demoEnv: 'https://docs.kalshi.com/getting_started/demo_env',
  marketData: 'https://docs.kalshi.com/getting_started/quick_start_market_data',
  ws: 'https://docs.kalshi.com/getting_started/quick_start_websockets',
  getMarkets: 'https://docs.kalshi.com/api-reference/market/get-markets',
  orderbook: 'https://docs.kalshi.com/api-reference/market/get-market-orderbook',
  candlesticks: 'https://docs.kalshi.com/api-reference/market/get-market-candlesticks',
  trades: 'https://docs.kalshi.com/api-reference/market/get-trades',
  seriesList: 'https://docs.kalshi.com/api-reference/market/get-series-list',
  rateLimits: 'https://docs.kalshi.com/getting_started/rate_limits',
  fees: 'https://kalshi.com/docs/kalshi-fee-schedule.pdf',
  events: 'https://docs.kalshi.com/api-reference/events/get-events',
  settlement: 'https://docs.kalshi.com/getting_started/market_settlement'
};
const TOPICS = {
  crypto:    { label: 'Crypto',      cls: 'topic-crypto' },
  elections: { label: 'Elections',   cls: 'topic-elections' },
  culture:   { label: 'Culture',     cls: 'topic-culture' },
  gas:       { label: 'Gas prices',  cls: 'topic-gas' },
  golf:      { label: 'Golf',        cls: 'topic-golf' }
};
const TOPIC_KEYS = Object.keys(TOPICS);
const PAGE = document.body.dataset.page || '';
const PAGE_TOPIC = document.body.dataset.topic || '';
const LS = {
  settings: 'kalshi-mon:settings',
  series: 'kalshi-mon:series-sets',
  catalog: 'kalshi-mon:catalog-cache',
  alerts: 'kalshi-mon:alerts',
  picks: 'kalshi-mon:picks',
  resolutions: 'kalshi-mon:resolutions',
  positions: 'kalshi-mon:positions',
  closed: 'kalshi-mon:closed-trades',
  equity: 'kalshi-mon:equity'
};
const DEFAULT_SETTINGS = {
  threshold: 0.10,       // $ swing that triggers an alert (requirement: >= $0.10)
  watchCount: 12,        // top events followed by the watcher
  botOn: true,           // automated paper-trading engine
  bankroll: 10000,
  riskPct: 2,            // % of bankroll risked per trade
  strategies: { momentum: true, fade: true, extreme: true, scalp: true },
  window: 300,           // chart window seconds (60|300|900|3600|21600|86400)
  paused: false          // global polling pause
};

/* ============================== 2. UTILS ============================== */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const nowS = () => Math.floor(Date.now() / 1000);
function parseD(v) { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function fmtMoney(v, dash) { if (v == null || !Number.isFinite(v)) return dash || ''; return '$' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtPx(v, dash) { if (v == null || !Number.isFinite(v)) return dash || ''; return '$' + v.toFixed(2); }
function fmtC(v, dash) { if (v == null || !Number.isFinite(v)) return dash || ''; return v.toLocaleString(undefined, { maximumFractionDigits: 0 }); }
function fmtPct(v, dash) { if (v == null || !Number.isFinite(v)) return dash || ''; return (v * 100).toFixed(1) + '%'; }
function fmtTime(ts, secs) { const d = new Date(ts); return secs ? d.toLocaleTimeString() : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function fmtAgo(ts) { const s = Math.max(0, Math.floor((Date.now() - ts) / 1000)); if (s < 60) return s + 's ago'; const m = Math.floor(s / 60); if (m < 60) return m + 'm ago'; return Math.floor(m / 60) + 'h ago'; }
function lsGet(key, def) { try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? def : v; } catch { return def; } }
function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* quota */ } }
function capPush(arr, item, cap) { arr.push(item); if (arr.length > cap) arr.splice(0, arr.length - cap); }
function download(name, obj) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ============================== 3. API CLIENT ============================== */
/* Serialized request queue with a minimum gap (unauthenticated rate limits are
 * documented as separate/undisclosed — docs.kalshi.com/getting_started/rate_limits),
 * exponential backoff on HTTP 429, and 15s timeouts. */
let _lastCall = 0, _backoffUntil = 0, _backoffMs = 1000, _chain = Promise.resolve();
const stats = { requests: 0, errors: 0, throttles: 0, lastOk: 0, state: 'init', lastError: '' };

function api(path, params) {
  const run = async () => {
    if (S.settings.paused) throw new Error('paused');
    while (Date.now() < _backoffUntil) await sleep(Math.min(_backoffUntil - Date.now(), 1000));
    const gap = 350 - (Date.now() - _lastCall);
    if (gap > 0) await sleep(gap);
    _lastCall = Date.now();
    const url = new URL(API + path);
    if (params) for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 15000);
    try {
      stats.requests++;
      const res = await fetch(url.toString(), { cache: 'no-store', signal: ctrl.signal });
      if (res.status === 429) {
        stats.throttles++;
        _backoffUntil = Date.now() + _backoffMs;
        _backoffMs = Math.min(_backoffMs * 2, 30000);
        throw new Error('HTTP 429 (rate limited) — backing off ' + Math.round(_backoffMs / 1000) + 's');
      }
      if (!res.ok) throw new Error('HTTP ' + res.status + ' from ' + path);
      _backoffMs = 1000;
      stats.lastOk = Date.now();
      stats.state = 'live';
      return await res.json();
    } catch (e) {
      if (e.name === 'AbortError') { stats.errors++; stats.lastError = 'timeout on ' + path; throw new Error('request timeout: ' + path); }
      stats.errors++;
      if (!String(e.message).startsWith('HTTP 429')) { stats.lastError = e.message; if (stats.state === 'init' || String(e.message).includes('Failed to fetch')) stats.state = 'blocked'; }
      throw e;
    } finally { clearTimeout(to); renderStatus(); }
  };
  const next = _chain.then(run, run);
  _chain = next.then(() => {}, () => {});
  return next;
}

/* ============================== 4. STATE ============================== */
const S = {
  settings: Object.assign({}, DEFAULT_SETTINGS, lsGet(LS.settings, {})),
  events: new Map(),        // event_ticker -> event object (+ _topic, _agg)
  markets: new Map(),       // market ticker -> market object (+ parsed fields, _topic)
  seriesSets: { crypto: new Set(), golf: new Set(), gas: new Set() },
  seriesMeta: { crypto: [], golf: [], gas: [] },   // for topic source tables
  alerts: lsGet(LS.alerts, []),             // alert feed entries (all events)
  picks: lsGet(LS.picks, []),               // model-pick feed entries
  resolutions: lsGet(LS.resolutions, []),   // resolution archive
  positions: lsGet(LS.positions, []),       // open paper positions
  closed: lsGet(LS.closed, []),             // closed paper trades
  equity: lsGet(LS.equity, []),             // [{t, equity}] samples
  samples: new Map(),       // ticker -> [{t,last,bid,ask,mid}]
  candles: new Map(),       // ticker -> {fetchedAt, points:[{t,close}]}
  orderbook: null,          // selected market ladder
  tape: [],                 // selected market recent trades
  watch: [],                // event tickers followed by the watcher
  watchIdx: 0,
  selected: null,           // selected market ticker
  trackedEvents: new Set(), // events we must follow to resolution
  seenOpenMarkets: new Set(),
  boot: { phase: 'init', progress: '' }
};
function saveSettings() { lsSet(LS.settings, S.settings); }

/* Official fee schedule (effective 2026-07-07):
 * taker: fees = round_up(0.07 * C * P * (1-P))  [M multiplier per series; demo series checked are M=1]
 * maker: 0.0175 * C * P * (1-P) with default M=0 for 'quadratic' series (maker fees not charged).
 * Source: https://kalshi.com/docs/kalshi-fee-schedule.pdf */
function takerFee(price, count) {
  if (!(price > 0) || !(count > 0)) return 0;
  // Integer-cent rounding with a float-epsilon guard: 0.07×100×0.5×0.5 = 1.75
  // (official table) must not ceil to 1.76 from binary float noise.
  const rawCents = 0.07 * count * price * (1 - price) * 100;
  return Math.ceil(rawCents - 1e-9) / 100;
}
function makerFee(price, count) { return 0; } // quadratic series: maker multiplier M defaults to 0

/* ============================== 5. TOPIC CLASSIFIER ============================== */
/* Deterministic rules, documented on each topic page:
 * 1) exact series whitelists fetched live from /series?category=Crypto,
 *    /series?tags=Golf, and gas series prefixes verified on demo;
 * 2) event.category exact match ('Elections', 'Culture' — both verified to
 *    exist on demo);
 * 3) title/keyword rules as a fallback.
 * An event is assigned to exactly one topic (first match wins) to keep topics
 * separate; 'All' shows everything matched to any of the five topics. */
const KW = {
  crypto: /\b(bitcoin|btc|ethereum|ether\b|eth\b|solana|solk|xrp|ripple|dogecoin|shiba|crypto|blockchain)\b/i,
  golf: /\b(golf|pga|liv\s?golf|ryder\s?cup|masters\b.*(golf|winner)|the\s?open\b.*(golf|claret)|presidents\s?cup|fedex\s?cup)\b/i,
  gas: /\b(gas|gasoline|fuel)\s+(price|prices)\b|\bgas\s+price\b|\bweekly\s+gas\b/i,
  elections: /\b(election|senate|senator|house\s+(seat|race|control)|governor|president|vice\s?president|congress|mayor|primary|nominee|nomination|ballot|referendum|poll\b|parliament|prime\s?minister)\b/i,
  culture: /\b(movie|film|box\s?office|grammy|oscar|academy\s?award|emmy|album|music\s+award|met\s?gala|tiktok|influencer|celebrit|saturday\s?night\s?live|tv\s+show|streaming\s+show|time\s?person\s+of\s+the\s+year|banned\s+from\s+x|viral)\b/i
};
function topicOf(event) {
  const st = event.series_ticker || '';
  const title = ((event.title || '') + ' ' + (event.sub_title || '')) ;
  if (S.seriesSets.golf.has(st) || KW.golf.test(title)) return 'golf';
  if (S.seriesSets.crypto.has(st) || /crypto/i.test(event.category || '') || KW.crypto.test(title)) return 'crypto';
  if (/^KXGAS/.test(st) || /^KXAAAGAS/.test(st) || S.seriesSets.gas.has(st) || KW.gas.test(title)) return 'gas';
  if ((event.category || '') === 'Elections' || KW.elections.test(title)) return 'elections';
  if ((event.category || '') === 'Culture' || KW.culture.test(title)) return 'culture';
  return null;
}

/* ============================== 6. PARSING / AGGREGATION ============================== */
function hydrateMarket(raw) {
  const m = {
    ticker: raw.ticker, event_ticker: raw.event_ticker,
    title: raw.title || raw.ticker, subtitle: raw.subtitle || raw.yes_sub_title || '',
    status: raw.status, result: raw.result || '',
    last: parseD(raw.last_price_dollars), bid: parseD(raw.yes_bid_dollars), ask: parseD(raw.yes_ask_dollars),
    bidSize: parseD(raw.yes_bid_size_fp), askSize: parseD(raw.yes_ask_size_fp),
    noBid: parseD(raw.no_bid_dollars), noAsk: parseD(raw.no_ask_dollars),
    volume: parseD(raw.volume_fp), volume24: parseD(raw.volume_24h_fp), oi: parseD(raw.open_interest_fp),
    prevPrice: parseD(raw.previous_price_dollars),
    rules: raw.rules_primary || '', closeTime: raw.close_time, canCloseEarly: raw.can_close_early,
    earlyClose: raw.early_close_condition || '', strikeType: raw.strike_type,
    updated: Date.now(), _raw: raw
  };
  m.mid = (m.bid != null && m.ask != null && m.ask >= m.bid) ? (m.bid + m.ask) / 2 : m.last;
  m.spread = (m.bid != null && m.ask != null) ? Math.max(0, m.ask - m.bid) : null;
  // Estimated traded dollars: volume (contracts) x last traded price. Kalshi's
  // API publishes volume in contracts, not official dollar volume, so this is
  // an estimate and is labeled as one everywhere it is shown.
  m.estDollars = (m.volume != null && m.last != null) ? m.volume * m.last : null;
  m.estOI = (m.oi != null && m.mid != null) ? m.oi * m.mid : null;
  return m;
}
function aggregate() {
  for (const ev of S.events.values()) {
    ev._agg = { estDollars: 0, estOI: 0, volume: 0, volume24: 0, markets: 0, liquid: 0, topMarket: null };
  }
  for (const m of S.markets.values()) {
    const ev = S.events.get(m.event_ticker);
    if (!ev || ev._topic == null) continue;
    const a = ev._agg;
    a.markets++;
    if (m.estDollars != null) a.estDollars += m.estDollars;
    if (m.estOI != null) a.estOI += m.estOI;
    if (m.volume != null) a.volume += m.volume;
    if (m.volume24 != null) a.volume24 += m.volume24;
    if (m.bid != null && m.ask != null && m.bid > 0 && m.ask < 1) a.liquid++;
    if (!a.topMarket || (m.estDollars || 0) > (a.topMarket.estDollars || 0)) a.topMarket = m;
  }
}
function topicEvents() {
  const out = [];
  for (const ev of S.events.values()) if (ev._topic != null) out.push(ev);
  return out;
}
function inScopeMarkets() {
  const out = [];
  for (const m of S.markets.values()) {
    const ev = S.events.get(m.event_ticker);
    if (ev && ev._topic != null) out.push(m);
  }
  return out;
}

/* ============================== 7. BOOTSTRAP ============================== */
const CATALOG_TTL = 10 * 60 * 1000, SERIES_TTL = 24 * 60 * 60 * 1000;
async function loadSeriesSets() {
  const cached = lsGet(LS.series, null);
  if (cached && Date.now() - cached.at < SERIES_TTL) {
    S.seriesSets.crypto = new Set(cached.crypto); S.seriesSets.golf = new Set(cached.golf); S.seriesSets.gas = new Set(cached.gas);
    S.seriesMeta = cached.meta || S.seriesMeta;
    return;
  }
  try {
    const [crypto, golf] = await Promise.all([api('/series', { category: 'Crypto' }), api('/series', { tags: 'Golf' })]);
    S.seriesSets.crypto = new Set((crypto.series || []).map(s => s.ticker));
    S.seriesSets.golf = new Set((golf.series || []).map(s => s.ticker));
    S.seriesMeta.crypto = crypto.series || [];
    S.seriesMeta.golf = golf.series || [];
    // Gas: verify the two known gas series live; demo may add more later.
    const gasMeta = [];
    for (const t of ['KXGAS', 'KXAAAGASM']) {
      try { const r = await api('/series/' + t); gasMeta.push(r.series); S.seriesSets.gas.add(t); } catch { /* absent */ }
    }
    S.seriesMeta.gas = gasMeta;
    lsSet(LS.series, { at: Date.now(), crypto: [...S.seriesSets.crypto], golf: [...S.seriesSets.golf], gas: [...S.seriesSets.gas], meta: S.seriesMeta });
  } catch (e) {
    throw e; // caller decides how to degrade
  }
}
async function fetchEventsPages(maxPages) {
  let cursor = '', pages = 0, total = 0;
  do {
    const d = await api('/events', { status: 'open', limit: 1000, cursor: cursor || undefined });
    for (const ev of d.events || []) { S.events.set(ev.event_ticker, ev); total++; }
    cursor = d.cursor || ''; pages++;
  } while (cursor && pages < maxPages);
  return total;
}
async function fetchMarketsPages(maxPages) {
  let cursor = '', pages = 0, total = 0;
  do {
    const d = await api('/markets', { status: 'open', limit: 1000, cursor: cursor || undefined });
    for (const raw of d.markets || []) { S.markets.set(raw.ticker, hydrateMarket(raw)); total++; }
    cursor = d.cursor || ''; pages++;
  } while (cursor && pages < maxPages);
  return total;
}
async function bootstrap() {
  S.boot = { phase: 'loading', progress: 'fetching official topic whitelists…' }; renderBoot();
  try {
    await loadSeriesSets();
    // fast path: recent catalog cache
    const cached = lsGet(LS.catalog, null);
    if (cached && Date.now() - cached.at < CATALOG_TTL) {
      S.events = new Map(cached.events); S.markets = new Map(cached.markets.map(hydrateMarket).map(m => [m.ticker, m]));
      for (const ev of S.events.values()) ev._topic = topicOf(ev);
      classifyMarkets(); aggregate();
      S.boot = { phase: 'live', progress: 'cached catalog (' + fmtAgo(cached.at) + '), refreshing…' };
      renderBoot(); afterBoot();
      refreshCatalog(true); // refresh in background
      return;
    }
    S.boot = { phase: 'loading', progress: 'fetching open events…' }; renderBoot();
    const ne = await fetchEventsPages(5);
    for (const ev of S.events.values()) ev._topic = topicOf(ev);
    S.boot = { phase: 'loading', progress: `fetched ${ne} open events · fetching open markets…` }; renderBoot();
    const nm = await fetchMarketsPages(6);
    classifyMarkets(); aggregate();
    lsSet(LS.catalog, { at: Date.now(), events: [...S.events.values()], markets: [...S.markets.values()].map(stripRaw) });
    S.boot = { phase: 'live', progress: `${ne} events · ${nm} open markets scanned` };
    renderBoot(); afterBoot();
  } catch (e) {
    S.boot = { phase: 'error', progress: e.message };
    renderBoot(); renderApiBlocked(e);
  }
}
function stripRaw(m) { const c = Object.assign({}, m); delete c._raw; return c; }
function classifyMarkets() { for (const m of S.markets.values()) m._topic = (S.events.get(m.event_ticker) || {})._topic ?? null; }
async function refreshCatalog(background) {
  try {
    await fetchEventsPages(3);
    for (const ev of S.events.values()) if (ev._topic == null) ev._topic = topicOf(ev);
    await fetchMarketsPages(4);
    classifyMarkets(); aggregate();
    lsSet(LS.catalog, { at: Date.now(), events: [...S.events.values()], markets: [...S.markets.values()].map(stripRaw) });
    detectNewOpens();
    ensureWatch();
    if (!background) renderAll();
    else renderTables();
  } catch (e) { if (!background) renderApiBlocked(e); }
}

/* ============================== 8. WATCH + ALERT ENGINE ============================== */
function ensureWatch() {
  const ranked = topicEvents().sort((a, b) => (b._agg.estDollars || 0) - (a._agg.estDollars || 0));
  S.watch = ranked.slice(0, S.settings.watchCount).map(e => e.event_ticker);
  for (const t of S.watch) S.trackedEvents.add(t);
  for (const p of S.positions) if (p.status === 'open') S.trackedEvents.add(p.event_ticker);
  for (const a of S.alerts.slice(-50)) if (a.event_ticker) S.trackedEvents.add(a.event_ticker);
}
function detectNewOpens() {
  for (const m of S.markets.values()) {
    if (m._topic == null) continue;
    if (!S.seenOpenMarkets.has(m.ticker)) {
      S.seenOpenMarkets.add(m.ticker);
      if (S.boot.seeded) chatPush(S.alerts, {
        kind: 'info', t: Date.now(), topic: m._topic,
        text: 'New open market: ' + m.title,
        ticker: m.ticker, event_ticker: m.event_ticker
      }, 400);
    }
  }
  S.boot.seeded = true;
}
/* One alert when a market's price moves by >= threshold between consecutive
 * observations, and a second source when the exchange's own previous_price
 * field differs from the last traded price by >= threshold. A 45-second
 * per-market cooldown damps oscillation spam while still allowing genuine
 * follow-on moves. */
function checkAlerts(m, prevObserved) {
  const thC = Math.round(S.settings.threshold * 100), cooldown = 45000;
  let entry = null;
  const obsMoveC = (prevObserved != null && m.last != null) ? Math.round((m.last - prevObserved) * 100) : 0;
  if (obsMoveC !== 0 && Math.abs(obsMoveC) >= thC && (!m.lastAlertTs || Date.now() - m.lastAlertTs >= cooldown)) {
    entry = {
      kind: obsMoveC > 0 ? 'up' : 'down', src: 'observed', t: Date.now(),
      topic: m._topic, ticker: m.ticker, event_ticker: m.event_ticker,
      title: m.title, from: prevObserved, to: m.last, delta: obsMoveC / 100
    };
  } else {
    const repMoveC = (m.prevPrice != null && m.last != null) ? Math.round((m.last - m.prevPrice) * 100) : 0;
    if (Math.abs(repMoveC) >= thC && (!m.lastPrevAlert || m.prevPrice !== m.lastPrevAlert)) {
      // Dedupe: if an observed alert already posted this same arrival price
      // recently, the exchange-reported signal describes the same swing.
      const dup = S.alerts.some(a => a.ticker === m.ticker && a.to === m.last && Date.now() - a.t < 10 * 60 * 1000);
      m.lastPrevAlert = m.prevPrice;
      if (!dup) {
        entry = {
          kind: repMoveC > 0 ? 'up' : 'down', src: 'exchange-reported', t: Date.now(),
          topic: m._topic, ticker: m.ticker, event_ticker: m.event_ticker,
          title: m.title, from: m.prevPrice, to: m.last, delta: repMoveC / 100
        };
      }
    }
  }
  if (entry) {
    m.lastAlertPrice = m.last; m.lastAlertTs = entry.t;
    capPush(S.alerts, entry, 400); lsSet(LS.alerts, S.alerts);
    chatRenderAll();
  }
}
function alertLinks(e) {
  const ev = S.events.get(e.event_ticker) || {};
  const q = encodeURIComponent(ev.title || e.title || e.ticker);
  return `
    <a href="${API}/markets/${encodeURIComponent(e.ticker)}" target="_blank" rel="noopener" title="Official API response for this market">API source ↗</a>
    <a href="${API}/markets?event_ticker=${encodeURIComponent(e.event_ticker)}&status=open" target="_blank" rel="noopener">event data ↗</a>
    <a href="${DEMO_SITE}" target="_blank" rel="noopener">demo.kalshi.co ↗</a>
    <a href="https://news.google.com/search?q=${q}" target="_blank" rel="noopener" title="Possible context — attribution is NOT verified">news context (unverified) ↗</a>`;
}

/* ============================== 9. CHATS ============================== */
function chatItemHtml(e, isModel) {
  const dirCls = e.kind === 'up' ? 'up' : e.kind === 'down' ? 'down' : e.kind === 'model' ? 'model' : 'info';
  const arrow = e.kind === 'up' ? '▲' : e.kind === 'down' ? '▼' : '•';
  const topic = e.topic ? `<span class="pill ${TOPICS[e.topic].cls}">${TOPICS[e.topic].label}</span>` : '';
  let main;
  if (isModel) {
    main = `<div class="title">${arrow} ${esc(e.title || e.ticker)}</div>
      <div>${esc(e.reason)} · entry ${fmtPx(e.entry)} · est. ROI ${fmtPct(e.roi, '—')} <span class="src">(heuristic — not advice)</span></div>`;
  } else if (e.kind === 'info') {
    main = `<div class="title">${arrow} ${esc(e.text)}</div>`;
  } else if (e.kind === 'resolved') {
    main = `<div class="title">${arrow} RESOLVED ${String(e.result).toUpperCase()} — ${esc(e.title)}</div>
      <div>Final result reported by the exchange: <b class="mono">${esc(e.result)}</b> ${e.settledAt ? '· settled ' + esc(e.settledAt) : ''}</div>`;
  } else {
    main = `<div class="title">${arrow} ${esc(e.title)}</div>
      <div>${fmtPx(e.from)} → <b class="num ${e.kind === 'up' ? 'up' : 'down'}">${fmtPx(e.to)}</b> (${e.kind === 'up' ? '+' : '−'}$${Math.abs(e.delta).toFixed(2)}) <span class="src">· ${e.src === 'exchange-reported' ? 'exchange-reported previous→last' : 'between consecutive observations'}</span></div>`;
  }
  const links = (e.kind === 'resolved')
    ? `<a href="${API}/markets/${encodeURIComponent(e.ticker || '')}" target="_blank" rel="noopener">API source ↗</a>`
    : (isModel ? `<a href="${API}/markets/${encodeURIComponent(e.ticker)}" target="_blank" rel="noopener">API source ↗</a>` : alertLinks(e));
  return `<div class="chatitem ${dirCls}">
    <div class="meta"><span>${new Date(e.t).toLocaleTimeString()}</span>${topic}<span class="mono">${esc(e.ticker || '')}</span></div>
    ${main}<div class="links">${links}</div>
  </div>`;
}
function chatRenderAll() {
  renderChat('chatAll', S.alerts, false);
  renderChat('chatModel', S.picks, true);
  if (PAGE === 'topic') renderChat('chatTopic', S.alerts.filter(a => a.topic === PAGE_TOPIC), false);
  if (PAGE === 'findings') renderFindingsArchive();
}
function renderChat(elId, entries, isModel) {
  const el = $(elId); if (!el) return;
  const list = entries.slice(-120).reverse();
  el.innerHTML = list.length
    ? list.map(e => chatItemHtml(e, isModel)).join('')
    : `<div class="chatempty">${isModel
        ? 'No qualifying setups yet. The model only posts when a watched market shows momentum + liquidity + a positive estimated ROI after fees. It stays silent rather than guessing.'
        : 'No alerts yet. Alerts fire when a tracked market moves by at least $' + S.settings.threshold.toFixed(2) + ' between observations (or the exchange reports such a move). Demo markets can be quiet for long stretches — that is genuine market behavior, not an error.'}</div>`;
  const countEl = $(elId + 'Count'); if (countEl) countEl.textContent = entries.length + ' entries';
}
function chatPush(store, entry, cap) { capPush(store, entry, cap || 400); lsSet(store === S.alerts ? LS.alerts : LS.picks, store); }

/* ============================== 10. MODEL (HIGH-ROI FILTER) ============================== */
/* Simple transparent heuristic, documented on strategies.html:
 *   score = 0.40|momentum| + 0.20 volume-surge + 0.20 liquidity + 0.10 tightness + 0.10 tradability
 * A pick posts when score >= 0.62 and estimated ROI after taker fees >= 5%.
 * This is OUR heuristic over official API data — not exchange data and not advice. */
function sampleOf(ticker) { return S.samples.get(ticker) || []; }
function scoreMarket(m) {
  const s = sampleOf(m.ticker).slice(-6);
  if (s.length < 2 || m.last == null) return null;
  const midNow = m.mid != null ? m.mid : m.last;
  const midAgo = s[0].mid != null ? s[0].mid : s[0].last;
  if (midAgo == null || midNow == null) return null;
  const move = midNow - midAgo;
  const spread = m.spread != null ? m.spread : 0.06;
  const momentum = Math.min(1, Math.abs(move) / 0.10);
  const surge = m.volume24 > 0 ? Math.min(1, Math.log10(1 + m.volume24) / 3.5) : 0;
  const liquidity = Math.min(1, ((m.bidSize || 0) + (m.askSize || 0)) / 100);
  const tightness = 1 - Math.min(1, spread / 0.08);
  const mid = midNow;
  const tradability = mid < 0.02 || mid > 0.98 ? 0 : 1 - Math.abs(0.5 - mid);
  const score = 0.40 * momentum + 0.20 * surge + 0.20 * liquidity + 0.10 * tightness + 0.10 * tradability;
  if (move === 0) return { score, move, roi: null, dir: null };
  const dir = move > 0 ? 'up' : 'down';
  const entry = dir === 'up' ? (m.ask != null ? m.ask : mid) : (m.noAsk != null ? m.noAsk : (1 - (m.bid != null ? m.bid : mid)));
  if (!(entry > 0) || entry >= 1) return { score, move, roi: null, dir };
  const target = Math.min(0.99, Math.max(0.01, entry + 0.5 * Math.abs(move)));
  const fee = takerFee(entry, 1) + takerFee(target, 1);
  const roi = (target - entry - fee) / entry;
  return { score, move, roi, dir, entry };
}
function modelTick() {
  const out = [];
  for (const m of inScopeMarkets()) {
    const sc = scoreMarket(m);
    if (!sc || sc.score < 0.62 || sc.roi == null || sc.roi < 0.05) continue;
    const ev = S.events.get(m.event_ticker) || {};
    out.push({ m, sc, ev });
  }
  out.sort((a, b) => b.sc.roi - a.sc.roi);
  return out;
}
let _lastPickAt = new Map();
function modelPost() {
  const ranked = modelTick();
  const now = Date.now();
  for (const { m, sc, ev } of ranked.slice(0, 3)) {
    const last = _lastPickAt.get(m.ticker) || 0;
    if (now - last < 5 * 60 * 1000) continue;
    _lastPickAt.set(m.ticker, now);
    const reason = `${m._topic ? TOPICS[m._topic].label : '—'} · move ${sc.move > 0 ? '+' : '−'}$${Math.abs(sc.move).toFixed(2)} recent · spread ${fmtPx(m.spread, '—')} · visible size ${fmtC((m.bidSize || 0) + (m.askSize || 0))} · 24h vol ${fmtC(m.volume24, '—')}`;
    const entry = { kind: 'model', t: now, topic: m._topic, ticker: m.ticker, event_ticker: m.event_ticker, title: m.title, reason, entry: sc.entry, roi: sc.roi, dir: sc.dir, score: sc.score };
    capPush(S.picks, entry, 300); lsSet(LS.picks, S.picks);
    botSignal(m, sc);
  }
  chatRenderAll();
  renderModelTable(ranked);
}

/* ============================== 11. CHART ============================== */
const WINDOWS = [
  { v: 60, label: '60 seconds' }, { v: 300, label: '5 minutes' }, { v: 900, label: '15 minutes' },
  { v: 3600, label: '1 hour' }, { v: 21600, label: '6 hours' }, { v: 86400, label: '24 hours' }
];
function ensureCandles(ticker, windowS) {
  const cached = S.candles.get(ticker);
  if (cached && Date.now() - cached.fetchedAt < 60000 && cached.span >= windowS) return Promise.resolve();
  const m = S.markets.get(ticker); const ev = m ? S.events.get(m.event_ticker) : null;
  const series = ev ? ev.series_ticker : null;
  if (!series) return Promise.resolve();
  const end = nowS(), start = end - windowS;
  return api(`/series/${encodeURIComponent(series)}/markets/${encodeURIComponent(ticker)}/candlesticks`, { start_ts: start, end_ts: end, period_interval: 1 })
    .then(d => {
      const pts = (d.candlesticks || []).map(c => ({ t: (c.end_period_ts || 0) * 1000, close: parseD(c.price && c.price.close) }));
      S.candles.set(ticker, { fetchedAt: Date.now(), span: windowS, points: pts.filter(p => p.t && p.close != null) });
    }).catch(() => {});
}
function drawChart() {
  const canvas = $('chart'); if (!canvas) return;
  const wrap = canvas.parentElement; const rect = wrap.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  const W = rect.width, H = rect.height, padL = 44, padR = 10, padT = 12, padB = 24;
  ctx.clearRect(0, 0, W, H);
  ctx.font = '10.5px system-ui'; ctx.fillStyle = '#8ba0a3'; ctx.strokeStyle = '#2a3a40';
  const windowMs = S.settings.window * 1000;
  const t0 = Date.now() - windowMs, t1 = Date.now();
  let pts = sampleOf(S.selected).map(p => ({ t: p.t, v: p.mid != null ? p.mid : p.last })).filter(p => p.v != null && p.t >= t0);
  const candleCache = S.candles.get(S.selected);
  if (windowMs >= 3600 * 1000 && candleCache) {
    pts = candleCache.points.map(p => ({ t: p.t, v: p.close })).concat(pts);
  }
  const alerts = S.alerts.filter(a => a.ticker === S.selected && a.t >= t0);
  // grid + y labels
  let lo = 0, hi = 1;
  if (pts.length >= 2) {
    const vs = pts.map(p => p.v);
    lo = Math.max(0, Math.min(...vs) - 0.02); hi = Math.min(1, Math.max(...vs) + 0.02);
    if (hi - lo < 0.04) { const midv = (hi + lo) / 2; lo = Math.max(0, midv - 0.02); hi = Math.min(1, midv + 0.02); }
  }
  const Y = v => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const X = t => padL + ((t - t0) / (t1 - t0)) * (W - padL - padR);
  for (let i = 0; i <= 4; i++) {
    const v = lo + (hi - lo) * i / 4, y = Y(v);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    ctx.fillText('$' + v.toFixed(2), 3, y + 3.5);
  }
  for (let i = 0; i <= 4; i++) {
    const t = t0 + (t1 - t0) * i / 4;
    const lbl = windowMs <= 300000 ? fmtTime(t, true) : fmtTime(t, false);
    ctx.fillText(lbl, Math.min(W - 62, Math.max(padL, X(t) - 26)), H - 8);
  }
  if (pts.length < 2) {
    ctx.fillStyle = '#8ba0a3';
    ctx.fillText(pts.length === 1 ? 'Collecting samples — one observation so far (page must stay open)' : 'No samples in this window yet — select a market and keep the page open', padL + 8, H / 2);
    return;
  }
  // line
  ctx.strokeStyle = '#2fd48f'; ctx.lineWidth = 2; ctx.beginPath();
  pts.forEach((p, i) => { const x = X(p.t), y = Y(p.v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.stroke();
  // alert markers
  for (const a of alerts) {
    const x = X(a.t), y = Y(Math.min(hi, Math.max(lo, a.to)));
    if (x < padL || x > W - padR) continue;
    ctx.fillStyle = a.kind === 'up' ? '#4ade9b' : '#ff8078';
    ctx.beginPath();
    if (a.kind === 'up') { ctx.moveTo(x, y - 6); ctx.lineTo(x - 4, y + 2); ctx.lineTo(x + 4, y + 2); }
    else { ctx.moveTo(x, y + 6); ctx.lineTo(x - 4, y - 2); ctx.lineTo(x + 4, y - 2); }
    ctx.closePath(); ctx.fill();
  }
  // last point
  const lastP = pts[pts.length - 1];
  ctx.fillStyle = '#2fd48f'; ctx.beginPath(); ctx.arc(X(lastP.t), Y(lastP.v), 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e9f2f0'; ctx.fillText(fmtPx(lastP.v), Math.min(W - 52, X(lastP.t) + 6), Y(lastP.v) - 6);
}

/* ============================== 12. ORDERBOOK + TAPE ============================== */
function renderOrderbook() {
  const el = $('orderbook'); if (!el) return;
  const ob = S.orderbook;
  if (!ob) { el.innerHTML = '<div class="chatempty">No orderbook loaded yet.</div>'; return; }
  const yes = (ob.yes_dollars || []).map(([p, q]) => ({ p: parseD(p), q: parseD(q) })).filter(x => x.p != null);
  const no = (ob.no_dollars || []).map(([p, q]) => ({ p: parseD(p), q: parseD(q) })).filter(x => x.p != null);
  const maxQ = Math.max(1, ...yes.map(x => x.q || 0), ...no.map(x => x.q || 0));
  const row = (x, cls, extra) => `<tr><td class="mono">${fmtPx(x.p)}</td><td class="right num">${fmtC(x.q)}</td>
    <td style="width:34%"><div class="bar ${cls}" style="width:${Math.max(2, Math.round(100 * (x.q || 0) / maxQ))}%"></div></td>${extra || ''}</tr>`;
  const yesRows = yes.slice(-12).reverse().map(x => row(x, '', `<td class="right num muted">${fmtPx(1 - x.p)}</td>`)).join('');
  const noRows = no.slice(-12).reverse().map(x => row(x, 'no', `<td class="right num muted">${fmtPx(1 - x.p)}</td>`)).join('');
  const m = S.markets.get(S.selected) || {};
  const yesDepth = yes.reduce((s, x) => s + (x.q || 0), 0);
  const noDepth = no.reduce((s, x) => s + (x.q || 0), 0);
  el.innerHTML = `
    <div class="kv mb0" style="margin-bottom:10px">
      <dt>Best YES bid / ask</dt><dd class="num">${fmtPx(m.bid, '—')} / ${fmtPx(m.ask, '—')} <span class="muted">(spread ${fmtPx(m.spread, '—')})</span></dd>
      <dt>Mid / last</dt><dd class="num">${fmtPx(m.mid, '—')} / ${fmtPx(m.last, '—')}</dd>
      <dt>Visible depth (contracts)</dt><dd class="num">YES ${fmtC(yesDepth, '—')} · NO ${fmtC(noDepth, '—')}</dd>
      <dt>Open interest / 24h volume</dt><dd class="num">${fmtC(m.oi, '—')} · ${fmtC(m.volume24, '—')}</dd>
    </div>
    <div class="oblayout">
      <div class="tablewrap"><table class="obtable"><thead><tr><th>YES bid</th><th class="right">Contracts</th><th></th><th class="right">= NO ask</th></tr></thead><tbody>${yesRows || '<tr><td colspan="4" class="muted">No YES bids visible</td></tr>'}</tbody></table></div>
      <div class="tablewrap"><table class="obtable"><thead><tr><th>NO bid</th><th class="right">Contracts</th><th></th><th class="right">= YES ask</th></tr></thead><tbody>${noRows || '<tr><td colspan="4" class="muted">No NO bids visible</td></tr>'}</tbody></table></div>
    </div>
    <p class="src mt">Official orderbook endpoint (bids only; a YES bid at $x equals a NO ask at $1.00−$x):
      <a href="${DOCS.orderbook}" target="_blank" rel="noopener">Get Market Orderbook docs ↗</a> ·
      <a href="${API}/markets/${encodeURIComponent(S.selected)}/orderbook" target="_blank" rel="noopener">live response ↗</a></p>`;
}
function renderTape() {
  const el = $('tape'); if (!el) return;
  if (!S.tape.length) { el.innerHTML = '<div class="chatempty">No trades fetched yet for this market.</div>'; return; }
  const dollars = S.tape.reduce((s, t) => s + (t.count || 0) * (t.yesPrice != null ? t.yesPrice : 0), 0);
  el.innerHTML = `<div class="tablewrap"><table>
    <thead><tr><th>Time</th><th>Taker side</th><th class="right">Contracts</th><th class="right">YES px</th><th class="right">≈ $</th></tr></thead>
    <tbody>${S.tape.map(t => `<tr><td class="mono">${new Date(t.t).toLocaleTimeString()}</td><td>${t.side === 'yes' ? '<span class="up">YES</span>' : '<span class="down">NO</span>'}</td>
      <td class="right num">${fmtC(t.count)}</td><td class="right num">${fmtPx(t.yesPrice)}</td><td class="right num">${fmtMoney(t.count * (t.yesPrice || 0))}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="src mt">Sample of ${S.tape.length} most recent official trade prints · traded dollars in sample ≈ ${fmtMoney(dollars)} (count × YES price). Source: <a href="${DOCS.trades}" target="_blank" rel="noopener">Get Trades ↗</a></p>`;
}

/* ============================== 13. RESOLUTION TRACKER ============================== */
async function resolveTick() {
  const toCheck = [...S.trackedEvents].slice(-25);
  for (const evT of toCheck) {
    try {
      const d = await api('/markets', { event_ticker: evT, status: 'settled', limit: 200 });
      for (const raw of d.markets || []) {
        const known = S.markets.get(raw.ticker);
        if (!known && !S.resolutions.some(r => r.ticker === raw.ticker)) continue;
        if (S.resolutions.some(r => r.ticker === raw.ticker)) continue;
        const m = hydrateMarket(raw);
        const entry = {
          kind: 'resolved', t: Date.now(), topic: m._topic || (known ? known._topic : null),
          ticker: m.ticker, event_ticker: m.event_ticker, title: m.title,
          result: (m.result || '').toLowerCase(), settledAt: raw.settlement_ts || '', lastBefore: m.last
        };
        if (!entry.result) continue; // never guess a result
        capPush(S.resolutions, entry, 600); lsSet(LS.resolutions, S.resolutions);
        capPush(S.alerts, entry, 400); lsSet(LS.alerts, S.alerts);
        settlePositions(m.ticker, entry.result);
        chatRenderAll(); renderResolutions();
      }
    } catch { /* keep going; flagged in status if persistent */ }
  }
}
function renderResolutions() {
  const el = $('resTable') || $('resMini'); if (!el) return;
  const rows = S.resolutions.slice(-200).reverse();
  const filt = PAGE === 'topic' ? PAGE_TOPIC : null;
  const list = filt ? rows.filter(r => r.topic === filt) : rows;
  const table = list.length ? `<div class="tablewrap"><table>
    <thead><tr><th>When</th><th>Topic</th><th>Market</th><th>Resolved</th><th>Source</th></tr></thead>
    <tbody>${list.map(r => `<tr><td class="mono">${new Date(r.t).toLocaleString()}</td>
      <td>${r.topic ? `<span class="pill ${TOPICS[r.topic].cls}">${TOPICS[r.topic].label}</span>` : '<span class="flag-blank">unverified</span>'}</td>
      <td>${esc(r.title)}<div class="sub mono">${esc(r.ticker)}</div></td>
      <td><b class="${r.result === 'yes' ? 'up' : 'down'}">${esc(String(r.result).toUpperCase())}</b></td>
      <td><a href="${API}/markets/${encodeURIComponent(r.ticker)}" target="_blank" rel="noopener">API ↗</a></td></tr>`).join('')}
    </tbody></table></div>`
    : `<div class="chatempty">No tracked resolutions recorded yet. Markets we follow are re-checked against the official settled-markets endpoint; the yes/no result is copied from the exchange's <code>result</code> field — never inferred. Empty can also mean no followed market has settled since you started watching.</div>`;
  el.innerHTML = table;
}

/* ============================== 14. PAPER TRADING BOT ============================== */
/* Automated SIMULATED trading. No order is ever sent to Kalshi. Fills are
 * modeled against the live top-of-book observed at decision time; fees use the
 * official schedule formula. All state is local to this browser. */
function botSignal(m, sc) {
  if (!S.settings.botOn) return;
  const bankroll = S.settings.bankroll;
  if (S.positions.filter(p => p.status === 'open').length >= 30) return;
  if (S.positions.some(p => p.ticker === m.ticker && p.status === 'open')) return;
  if (sc.dir === 'up' && S.settings.strategies.momentum) {
    const entry = m.ask;
    if (entry != null && entry < 0.97 && (m.askSize || 0) >= 1) enter(m, 'YES', entry, 'momentum', 'Momentum Rider', 'bought ≥$0.10 upswing continuation at ask');
  } else if (sc.dir === 'up' && S.settings.strategies.fade) {
    const liquidityRatio = (m.bidSize || 0) / Math.max(1, (m.askSize || 0));
    if (liquidityRatio < 0.6) { const entry = m.noAsk != null ? m.noAsk : (m.bid != null ? 1 - m.bid : null); if (entry != null && entry < 0.97) enter(m, 'NO', entry, 'fade', 'Fade the Spike', 'spike into thin book — fading toward pre-move mid'); }
  }
}
function botOnPriceUpdate(m, prevObserved) {
  if (!S.settings.botOn) return;
  if (prevObserved != null && m.last != null && Math.abs(Math.round((m.last - prevObserved) * 100)) >= Math.round(S.settings.threshold * 100)) {
    // handled by model scoring path (momentum/fade); extreme check here:
  }
  if (S.settings.strategies.extreme && m.last != null && m.last <= 0.06 && (m.oi || 0) > 500 && m.ask != null && m.ask <= 0.08 && !S.positions.some(p => p.ticker === m.ticker && p.status === 'open')) {
    enter(m, 'YES', m.ask, 'extreme', 'Extreme Value', 'cheap tail contract with open interest — hold toward resolution');
  }
  if (S.settings.strategies.scalp && m.spread != null && m.spread <= 0.03 && (m.bidSize || 0) >= 10 && (m.askSize || 0) >= 10 && m.mid != null && m.mid > 0.10 && m.mid < 0.90) {
    if (!S.positions.some(p => p.ticker === m.ticker && p.status === 'open')) enter(m, 'YES', m.bid != null ? m.bid : m.mid, 'scalp', 'Liquidity Scalper', 'tight two-sided book — modeled maker entry at bid (maker fee 0 on quadratic series)', true);
  }
}
function enter(m, side, entryPrice, stratId, stratName, note, isMaker) {
  const risk = S.settings.bankroll * (S.settings.riskPct / 100);
  const visible = Math.min((m.askSize || 5) * 10, 500);
  let qty = Math.max(1, Math.min(Math.floor(risk / Math.max(0.01, entryPrice)), visible, 2000));
  const fee = isMaker ? makerFee(entryPrice, qty) : takerFee(entryPrice, qty);
  const pos = {
    id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    t: Date.now(), ticker: m.ticker, event_ticker: m.event_ticker, title: m.title,
    topic: m._topic, side, qty, entry: entryPrice, strategy: stratId, strategyName: stratName,
    note, feeEntry: fee, status: 'open', mark: entryPrice,
    target: stratId === 'momentum' ? entryPrice + 0.08 : stratId === 'scalp' ? entryPrice + 0.03 : stratId === 'fade' ? null : null,
    stop: stratId === 'momentum' ? entryPrice - 0.06 : stratId === 'fade' ? entryPrice + 0.05 : null,
    maxHold: stratId === 'momentum' ? 15 * 60000 : stratId === 'fade' ? 20 * 60000 : stratId === 'scalp' ? 10 * 60000 : null,
    isMaker: !!isMaker
  };
  S.positions.push(pos); lsSet(LS.positions, S.positions); lsSet(LS.closed, S.closed);
  capPush(S.alerts, { kind: 'info', t: Date.now(), topic: m._topic, ticker: m.ticker, event_ticker: m.event_ticker, text: `PAPER ${isMaker ? 'maker' : 'taker'} BUY ${side} ${qty} @ ${fmtPx(entryPrice)} — ${stratName}: ${note}` }, 400);
  lsSet(LS.alerts, S.alerts); chatRenderAll(); renderPortfolio();
}
function markToMarket() {
  let changed = false;
  for (const p of S.positions) {
    if (p.status !== 'open') continue;
    const m = S.markets.get(p.ticker);
    if (!m) continue;
    const yesPx = m.mid != null ? m.mid : m.last;
    if (yesPx == null) continue;
    p.mark = p.side === 'YES' ? yesPx : 1 - yesPx;
    changed = true;
    // exits
    const fee = takerFee(p.mark, p.qty);
    if (p.target != null && p.mark >= p.target) closePos(p, p.mark, 'target', fee);
    else if (p.stop != null && p.mark <= p.stop) closePos(p, p.mark, 'stop', fee);
    else if (p.maxHold && Date.now() - p.t > p.maxHold) closePos(p, p.mark, 'timeout', fee);
    else if (p.strategy === 'fade' && p.target == null) {
      const anchor = p.entry; // revert toward pre-move mid ≈ entry on NO side
      if (p.mark <= anchor) closePos(p, p.mark, 'reversion', fee);
    }
  }
  if (changed) { lsSet(LS.positions, S.positions); renderPortfolio(); pushEquity(); }
}
function closePos(p, exitPrice, reason, feeExit) {
  p.status = 'closed'; p.exit = exitPrice; p.exitTs = Date.now(); p.exitReason = reason; p.feeExit = feeExit || 0;
  const gross = p.side === 'YES' ? (p.exit - p.entry) * p.qty : (p.entry - p.exit) * p.qty;
  p.pnl = gross - (p.feeEntry || 0) - (p.feeExit || 0);
  p.roi = p.pnl / Math.max(0.01, p.entry * p.qty);
  S.closed.push(p); S.positions = S.positions.filter(x => x.id !== p.id);
  lsSet(LS.positions, S.positions); lsSet(LS.closed, S.closed);
  capPush(S.alerts, { kind: 'info', t: Date.now(), topic: p.topic, ticker: p.ticker, event_ticker: p.event_ticker, text: `PAPER CLOSED ${p.side} ${p.qty} @ ${fmtPx(p.exit)} (${reason}) — net ${fmtMoney(p.pnl)} (${fmtPct(p.roi)})` }, 400);
  lsSet(LS.alerts, S.alerts); chatRenderAll();
}
function settlePositions(ticker, result) {
  for (const p of S.positions.filter(x => x.ticker === ticker && x.status === 'open')) {
    const payout = p.side === 'YES' ? (result === 'yes' ? 1 : 0) : (result === 'no' ? 1 : 0);
    closePos(p, payout, 'settlement: ' + result, 0); // no settlement fee (official fee schedule)
  }
}
function pushEquity() {
  const cash = S.settings.bankroll - S.positions.reduce((s, p) => s + p.entry * p.qty + (p.feeEntry || 0), 0);
  const markVal = S.positions.reduce((s, p) => s + p.mark * p.qty, 0);
  const realized = S.closed.reduce((s, p) => s + (p.pnl || 0), 0);
  capPush(S.equity, { t: Date.now(), equity: cash + markVal + realized }, 600);
  lsSet(LS.equity, S.equity);
}
function portfolioStats() {
  const cash = S.settings.bankroll - S.positions.reduce((s, p) => s + p.entry * p.qty + (p.feeEntry || 0), 0);
  const markVal = S.positions.reduce((s, p) => s + p.mark * p.qty, 0);
  const realized = S.closed.reduce((s, p) => s + (p.pnl || 0), 0);
  const fees = S.closed.reduce((s, p) => s + (p.feeEntry || 0) + (p.feeExit || 0), 0);
  return { cash, markVal, realized, equity: cash + markVal + realized, fees, open: S.positions.length, closed: S.closed.length };
}
function groupBy(arr, key) {
  const g = {};
  for (const p of arr) { const k = p[key] || '—'; (g[k] = g[k] || []).push(p); }
  return g;
}
function statsTable(grouped, keyLabel) {
  const rows = Object.entries(grouped).map(([k, list]) => {
    const closed = list.filter(p => p.status === 'closed');
    const wins = closed.filter(p => (p.pnl || 0) > 0).length;
    const net = closed.reduce((s, p) => s + (p.pnl || 0), 0);
    const fees = list.reduce((s, p) => s + (p.feeEntry || 0) + (p.feeExit || 0), 0);
    const openN = list.filter(p => p.status === 'open').length;
    const openNotional = list.filter(p => p.status === 'open').reduce((s, p) => s + p.entry * p.qty, 0);
    return { k, total: list.length, openN, closed: closed.length, winRate: closed.length ? wins / closed.length : null, net, fees, openNotional };
  }).sort((a, b) => b.net - a.net);
  return `<div class="tablewrap"><table>
    <thead><tr><th>${keyLabel}</th><th class="right">Trades</th><th class="right">Open</th><th class="right">Closed</th><th class="right">Win rate</th><th class="right">Net P&L</th><th class="right">Fees</th><th class="right">Open notional</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td>${esc(r.k)}</td><td class="right num">${r.total}</td><td class="right num">${r.openN}</td><td class="right num">${r.closed}</td>
      <td class="right num">${fmtPct(r.winRate, '—')}</td><td class="right num ${r.net > 0 ? 'up' : r.net < 0 ? 'down' : ''}">${fmtMoney(r.net, '—')}</td>
      <td class="right num">${fmtMoney(r.fees, '—')}</td><td class="right num">${fmtMoney(r.openNotional, '—')}</td></tr>`).join('') || '<tr><td colspan="8" class="chatempty">No simulated trades yet — the bot fills entries as alert/model conditions occur on tracked markets.</td></tr>'}</tbody></table></div>`;
}
function renderPortfolio() {
  const el = $('portfolio'); if (!el) return;
  const st = portfolioStats();
  const equityCanvas = $('equityChart');
  el.innerHTML = `
    <div class="cards" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
      <div class="card"><small>Paper equity</small><strong class="num">${fmtMoney(st.equity)}</strong></div>
      <div class="card"><small>Cash</small><strong class="num">${fmtMoney(st.cash)}</strong></div>
      <div class="card"><small>Open mark value</small><strong class="num">${fmtMoney(st.markVal)}</strong></div>
      <div class="card"><small>Realized P&L (net)</small><strong class="num ${st.realized >= 0 ? 'up' : 'down'}">${fmtMoney(st.realized)}</strong></div>
      <div class="card"><small>Fees paid</small><strong class="num">${fmtMoney(st.fees)}</strong></div>
      <div class="card"><small>Open / closed</small><strong class="num">${st.open} / ${st.closed}</strong></div>
    </div>
    ${equityCanvas ? '<div class="panel"><h2>Equity curve (paper, this browser)</h2><div class="chartwrap" style="height:170px"><canvas id="equityC"></canvas></div></div>' : ''}
    <div class="stack">
      <h3>By strategy</h3>${statsTable(groupBy(S.closed.concat(S.positions), 'strategyName'), 'Strategy')}
      <h3>By topic</h3>${statsTable(groupBy(S.closed.concat(S.positions).map(p => ({ ...p, strategyName: p.topic ? TOPICS[p.topic].label : 'unmatched' })), 'strategyName'), 'Topic')}
      <h3>Open positions</h3>
      <div class="tablewrap"><table><thead><tr><th>Since</th><th>Market</th><th>Side</th><th class="right">Qty</th><th class="right">Entry</th><th class="right">Mark</th><th class="right">uP&L</th><th>Strategy</th></tr></thead>
      <tbody>${S.positions.slice().reverse().map(p => `<tr><td class="mono">${new Date(p.t).toLocaleTimeString()}</td><td>${esc(p.title)}<div class="sub mono">${esc(p.ticker)}</div></td><td>${p.side}</td>
        <td class="right num">${p.qty}</td><td class="right num">${fmtPx(p.entry)}</td><td class="right num">${fmtPx(p.mark)}</td>
        <td class="right num ${(p.mark - p.entry) * (p.side === 'YES' ? 1 : -1) >= 0 ? 'up' : 'down'}">${fmtMoney((p.mark - p.entry) * (p.side === 'YES' ? 1 : -1) * p.qty)}</td><td>${esc(p.strategyName)}</td></tr>`).join('') || '<tr><td colspan="8" class="chatempty">No open paper positions.</td></tr>'}</tbody></table></div>
      <h3>Closed trades</h3>
      <div class="tablewrap"><table><thead><tr><th>Closed</th><th>Market</th><th>Side</th><th class="right">Qty</th><th class="right">Entry→Exit</th><th class="right">Net P&L</th><th class="right">ROI</th><th>Strategy</th><th>Exit</th></tr></thead>
      <tbody>${S.closed.slice().reverse().slice(0, 100).map(p => `<tr><td class="mono">${new Date(p.exitTs).toLocaleTimeString()}</td><td>${esc(p.title)}</td><td>${p.side}</td>
        <td class="right num">${p.qty}</td><td class="right num">${fmtPx(p.entry)}→${fmtPx(p.exit)}</td>
        <td class="right num ${p.pnl >= 0 ? 'up' : 'down'}">${fmtMoney(p.pnl)}</td><td class="right num ${p.pnl >= 0 ? 'up' : 'down'}">${fmtPct(p.roi)}</td><td>${esc(p.strategyName)}</td><td>${esc(p.exitReason)}</td></tr>`).join('') || '<tr><td colspan="9" class="chatempty">No closed paper trades yet.</td></tr>'}</tbody></table></div>
    </div>
    <p class="src mt">Simulated fills only — no orders are sent to Kalshi. Entry/exit fees modeled with the official schedule formula fees = round_up(0.07 × C × P × (1−P)) (taker) and 0 for modeled maker fills on quadratic-fee series; settlement pays $1/contract, no settlement fee. Source: <a href="${DOCS.fees}" target="_blank" rel="noopener">Kalshi fee schedule PDF ↗</a> · <a href="${DOCS.settlement}" target="_blank" rel="noopener">Market settlement docs ↗</a></p>`;
  if (equityCanvas) drawEquity();
}
function drawEquity() {
  const canvas = $('equityC'); if (!canvas) return;
  const wrap = canvas.parentElement, rect = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  const W = rect.width, H = rect.height, pts = S.equity;
  ctx.clearRect(0, 0, W, H);
  if (pts.length < 2) { ctx.fillStyle = '#8ba0a3'; ctx.fillText('Equity curve builds as the bot trades…', 10, H / 2); return; }
  const vs = pts.map(p => p.equity);
  const lo = Math.min(...vs, S.settings.bankroll) - 5, hi = Math.max(...vs, S.settings.bankroll) + 5;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
  const X = t => 34 + (t - t0) / Math.max(1, t1 - t0) * (W - 44);
  const Y = v => 8 + (1 - (v - lo) / Math.max(0.01, hi - lo)) * (H - 26);
  ctx.strokeStyle = '#2a3a40'; ctx.fillStyle = '#8ba0a3'; ctx.font = '10.5px system-ui';
  [lo, (lo + hi) / 2, hi].forEach(v => { ctx.beginPath(); ctx.moveTo(34, Y(v)); ctx.lineTo(W - 10, Y(v)); ctx.stroke(); ctx.fillText('$' + Math.round(v).toLocaleString(), 2, Y(v) + 3); });
  ctx.strokeStyle = '#7cc4ff'; ctx.lineWidth = 2; ctx.beginPath();
  pts.forEach((p, i) => { i ? ctx.lineTo(X(p.t), Y(p.equity)) : ctx.moveTo(X(p.t), Y(p.equity)); });
  ctx.stroke();
}

/* ============================== 15. RENDER: TABLES / PAGES ============================== */
function eventRow(ev, rank) {
  const a = ev._agg || {};
  const topic = ev._topic ? `<span class="pill ${TOPICS[ev._topic].cls}">${TOPICS[ev._topic].label}</span>` : '<span class="flag-blank">unmatched</span>';
  const watched = S.watch.includes(ev.event_ticker);
  return `<tr class="clickable" data-ev="${esc(ev.event_ticker)}">
    <td class="num muted">#${rank}</td>
    <td><a href="${API}/markets?event_ticker=${encodeURIComponent(ev.event_ticker)}&status=open" target="_blank" rel="noopener">${esc(ev.title || ev.event_ticker)}</a>
      <div class="sub mono">${esc(ev.event_ticker)} · ${a.markets || 0} market${(a.markets || 0) === 1 ? '' : 's'} ${watched ? '· <span class="up">watched</span>' : ''}</div></td>
    <td>${topic}</td>
    <td class="right num"><b>${fmtMoney(a.estDollars, '—')}</b><div class="sub">est. traded $</div></td>
    <td class="right num">${fmtMoney(a.estOI, '—')}<div class="sub">est. OI $</div></td>
    <td class="right num">${fmtC(a.volume, '—')}<div class="sub">contracts</div></td>
    <td class="right num">${fmtC(a.volume24, '—')}<div class="sub">24h</div></td>
    <td class="right num">${a.topMarket ? fmtPx(a.topMarket.mid ?? a.topMarket.last) : ''}<div class="sub">top market mid</div></td>
    <td><a href="${API}/markets?event_ticker=${encodeURIComponent(ev.event_ticker)}&status=open" target="_blank" rel="noopener">source ↗</a></td>
  </tr>`;
}
function renderTables() {
  const tbody = $('eventsBody'); if (!tbody) return;
  let evs = topicEvents();
  if (PAGE === 'topic') evs = evs.filter(e => e._topic === PAGE_TOPIC);
  evs.sort((a, b) => (b._agg.estDollars || 0) - (a._agg.estDollars || 0));
  const total$ = evs.reduce((s, e) => s + (e._agg.estDollars || 0), 0);
  const totalVol = evs.reduce((s, e) => s + (e._agg.volume || 0), 0);
  if ($('statEvents')) $('statEvents').textContent = evs.length.toLocaleString();
  if ($('statDollars')) $('statDollars').textContent = fmtMoney(total$, '—');
  if ($('statVol')) $('statVol').textContent = fmtC(totalVol, '—');
  if ($('statMarkets')) $('statMarkets').textContent = inScopeMarkets().filter(m => PAGE === 'topic' ? m._topic === PAGE_TOPIC : true).length.toLocaleString();
  tbody.innerHTML = evs.slice(0, 150).map((e, i) => eventRow(e, i + 1)).join('') ||
    `<tr><td colspan="9" class="chatempty">${PAGE === 'topic' ? `No open ${TOPICS[PAGE_TOPIC].label} events are live in the demo environment right now. Gas ("KXGAS"/"KXAAAGASM") and Culture series exist but currently have few or zero open events — see the Flagged for Review page. Live rows appear automatically when the exchange lists them.` : 'No in-scope open events found.'}</td></tr>`;
  tbody.querySelectorAll('[data-ev]').forEach(tr => {
    tr.onclick = (e) => { if (e.target.closest('a')) return; selectEvent(tr.dataset.ev); };
  });
}
function selectEvent(evT) {
  const ev = S.events.get(evT); if (!ev) return;
  const markets = [...S.markets.values()].filter(m => m.event_ticker === evT && m._topic != null)
    .sort((a, b) => (b.estDollars || 0) - (a.estDollars || 0));
  const panel = $('eventDetail'); if (!panel) return;
  panel.classList.remove('hidden');
  if ($('eventTitle')) $('eventTitle').textContent = ev.title || evT;
  if ($('eventMeta')) $('eventMeta').innerHTML = `<span class="mono">${esc(evT)}</span> · ${esc(ev.category || '')} · series <span class="mono">${esc(ev.series_ticker || '—')}</span> ·
    <a href="${API}/markets?event_ticker=${encodeURIComponent(evT)}&status=open" target="_blank" rel="noopener">official event data ↗</a>`;
  const body = $('eventMarkets');
  if (body) body.innerHTML = markets.slice(0, 25).map(m => `<tr class="clickable ${m.ticker === S.selected ? 'selected' : ''}" data-mk="${esc(m.ticker)}">
      <td>${esc(m.title)}<div class="sub mono">${esc(m.ticker)}</div></td>
      <td class="right num">${fmtPx(m.bid, '—')} / ${fmtPx(m.ask, '—')}</td>
      <td class="right num">${fmtPx(m.mid ?? m.last, '—')}</td>
      <td class="right num">${fmtC(m.volume, '—')}</td>
      <td class="right num">${fmtC(m.volume24, '—')}</td>
      <td class="right num">${fmtC(m.oi, '—')}</td>
      <td class="right num">${fmtMoney(m.estDollars, '—')}</td>
      <td><a href="${API}/markets/${encodeURIComponent(m.ticker)}" target="_blank" rel="noopener">src ↗</a></td>
    </tr>`).join('') || '<tr><td colspan="8" class="chatempty">No open markets for this event.</td></tr>';
  body.querySelectorAll('[data-mk]').forEach(tr => tr.onclick = () => selectMarket(tr.dataset.mk));
  if (!S.selected && markets.length) selectMarket(markets[0].ticker);
}
function selectMarket(ticker) {
  S.selected = ticker;
  document.querySelectorAll('[data-mk]').forEach(tr => tr.classList.toggle('selected', tr.dataset.mk === ticker));
  const m = S.markets.get(ticker);
  if ($('chartName')) $('chartName').textContent = m ? (m.title + ' — YES price ($), window: ' + ((WINDOWS.find(w => w.v === S.settings.window) || {}).label || '')) : ticker;
  if ($('selTicker')) $('selTicker').textContent = ticker;
  drawChart(); renderOrderbook();
  refreshSelected(true);
}
async function refreshSelected(force) {
  if (!S.selected) return;
  try {
    const d = await api('/markets/' + encodeURIComponent(S.selected));
    if (d.market) {
      const m = hydrateMarket(d.market);
      m._topic = (S.events.get(m.event_ticker) || {})._topic ?? null;
      const prevM = S.markets.get(m.ticker);
      const prevObs = prevM ? (prevM.mid != null ? prevM.mid : prevM.last) : null;
      S.markets.set(m.ticker, m);
      const s = sampleOf(m.ticker);
      capPush(s, { t: Date.now(), last: m.last, bid: m.bid, ask: m.ask, mid: m.mid }, 4000);
      S.samples.set(m.ticker, s);
      checkAlerts(m, prevObs);
      botOnPriceUpdate(m, prevObs);
      modelPost();
      markToMarket();
      drawChart(); renderOrderbook();
      if ($('selStats')) $('selStats').innerHTML = `<span class="num">last ${fmtPx(m.last, '—')}</span> · <span class="num">bid/ask ${fmtPx(m.bid, '—')}/${fmtPx(m.ask, '—')}</span> · <span class="num">spread ${fmtPx(m.spread, '—')}</span> · <span class="num">vol ${fmtC(m.volume, '—')}</span> · <span class="num">24h ${fmtC(m.volume24, '—')}</span> · <span class="num">OI ${fmtC(m.oi, '—')}</span>`;
    }
  } catch { /* status bar shows it */ }
  if (S.settings.window >= 3600) ensureCandles(S.selected, S.settings.window).then(drawChart);
}
async function pollWatched() {
  if (!S.watch.length) { ensureWatch(); if (!S.watch.length) return; }
  const evT = S.watch[S.watchIdx % S.watch.length];
  S.watchIdx++;
  try {
    const d = await api('/markets', { event_ticker: evT, status: 'open', limit: 200 });
    for (const raw of d.markets || []) {
      const m = hydrateMarket(raw);
      m._topic = (S.events.get(m.event_ticker) || {})._topic ?? null;
      const prev = S.markets.get(m.ticker);
      const prevObs = prev ? (prev.mid != null ? prev.mid : prev.last) : null;
      S.markets.set(m.ticker, m);
      const s = sampleOf(m.ticker);
      capPush(s, { t: Date.now(), last: m.last, bid: m.bid, ask: m.ask, mid: m.mid }, 4000);
      S.samples.set(m.ticker, s);
      checkAlerts(m, prevObs);
      botOnPriceUpdate(m, prevObs);
      if (m.ticker === S.selected) { drawChart(); renderOrderbook(); }
    }
    S.trackedEvents.add(evT);
    markToMarket(); modelPost();
    if ($('lastPoll')) $('lastPoll').textContent = fmtAgo(Date.now() - 1000);
  } catch { /* status */ }
}
async function pollOrderbook() {
  if (!S.selected) return;
  try { const d = await api(`/markets/${encodeURIComponent(S.selected)}/orderbook`, { depth: 10 }); S.orderbook = d.orderbook_fp || d.orderbook || null; renderOrderbook(); }
  catch { /* status */ }
}
async function pollTape() {
  if (!S.selected) return;
  try {
    const d = await api('/markets/trades', { ticker: S.selected, limit: 20 });
    S.tape = (d.trades || []).map(t => ({ t: Date.parse(t.created_time), count: parseD(t.count_fp), yesPrice: parseD(t.yes_price_dollars), side: t.taker_outcome_side || t.taker_side || '' })).filter(x => x.t);
    S.tape.sort((a, b) => b.t - a.t);
    renderTape();
  } catch { /* status */ }
}

/* ============================== 16. STATUS / BOOT UI ============================== */
function renderStatus() {
  const el = $('liveState'); if (!el) return;
  const dot = `<span class="statusdot ${stats.state === 'live' ? 'ok' : stats.state === 'blocked' ? 'err' : ''}"></span>`;
  const label = stats.state === 'live' ? 'Live — official demo API' : stats.state === 'blocked' ? 'API unreachable from this browser' : stats.state === 'init' ? 'Connecting…' : 'Degraded';
  el.innerHTML = `${dot}${label} · <span class="mono" title="requests / errors / 429-backoffs">${stats.requests} req · ${stats.errors} err · ${stats.throttles} 429</span>`;
  const err = $('apiError');
  if (err) err.textContent = stats.lastError ? 'Last issue: ' + stats.lastError : '';
}
function renderBoot() {
  const el = $('bootStatus'); if (!el) return;
  el.textContent = S.boot.progress || '';
  el.className = S.boot.phase === 'error' ? 'down' : 'muted';
}
function renderApiBlocked(e) {
  const el = $('apiNotice'); if (!el) return;
  el.classList.remove('hidden');
  el.className = 'notice err';
  el.innerHTML = `<b>This browser could not reach ${esc(API)}.</b> ${esc(e.message)}.<br>
  The live tables populate only when the page can call the official demo API directly (network or CORS restrictions may block it in some environments). Everything below still renders from the <b>verified snapshot</b> captured on 2026-11-20 from the same official endpoints — every snapshot value keeps its request URL as the source link.<br>
  To check CORS from your own machine: <code>curl -sS -X OPTIONS "${API}/markets" -H "Origin: ${location.origin}" -H "Access-Control-Request-Method: GET" -D - -o /dev/null | grep -i access-control</code>`;
  stats.state = 'blocked'; renderStatus();
}

/* ============================== 17. SNAPSHOT (VERIFIED) ============================== */
let SNAP = null;
async function loadSnapshot() {
  try { const r = await fetch('data/snapshot-2026-11-20.json', { cache: 'no-store' }); SNAP = await r.json(); }
  catch { SNAP = null; }
}
function renderSnapshotTable(section, elId) {
  const el = $(elId); if (!el) return;
  if (!SNAP || !SNAP[section]) { el.innerHTML = '<div class="chatempty">Snapshot unavailable.</div>'; return; }
  const rows = SNAP[section];
  el.innerHTML = `<div class="tablewrap"><table>
    <thead><tr><th>Item (verified ${esc(SNAP.generated || '')})</th><th>Value from official source</th><th>Source link</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td>${esc(r.item)}</td><td class="num">${r.value == null || r.value === '' ? '<span class="flag-blank">blank — unverified, never inferred</span>' : esc(r.value)}</td>
      <td>${r.source ? `<a href="${esc(r.source)}" target="_blank" rel="noopener">${esc(r.sourceLabel || 'official source')} ↗</a>` : '<span class="flag-blank">no official link</span>'}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="src mt">Snapshot captured ${esc(SNAP.generated)} directly from the official Kalshi demo API / official docs. Values are point-in-time; the live tables above show current exchange state.</p>`;
}

/* ============================== 18. MODEL PICKS TABLE (strategies page) ============================== */
function renderModelTable(ranked) {
  const el = $('modelTable'); if (!el) return;
  const list = (ranked || modelTick()).slice(0, 15);
  el.innerHTML = `<div class="tablewrap"><table>
    <thead><tr><th>Market</th><th>Topic</th><th class="right">Score</th><th class="right">Recent move</th><th class="right">Entry</th><th class="right">Est. ROI*</th><th>Source</th></tr></thead>
    <tbody>${list.map(({ m, sc }) => `<tr><td>${esc(m.title)}<div class="sub mono">${esc(m.ticker)}</div></td>
      <td>${m._topic ? `<span class="pill ${TOPICS[m._topic].cls}">${TOPICS[m._topic].label}</span>` : '—'}</td>
      <td class="right num">${sc.score.toFixed(2)}</td><td class="right num">${sc.move > 0 ? '+' : '−'}$${Math.abs(sc.move).toFixed(2)}</td>
      <td class="right num">${fmtPx(sc.entry, '—')}</td><td class="right num">${fmtPct(sc.roi, '—')}</td>
      <td><a href="${API}/markets/${encodeURIComponent(m.ticker)}" target="_blank" rel="noopener">API ↗</a></td></tr>`).join('') || '<tr><td colspan="7" class="chatempty">No markets currently clear the model thresholds (score ≥ 0.62 and est. ROI ≥ 5% after modeled fees).</td></tr>'}</tbody></table></div>
    <p class="src mt">*Heuristic continuation estimate — OUR model over official prices, not an exchange product and not advice. Blank = not computable from current data.</p>`;
}

/* ============================== 19. FINDINGS PAGE ============================== */
function renderFindingsArchive() {
  const el = $('archiveBody'); if (!el) return;
  const list = S.alerts.slice(-300).reverse();
  const up = S.alerts.filter(a => a.kind === 'up').length, down = S.alerts.filter(a => a.kind === 'down').length;
  const byTopic = {};
  for (const a of S.alerts) if (a.topic) byTopic[a.topic] = (byTopic[a.topic] || 0) + 1;
  const biggest = S.alerts.filter(a => a.delta != null).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 10);
  el.innerHTML = `
    <div class="cards">
      <div class="card"><small>Alerts captured</small><strong>${S.alerts.length}</strong></div>
      <div class="card"><small>Up moves ≥ $${S.settings.threshold.toFixed(2)}</small><strong class="up">${up}</strong></div>
      <div class="card"><small>Down moves ≥ $${S.settings.threshold.toFixed(2)}</small><strong class="down">${down}</strong></div>
      <div class="card"><small>Model picks</small><strong>${S.picks.length}</strong></div>
      <div class="card"><small>Resolutions logged</small><strong>${S.resolutions.length}</strong></div>
    </div>
    <h3>Alert counts by topic</h3>
    <div class="flex">${TOPIC_KEYS.map(t => `<span class="pill ${TOPICS[t].cls}">${TOPICS[t].label}: ${byTopic[t] || 0}</span>`).join('')}</div>
    <h3 class="mt">Biggest observed moves</h3>
    ${biggest.length ? `<div class="tablewrap"><table><thead><tr><th>Time</th><th>Topic</th><th>Market</th><th class="right">From→To</th><th class="right">Δ</th><th>Source</th></tr></thead>
      <tbody>${biggest.map(a => `<tr><td class="mono">${new Date(a.t).toLocaleTimeString()}</td><td>${a.topic ? `<span class="pill ${TOPICS[a.topic].cls}">${TOPICS[a.topic].label}</span>` : '—'}</td>
        <td>${esc(a.title)}<div class="sub mono">${esc(a.ticker)}</div></td><td class="right num">${fmtPx(a.from)} → ${fmtPx(a.to)}</td>
        <td class="right num ${a.delta > 0 ? 'up' : 'down'}">${a.delta > 0 ? '+' : '−'}$${Math.abs(a.delta).toFixed(2)}</td>
        <td><a href="${API}/markets/${encodeURIComponent(a.ticker)}" target="_blank" rel="noopener">API ↗</a></td></tr>`).join('')}</tbody></table></div>` : '<div class="chatempty">No qualified moves captured yet in this browser session.</div>'}
    <h3 class="mt">Full alert archive</h3>
    ${S.alerts.length ? `<div class="tablewrap"><table><thead><tr><th>Time</th><th>Kind</th><th>Topic</th><th>Detail</th><th>Source</th></tr></thead>
      <tbody>${list.map(a => {
        const detail = a.kind === 'resolved' ? `RESOLVED ${String(a.result).toUpperCase()} — ${esc(a.title)}`
          : a.kind === 'info' ? esc(a.text)
          : `${esc(a.title)}: ${fmtPx(a.from)} → ${fmtPx(a.to)} (${a.kind === 'up' ? '+' : '−'}$${Math.abs(a.delta).toFixed(2)}, ${a.src === 'exchange-reported' ? 'exchange-reported' : 'observed'})`;
        return `<tr><td class="mono">${new Date(a.t).toLocaleTimeString()}</td>
          <td>${a.kind === 'up' ? '<span class="up">▲ up</span>' : a.kind === 'down' ? '<span class="down">▼ down</span>' : a.kind === 'resolved' ? '<span class="pill">resolved</span>' : a.kind === 'info' ? 'info' : 'model'}</td>
          <td>${a.topic ? `<span class="pill ${TOPICS[a.topic].cls}">${TOPICS[a.topic].label}</span>` : '—'}</td>
          <td>${detail}<div class="sub mono">${esc(a.ticker || '')}</div></td>
          <td>${a.ticker ? `<a href="${API}/markets/${encodeURIComponent(a.ticker)}" target="_blank" rel="noopener">API ↗</a>` : ''}</td></tr>`;
      }).join('')}</tbody></table></div>` : '<div class="chatempty">Archive empty — alerts appear once the page observes qualifying moves on tracked markets.</div>'}`;
}

/* ============================== 20. TOPIC SOURCES RENDER ============================== */
function renderTopicSources() {
  const el = $('topicSources'); if (!el) return;
  const t = PAGE_TOPIC;
  const meta = (SNAP && SNAP.topicSources && SNAP.topicSources[t]) || [];
  el.innerHTML = meta.length ? `<div class="tablewrap"><table>
    <thead><tr><th>Series</th><th>Title</th><th>Category / frequency</th><th>Official settlement source(s)</th><th>Contract terms</th><th>Series API</th></tr></thead>
    <tbody>${meta.map(s => `<tr><td class="mono">${esc(s.ticker)}</td><td>${esc(s.title)}</td><td>${esc(s.category || '')} / ${esc(s.frequency || '')}</td>
      <td>${(s.settlement_sources || []).map(x => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)} ↗</a>`).join(' · ') || '<span class="flag-blank">none listed</span>'}</td>
      <td>${s.contract_terms_url ? `<a href="${esc(s.contract_terms_url)}" target="_blank" rel="noopener">terms PDF ↗</a>` : ''}</td>
      <td><a href="${API}/series/${encodeURIComponent(s.ticker)}" target="_blank" rel="noopener">API ↗</a></td></tr>`).join('')}
    </tbody></table></div>
    <p class="src mt">Series metadata verified from the official demo API on ${esc(SNAP ? SNAP.generated : '2026-11-20')} (point-in-time snapshot). Live discovery at view time additionally uses <code>/series?category=…</code> / <code>/series?tags=…</code> (official filters per <a href="${DOCS.seriesList}" target="_blank" rel="noopener">Get Series List ↗</a>).</p>`
    : '<div class="chatempty">No verified series snapshot for this topic.</div>';
}

/* ============================== 21. LOOP CONTROL ============================== */
let _timers = [];
function afterBoot() {
  ensureWatch(); detectNewOpens();
  if (PAGE === 'live' || PAGE === 'topic') {
    selectEvent((S.watch[0] && !PAGE_TOPIC) ? S.watch[0] : (topicEvents().filter(e => PAGE === 'topic' ? e._topic === PAGE_TOPIC : true)[0] || {}).event_ticker || null);
    if (!S.selected) { const mk = inScopeMarkets().filter(m => PAGE === 'topic' ? m._topic === PAGE_TOPIC : true)[0]; if (mk) selectMarket(mk.ticker); }
  }
  renderAll();
  startLoops();
}
function startLoops() {
  stopLoops();
  _timers.push(setInterval(pollWatched, 2500));
  _timers.push(setInterval(refreshSelected, 2500));
  _timers.push(setInterval(pollOrderbook, 4000));
  _timers.push(setInterval(pollTape, 7000));
  _timers.push(setInterval(resolveTick, 45000));
  _timers.push(setInterval(() => refreshCatalog(true), 95000));
  _timers.push(setInterval(() => { if ($('lastPoll')) $('lastPoll').textContent = fmtAgo(stats.lastOk || Date.now()); renderStatus(); }, 3000));
  _timers.push(setInterval(drawChart, 1000));
}
function stopLoops() { _timers.forEach(clearInterval); _timers = []; }
function renderAll() {
  renderTables(); chatRenderAll(); renderResolutions(); renderPortfolio(); renderStatus(); renderBoot();
  if (PAGE === 'topic') { renderTopicSources(); }
}

/* ============================== 22. UI WIRING ============================== */
function wireUi() {
  // nav
  const nav = $('mainnav');
  if (nav) {
    const links = [
      ['index.html', 'Home'], ['live.html', 'Live dashboard'],
      ...TOPIC_KEYS.map(k => [k + '.html', TOPICS[k].label]),
      ['strategies.html', 'Strategies'], ['findings.html', 'Findings'],
      ['resolved.html', 'Resolved'], ['flagged.html', 'Flagged for review']
    ];
    const here = location.pathname.split('/').pop() || 'index.html';
    nav.innerHTML = links.map(([href, label]) => `<a href="${href}" class="${here === href ? 'active' : ''}">${label}</a>`).join('');
  }
  const wSel = $('windowSel');
  if (wSel) {
    wSel.innerHTML = WINDOWS.map(w => `<option value="${w.v}" ${w.v === S.settings.window ? 'selected' : ''}>${w.label}</option>`).join('');
    wSel.onchange = () => { S.settings.window = Number(wSel.value); saveSettings(); if (S.selected) { if (S.settings.window >= 3600) ensureCandles(S.selected, S.settings.window).then(drawChart); else drawChart(); } if ($('chartName') && S.selected) { const m = S.markets.get(S.selected); $('chartName').textContent = (m ? m.title : S.selected) + ' — YES price ($), window: ' + (WINDOWS.find(w => w.v === S.settings.window) || {}).label; } };
  }
  const thSel = $('thresholdSel');
  if (thSel) {
    thSel.innerHTML = [0.05, 0.10, 0.15, 0.20].map(v => `<option value="${v}" ${v === S.settings.threshold ? 'selected' : ''}>≥ $${v.toFixed(2)}</option>`).join('');
    thSel.onchange = () => { S.settings.threshold = Number(thSel.value); saveSettings(); chatRenderAll(); };
  }
  const wcSel = $('watchSel');
  if (wcSel) {
    wcSel.value = S.settings.watchCount;
    wcSel.onchange = () => { S.settings.watchCount = Math.max(1, Math.min(40, Number(wcSel.value) || 12)); saveSettings(); ensureWatch(); };
  }
  const pauseBtn = $('pauseBtn');
  if (pauseBtn) pauseBtn.onclick = () => { S.settings.paused = !S.settings.paused; saveSettings(); pauseBtn.textContent = S.settings.paused ? '▶ Resume polling' : '⏸ Pause polling'; };
  const botBtn = $('botBtn');
  if (botBtn) {
    botBtn.textContent = S.settings.botOn ? '🤖 Paper bot: ON' : '🤖 Paper bot: OFF';
    botBtn.classList.toggle('primary', S.settings.botOn);
    botBtn.onclick = () => { S.settings.botOn = !S.settings.botOn; saveSettings(); botBtn.textContent = S.settings.botOn ? '🤖 Paper bot: ON' : '🤖 Paper bot: OFF'; botBtn.classList.toggle('primary', S.settings.botOn); };
  }
  const clearBtn = $('clearBtn');
  if (clearBtn) clearBtn.onclick = () => {
    S.alerts = []; S.picks = []; S.resolutions = []; S.positions = []; S.closed = []; S.equity = [];
    Object.values(LS).forEach(k => { if (k !== LS.settings && k !== LS.series && k !== LS.catalog) localStorage.removeItem(k); });
    chatRenderAll(); renderResolutions(); renderPortfolio(); renderFindingsArchive();
  };
  const exportBtn = $('exportBtn');
  if (exportBtn) exportBtn.onclick = () => download('kalshi-demo-session-' + new Date().toISOString().slice(0, 10) + '.json', {
    exportedAt: new Date().toISOString(), settings: S.settings, alerts: S.alerts, modelPicks: S.picks,
    resolutions: S.resolutions, openPositions: S.positions, closedTrades: S.closed, equity: S.equity,
    note: 'All data from the official Kalshi demo REST API or locally simulated paper trades.'
  });
  window.addEventListener('resize', () => { drawChart(); drawEquity(); });
}

/* ============================== 23. INIT ============================== */
async function init() {
  wireUi(); renderStatus(); renderBoot();
  chatRenderAll(); renderResolutions(); renderPortfolio();
  await loadSnapshot();
  if (PAGE === 'index') renderSnapshotTable('endpoints', 'endpointTable');
  if (PAGE === 'topic') { renderSnapshotTable('topics.' + PAGE_TOPIC, 'snapTable'); }
  if (PAGE === 'flagged') renderSnapshotTable('irregularities', 'irregTable');
  bootstrap();
}
document.addEventListener('DOMContentLoaded', init);
/* Read-only test/diagnostic hook (used by repo unit tests; no credentials or private state). */
window.__KDM__ = { takerFee, makerFee, hydrateMarket, topicOf, checkAlerts, enter, closePos, settlePositions, portfolioStats, scoreMarket, parseD, statsTable, state: S, config: { API, TOPICS, KW, DEFAULT_SETTINGS } };
})();
