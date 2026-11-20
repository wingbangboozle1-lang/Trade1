// demo-account/assets/app.js — Demo Account & Strategy Lab (browser console).
// Paper portfolio runs automatically against LIVE public demo-market data (no input).
// Live demo-account calls require a user-supplied API key (kept in localStorage only) and
// degrade gracefully when blocked by browser CORS (flagged F-DA-2).
//
// Data source: the official Kalshi DEMO Trade API only
//   https://external-api.demo.kalshi.co/trade-api/v2
//   https://docs.kalshi.com/getting_started/demo_env
import * as engine from './engine.js';
import * as signer from './signer.js';

const API = 'https://external-api.demo.kalshi.co/trade-api/v2';
const POLL_MS = 60_000;
const MAX_SERIES_PER_TOPIC = 3;

// Series verified to exist on the demo environment (probes logged in ../VERIFICATION.md).
// Used only as a fallback when /series discovery fails or a topic matches nothing.
const FALLBACK_SERIES = {
  'gas-prices': ['KXAAAGASM', 'KXGAS'],
  elections: [],
  culture: ['KXBALLONDOR'],
  crypto: ['KXBTC', 'KXETH'],
  golf: ['KXPGA', 'KXMASTERS'],
};

const state = {
  seriesByTopic: Object.fromEntries(engine.TOPICS.map((t) => [t, []])),
  seriesTitle: {},
  // seriesTicker -> { fee_multiplier, fee_type } read from GET /series (official
  // Get Series List). The taker multiplier M comes from here, not from the PDF's
  // production table (see engine.js and flagged F-DA-12).
  seriesFee: {},
  markets: new Map(), // ticker -> { m, topic, samples: [{tsMs,lastUnits}], lastSeenMs }
  alerts: [],
  roiAlerts: [],
  resolutions: [],
  watched: new Map(), // ticker -> { title, topic, eventTicker, sourceUrl }
  pf: null,
  selected: null,
  live: { keyId: null, imported: null, note: 'Not connected. Paper mode runs automatically.' },
  cycle: 0,
  lastPollAt: null,
  statusText: 'Boot',
};

// ---------------------------------------------------------------------------
// storage
// ---------------------------------------------------------------------------
const LS_PAPER = 'trade1.demoAccount.paper.v1';
const LS_KEY = 'trade1.demoAccount.key.v1';

