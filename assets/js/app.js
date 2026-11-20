/* Kalshi Demo Dashboard — shared application logic
 *
 * Reads ONLY public demo market data. No account authentication, no API keys,
 * no order submission. Paper trades live in this browser's localStorage.
 *
 * Live values come from https://external-api.demo.kalshi.co/trade-api/v2 at
 * runtime. This sandbox cannot reach that host, so nothing here is
 * pre-verified; every market row links to the official market page and every
 * value is marked as live/unverified until the deployed origin can reach the API.
 */
'use strict';

const API = 'https://external-api.demo.kalshi.co/trade-api/v2';
const MARKETS_URL = API + '/markets';
const TOPICS = ['All', 'Gas prices', 'Elections', 'Culture', 'Crypto', 'Golf'];
// Topic keyword heuristic (title/subtitle/category/event ticker). Not an official
// Kalshi classification; flagged for review.
const TERMS = {
  'Gas prices': ['gas', 'gasoline', 'fuel', 'heating oil', 'oil price', 'oil prices', 'petrol', 'natural gas'],
  'Elections': ['election', 'president', 'senate', 'governor', 'congress', 'vote', 'electoral'],
  'Culture': ['culture', 'music', 'movie', 'film', 'celebrity', 'award', 'grammy', 'oscar', 'tv', 'entertainment', 'box office', 'emmy'],
  'Crypto': ['crypto', 'bitcoin', 'ethereum', 'btc', 'eth', 'sol', 'solana'],
  'Golf': ['golf', 'pga', 'lpga', 'masters', 'ryder cup', 'players championship']
};

let category = window.category || 'All';
let markets = [];
let selected = '';
let samples = [];        // {t, p} for selected market
let alertLog = [];       // all sharp-move alerts
let likeLog = [];        // model-liked high-ROI alerts
let timer = null;
let lastBid = {};        // ticker -> last sampled yes bid
const ALERT_MOVE = 0.10; // dollars

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

function titleOf(m) { return m.yes_sub_title || m.title || m.ticker || ''; }
function topicOf(m) {
  const raw = [titleOf(m), m.subtitle, m.category, m.event_ticker, m.ticker].filter(Boolean).join(' ').toLowerCase();
  const text = ' ' + raw.replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
  return TOPICS.slice(1).find((topic) => (TERMS[topic] || []).some((term) => text.includes(' ' + term + ' '))) || '';
}
function matchTopic(m) {
  const topic = topicOf(m);
  return Boolean(topic) && (category === 'All' || topic === category);
}

