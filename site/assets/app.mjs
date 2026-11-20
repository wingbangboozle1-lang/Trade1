// Browser app for the Kalshi demo monitor. Public, unauthenticated GET requests only.
// Falls back to data/snapshot.json (built in CI from the same official endpoints) when
// the live API cannot be reached from the browser (e.g. CORS or network).
import { API_BASES, TOPICS, topicById, rowsFromEvents, fetchPaged, detectSwing, screenAlert, parseOrderbook, fmtUsd, fmtNum, SCREEN } from './lib.mjs';

const $ = (s, r = document) => r.querySelector(s);
const set = (id, prop, v) => { const el = $(id); if (el) el[prop] = v; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SIM_KEY = 'kalshi-demo-sim-v1';
const ALERT_KEY = 'kalshi-demo-alerts-v1';
const SETTINGS_KEY = 'kalshi-demo-settings-v1';
const WINDOW_SEC = 300;           // swing window for alerts (5 minutes)
const TRADE_LOOKBACK_SEC = 900;   // trade history kept per market for alerting
const RANGES = [[60, '60 seconds'], [300, '5 minutes'], [900, '15 minutes'], [3600, '1 hour'], [21600, '6 hours']];
const STRATS = {
  momentum: { label: 'A · Momentum follow', desc: 'Buy the side the alert moved toward. 1 contract, entry = last official trade price.' },
  fade: { label: 'B · Mean-reversion fade', desc: 'Buy the side opposite the alert move. 1 contract, entry = last official trade price.' },
  screen: { label: 'C · Placeholder high-ROI screen', desc: 'Momentum follow, only for alerts that pass the placeholder screen (see Flagged page).' },
};

const root = document.body.dataset.root || './';
const topicFilter = document.body.dataset.topic || 'all';
const settings = loadJSON(SETTINGS_KEY, { base: 'demo' });
const state = {
  base: API_BASES[settings.base] ? settings.base : 'demo',
  markets: [],          // rows (topic-matched) from live or snapshot
  byTicker: new Map(),  // ticker -> row
  source: 'loading',    // live | snapshot | offline
  snapshotMeta: null,
  trades: new Map(),    // ticker -> [{t, p}] within lookback
  lastPrice: new Map(), // ticker -> {p, t}
  alerts: loadJSON(ALERT_KEY, []),
  seenAlert: new Set(),
  selected: null,
  chartPoints: [],
  resolved: new Map(),  // ticker -> {result, ts}
  statusMsg: '',
};
let pollErrors = 0;

function loadJSON(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }
function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or disabled */ } }
const API = () => API_BASES[state.base];
const nowSec = () => Date.now() / 1000;
const r4 = x => Math.round(x * 10000) / 10000;
const hms = ts => new Date(ts * 1000).toLocaleTimeString();
const inTopic = row => topicFilter === 'all' || row.topics.includes(topicFilter);

// ---------- navigation ----------
const NAV = [['index.html', 'Home'], ['live.html', 'Live dashboard'], ['topics/gas-prices.html', 'Gas prices'], ['topics/elections.html', 'Elections'], ['topics/culture.html', 'Culture'], ['topics/crypto.html', 'Crypto'], ['topics/golf.html', 'Golf'], ['resolved.html', 'Resolved'], ['strategies.html', 'Strategies'], ['sources.html', 'Sources'], ['flagged.html', 'Flagged for Review']];
function renderNav() {
  const nav = $('#nav');
  if (!nav) return;
  const here = location.pathname.split('/').pop() || 'index.html';
  const inTopics = location.pathname.includes('/topics/');
  nav.innerHTML = `<a class="brand" href="${root}index.html"><span class="mark">K</span> Kalshi Demo Monitor</a><nav class="menu">${NAV.map(([href, label]) => {
    const active = href.endsWith(here) || (inTopics && href.endsWith(here));
    return `<a href="${root}${href}" class="${active ? 'on' : ''}">${label}</a>`;
  }).join('')}</nav>`;
}

function setPill(kind, text) {
  const p = $('#statusPill');
  if (!p) return;
  p.className = `pill ${kind}`;
  p.textContent = text;
}