function loadPortfolio() {
  try {
    const raw = localStorage.getItem(LS_PAPER);
    if (raw) {
      const pf = JSON.parse(raw);
      if (pf && Array.isArray(pf.positions) && Array.isArray(pf.trades)) return pf;
    }
  } catch { /* fall through to a fresh portfolio */ }
  return engine.createPortfolio();
}
function savePortfolio() {
  try { localStorage.setItem(LS_PAPER, JSON.stringify(state.pf)); } catch { /* storage full — keep running */ }
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmt$(u) { return `$${(u / 10000).toFixed(2)}`; }
function fmtTs(ms) { return new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + 'Z'; }
function apiMarketUrl(ticker) { return `${API}/markets/${encodeURIComponent(ticker)}`; }
function contextSearchUrl(title, tsMs) {
  const d = new Date(tsMs).toISOString().slice(0, 10);
  return `https://www.google.com/search?q=${encodeURIComponent(`${title} ${d}`)}`;
}

async function getJSON(path, opts = {}) {
  const res = await fetch(API + path, { headers: { Accept: 'application/json' }, ...opts });
  if (!res.ok) {
    const err = new Error(`GET ${path} -> HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// series discovery (topics stay separate; events within a topic stay grouped)
// ---------------------------------------------------------------------------
async function discoverSeries() {
  const found = Object.fromEntries(engine.TOPICS.map((t) => [t, []]));
  const title = {};
  let cursor = '';
  for (let page = 0; page < 3; page++) {
    const res = await getJSON(`/series?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    for (const s of res.series || []) {
      const st = s.ticker || s.series_ticker;
      // Official per-series fee structure (fee_type, fee_multiplier) — the
      // taker multiplier M used by the paper broker. Absent fields are left
      // undefined and the engine falls back to the documented default of 1.
      if (st && (s.fee_multiplier !== undefined || s.fee_type !== undefined)) {
        state.seriesFee[st] = {
          fee_multiplier: s.fee_multiplier,
          fee_type: s.fee_type,
          sourceUrl: `${API}/series/${encodeURIComponent(st)}`,
        };
      }
      const topic = engine.classifyTopic({
        title: s.title, series_ticker: st,
        category: s.category, tags: s.tags,
      });
      if (topic !== 'other') {
        found[topic].push(st);
        title[st] = s.title || '';
      }
    }
    cursor = res.cursor || '';
    if (!cursor) break;
  }
  for (const t of engine.TOPICS) {
    if (!found[t].length) found[t] = [...FALLBACK_SERIES[t]];
    // prefer verified fallbacks first, then discovered, capped
    const ordered = [...new Set([...FALLBACK_SERIES[t], ...found[t]])];
    state.seriesByTopic[t] = ordered.slice(0, MAX_SERIES_PER_TOPIC);
    state.seriesTitle = { ...state.seriesTitle, ...title };
  }
}

// ---------------------------------------------------------------------------
// market polling + swing detection + paper loop
// ---------------------------------------------------------------------------
function marketSample(m) {
  const lastUnits = m.last_price_dollars ? engine.dollarsToUnits(m.last_price_dollars) : null;
  const yesBid = m.yes_bid_dollars ? engine.dollarsToUnits(m.yes_bid_dollars) : 0;
  const yesAsk = m.yes_ask_dollars ? engine.dollarsToUnits(m.yes_ask_dollars) : 0;
  const noAsk = m.no_ask_dollars ? engine.dollarsToUnits(m.no_ask_dollars) : 0;
  const mid = yesBid > 0 && yesAsk > 0 ? Math.round((yesBid + yesAsk) / 2) : null;
  return {
    ticker: m.ticker,
    title: m.title || m.ticker,
    event_ticker: m.event_ticker || '',
    series_ticker: m.series_ticker || m.ticker?.split('-')[0] || '',
    // taker multiplier M for this series, read from GET /series (official)
    fee_multiplier: (state.seriesFee[m.series_ticker] || {}).fee_multiplier,
    status: m.status,
    result: m.result || '',
    lastUnits: Number.isFinite(lastUnits) && lastUnits > 0 ? lastUnits : mid,
    yesBidUnits: yesBid, yesAskUnits: yesAsk, noAskUnits: noAsk,
    vol24: Number(m.volume_24h_fp || 0),
    openInterest: Number(m.open_interest_fp || 0),
    sourceUrl: apiMarketUrl(m.ticker),
  };
}

async function pollMarkets() {
  state.cycle++;
  const tsMs = Date.now();
  let fetched = 0;
  for (const topic of engine.TOPICS) {
    for (const seriesTicker of state.seriesByTopic[topic]) {
      try {
        const res = await getJSON(`/markets?series_ticker=${encodeURIComponent(seriesTicker)}&status=open&limit=200`);
        for (const m of res.markets || []) {
          const s = marketSample(m);
          if (!s.lastUnits) continue;
          const rec = state.markets.get(s.ticker) || { samples: [] };
          const prev = rec.samples.length ? rec.samples[rec.samples.length - 1] : null;
          rec.m = s;
          rec.topic = topic;
          rec.lastSeenMs = tsMs;
          rec.samples.push({ tsMs, lastUnits: s.lastUnits });
          if (rec.samples.length > 360) rec.samples.splice(0, rec.samples.length - 360);
          state.markets.set(s.ticker, rec);
          fetched++;

          // swing detection: >= $0.10 in either direction, integer cents
          const prevLast = prev ? { lastUnits: prev.lastUnits, tsMs: prev.tsMs } : null;
          if (prevLast && Math.abs(s.lastUnits - prevLast.lastUnits) >= engine.JUMP_THRESHOLD_UNITS) {
            pushAlert(s, topic, s.lastUnits - prevLast.lastUnits, tsMs);
          }
          // paper signals
          const held = state.pf.positions.some((p) => p.ticker === s.ticker);
          const sigs = engine.generateSignals(prevLast, s, held);
          for (const sig of sigs) {
            if (sig.strategy === 'fade-jump' && sigs.some((x) => x.strategy === 'momentum-jump')) {
              // both fired on the same jump: take momentum only (documented in README)
            }
            if (sig.strategy === 'momentum-jump' || sig.strategy === 'value-ask') {
              const pos = engine.openPosition(state.pf, sig, s, topic, tsMs);
              if (pos) pushPaperEntry(pos);
            }
          }
          if (s.result === 'yes' || s.result === 'no') {
            resolveWatched(s.ticker, s.result, tsMs);
          }
        }
      } catch (e) {
        state.statusText = `Poll error: ${e.message} (will retry)`;
      }
    }
  }
  // settle paper positions whose markets have resolved (bounded direct lookups)
  if (state.pf.positions.length) {
    const results = {};
    for (const p of state.pf.positions.slice(0, 8)) {
      try {
        const res = await getJSON(`/markets/${encodeURIComponent(p.ticker)}`);
        const m = res.market || res;
        if (m.result === 'yes' || m.result === 'no') results[p.ticker] = m.result;
      } catch { /* leave the position open and try next cycle */ }
    }
    const settled = engine.settlePositions(state.pf, results, tsMs);
    for (const t of settled) {
      state.resolutions.unshift({
        tsMs, ticker: t.ticker, title: t.title, topic: t.topic, result: t.result,
        pnlUnits: t.pnlUnits, won: t.won, sourceUrl: t.sourceUrl,
      });
      pushSettleNotice(t);
    }
  }
  engine.recordEquity(state.pf, tsMs, lastByTicker());
  savePortfolio();
  state.lastPollAt = tsMs;
  state.statusText = `Live · ${fetched} markets polled · cycle ${state.cycle} · ${fmtTs(tsMs)}`;
  renderAll();
}

function lastByTicker() {
  const out = {};
  for (const [t, rec] of state.markets) out[t] = rec.m.lastUnits;
  return out;
}

// ---------------------------------------------------------------------------
// alerts (two scrolling chats: ALL and HIGH-ROI)
// ---------------------------------------------------------------------------
function roiScore(s, hadJump) {
  let score = 0;
  if (hadJump) score++;
  if (s.vol24 >= 50) score++;
  if (s.yesAskUnits > 0 && s.yesBidUnits > 0 && s.yesAskUnits - s.yesBidUnits <= 300) score++;
  if (s.lastUnits > 500 && s.lastUnits < 8500) score++;
  return score;
}

function pushAlert(s, topic, deltaUnits, tsMs) {
  const jump = true;
  const score = roiScore(s, jump);
  const entry = {
    tsMs, ticker: s.ticker, title: s.title, topic,
    deltaUnits, priceUnits: s.lastUnits, vol24: s.vol24,
    score, sourceUrl: s.sourceUrl,
    searchUrl: contextSearchUrl(s.title, tsMs),
  };
  state.alerts.unshift(entry);
  if (state.alerts.length > 200) state.alerts.pop();
  if (score >= 3) {
    state.roiAlerts.unshift(entry);
    if (state.roiAlerts.length > 200) state.roiAlerts.pop();
  }
  state.watched.set(s.ticker, { title: s.title, topic, eventTicker: s.event_ticker, sourceUrl: s.sourceUrl });
  renderChats();
}

function pushPaperEntry(pos) {
  const entry = {
    tsMs: pos.tsMs, ticker: pos.ticker, title: pos.title, topic: pos.topic,
    deltaUnits: 0, priceUnits: pos.priceUnits, vol24: 0,
    score: 0, sourceUrl: pos.sourceUrl,
    paper: `PAPER BUY ${pos.side.toUpperCase()} x${pos.count} @ ${fmt$(pos.priceUnits)} · ${pos.strategy}`,
    searchUrl: contextSearchUrl(pos.title, pos.tsMs),
  };
  state.alerts.unshift(entry);
  if (state.alerts.length > 200) state.alerts.pop();
  renderChats();
}

function pushSettleNotice(t) {
  const entry = {
    tsMs: t.exitTsMs, ticker: t.ticker, title: t.title, topic: t.topic,
    deltaUnits: 0, priceUnits: t.priceUnits, vol24: 0, score: 0, sourceUrl: t.sourceUrl,
    paper: `RESOLVED ${t.result.toUpperCase()} · ${t.won ? 'WON' : 'LOST'} · P&L ${(t.pnlUnits >= 0 ? '+' : '')}${fmt$(t.pnlUnits)}`,
    searchUrl: contextSearchUrl(t.title, t.exitTsMs),
  };
  state.alerts.unshift(entry);
  if (state.alerts.length > 200) state.alerts.pop();
  renderChats();
}

function resolveWatched(ticker, result, tsMs) {
  const w = state.watched.get(ticker);
  if (!w || state.resolutions.some((r) => r.ticker === ticker)) return;
  state.resolutions.unshift({
    tsMs, ticker, title: w.title, topic: w.topic, result, pnlUnits: null, won: null,
    sourceUrl: w.sourceUrl,
  });
  if (state.resolutions.length > 120) state.resolutions.pop();
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------
function renderAll() {
  renderStatus();
  renderChats();
  renderPositions();
  renderTrades();
  renderAnalysis();
  renderMarketsTable();
  renderResolutions();
  renderEquityChart();
  renderMarketChart();
  renderLivePanel();
}

function renderStatus() {
  $('stat-cash').textContent = fmt$(state.pf.cashUnits);
  const st = engine.portfolioStats(state.pf);
  $('stat-open').textContent = String(st.openPositions);
  $('stat-closed').textContent = String(st.closedTrades);
  $('stat-winrate').textContent = st.closedTrades ? `${(st.winRate * 100).toFixed(0)}%` : '—';
  $('stat-realized').textContent = `${st.realizedPnlUnits >= 0 ? '+' : ''}${fmt$(st.realizedPnlUnits)}`;
  $('stat-equity').textContent = fmt$(engine.equityUnits(state.pf, lastByTicker()));
  $('stat-updated').textContent = state.lastPollAt ? fmtTs(state.lastPollAt) : 'not yet';
  $('stat-status').textContent = state.statusText;
}

function alertRow(e) {
  const dir = e.deltaUnits > 0 ? '▲' : e.deltaUnits < 0 ? '▼' : '•';
  const move = e.deltaUnits ? `${dir} ${fmt$(Math.abs(e.deltaUnits))} → ${fmt$(e.priceUnits)}` : esc(e.paper || '');
  return `<div class="chat-row">
    <span class="chat-ts">${fmtTs(e.tsMs).slice(11)}</span>
    <span class="chat-topic topic-${esc(e.topic)}">${esc(e.topic)}</span>
    <span class="chat-body"><a href="${esc(e.sourceUrl)}" target="_blank" rel="noopener">${esc(e.title)}</a>
      <span class="chat-move ${e.deltaUnits > 0 ? 'up' : e.deltaUnits < 0 ? 'down' : ''}">${move}</span>
      ${e.paper ? '' : `<span class="chat-score" title="heuristic high-ROI score (0-4)">ROI ${e.score}/4</span>`}
      <a class="chat-src" href="${esc(e.searchUrl)}" target="_blank" rel="noopener" title="context search link — causality unverified (flagged)">context</a>
    </span>
  </div>`;
}

function renderChats() {
  $('chat-all').innerHTML = state.alerts.slice(0, 60).map(alertRow).join('') || '<div class="empty">No price swings ≥ $0.10 since page load. Alerts appear here in real time.</div>';
  $('chat-roi').innerHTML = state.roiAlerts.slice(0, 60).map(alertRow).join('') || '<div class="empty">No high-ROI candidates yet (score ≥ 3 of 4). See the model definition on the Flagged page.</div>';
}

function tradeRow(t) {
  return `<tr>
    <td>${fmtTs(t.tsMs)}</td>
    <td><span class="topic-${esc(t.topic)}">${esc(t.topic)}</span></td>
    <td><a href="${esc(t.sourceUrl)}" target="_blank" rel="noopener">${esc(t.title)}</a></td>
    <td>${esc(t.strategy)}</td>
    <td>${esc(t.trigger)}</td>
    <td>${esc(t.side)}</td>
    <td>${fmt$(t.priceUnits)}</td>
    <td>${t.count}</td>
    <td>${fmt$(t.feeUnits)}</td>
    <td>${t.result ? esc(t.result) : '—'}</td>
    <td class="${t.pnlUnits > 0 ? 'up' : t.pnlUnits < 0 ? 'down' : ''}">${t.pnlUnits == null ? '—' : `${t.pnlUnits >= 0 ? '+' : ''}${fmt$(t.pnlUnits)}`}</td>
  </tr>`;
}

function renderPositions() {
  $('tbl-positions').innerHTML = state.pf.positions.map((p) => `<tr>
    <td>${fmtTs(p.tsMs)}</td>
    <td><span class="topic-${esc(p.topic)}">${esc(p.topic)}</span></td>
    <td><a href="${esc(p.sourceUrl)}" target="_blank" rel="noopener">${esc(p.title)}</a></td>
    <td>${esc(p.strategy)}</td>
    <td>${esc(p.side)}</td>
    <td>${fmt$(p.priceUnits)}</td>
    <td>${p.count}</td>
    <td>${fmt$(p.feeUnits)}</td>
    <td>${fmt$((engine.equityUnits({ ...state.pf, positions: [p], cashUnits: 0 }, lastByTicker())))}</td>
  </tr>`).join('') || '<tr><td colspan="9" class="empty">No open paper positions.</td></tr>';
}

function renderTrades() {
  $('tbl-trades').innerHTML = state.pf.trades.slice().reverse().slice(0, 40).map(tradeRow).join('')
    || '<tr><td colspan="11" class="empty">No closed trades yet. Positions settle when the market resolves YES or NO.</td></tr>';
}

function analysisTable(rows, label) {
  return `<table><thead><tr><th>${label}</th><th>Trades</th><th>Wins</th><th>Losses</th><th>Win rate</th><th>Cost</th><th>P&amp;L</th><th>ROI</th></tr></thead><tbody>
  ${rows.map((r) => `<tr><td>${esc(r.key)}</td><td>${r.trades}</td><td>${r.wins}</td><td>${r.losses}</td>
    <td>${(r.winRate * 100).toFixed(0)}%</td><td>${fmt$(r.costUnits)}</td>
    <td class="${r.pnlUnits > 0 ? 'up' : r.pnlUnits < 0 ? 'down' : ''}">${r.pnlUnits >= 0 ? '+' : ''}${fmt$(r.pnlUnits)}</td>
    <td>${(r.roi * 100).toFixed(1)}%</td></tr>`).join('') || `<tr><td colspan="8" class="empty">No closed trades to analyze.</td></tr>`}
  </tbody></table>`;
}

function renderAnalysis() {
  $('an-topic').innerHTML = analysisTable(engine.analyzeBy(state.pf.trades, 'topic'), 'Topic');
  $('an-strategy').innerHTML = analysisTable(engine.analyzeBy(state.pf.trades, 'strategy'), 'Strategy');
  $('an-trigger').innerHTML = analysisTable(engine.analyzeBy(state.pf.trades, 'trigger'), 'Entry trigger');
}

function renderMarketsTable() {
  // highest activity live markets in the five topics, grouped by topic
  const byTopic = Object.fromEntries(engine.TOPICS.map((t) => [t, []]));
  for (const [, rec] of state.markets) {
    if (rec.m.status !== 'active') continue;
    byTopic[rec.topic]?.push(rec.m);
  }
  let html = '';
  for (const t of engine.TOPICS) {
    const rows = byTopic[t].sort((a, b) => b.vol24 - a.vol24).slice(0, 8);
    html += `<h3>${esc(t)} <span class="muted">(${byTopic[t].length} open · ranked by 24h contract volume — no official dollar-volume field, flagged)</span></h3>
    <table><thead><tr><th>Event / market</th><th>Last</th><th>YES bid/ask</th><th>NO ask</th><th>24h vol (contracts)</th><th>Open int.</th><th>Source</th></tr></thead><tbody>
    ${rows.map((m) => `<tr class="market-row ${state.selected === m.ticker ? 'selected' : ''}" data-ticker="${esc(m.ticker)}">
      <td>${esc(m.title)}</td>
      <td>${m.lastUnits ? fmt$(m.lastUnits) : '—'}</td>
      <td>${m.yesBidUnits ? fmt$(m.yesBidUnits) : '—'} / ${m.yesAskUnits ? fmt$(m.yesAskUnits) : '—'}</td>
      <td>${m.noAskUnits ? fmt$(m.noAskUnits) : '—'}</td>
      <td>${m.vol24}</td>
      <td>${m.openInterest}</td>
      <td><a href="${esc(m.sourceUrl)}" target="_blank" rel="noopener">API</a></td>
    </tr>`).join('') || '<tr><td colspan="7" class="empty">Waiting for the first poll…</td></tr>'}
    </tbody></table>`;
  }
  $('markets-tables').innerHTML = html;
  document.querySelectorAll('.market-row').forEach((el) => el.addEventListener('click', (ev) => {
    if (ev.target.tagName === 'A') return;
    state.selected = el.dataset.ticker;
    renderMarketsTable();
    renderMarketChart();
  }));
}

function renderResolutions() {
  $('tbl-resolutions').innerHTML = state.resolutions.slice(0, 30).map((r) => `<tr>
    <td>${fmtTs(r.tsMs)}</td>
    <td><span class="topic-${esc(r.topic)}">${esc(r.topic)}</span></td>
    <td><a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">${esc(r.title)}</a></td>
    <td class="${r.result === 'yes' ? 'up' : 'down'}">${esc(r.result)}</td>
    <td>${r.pnlUnits == null ? '—' : `${r.pnlUnits >= 0 ? '+' : ''}${fmt$(r.pnlUnits)}`}</td>
  </tr>`).join('') || '<tr><td colspan="5" class="empty">Tracked events appear here once they resolve YES or NO.</td></tr>';
}

// ---------------------------------------------------------------------------
// SVG charts (price movement: x = time, y = contract price)
// ---------------------------------------------------------------------------
function svgChart(points, markers) {
  const W = 640, H = 180, PAD = 28;
  if (!points.length) return '<div class="empty">Chart appears after the first price samples.</div>';
  const xs = points.map((p) => p.tsMs);
  const ys = points.map((p) => p.units);
  const x0 = Math.min(...xs), x1 = Math.max(...xs) || x0 + 1;
  const y0 = Math.min(...ys, 0), y1 = Math.max(...ys, 10000);
  const X = (t) => PAD + ((t - x0) / Math.max(1, x1 - x0)) * (W - 2 * PAD);
  const Y = (u) => H - PAD - ((u - y0) / Math.max(1, y1 - y0)) * (H - 2 * PAD);
  const poly = points.map((p) => `${X(p.tsMs).toFixed(1)},${Y(p.units).toFixed(1)}`).join(' ');
  const marks = (markers || []).map((m) => `<circle cx="${X(m.tsMs).toFixed(1)}" cy="${Y(m.units).toFixed(1)}" r="4" class="mark-${m.dir}"><title>${esc(m.label)}</title></circle>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="contract price over time">
    <line x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}" class="axis"/>
    <line x1="${PAD}" y1="${PAD}" x2="${PAD}" y2="${H - PAD}" class="axis"/>
    <text x="${PAD}" y="${H - 8}" class="tick">${fmtTs(x0).slice(11)}</text>
    <text x="${W - PAD - 52}" y="${H - 8}" class="tick">${fmtTs(x1).slice(11)}</text>
    <text x="2" y="${PAD + 4}" class="tick">${fmt$(y1)}</text>
    <text x="2" y="${H - PAD}" class="tick">${fmt$(y0)}</text>
    <polyline points="${poly}" class="line"/>
    ${marks}
  </svg>`;
}

function renderEquityChart() {
  const pts = (state.pf.equityCurve || []).map((e) => ({ tsMs: e.tsMs, units: e.equityUnits }));
  $('chart-equity').innerHTML = svgChart(pts, []);
}

function renderMarketChart() {
  const ticker = state.selected;
  const rec = ticker ? state.markets.get(ticker) : null;
  if (!rec) {
    $('chart-market').innerHTML = '<div class="empty">Click a market row to chart its contract price over time (x = time, y = price). Alert markers show ≥ $0.10 moves.</div>';
    $('chart-market-title').textContent = '';
    return;
  }
  $('chart-market-title').textContent = `${rec.m.title} — contract price (x = time · y = price)`;
  const markers = state.alerts.filter((a) => a.ticker === ticker).map((a) => ({
    tsMs: a.tsMs, units: a.priceUnits, dir: a.deltaUnits > 0 ? 'up' : 'down',
    label: `${a.deltaUnits > 0 ? '▲' : '▼'} ${fmt$(Math.abs(a.deltaUnits))} at ${fmtTs(a.tsMs)}`,
  }));
  $('chart-market').innerHTML = svgChart(rec.samples.map((s) => ({ tsMs: s.tsMs, units: s.lastUnits })), markers);
}

// ---------------------------------------------------------------------------
// live demo-account panel (user-supplied key; never leaves the browser)
// ---------------------------------------------------------------------------
function renderLivePanel() {
  const l = state.live;
  $('live-note').textContent = l.note;
  $('live-mode').textContent = l.imported ? `LIVE DEMO CONNECTED (key ${l.keyId.slice(0, 8)}…)` : 'PAPER MODE (automatic)';
  $('live-mode').className = l.imported ? 'mode live' : 'mode paper';
}

async function connectLive() {
  const keyId = $('live-keyid').value.trim();
  const pem = $('live-pem').value.trim();
  if (!keyId || !pem) { state.live.note = 'Enter both the API key ID and the PEM private key.'; renderLivePanel(); return; }
  try {
    const imported = await signer.importPrivateKey(pem);
    state.live = { keyId, imported, note: 'Key imported locally. Fetching balance…' };
    localStorage.setItem(LS_KEY, JSON.stringify({ keyId, pem }));
    renderLivePanel();
    await liveGet('/portfolio/balance');
  } catch (e) {
    state.live = { keyId: null, imported: null, note: `Connect failed: ${e.message}` };
    renderLivePanel();
  }
}

function disconnectLive() {
  localStorage.removeItem(LS_KEY);
  state.live = { keyId: null, imported: null, note: 'Disconnected. Key removed from localStorage.' };
  $('live-out').textContent = '';
  renderLivePanel();
}

async function liveGet(path) {
  const l = state.live;
  if (!l.imported) throw new Error('not connected');
  const ts = Date.now();
  const headers = await signer.authHeaders(l.imported, l.keyId, 'GET', '/trade-api/v2' + path, ts);
  const res = await fetch(API + path, { headers: { Accept: 'application/json', ...headers } });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function liveFetchBalance() {
  try {
    const b = await liveGet('/portfolio/balance');
    $('live-out').innerHTML = `<table><tbody>
      <tr><th>Balance</th><td>${esc(b.balance_dollars ?? b.balance)} ${b.balance_dollars ? '(dollars field)' : '(cents field — flagged, see docs)'}</td>
      <td><a href="https://docs.kalshi.com/api-reference/portfolio/get-balance" target="_blank" rel="noopener">docs</a></td></tr>
      <tr><th>Portfolio value</th><td>${esc(b.portfolio_value)}</td><td></td></tr>
      <tr><th>Updated</th><td>${esc(b.updated_ts)}</td><td></td></tr>
    </tbody></table>`;
  } catch (e) {
    $('live-out').innerHTML = `<div class="warn">Live call failed: ${esc(e.message)}. Common causes: wrong key, key from production (demo keys are separate), clock skew &gt; 30s, or the browser blocked the request (CORS preflight on custom headers — flagged F-DA-2). The CI workflow and scripts/demo_account run the same calls server-side.</div>`;
  }
}

async function liveFetchPositions() {
  try {
    const p = await liveGet('/portfolio/positions?count_filter=position&settlement_status=unsettled&limit=100');
    const rows = (p.market_positions || []).map((m) => `<tr>
      <td><a href="${esc(apiMarketUrl(m.ticker))}" target="_blank" rel="noopener">${esc(m.ticker)}</a></td>
      <td>${esc(m.position_fp)}</td><td>${esc(m.market_exposure_dollars)}</td>
      <td>${esc(m.realized_pnl_dollars)}</td><td>${esc(m.fees_paid_dollars)}</td></tr>`).join('');
    $('live-out').innerHTML = `<table><thead><tr><th>Ticker</th><th>Position</th><th>Exposure</th><th>Realized P&amp;L</th><th>Fees</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No non-zero positions.</td></tr>'}</tbody></table>`;
  } catch (e) {
    $('live-out').innerHTML = `<div class="warn">Live call failed: ${esc(e.message)}</div>`;
  }
}

async function livePlaceOrder() {
  const ticker = $('ord-ticker').value.trim();
  const side = $('ord-side').value;
  const price = $('ord-price').value.trim();
  const count = $('ord-count').value.trim();
  const confirmText = $('ord-confirm').value.trim();
  const out = $('ord-out');
  if (confirmText !== 'PLACE DEMO ORDER') {
    out.innerHTML = '<div class="warn">Type PLACE DEMO ORDER in the confirmation box to submit. This is a DEMO environment order with real demo money.</div>';
    return;
  }
  if (!state.live.imported) {
    out.innerHTML = '<div class="warn">Connect a demo API key first (or use the paper lab, which needs no key).</div>';
    return;
  }
  const body = {
    ticker, side, count: Number(count).toFixed(2), price,
    client_order_id: (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`),
    time_in_force: 'good_till_canceled',
    self_trade_prevention_type: 'taker_at_cross',
    post_only: false, reduce_only: false, cancel_order_on_pause: false,
    subaccount: 0,
  };
  try {
    const ts = Date.now();
    const headers = await signer.authHeaders(state.live.imported, state.live.keyId, 'POST', '/trade-api/v2/portfolio/events/orders', ts);
    const res = await fetch(`${API}/portfolio/events/orders`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    out.innerHTML = `<div class="${res.ok ? 'ok' : 'warn'}">HTTP ${res.status} — <code>${esc(text.slice(0, 500))}</code><br>
      Source: <a href="https://docs.kalshi.com/api-reference/orders/create-order-v2" target="_blank" rel="noopener">Create Order (V2) docs</a></div>`;
  } catch (e) {
    out.innerHTML = `<div class="warn">Order failed: ${esc(e.message)}</div>`;
  }
}

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
function tryRestoreKey() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const { keyId, pem } = JSON.parse(raw);
    signer.importPrivateKey(pem).then((imported) => {
      state.live = { keyId, imported, note: 'Restored key from localStorage (this browser only).' };
      $('live-keyid').value = keyId;
      $('live-pem').value = pem;
      renderLivePanel();
    }).catch(() => localStorage.removeItem(LS_KEY));
  } catch { /* ignore malformed stored key */ }
}

function tick() {
  pollMarkets().catch((e) => { state.statusText = `Poll failed: ${e.message}`; renderStatus(); });
}

async function boot() {
  state.pf = loadPortfolio();
  renderAll();
  tryRestoreKey();
  try {
    state.statusText = 'Discovering series…';
    await discoverSeries();
    state.statusText = `Series ready: ${engine.TOPICS.map((t) => `${t}=${state.seriesByTopic[t].length}`).join(' ')}`;
  } catch (e) {
    state.statusText = `Series discovery failed (${e.message}); using fallback series.`;
    for (const t of engine.TOPICS) state.seriesByTopic[t] = [...FALLBACK_SERIES[t]].slice(0, MAX_SERIES_PER_TOPIC);
  }
  renderAll();
  tick();
  setInterval(tick, POLL_MS);
  $('btn-connect').addEventListener('click', connectLive);
  $('btn-disconnect').addEventListener('click', disconnectLive);
  $('btn-balance').addEventListener('click', liveFetchBalance);
  $('btn-positions').addEventListener('click', liveFetchPositions);
  $('btn-order').addEventListener('click', livePlaceOrder);
}

boot();
