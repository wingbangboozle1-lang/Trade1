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
  'Gas prices': ['gas', 'gasoline', 'fuel', 'oil', 'petrol', 'hevno', 'natural gas'],
  'Elections': ['election', 'president', 'senate', 'governor', 'congress', 'vote', 'electoral'],
  'Culture': ['culture', 'music', 'movie', 'film', 'celebrity', 'award', 'grammy', 'oscar', 'tv', 'entertainment'],
  'Crypto': ['crypto', 'bitcoin', 'ethereum', 'btc', 'eth', 'solana', 'sol', 'crypto'],
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

function matchTopic(m) {
  if (category === 'All') return true;
  const t = ((m.title || '') + ' ' + (m.subtitle || '') + ' ' + (m.category || '') + ' ' + (m.event_ticker || '') + ' ' + (m.ticker || '')).toLowerCase();
  return (TERMS[category] || []).some((x) => t.includes(x));
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
  return Number.isFinite(n) ? '$' + n.toFixed(2) : '';
}
function numRaw(v) {
  if (v === undefined || v === null || v === '') return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}
function tickerLink(m) {
  const event = m.event_ticker || m.ticker;
  return 'https://kalshi.com/markets/' + encodeURIComponent(event);
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

function scoreModelLike(m, move) {
  // Simulated, unverified model heuristic: higher score = potentially high ROI setup.
  // Factors: volume, absolute move, price near 0.50 (uncertainty), recent activity.
  const vol = Math.max(0, num(m, 'volume_fp', 'volume') || 0);
  const bid = num(m, 'yes_bid_dollars', 'yes_bid');
  const nearMid = bid == null ? 0 : 1 - Math.abs(bid - 0.5) * 2; // 1 at 0.50, 0 at 0/1
  const moveScore = Math.min(move / ALERT_MOVE, 3);
  const volScore = Math.min(Math.log10(vol + 1) / 3, 1);
  return 0.4 * moveScore + 0.3 * volScore + 0.3 * nearMid;
}

function addAlert(kind, m, prevBid, newBid, causeUrl) {
  const now = Date.now();
  const move = Math.abs(newBid - prevBid);
  const entry = {
    id: now + '-' + Math.random().toString(36).slice(2, 7),
    t: now, ticker: m.ticker, title: m.title || m.ticker,
    event: m.event_ticker || m.ticker, prev: prevBid, cur: newBid,
    move: move, dir: newBid >= prevBid ? 'up' : 'down',
    url: tickerLink(m), cause: causeUrl || null, kind: kind,
    score: scoreModelLike(m, move)
  };
  alertLog.unshift(entry);
  if (entry.score >= 0.55) likeLog.unshift(entry); // model-liked threshold (heuristic, unverified)
  if (alertLog.length > 500) alertLog.length = 500;
  if (likeLog.length > 500) likeLog.length = 500;
  renderAlerts();
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
  tbody.innerHTML = rows.slice(0, 200).map((m) => {
    const yesBid = num(m, 'yes_bid_dollars', 'yes_bid');
    const yesAsk = num(m, 'yes_ask_dollars', 'yes_ask');
    const liq = m._liq || '…';
    const status = esc(m.status || 'open');
    const resolved = m.status === 'resolved' ? (m.result === 'yes' ? 'Resolved: YES' : m.result === 'no' ? 'Resolved: NO' : 'Resolved') : '';
    const rowSel = selected === m.ticker ? ' selected' : '';
    return '<tr data-ticker="' + esc(m.ticker) + '" class="' + esc(rowSel) + '" style="cursor:pointer">' +
      '<td>' +
      '<a href="' + tickerLink(m) + '" target="_blank" rel="noopener">' + esc(m.title || m.ticker) + '</a>' +
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
  }).join('') || '<tr><td colspan="8" class="empty">No matching open markets returned.</td></tr>';

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
    markets = (d.markets || []).map((x) => ({ ...x }));
    if ($('apiError')) $('apiError').textContent = '';
    if ($('status')) $('status').textContent = markets.length + ' returned · REST polling';
    if ($('liveState')) { $('liveState').textContent = 'Demo API reachable'; $('liveState').style.color = 'var(--green)'; }
    for (const m of markets) await enrichLiquidity(m);
    render();
    if (!selected && markets.length) select(markets[0].ticker);
  } catch (e) {
    if ($('status')) $('status').textContent = 'Demo API unavailable';
    if ($('liveState')) { $('liveState').textContent = 'Disconnected'; $('liveState').style.color = 'var(--amber)'; }
    if ($('apiError')) $('apiError').textContent = ' · ' + esc(e.message) + ' — values unverified; endpoint not reachable from this preview.';
    if ($('markets')) $('markets').innerHTML = '<tr><td colspan="8" class="empty">Could not read the demo API. Check network/CORS availability in the deployed GitHub Pages origin. No sample values are shown.</td></tr>';
  }
}