function num(m, ...keys) {
  for (const k of keys) {
    const v = m[k];
    if (v !== undefined && v !== null && v !== '') {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}
function fmt(v) {
  if (v === undefined || v === null || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString() : String(v);
}
function price(v) {
  const n = numRaw(v);
  return Number.isFinite(n) ? '$' + n.toFixed(4) : '';
}
function numRaw(v) {
  if (v === undefined || v === null || v === '') return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}
function tickerLink(m) {
  return API + '/markets/' + encodeURIComponent(m.ticker);
}

function setTabs() {
  const el = $('tabs');
  if (!el) return;
  el.innerHTML = TOPICS.map((c) =>
    '<button class="tab ' + (category === c ? 'active' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + '</button>'
  ).join('');
  document.querySelectorAll('[data-cat]').forEach((b) => {
    b.onclick = () => { category = b.dataset.cat; setTabs(); render(); };
  });
}

function isModelLike(m) {
  // Transparent experiment only: top quartile by current listed contract volume plus YES spread <= $0.10.
  // This is not an ROI estimate, forecast, or validated strategy.
  const volumes = markets.map((x) => num(x, 'volume_fp', 'volume')).filter((v) => v != null).sort((a, b) => a - b);
  if (!volumes.length) return false;
  const threshold = volumes[Math.floor((volumes.length - 1) * 0.75)];
  const volume = num(m, 'volume_fp', 'volume');
  const bid = num(m, 'yes_bid_dollars', 'yes_bid');
  const ask = num(m, 'yes_ask_dollars', 'yes_ask');
  return volume != null && bid != null && ask != null && volume >= threshold && ask >= bid && priceDelta(bid, ask) <= 0.10;
}
function priceDelta(a, b) { return Math.round((b - a) * 10000) / 10000; }
function observePrices(rows) {
  for (const m of rows) {
    const bid = num(m, 'yes_bid_dollars', 'yes_bid');
    if (bid == null) continue;
    const prev = lastBid[m.ticker];
    if (prev != null && Math.abs(priceDelta(prev, bid)) >= ALERT_MOVE) addAlert('all', m, prev, bid);
    lastBid[m.ticker] = bid;
  }
}

function addAlert(kind, m, prevBid, newBid, causeUrl) {
  const now = Date.now();
  const move = Math.abs(priceDelta(prevBid, newBid));
  const entry = {
    id: now + '-' + Math.random().toString(36).slice(2, 7),
    t: now, ticker: m.ticker, title: titleOf(m),
    event: m.event_ticker || m.ticker, prev: prevBid, cur: newBid,
    move: move, dir: newBid >= prevBid ? 'up' : 'down',
    url: tickerLink(m), cause: causeUrl || null, kind: kind,
    score: isModelLike(m) ? 1 : 0
  };
  alertLog.unshift(entry);
  if (entry.score === 1) likeLog.unshift(entry); // transparent volume/spread filter, not ROI
  if (alertLog.length > 500) alertLog.length = 500;
  if (likeLog.length > 500) likeLog.length = 500;
  recordAutoSignals(m, prevBid, newBid, now);
  renderAlerts();
}

function recordAutoSignals(m, previous, current, at) {
  if (!(current > 0 && current < 1)) return;
  const rising = current > previous;
  const ts = getTrades();
  for (const strategy of ['Momentum', 'Mean reversion']) {
    const follows = strategy === 'Momentum' ? rising : !rising;
    const side = follows ? 'YES' : 'NO';
    const mark = side === 'YES' ? current : 1 - current;
    ts.push({ ticker: m.ticker, side, price: mark, qty: 1, strategy: 'Auto · ' + strategy,
      at: new Date(at).toISOString(), auto: true, signal: true });
  }
  try { saveTrades(ts.slice(-5000)); }
  catch (e) { if ($('tradeMsg')) $('tradeMsg').textContent = 'Automatic alert observed; local storage was unavailable, so signal marks were not saved.'; }
}

function render() {
  const rows = markets.filter(matchTopic).sort((a, b) =>
    (num(b, 'volume_fp', 'volume') || 0) - (num(a, 'volume_fp', 'volume') || 0)
  );

  if ($('tableTitle')) {
    $('tableTitle').textContent = category === 'All' ? 'Markets · all tracked topics' : 'Markets · ' + category;
    $('marketCount').textContent = fmt(rows.length);
    $('topVolume').textContent = rows.length ? fmt(num(rows[0], 'volume_fp', 'volume')) : '';
    const top = rows.find((m) => num(m, 'yes_bid_dollars', 'yes_bid') != null);
    $('topPrice').textContent = top ? price(num(top, 'yes_bid_dollars', 'yes_bid')) : '';
  }

  const tbody = $('markets');
  if (!tbody) return;
  tbody.innerHTML = rows.map((m) => {
    const yesBid = num(m, 'yes_bid_dollars', 'yes_bid');
    const yesAsk = num(m, 'yes_ask_dollars', 'yes_ask');
    const liq = 'Bid ' + price(yesBid) + ' × ' + fmt(m.yes_bid_size_fp) + ' / ask ' + price(yesAsk) + ' × ' + fmt(m.yes_ask_size_fp);
    const status = esc(m.status || 'open');
    const resolved = ''; // Settled outcomes are listed separately from the open-market table.
    const rowSel = selected === m.ticker ? ' selected' : '';
    return '<tr data-ticker="' + esc(m.ticker) + '" class="' + esc(rowSel) + '" style="cursor:pointer">' +
      '<td>' +
      '<a href="' + tickerLink(m) + '" target="_blank" rel="noopener">' + esc(titleOf(m)) + '</a>' +
      '<br><small class="muted">' + esc(m.event_ticker || m.ticker) + ' · ' + esc(m.category || '') + '</small>' +
      (resolved ? '<br><span class="pill">' + esc(resolved) + '</span>' : '') +
      '</td>' +
      '<td>' + price(yesBid) + '</td>' +
      '<td>' + price(yesAsk) + '</td>' +
      '<td>' + fmt(num(m, 'volume_fp', 'volume')) + '</td>' +
      '<td>' + liq + '</td>' +
      '<td>' + status + '</td>' +
      '<td>' + resolved + '</td>' +
      '</tr>';
  }).join('') || '<tr><td colspan="7" class="empty">No matching open markets returned.</td></tr>';

  document.querySelectorAll('[data-ticker]').forEach((r) => {
    r.onclick = (e) => { if (e.target.closest('a')) return; select(r.dataset.ticker); };
  });
  if ($('updated')) $('updated').textContent = new Date().toLocaleTimeString();
}

async function fetchMarkets() {
  try {
    const u = new URL(MARKETS_URL);
    u.searchParams.set('status', 'open');
    u.searchParams.set('limit', '1000');
    const r = await fetch(u, { cache: 'no-store' });
    if (!r.ok) throw Error('HTTP ' + r.status);
    const d = await r.json();
    markets = (d.markets || []).filter((m) => topicOf(m));
    observePrices(markets);
    if ($('apiError')) $('apiError').textContent = '';
    if ($('status')) $('status').textContent = markets.length + ' supported-topic markets · first API page (up to 1,000) · 30s polling';
    if ($('liveState')) { $('liveState').textContent = 'Demo API reachable'; $('liveState').style.color = 'var(--green)'; }
    render();
    if (!selected && markets.length) select(markets[0].ticker);
  } catch (e) {
    if ($('status')) $('status').textContent = 'Demo API unavailable';
    if ($('liveState')) { $('liveState').textContent = 'Disconnected'; $('liveState').style.color = 'var(--amber)'; }
    if ($('apiError')) $('apiError').textContent = ' · ' + esc(e.message) + ' — live values unverified; browser/API access must be checked in the deployed site.';
    if ($('markets')) $('markets').innerHTML = '<tr><td colspan="7" class="empty">Could not read the demo API. Check network/CORS availability in the deployed GitHub Pages origin. No sample values are shown.</td></tr>';
  }
}



async function select(t) {
  selected = t;
  if ($('tradeTicker')) $('tradeTicker').value = t;
  const m = markets.find((x) => x.ticker === t);
  if ($('graphName')) $('graphName').textContent = m ? titleOf(m) : t;
  samples = [];
  if ($('liquidity')) $('liquidity').textContent = 'Loading official order-book levels…';
  render();
  await samplePrice(m);
}

async function samplePrice(m) {
  if (!m) return;
  try {
    const obResponse = await fetch(API + '/markets/' + encodeURIComponent(m.ticker) + '/orderbook', { cache: 'no-store' });
    if (obResponse.ok) {
      const obData = await obResponse.json();
      const ob = obData.orderbook_fp || obData.orderbook || {};
      m._book = { yes: (ob.yes_dollars || ob.yes || []).slice(-8).reverse(), no: (ob.no_dollars || ob.no || []).slice(-8).reverse() };
      renderLiquidity(m);
    }
    const r = await fetch(API + '/markets/' + encodeURIComponent(m.ticker), { cache: 'no-store' });
    if (!r.ok) throw Error('HTTP ' + r.status);
    const d = await r.json();
    if (d.market) Object.assign(m, d.market);
  } catch (e) { /* Keep the last official list snapshot; no synthetic price is inserted. */ }
  const bid = num(m, 'yes_bid_dollars', 'yes_bid');
  if (bid == null) return;
  const now = Date.now();
  const prev = lastBid[m.ticker];
  if (prev != null && Math.abs(priceDelta(prev, bid)) >= ALERT_MOVE) addAlert('all', m, prev, bid);
  lastBid[m.ticker] = bid;
  samples.push({ t: now, p: bid });
  const ms = Number($('period') ? $('period').value : 3600) * 1000;
  samples = samples.filter((s) => s.t >= now - ms);
  draw();
  render();
}


async function fetchResolved() {
  const body = $('resolved');
  if (!body) return;
  try {
    const u = new URL(MARKETS_URL);
    u.searchParams.set('status', 'settled');
    u.searchParams.set('limit', '1000');
    const r = await fetch(u, { cache: 'no-store' });
    if (!r.ok) throw Error('HTTP ' + r.status);
    const d = await r.json();
    const rows = (d.markets || []).filter((m) => topicOf(m));
    body.innerHTML = rows.map((m) => {
      const result = ['yes', 'no'].includes(String(m.result || '').toLowerCase()) ? String(m.result).toUpperCase() : '';
      return '<tr><td>' + esc(titleOf(m)) + '<br><small>' + esc(m.event_ticker || m.ticker) + '</small></td>' +
        '<td>' + esc(m.status || '') + '</td><td>' + esc(result) + '</td>' +
        '<td><a href="' + esc(tickerLink(m)) + '" target="_blank" rel="noopener">Official API ↗</a></td></tr>';
    }).join('') || '<tr><td colspan="4" class="muted">No matching settled records returned.</td></tr>';
  } catch (e) {
    body.innerHTML = '<tr><td colspan="4" class="muted">Settled records unavailable; outcome left blank and unverified.</td></tr>';
  }
}

function renderLiquidity(m) {
  const el = $('liquidity');
  if (!el) return;
  if (!m || !m._book) { el.innerHTML = '<p class="muted">Order-book levels unavailable.</p>'; return; }
  const rows = [
    ['YES bids (contracts @ price)', m._book.yes],
    ['NO bids (contracts @ price)', m._book.no]
  ];
  el.innerHTML = rows.map(([label, levels]) =>
    '<div><b>' + esc(label) + '</b><br>' +
    (levels && levels.length ? levels.map((lv) =>
      '<span class="muted">' + fmt(lv[1]) + ' @ ' + price(lv[0]) + '</span>'
    ).join('  ') : '<span class="muted">none published</span>') +
    '</div>'
  ).join('') + '<p><a href="' + esc(API + '/markets/' + encodeURIComponent(m.ticker) + '/orderbook') + '" target="_blank" rel="noopener">Official order-book API source ↗</a></p>';
}

function draw() {
  const c = $('chart');
  if (!c) return;
  const rect = c.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  c.width = rect.width * dpr; c.height = rect.height * dpr;
  const x = c.getContext('2d'); x.scale(dpr, dpr);
  const w = rect.width, h = rect.height;
  x.clearRect(0, 0, w, h);
  x.strokeStyle = '#263238'; x.fillStyle = '#93a3a8'; x.font = '11px system-ui';
  for (let i = 0; i <= 4; i++) {
    const y = 14 + i * (h - 40) / 4;
    x.beginPath(); x.moveTo(40, y); x.lineTo(w - 10, y); x.stroke();
    x.fillText(((4 - i) / 4).toFixed(2), 4, y + 4);
  }
  if (samples.length < 1) {
    x.fillText('Select a market to plot YES bid vs time', 40, h / 2);
    x.fillText('X axis: timestamp · Y axis: contract price ($)', 40, h / 2 + 16);
    return;
  }
  let min = samples[0].t, max = samples[0].t;
  samples.forEach((s) => { if (s.t < min) min = s.t; if (s.t > max) max = s.t; });
  if (max === min) max = min + 1000;
  x.strokeStyle = varGreen(); x.lineWidth = 2; x.beginPath();
  samples.forEach((p, i) => {
    const px = 40 + (p.t - min) / (max - min) * (w - 50);
    const py = 14 + (1 - p.p) * (h - 40);
    i ? x.lineTo(px, py) : x.moveTo(px, py);
  });
  x.stroke();
  const last = samples[samples.length - 1];
  x.fillStyle = '#93a3a8';
  x.fillText(new Date(min).toLocaleTimeString(), 40, h - 6);
  x.fillText(new Date(max).toLocaleTimeString(), Math.max(40, w - 72), h - 6);
  x.fillText('Last: $' + last.p.toFixed(4), w - 100, 26);
}
function varGreen() { return '#61d6a2'; }

function renderAlerts() {
  const renderList = (el, list) => {
    if (!el) return;
    el.innerHTML = list.slice().map((e) =>
      '<div class="msg ' + e.kind + '">' +
      '<span class="move ' + (e.dir === 'up' ? 'up' : 'down') + '">' +
      (e.dir === 'up' ? '▲' : '▼') + ' ' + esc(e.title) + ' (' + esc(e.ticker) + ')</span>' +
      '$' + e.prev.toFixed(4) + ' → ' + '$' + e.cur.toFixed(4) +
      (' <span class="muted">· move $' + e.move.toFixed(4) + ' · ' + new Date(e.t).toLocaleTimeString() + '</span>') +
      '<span class="time source"><a href="' + esc(e.url) + '" target="_blank" rel="noopener">Official Kalshi API record ↗</a>' +
      (e.cause ? ' · cause link: <a href="' + esc(e.cause) + '" target="_blank" rel="noopener">link</a>' : '') +
      ' · cause unverified</span>' +
      '</div>'
    ).join('') || '<div class="muted">No qualifying alerts yet.</div>';
  };
  renderList($('alertsAll'), alertLog);
  renderList($('alertsLike'), likeLog);
  if ($('alertCount')) $('alertCount').textContent = alertLog.length;
  if ($('likeCount')) $('likeCount').textContent = likeLog.length;
}

// ---------- paper trades (localStorage only) ----------
function getTrades() {
  try { const rows = JSON.parse(localStorage.getItem('kalshi-paper-trades') || '[]'); return Array.isArray(rows) ? rows : []; } catch { return []; }
}
function saveTrades(ts) { localStorage.setItem('kalshi-paper-trades', JSON.stringify(ts)); drawTrades(); renderPortfolio(); }
function drawTrades() {
  const el = $('trades');
  if (!el) return;
  const ts = getTrades();
  el.innerHTML = ts.slice().reverse().map((t) =>
    '<tr><td>' + esc(new Date(t.at).toLocaleString()) + '<br><a href="' + esc(tickerLink({ ticker: t.ticker })) + '" target="_blank" rel="noopener">' + esc(t.ticker) + ' · API source ↗</a></td>' +
    '<td>' + esc(t.side) + '</td>' +
    '<td>' + fmt(t.qty) + ' × ' + price(t.price) + '</td>' +
    '<td>' + esc(t.strategy) + '</td></tr>'
  ).join('');
}
function renderPortfolio() {
  const el = $('portfolio');
  if (!el) return;
  const ts = getTrades();
  const count = ts.length;
  const cost = ts.reduce((s, t) => s + t.qty * t.price, 0);
  el.textContent = count ? count + ' paper records · signal-mark total $' + cost.toFixed(4) + ' · not fill cost · no P&L valuation' : 'No paper trades yet.';
}
function recordPaperTrade() {
  const ticker = $('tradeTicker') ? $('tradeTicker').value.trim() : '';
  const priceN = numRaw($('tradePrice') ? $('tradePrice').value : '');
  const qty = Number($('tradeQty') ? $('tradeQty').value : '');
  const msg = $('tradeMsg');
  if (!ticker || !Number.isFinite(priceN) || priceN <= 0 || priceN >= 1 || !Number.isInteger(qty) || qty < 1) {
    msg.textContent = 'Enter ticker, price between $0.01 and $0.99, and whole contracts.';
    return;
  }
  const ts = getTrades();
  ts.push({ ticker, side: $('tradeSide').value, price: priceN, qty, strategy: $('strategy').value, at: new Date().toISOString() });
  saveTrades(ts);
  msg.textContent = 'Recorded locally only. No order was submitted to Kalshi.';
}
function clearTrades() {
  localStorage.removeItem('kalshi-paper-trades');
  drawTrades(); renderPortfolio();
}

function init() {
  setTabs();
  if ($('refresh')) $('refresh').onclick = () => { fetchMarkets(); fetchResolved(); };
  if ($('period')) $('period').onchange = () => { samples = []; if (selected) { const m = markets.find((x) => x.ticker === selected); samplePrice(m); } };
  if ($('paperTrade')) $('paperTrade').onclick = recordPaperTrade;
  if ($('clearTrades')) $('clearTrades').onclick = clearTrades;
  if ($('clearTradesBtn')) $('clearTradesBtn').onclick = clearTrades;
  drawTrades(); renderPortfolio();
  fetchMarkets();
  fetchResolved();
  setInterval(fetchMarkets, 30000);
  setInterval(fetchResolved, 60000);
  setInterval(() => { if (selected) { const m = markets.find((x) => x.ticker === selected); samplePrice(m); } }, 5000);
  if ($('period') && selected) draw();
  window.addEventListener('resize', draw);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

// The arrow above is intentional in the rendered string; keep as-is.