// ---------- data loading ----------
async function loadSnapshot() {
  const res = await fetch(`${root}data/snapshot.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`snapshot HTTP ${res.status}`);
  const snap = await res.json();
  state.snapshotMeta = { generated_at: snap.generated_at, api_base: snap.api_base, coverage: snap.coverage };
  return snap;
}

async function loadMarkets() {
  try {
    const { items, pages, truncated } = await fetchPaged(`${API()}/events?status=open&with_nested_markets=true&limit=200`, 'events', { maxPages: 40, pageDelayMs: 120 });
    state.markets = rowsFromEvents(items, API());
    state.source = 'live';
    state.statusMsg = `${items.length} open events, ${pages} page(s)${truncated ? ' — TRUNCATED at page cap' : ''}`;
  } catch (e) {
    state.statusMsg = `Live API unavailable from this browser (${e.message}). Showing build-time snapshot.`;
    try {
      const snap = await loadSnapshot();
      state.markets = snap.rows.filter(r => r.status === 'active' || r.status === 'initialized' || r.status === 'inactive' || r.status === 'closed');
      state.source = 'snapshot';
    } catch (e2) {
      state.markets = [];
      state.source = 'offline';
      state.statusMsg = `No live data and no snapshot (${e2.message}).`;
    }
  }
  state.byTicker = new Map(state.markets.map(r => [r.ticker, r]));
  const pill = state.source === 'live' ? ['ok', `Live · ${state.base} API`] : state.source === 'snapshot' ? ['warn', 'Snapshot (build time)'] : ['bad', 'Offline'];
  setPill(...pill);
  renderMarkets();
  renderCards();
}

async function pollTrades() {
  if (state.source !== 'live' || state.byTicker.size === 0) return;
  const since = Math.floor(nowSec() - TRADE_LOOKBACK_SEC);
  let trades;
  try {
    ({ items: trades } = await fetchPaged(`${API()}/markets/trades?limit=1000&min_ts=${since}`, 'trades', { maxPages: 3, pageDelayMs: 80 }));
    pollErrors = 0;
  } catch (e) {
    pollErrors += 1;
    if (pollErrors >= 3) setPill('bad', 'Trade feed errors · retrying');
    return;
  }
  const touched = new Set();
  for (const tr of trades) {
    if (!state.byTicker.has(tr.ticker)) continue;
    const p = Number(tr.yes_price_dollars), t = Date.parse(tr.created_time) / 1000;
    if (!Number.isFinite(p) || !Number.isFinite(t)) continue;
    if (!state.trades.has(tr.ticker)) state.trades.set(tr.ticker, []);
    state.trades.get(tr.ticker).push({ t, p, id: tr.trade_id });
    touched.add(tr.ticker);
  }
  const cutoff = nowSec() - TRADE_LOOKBACK_SEC;
  for (const [tk, arr] of state.trades) {
    const kept = arr.filter(x => x.t >= cutoff);
    const seen = new Set();
    state.trades.set(tk, kept.filter(x => (seen.has(x.id) ? false : (seen.add(x.id), true))));
  }
  for (const tk of touched) {
    const arr = state.trades.get(tk);
    const last = arr.reduce((a, b) => (b.t > a.t ? b : a));
    state.lastPrice.set(tk, { p: last.p, t: last.t });
    const sw = detectSwing(arr.map(x => ({ t: x.t, p: x.p })), { windowSec: WINDOW_SEC, now: nowSec() });
    if (sw) addAlert(tk, sw);
  }
  if (state.selected && touched.has(state.selected)) drawChart();
  if (touched.size) renderMarkets();
  renderAlerts();
  renderCards();
  renderSim();
  set('#lastTrade', 'textContent', `${trades.length} trades in last ${TRADE_LOOKBACK_SEC / 60} min`);
}

function addAlert(ticker, sw) {
  const bucket = Math.floor(sw.at / WINDOW_SEC);
  const key = `${ticker}|${sw.type}|${sw.direction}|${bucket}`;
  if (state.seenAlert.has(key)) return;
  state.seenAlert.add(key);
  const row = state.byTicker.get(ticker);
  const alert = { key, ticker, title: row?.title || ticker, topics: row?.topics || [], at: sw.at, ...sw, screen: screenAlert(sw), sources: row?.event_settlement_sources || [], source_url: row?.source_url || `${API()}/markets/${encodeURIComponent(ticker)}`, kalshi_url: row?.kalshi_url || null, base: state.base };
  state.alerts.push(alert);
  if (state.alerts.length > 300) state.alerts = state.alerts.slice(-300);
  saveJSON(ALERT_KEY, state.alerts);
  simOnAlert(alert, row);
}

async function loadResolved() {
  // Official settled events (first pages) plus the build snapshot.
  try {
    const { items } = await fetchPaged(`${API()}/events?status=settled&with_nested_markets=true&limit=200`, 'events', { maxPages: 4, pageDelayMs: 120 });
    for (const r of rowsFromEvents(items, API())) {
      if (r.result) state.resolved.set(r.ticker, { result: r.result, ts: r.settlement_ts, title: r.title, topics: r.topics, source_url: r.source_url, kalshi_url: r.kalshi_url, sources: r.event_settlement_sources, status: r.status });
    }
  } catch { /* snapshot below still applies */ }
  try {
    const snap = await loadSnapshot();
    for (const r of snap.resolved || []) if (!state.resolved.has(r.ticker)) state.resolved.set(r.ticker, { result: r.result, ts: r.settlement_ts, title: r.title, topics: r.topics, source_url: r.source_url, kalshi_url: r.kalshi_url, sources: r.event_settlement_sources, status: r.status, from_snapshot: true });
  } catch { /* no snapshot */ }
  renderResolved();
  renderSim();
}

// ---------- rendering ----------
function renderCards() {
  const rows = state.markets.filter(inTopic);
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set('#cMarkets', fmtNum(rows.length));
  set('#cOI', fmtUsd(rows.reduce((s, r) => s + (r.open_interest_notional_derived || 0), 0), 0));
  set('#cAlerts', fmtNum(state.alerts.filter(a => inTopic({ topics: a.topics })).length));
  set('#cUpdated', new Date().toLocaleTimeString());
  const st = state.snapshotMeta ? `Snapshot built ${state.snapshotMeta.generated_at}` : '';
  set('#statusMsg', state.source === 'snapshot' ? st + ' · ' + state.statusMsg : state.statusMsg);
}

function sortRows(rows) {
  const by = $('#sortBy')?.value || 'oi';
  const move = r => {
    const lp = state.lastPrice.get(r.ticker);
    const arr = state.trades.get(r.ticker) || [];
    if (!arr.length) return 0;
    return Math.abs(arr[arr.length - 1].p - arr[0].p);
  };
  const key = { oi: r => r.open_interest_notional_derived ?? -1, vol: r => r.volume_contracts ?? -1, move: move }[by] || (r => 0);
  return rows.slice().sort((a, b) => key(b) - key(a));
}

function renderMarkets() {
  const body = $('#marketBody');
  if (!body) return;
  const rows = sortRows(state.markets.filter(inTopic)).slice(0, 300);
  body.innerHTML = rows.map(r => {
    const lp = state.lastPrice.get(r.ticker);
    const price = lp ? lp.p : r.last_price;
    const sel = state.selected === r.ticker ? ' class="sel"' : '';
    return `<tr data-ticker="${esc(r.ticker)}"${sel}>
      <td><b>${esc(r.title)}</b><br><small class="muted">${esc(r.yes_label || '')} · ${esc(r.ticker)}</small></td>
      <td>${r.topics.map(t => `<span class="tag">${esc(topicById(t)?.label || t)}</span>`).join(' ')}</td>
      <td>${fmtUsd(r.yes_bid)}</td><td>${fmtUsd(r.yes_ask)}</td>
      <td>${fmtUsd(price)}${lp ? ' <small class="muted">trade</small>' : ''}</td>
      <td>${fmtNum(r.volume_contracts)}</td>
      <td title="Derived: open interest × notional value per contract">${fmtUsd(r.open_interest_notional_derived, 0)}</td>
      <td>${esc(r.status || '')}</td>
      <td class="links"><a href="${esc(r.source_url)}" target="_blank" rel="noopener">API ↗</a>${r.kalshi_url ? ` · <a href="${esc(r.kalshi_url)}" target="_blank" rel="noopener">Kalshi ↗</a>` : ''}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="9" class="empty">No matching markets in the ${state.source} data yet.</td></tr>`;
  body.querySelectorAll('tr[data-ticker]').forEach(tr => tr.addEventListener('click', e => { if (e.target.closest('a')) return; select(tr.dataset.ticker); }));
  $('#tableCount') && (set('#tableCount', 'textContent', `${rows.length} shown · ${state.markets.filter(inTopic).length} matched`));
}

function renderAlerts() {
  const mk = a => `<div class="msg ${a.direction}"><div class="meta">${hms(a.at)} · ${esc(a.type)} · <b class="${a.direction}">${a.direction === 'up' ? '▲' : '▼'} ${fmtUsd(Math.abs(a.net))}</b> ${fmtUsd(a.from)} → ${fmtUsd(a.to)}${a.screen.pass ? ' · <span class="tag hot">screen pass</span>' : ''}</div>
    <div><a href="${esc(a.source_url)}" target="_blank" rel="noopener">${esc(a.title)}</a> <small class="muted">(${esc(a.ticker)})</small></div>
    <small class="muted">Cause not verified.${a.sources.length ? ' Official settlement sources listed by Kalshi: ' + a.sources.slice(0, 4).map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>`).join(', ') : ''}</small></div>`;
  const list = state.alerts.filter(a => topicFilter === 'all' || a.topics.includes(topicFilter)).slice(-200);
  const all = $('#chatAll');
  const scr = $('#chatScreen');
  if (all) { const stick = nearBottom(all); all.innerHTML = list.map(mk).join('') || '<p class="muted">No swings of $0.10 or more in the last 5 minutes yet.</p>'; if (stick) all.scrollTop = all.scrollHeight; }
  if (scr) { const sl = list.filter(a => a.screen.pass); const stick = nearBottom(scr); scr.innerHTML = sl.map(mk).join('') || `<p class="muted">No alerts pass the placeholder screen (≥ ${SCREEN.minTrades} trades, payout ≥ ${SCREEN.minPayoutMultiple}×, side price ≤ $${SCREEN.maxSidePrice.toFixed(2)}).</p>`; if (stick) scr.scrollTop = scr.scrollHeight; }
  $('#alertCount') && (set('#alertCount', 'textContent', fmtNum(list.length)));
}
const nearBottom = el => el.scrollHeight - el.scrollTop - el.clientHeight < 60;

function renderResolved() {
  const el = $('#resolvedBody');
  const count = $('#resolvedCount');
  const list = [...state.resolved.entries()].filter(([, v]) => topicFilter === 'all' || v.topics.includes(topicFilter));
  if (count) count.textContent = fmtNum(list.length);
  if (!el) return;
  el.innerHTML = list.sort((a, b) => (b[1].ts || '').localeCompare(a[1].ts || '')).map(([tk, v]) => `<tr>
    <td>${esc(v.title)}<br><small class="muted">${esc(tk)}</small></td>
    <td>${v.topics.map(t => `<span class="tag">${esc(topicById(t)?.label || t)}</span>`).join(' ')}</td>
    <td><b class="${v.result === 'yes' ? 'up' : 'down'}">${esc(String(v.result).toUpperCase())}</b></td>
    <td>${esc(v.ts || '')}</td><td>${esc(v.status || '')}${v.from_snapshot ? ' <small class="muted">(snapshot)</small>' : ''}</td>
    <td class="links"><a href="${esc(v.source_url)}" target="_blank" rel="noopener">API ↗</a>${v.kalshi_url ? ` · <a href="${esc(v.kalshi_url)}" target="_blank" rel="noopener">Kalshi ↗</a>` : ''}</td>
  </tr>`).join('') || '<tr><td colspan="6" class="empty">No settled markets loaded yet.</td></tr>';
}

// ---------- selected market: chart + liquidity ----------
function select(ticker) {
  state.selected = ticker;
  const r = state.byTicker.get(ticker);
  $('#selTitle') && (set('#selTitle', 'textContent', r ? r.title : ticker));
  $('#selLink') && r && ($('#selLink').href = r.source_url);
  renderMarkets();
  loadChart();
  loadBook();
}

async function loadChart() {
  const t = state.selected;
  if (!t) return;
  const range = Number($('#range')?.value || 300);
  try {
    const { items } = await fetchPaged(`${API()}/markets/trades?ticker=${encodeURIComponent(t)}&min_ts=${Math.floor(nowSec() - range)}&limit=1000`, 'trades', { maxPages: 5, pageDelayMs: 60 });
    state.chartPoints = items.map(x => ({ t: Date.parse(x.created_time) / 1000, p: Number(x.yes_price_dollars), n: Number(x.count_fp) })).filter(x => Number.isFinite(x.p) && Number.isFinite(x.t)).sort((a, b) => a.t - b.t);
    set('#chartNote', 'textContent', `${state.chartPoints.length} official trade prints in the last ${RANGES.find(([s]) => s === range)?.[1] || range + ' s'}. ${state.chartPoints.length ? '' : 'No trades in this window (not zero).'}`);
  } catch (e) {
    state.chartPoints = [];
    set('#chartNote', 'textContent', `Trade history unavailable from this browser (${e.message}).`);
  }
  drawChart();
}

function drawChart() {
  const c = $('#chart');
  if (!c) return;
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = c.clientHeight || 260;
  c.width = w * dpr; c.height = h * dpr;
  const x = c.getContext('2d');
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, w, h);
  const L = 46, R = 12, T = 12, B = 30;
  const range = Number($('#range')?.value || 300);
  const end = nowSec(), start = end - range;
  const px = t => L + (t - start) / range * (w - L - R);
  const py = p => T + (1 - p) * (h - T - B);
  x.font = '11px system-ui'; x.strokeStyle = '#2a3a44'; x.fillStyle = '#8fa3ad';
  for (let i = 0; i <= 4; i++) { const p = i / 4; const y = py(p); x.beginPath(); x.moveTo(L, y); x.lineTo(w - R, y); x.stroke(); x.fillText('$' + p.toFixed(2), 4, y + 4); }
  x.fillText(new Date(start * 1000).toLocaleTimeString(), L, h - 8);
  x.fillText(new Date(end * 1000).toLocaleTimeString(), w - 80, h - 8);
  x.fillText('time →', (w / 2) - 20, h - 8);
  if (!state.selected) return;
  const pts = state.chartPoints;
  if (pts.length) {
    x.strokeStyle = '#62d6a2'; x.lineWidth = 2; x.beginPath();
    pts.forEach((q, i) => (i ? x.lineTo(px(q.t), py(q.p)) : x.moveTo(px(q.t), py(q.p))));
    x.stroke();
    x.fillStyle = '#62d6a2';
    for (const q of pts) { x.beginPath(); x.arc(px(q.t), py(q.p), 2.5, 0, Math.PI * 2); x.fill(); }
  }
  const r = state.byTicker.get(state.selected);
  if (r && r.yes_bid != null) { x.fillStyle = '#f5b84b'; x.fillText(`bid $${r.yes_bid.toFixed(2)}`, w - 90, py(r.yes_bid) - 4); }
}

async function loadBook() {
  const t = state.selected;
  if (!t) return;
  try {
    const res = await fetch(`${API()}/markets/${encodeURIComponent(t)}/orderbook`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ob = parseOrderbook(await res.json());
    const lvl = arr => arr.slice(0, 10).map(l => `<tr><td>${fmtUsd(l.price)}</td><td>${fmtNum(l.contracts)}</td></tr>`).join('') || '<tr><td colspan="2" class="empty">no resting bids</td></tr>';
    set('#bookYes', 'innerHTML', `<thead><tr><th>YES bid</th><th>contracts</th></tr></thead><tbody>${lvl(ob.yes_bids)}</tbody>`);
    set('#bookNo', 'innerHTML', `<thead><tr><th>NO bid</th><th>contracts</th></tr></thead><tbody>${lvl(ob.no_bids)}</tbody>`);
    const tot = arr => arr.reduce((s, l) => s + l.contracts, 0);
    set('#bookNote', 'innerHTML', `Total resting: YES bids ${fmtNum(tot(ob.yes_bids))} contracts, NO bids ${fmtNum(tot(ob.no_bids))} contracts. Derived implied YES ask = $1.00 − best NO bid: ${fmtUsd(ob.implied_yes_ask)}. Source: <a href="${API()}/markets/${encodeURIComponent(t)}/orderbook" target="_blank" rel="noopener">orderbook API ↗</a>.`);
  } catch (e) {
    set('#bookNote', 'textContent', `Orderbook unavailable from this browser (${e.message}). No values are shown in its place.`);
  }
}

// ---------- simulated strategies ----------
function loadSim() { return loadJSON(SIM_KEY, { positions: [] }); }
function simOnAlert(alert, row) {
  const sim = loadSim();
  const bucket = Math.floor(alert.at / WINDOW_SEC);
  const followYes = alert.direction === 'up';
  let added = 0;
  for (const sid of Object.keys(STRATS)) {
    if (sid === 'screen' && !alert.screen.pass) continue;
    const key = `${sid}|${alert.ticker}|${bucket}`;
    if (sim.positions.some(p => p.key === key)) continue;
    const sideYes = sid === 'fade' ? !followYes : followYes;
    const entry = sideYes ? alert.to : 1 - alert.to;
    if (!(entry > 0 && entry < 1)) continue;
    sim.positions.push({ key, strategy: sid, ticker: alert.ticker, title: alert.title, topics: alert.topics, side: sideYes ? 'YES' : 'NO', entry: r4(entry), alert_type: alert.type, direction: alert.direction, screen_pass: alert.screen.pass, opened_at: new Date(alert.at * 1000).toISOString(), source_url: alert.source_url, base: alert.base, qty: 1 });
    added++;
  }
  if (added) saveJSON(SIM_KEY, sim);
}

// Value of one contract now: settled result if known, else last official trade price.
export function positionValue(p, resolved, lastPrice) {
  const res = resolved.get(p.ticker);
  if (res && (res.result === 'yes' || res.result === 'no')) {
    const yesPaid = res.result === 'yes' ? 1 : 0;
    return { value: p.side === 'YES' ? yesPaid : 1 - yesPaid, basis: 'settled' };
  }
  const lp = lastPrice.get(p.ticker);
  if (!lp) return { value: null, basis: 'unmarked' };
  return { value: p.side === 'YES' ? lp.p : 1 - lp.p, basis: 'mark' };
}

export function summarize(positions, resolved, lastPrice) {
  const groups = {};
  for (const p of positions) {
    const v = positionValue(p, resolved, lastPrice);
    const keys = [['strategy', p.strategy], ...p.topics.map(t => ['topic', t]), ['alert', p.alert_type]];
    for (const [dim, k] of keys) {
      const g = (groups[`${dim}:${k}`] ||= { dim, key: k, n: 0, marked: 0, settled: 0, wins: 0, pnl: 0 });
      g.n++;
      if (v.value != null) { g.marked++; g.pnl += v.value - p.entry; if (v.value > p.entry) g.wins++; }
      if (v.basis === 'settled') g.settled++;
    }
  }
  return groups;
}

function renderSim() {
  const el = $('#simSummary');
  const sim = loadSim();
  const pos = sim.positions;
  const cnt = $('#simCount');
  if (cnt) cnt.textContent = fmtNum(pos.length);
  if (!el) return;
  const g = summarize(pos, state.resolved, state.lastPrice);
  const row = (x, label) => `<tr><td>${label}</td><td>${x.n}</td><td>${x.marked}</td><td>${x.settled}</td><td>${x.marked ? Math.round(x.wins / x.marked * 100) + '%' : '—'}</td><td>${x.marked ? fmtUsd(x.pnl / x.marked, 3) : '—'}</td><td>${x.marked ? fmtUsd(x.pnl, 2) : '—'}</td></tr>`;
  const head = '<thead><tr><th>Group</th><th>Trades</th><th>Marked</th><th>Settled</th><th>Win rate (marked)</th><th>Avg P&amp;L / contract</th><th>Total P&amp;L (1 contract each)</th></tr></thead>';
  const sect = (dim, title) => {
    const items = Object.values(g).filter(x => x.dim === dim).sort((a, b) => b.n - a.n);
    return items.length ? `<h3>${title}</h3><div class="tablewrap"><table>${head}<tbody>${items.map(x => row(x, esc(dim === 'strategy' ? (STRATS[x.key]?.label || x.key) : dim === 'topic' ? (topicById(x.key)?.label || x.key) : x.key))).join('')}</tbody></table></div>` : '';
  };
  el.innerHTML = pos.length ? sect('strategy', 'By strategy') + sect('topic', 'By topic category') + sect('alert', 'By alert type') : '<p class="muted">No simulated trades yet. The engine opens one 1-contract simulated position per alert and strategy in this browser.</p>';
  const recent = $('#simRecent');
  if (recent) recent.innerHTML = pos.slice(-100).reverse().map(p => { const v = positionValue(p, state.resolved, state.lastPrice); return `<tr><td>${esc(p.opened_at.replace('T', ' ').slice(0, 19))}</td><td>${esc(STRATS[p.strategy]?.label || p.strategy)}</td><td><a href="${esc(p.source_url)}" target="_blank" rel="noopener">${esc(p.title)}</a><br><small class="muted">${esc(p.ticker)}</small></td><td>${p.side} @ ${fmtUsd(p.entry)}</td><td>${v.value == null ? '—' : fmtUsd(v.value) + ' <small class="muted">' + v.basis + '</small>'}</td></tr>`; }).join('') || '<tr><td colspan="5" class="empty">No simulated trades yet.</td></tr>';
}

// ---------- settings & boot ----------
function bindControls() {
  const apiSel = $('#apiBase');
  if (apiSel) {
    apiSel.value = state.base;
    apiSel.addEventListener('change', () => { state.base = apiSel.value; saveJSON(SETTINGS_KEY, { base: state.base }); state.trades.clear(); state.lastPrice.clear(); loadMarkets(); });
  }
  $('#sortBy')?.addEventListener('change', renderMarkets);
  $('#range')?.addEventListener('change', loadChart);
  $('#clearSim')?.addEventListener('click', () => { if (confirm('Clear this browser\'s simulated trades?')) { localStorage.removeItem(SIM_KEY); renderSim(); } });
  $('#clearAlerts')?.addEventListener('click', () => { state.alerts = []; saveJSON(ALERT_KEY, []); renderAlerts(); });
  const rs = $('#range');
  if (rs) rs.innerHTML = RANGES.map(([s, l]) => `<option value="${s}"${s === 300 ? ' selected' : ''}>${l}</option>`).join('');
  $('#topicTitle') && (set('#topicTitle', 'textContent', topicFilter === 'all' ? 'All five topics' : (topicById(topicFilter)?.label || topicFilter)));
}

async function boot() {
  renderNav();
  bindControls();
  renderSim();
  if (!document.querySelector('[data-live]')) {
    // Non-live pages: resolved and strategies still need data.
    if (document.querySelector('#resolvedBody')) loadResolved();
    renderSim();
    return;
  }
  renderAlerts();
  await loadMarkets();
  if (state.markets.length && !state.selected) {
    const first = sortRows(state.markets.filter(inTopic))[0];
    if (first) select(first.ticker);
  }
  pollTrades();
  setInterval(() => loadMarkets(), 60000);
  setInterval(() => pollTrades(), 15000);
  setInterval(() => { loadChart(); loadBook(); }, 20000);
  setInterval(() => renderSim(), 15000);
  loadResolved();
  setInterval(loadResolved, 300000);
  $('#sortBy') && ($('#sortBy').onchange = renderMarkets);
  $('#refresh')?.addEventListener('click', () => { loadMarkets(); pollTrades(); });
  addEventListener('resize', drawChart);
}

boot();