async function enrichLiquidity(m) {
  try {
    const r = await fetch(API + '/markets/' + encodeURIComponent(m.ticker) + '/orderbook', { cache: 'no-store' });
    if (!r.ok) { m._liq = '—'; return; }
    const d = await r.json();
    const ob = d.orderbook_fp || d.orderbook || {};
    const yes = ob.yes_dollars || ob.yes || [];
    const no = ob.no_dollars || ob.no || [];
    const sum = (arr) => arr.reduce((s, x) => s + Number(x[1] || 0), 0);
    m._liq = 'Y ' + fmt(sum(yes)) + ' / N ' + fmt(sum(no));
    m._book = { yes: yes.slice(0, 5), no: no.slice(0, 5) };
  } catch (e) { m._liq = '—'; }
}

async function select(t) {
  selected = t;
  if ($('tradeTicker')) $('tradeTicker').value = t;
  const m = markets.find((x) => x.ticker === t);
  if ($('graphName')) $('graphName').textContent = m ? (m.title || t) : t;
  render();
  try {
    const r = await fetch(API + '/markets/' + encodeURIComponent(t) + '/orderbook', { cache: 'no-store' });
    if (!r.ok) throw Error();
    const d = await r.json();
    const ob = d.orderbook_fp || d.orderbook || {};
    if (m) m._book = { yes: (ob.yes_dollars || ob.yes || []).slice(0, 8), no: (ob.no_dollars || ob.no || []).slice(0, 8) };
    renderLiquidity(m);
  } catch (e) { if (m) m._book = null; }
  await samplePrice(m);
}

async function samplePrice(m) {
  if (!m) return;
  const bid = num(m, 'yes_bid_dollars', 'yes_bid');
  if (bid == null) return;
  const now = Date.now();
  const prev = lastBid[m.ticker];
  if (prev != null && Math.abs(bid - prev) >= ALERT_MOVE) {
    addAlert('all', m, prev, bid);
  }
  lastBid[m.ticker] = bid;
  samples.push({ t: now, p: bid });
  const ms = Number($('period') ? $('period').value : 3600) * 1000;
  const cutoff = now - ms;
  samples = samples.filter((s) => s.t >= cutoff);
  draw();
  render();
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
  ).join('');
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
  x.fillText('Last: $' + last.p.toFixed(2), w - 90, 26);
}
function varGreen() { return '#61d6a2'; }

function renderAlerts() {
  const renderList = (el, list) => {
    if (!el) return;
    el.innerHTML = list.slice().map((e) =>
      '<div class="msg ' + e.kind + '">' +
      '<span class="move ' + (e.dir === 'up' ? 'up' : 'down') + '">' +
      (e.dir === 'up' ? '▲' : '▼') + ' ' + esc(e.title) + ' (' + esc(e.ticker) + ')</span>' +
      '$' + e.prev.toFixed(2) + ' → ' + '$' + e.cur.toFixed(2) +
      (' <span class="muted">· move $' + e.move.toFixed(2) + ' · ' + new Date(e.t).toLocaleTimeString() + '</span>') +
      '<span class="time source"><a href="' + esc(e.url) + '" target="_blank" rel="noopener">Official market page ↗</a>' +
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
  try { return JSON.parse(localStorage.getItem('kalshi-paper-trades') || '[]'); } catch { return []; }
}
function saveTrades(ts) { localStorage.setItem('kalshi-paper-trades', JSON.stringify(ts)); drawTrades(); renderPortfolio(); }
function drawTrades() {
  const el = $('trades');
  if (!el) return;
  const ts = getTrades();
  el.innerHTML = ts.slice().reverse().map((t) =>
    '<tr><td>' + esc(new Date(t.at).toLocaleString()) + '<br>' + esc(t.ticker) + '</td>' +
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
  el.textContent = count ? count + ' paper trades · simulated cost $' + cost.toFixed(2) + ' · no P&L valuation' : 'No paper trades yet.';
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
  if ($('refresh')) $('refresh').onclick = fetchMarkets;
  if ($('period')) $('period').onchange = () => { samples = []; if (selected) { const m = markets.find((x) => x.ticker === selected); samplePrice(m); } };
  if ($('paperTrade')) $('paperTrade').onclick = recordPaperTrade;
  if ($('clearTrades')) $('clearTrades').onclick = clearTrades;
  if ($('clearTradesBtn')) $('clearTradesBtn').onclick = clearTrades;
  drawTrades(); renderPortfolio();
  fetchMarkets();
  setInterval(fetchMarkets, 30000);
  setInterval(() => { if (selected) { const m = markets.find((x) => x.ticker === selected); samplePrice(m); } }, 5000);
  if ($('period') && selected) draw();
  window.addEventListener('resize', draw);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

// The arrow above is intentional in the rendered string; keep as-is.
