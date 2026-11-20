/* Trade1 — portfolio ledger + page tests (offline; no network needed).
 *
 * 1. runs the engine's own numeric self-tests (python3 scripts/portfolio_engine.py selftest)
 * 2. validates the committed artifact: required keys, bounded sizes, and that every rendered row
 *    carries the exact URL/file it came from (the site rule: no row without a source)
 * 3. boots portfolio.html in jsdom against the real artifact and asserts every panel renders,
 *    no "undefined"/"NaN" leaks into the DOM, and every source cell links somewhere
 *
 * Usage: node tests/portfolio.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// jsdom is only needed for the page-boot sections; the engine and artifact checks always run.
let JSDOM = null, VirtualConsole = null;
try { ({ JSDOM, VirtualConsole } = await import('jsdom')); } catch { /* not installed here */ }
const HAVE_DOM = !!JSDOM;

const ROOT = path.resolve(import.meta.dirname, '..');
let checks = 0; const fails = [];
const ok = (name, cond, detail = '') => {
  checks++;
  if (!cond) { fails.push(`${name} ${detail}`); console.log(`FAIL ${name} ${detail}`); }
  else console.log(`pass ${name}`);
};
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* 1. engine numeric self-tests ------------------------------------------------- */
let selftest = '';
try {
  selftest = execFileSync('python3', ['scripts/portfolio_engine.py', 'selftest'], { cwd: ROOT, encoding: 'utf8' });
} catch (e) {
  selftest = (e.stdout || '') + (e.stderr || '');
  ok('engine selftest exits 0', false, selftest.slice(-400));
}
const m = /(\d+)\/(\d+) checks passed/.exec(selftest);
ok('engine selftest reports all checks passing', !!m && m[1] === m[2], selftest.slice(-200));
ok('engine selftest covers the official fee example ($1.75 for 100 contracts at 50c)',
  /fee 100c @ \$0\.50 = \$1\.75 exactly/.test(selftest));
ok('engine selftest covers the exact 10-cent boundary', /exactly 1000 bits/.test(selftest));

/* 2. artifact contract --------------------------------------------------------- */
const art = JSON.parse(read('data/portfolio.json'));
ok('artifact identity', art.artifact === 'kalshi-demo-ci-paper-portfolio', String(art.artifact));
ok('artifact status is one of the documented values',
  ['live', 'offline-replay', 'baseline', 'degraded'].includes(art.status), art.status);
ok('artifact has a generated_at timestamp', /^\d{4}-\d{2}-\d{2}T/.test(art.generated_at || ''), art.generated_at);
for (const k of ['engine', 'summary', 'by_strategy', 'by_topic', 'positions', 'trades', 'resolutions',
  'alerts', 'equity_curve', 'watchlist', 'runs', 'sources', 'disclaimer', 'log']) {
  ok(`artifact has ${k}`, k in art);
}
ok('artifact documents the bankroll, threshold and fee rule',
  art.engine.bankroll_start_usd === 1000 && art.engine.alert_threshold_usd === 0.1 &&
  /0\.07/.test(art.engine.fee_rule));
ok('artifact lists all four strategy rule sets',
  ['momentum', 'fade', 'breakout', 'harvest'].every((s) => art.engine.rules[s] && art.engine.rules[s].enter && art.engine.rules[s].exit));
ok('artifact links the official docs it implements',
  art.sources.official_docs.fee_schedule === 'https://kalshi.com/docs/kalshi-fee-schedule.pdf' &&
  art.sources.official_docs.market_lifecycle === 'https://docs.kalshi.com/getting_started/market_lifecycle');

const rowsWith = (arr) => (arr || []).filter((r) => r && typeof r === 'object');
ok('every watchlist row records its source URL',
  rowsWith(art.watchlist).every((r) => typeof r.source === 'string' && r.source.length > 10),
  `${rowsWith(art.watchlist).filter((r) => !r.source).length} rows without a source`);
ok('every alert row records the quote response it came from',
  rowsWith(art.alerts).every((r) => typeof r.source === 'string' && r.source.length > 10));
ok('every resolution row records its source and a YES/NO result',
  rowsWith(art.resolutions).every((r) => r.source && ['yes', 'no'].includes(r.result)));
ok('every trade row records a fill source URL (and an exit source once closed)',
  rowsWith(art.trades).every((t) => (typeof t.source === 'string' && t.source.length > 10) &&
    (t.status === 'open' || (t.exit && typeof t.exit.source === 'string'))));
ok('trade quantities are whole contracts (fractional sizes are market-permissioned)',
  rowsWith(art.trades).every((t) => Number.isInteger(t.qty_contracts)));
ok('every alert records the sample gap it was measured over',
  rowsWith(art.alerts).every((a) => typeof a.prev_t === 'string' && Number.isFinite(a.gap_minutes)));
ok('no alert is below the $0.10 threshold',
  rowsWith(art.alerts).every((a) => Math.abs(a.delta_usd) >= 0.1 - 1e-9));
ok('bounded sizes keep the committed artifact small',
  art.trades.length <= 250 && art.alerts.length <= 120 && art.equity_curve.length <= 800 &&
  art.watchlist.length <= 120 && art.runs.length <= 40);
const size = fs.statSync(path.join(ROOT, 'data/portfolio.json')).size;
ok('artifact is under 900 kB', size < 900_000, `${size} bytes`);
ok('equity values are finite numbers',
  rowsWith(art.equity_curve).every((p) => Number.isFinite(p.equity_usd) && Number.isFinite(p.cash_usd)));
ok('summary is internally consistent (open + realised = total)',
  art.summary.trades_total === art.summary.open + art.summary.realised);
ok('cash + positions reconciles to equity within a cent',
  Math.abs(art.summary.equity_usd - art.summary.cash_usd -
    rowsWith(art.positions).reduce((s, p) => s + (p.cost_usd || 0) + (p.pnl_usd || 0), 0)) <
    Math.max(1, art.positions.length) * 0.02,
  `${art.summary.equity_usd} vs ${art.summary.cash_usd}`);

/* 3. page boot in jsdom -------------------------------------------------------- */
const html = read('portfolio.html').replace(
  '<script src="assets/portfolio.js"></script>',
  () => {
    const artJson = fs.readFileSync(path.join(ROOT, 'data/portfolio.json'), 'utf8');
    const stub = '<script>window.__ART__ = ' + artJson + ';' +
      'window.fetch = function (u) {' +
      '  var p = String(u).split("?")[0];' +
      '  if (window.__ART__ && /data[\\/]+portfolio[.]json$/.test(p)) {' +
      '    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(window.__ART__); } });' +
      '  }' +
      '  return Promise.resolve({ ok: false, status: 404, json: function () { return Promise.resolve({}); } });' +
      '};</script><script>' + read('assets/portfolio.js') + '</script>';
    return stub;
  });
const errors = [];
if (!HAVE_DOM) console.log('SKIP page-boot checks (jsdom not installed: npm i --no-save jsdom)');
const vc = HAVE_DOM ? new VirtualConsole() : null;
if (vc) {
  vc.on('jsdomError', (e) => errors.push(String(e && (e.message || e))));
  vc.on('error', (e) => errors.push(String(e && (e.message || e))));
}
const dom = HAVE_DOM ? new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc }) : null;
if (HAVE_DOM) {
  ok('page html references the shared stylesheet and nav', /assets\/site\.css/.test(html) && /flagged\.html/.test(html));
  ok('portfolio.html links exist as files', ['index.html', 'dashboard.html', 'trades.html', 'data.html', 'methods.html',
    'suggestions.html', 'flagged.html', 'sources.html', 'topics/gas-prices.html', 'topics/elections.html',
    'topics/culture.html', 'topics/crypto.html', 'topics/golf.html'].every((f) => fs.existsSync(path.join(ROOT, f))));

  if (HAVE_DOM) await new Promise((r) => setTimeout(r, 220));
  const d = HAVE_DOM ? dom.window.document : null;
  const txt = (sel) => (d.querySelector(sel) ? d.querySelector(sel).textContent.trim() : null);
  ok('status pill rendered', !!txt('#pf-status') && txt('#pf-status').length > 3, txt('#pf-status'));
  ok('KPI grid renders 8 cards', d.querySelectorAll('#pf-kpis .card').length === 8);
  ok('equity panel renders (chart or an explicit waiting note)',
    !!d.querySelector('#pf-equity svg') || /needs at least two engine cycles/.test(txt('#pf-equity') || ''),
    (txt('#pf-equity') || '').slice(0, 80));
  ok('positions panel renders a table or a clear empty-state',
    !!d.querySelector('#pf-positions table') || d.querySelector('#pf-positions p').textContent.length > 30);
  ok('ledger panel renders a table or a clear empty-state',
    !!d.querySelector('#pf-trades table') || d.querySelector('#pf-trades p').textContent.length > 30);
  ok('rules panel lists the four strategies',
    /momentum/.test(txt('#pf-rules') || '') && /harvest/.test(txt('#pf-rules') || ''));
  ok('settings panel shows the fee rule and the official docs links',
    /0\.07/.test(txt('#pf-settings') || '') && d.querySelectorAll('#pf-settings a[href^="https://docs.kalshi.com"]').length >= 5);
  ok('watchlist table renders rows', d.querySelectorAll('#pf-watchlist tbody tr').length === art.watchlist.length,
    `${d.querySelectorAll('#pf-watchlist tbody tr').length} rows vs ${art.watchlist.length}`);
  ok('every watchlist row links its own API URL',
    Array.from(d.querySelectorAll('#pf-watchlist tbody tr')).every((tr) => {
      const a = tr.querySelector('td:last-child a');
      return a && /trade-api\/v2\/markets\?tickers=/.test(a.getAttribute('href'));
    }));
  ok('no page script errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  // scan the rendered panels only (the inlined <script> source legitimately mentions both words)
  const panels = ['#pf-status', '#pf-note', '#pf-kpis', '#pf-equity', '#pf-positions', '#pf-places',
    '#pf-trades', '#pf-by-strategy', '#pf-by-topic', '#pf-by-exit', '#pf-alerts', '#pf-resolutions',
    '#pf-watchlist', '#pf-rules', '#pf-settings', '#pf-runs']
    .map((sel) => (d.querySelector(sel) ? d.querySelector(sel).innerHTML : '')).join('\n');
  ok('no undefined/NaN/[object Object] leaked into the rendered panels',
    !/>undefined</.test(panels) && !/NaN/.test(panels) && !/\[object Object\]/.test(panels) &&
    !/undefined/.test(panels));
  ok('filters are populated from the artifact',
    d.querySelectorAll('#pf-topic option').length >= 2 && d.querySelectorAll('#pf-strategy option').length >= 1);

  /* interactively exercise the filter path */
  d.querySelector('#pf-topic').value = 'golf';
  d.querySelector('#pf-topic').dispatchEvent(new dom.window.Event('change'));
  await new Promise((r) => setTimeout(r, 60));
  ok('topic filter re-renders without errors', errors.length === 0 && !!d.querySelector('#pf-watchlist'));
}
/* 4. same page against a synthetic populated ledger (exercises the chart, the tables and
      every link path that the current artifact has no rows for). Synthetic data is used for
      code paths only - it is never written to data/ and never presented as real quotes. */
const synth = JSON.parse(JSON.stringify(art));
synth.status = 'live';
synth.note = 'synthetic test artifact (code-path coverage only)';
synth.equity_curve = [
  { t: '2026-11-20T19:00:00Z', equity_usd: 1000, cash_usd: 975, open: 1 },
  { t: '2026-11-20T19:30:00Z', equity_usd: 1004.5, cash_usd: 1000.25, open: 0 },
  { t: '2026-11-20T20:00:00Z', equity_usd: 998.75, cash_usd: 998.75, open: 1 }
];
synth.alerts = [{ t: '2026-11-20T19:30:00Z', ticker: 'KXTEST-1', event_ticker: 'KXTEST',
  title: 'Test **market**', topic: 'crypto', from_usd: 0.66, to_usd: 0.56, delta_usd: -0.1,
  dir: 'down', score: 0.823, spread_usd: 0.02, vol24_contracts: 9000, model_pick: true,
  prev_t: '2026-11-20T19:00:00Z', gap_minutes: 30, wide_gap: false,
  source: 'https://external-api.demo.kalshi.co/trade-api/v2/markets?tickers=KXTEST-1' }];
synth.resolutions = [{ t: '2026-11-20T20:00:00Z', ticker: 'KXTEST-1', event_ticker: 'KXTEST',
  title: 'Test market', topic: 'crypto', result: 'no', settlement_ts: '2026-11-20T19:45:00Z',
  source: 'https://external-api.demo.kalshi.co/trade-api/v2/markets?tickers=KXTEST-1' }];
synth.trades = [{ id: 't1', t: '2026-11-20T19:30:00Z', ticker: 'KXTEST-1', event_ticker: 'KXTEST',
  title: 'Test market', topic: 'crypto', side: 'no', qty_contracts: 48, strategy: 'momentum',
  status: 'settled', entry_usd: 0.45, mark_usd: 0.44, cost_usd: 21.84, fee_usd: 0.84,
  pnl_usd: 23.32, realised: true, exit: { t: '2026-11-20T20:00:00Z', price_usd: 1,
  reason: 'settlement (no)', fee_usd: 0, credit_usd: 48,
  source: 'https://external-api.demo.kalshi.co/trade-api/v2/markets?tickers=KXTEST-1' },
  note: 'momentum on -0.1000 (score 0.823)',
  source: 'https://external-api.demo.kalshi.co/trade-api/v2/markets?tickers=KXTEST-1' }];
synth.positions = [{ id: 't2', t: '2026-11-20T20:00:00Z', ticker: 'KXTEST-2', event_ticker: 'KXTEST2',
  title: 'Open test market', topic: 'golf', side: 'yes', qty_contracts: 27, strategy: 'harvest',
  status: 'open', entry_usd: 0.92, mark_usd: 0.93, cost_usd: 24.9, fee_usd: 0.1, pnl_usd: 0.27,
  realised: false, exit: null, note: 'harvest @ $0.9200',
  source: 'https://external-api.demo.kalshi.co/trade-api/v2/markets?tickers=KXTEST-2' }];
synth.by_strategy = [{ strategy: 'momentum', trades: 1, open: 0, closed: 1, settled: 1, wins: 1,
  losses: 0, flat: 0, win_rate_pct: 100, pnl_usd: 23.32, cost_usd: 22.68, avg_pnl_usd: 23.32, roi_pct: 102.8 }];
synth.by_topic = [{ topic: 'crypto', trades: 1, open: 0, closed: 1, settled: 1, wins: 1, losses: 0,
  flat: 0, win_rate_pct: 100, pnl_usd: 23.32, cost_usd: 22.68, avg_pnl_usd: 23.32, roi_pct: 102.8 }];
synth.summary = { trades_total: 2, open: 1, realised: 1, settled: 1, wins: 1, losses: 0, flat: 0,
  win_rate_pct: 100, realised_pnl_usd: 23.32, realised_cost_usd: 22.68, roi_pct: 102.8,
  cash_usd: 998.75, equity_usd: 998.75, return_on_bankroll_pct: -0.125, peak_equity_usd: 1004.5,
  max_drawdown_usd: -5.75, alerts_total: 1 };

if (HAVE_DOM) {
    const synthHtml = read('portfolio.html').replace('<script src="assets/portfolio.js"></script>', () => {
      const inject = '<script>window.__ART__ = ' + JSON.stringify(synth) + ';' +
        'window.fetch = function () { return Promise.resolve({ ok: true, status: 200,' +
        ' json: function () { return Promise.resolve(window.__ART__); } }); };</script><script>' + read('assets/portfolio.js') + '</script>';
      return inject;
    });
    const vc2 = new VirtualConsole(); const errors2 = [];
    vc2.on('jsdomError', (e) => errors2.push(String(e && (e.message || e))));
    vc2.on('error', (e) => errors2.push(String(e && (e.message || e))));
    const dom2 = new JSDOM(synthHtml, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc2 });
    await new Promise((r) => setTimeout(r, 250));
    const d2 = dom2.window.document;
    ok('synthetic: equity chart draws an SVG polyline', !!d2.querySelector('#pf-equity svg path[d]'),
      (d2.querySelector('#pf-equity') ? d2.querySelector('#pf-equity').textContent : '').slice(0, 80));
    ok('synthetic: ledger shows the settled trade with its exit reason',
      /settlement \(no\)/.test(d2.querySelector('#pf-trades').textContent));
    ok('synthetic: positions panel shows the open harvest position',
      /harvest/.test(d2.querySelector('#pf-positions').textContent));
    ok('synthetic: performance tables render', /momentum/.test(d2.querySelector('#pf-by-strategy').textContent) &&
      /crypto/.test(d2.querySelector('#pf-by-topic').textContent));
    ok('synthetic: alert chat renders the jump with a news lead and a quote source',
      /news search/.test(d2.querySelector('#pf-alerts').textContent) &&
      /markets\?tickers=KXTEST-1/.test(d2.querySelector('#pf-alerts').innerHTML));
    ok('synthetic: markdown asterisks in titles are stripped for display',
      !/\*\*/.test(d2.querySelector('#pf-alerts').textContent));
    ok('synthetic: resolutions table shows NO', /NO/.test(d2.querySelector('#pf-resolutions').textContent));
    ok('synthetic: every rendered table row carries a source link',
      Array.from(d2.querySelectorAll('#pf-trades tbody tr')).every((tr) => /trade-api|data\/topics/.test(tr.innerHTML)));
    ok('synthetic: no script errors', errors2.length === 0, errors2.join(' | ').slice(0, 300));
    const p2 = Array.from(['#pf-kpis', '#pf-trades', '#pf-positions', '#pf-alerts', '#pf-resolutions', '#pf-by-strategy'])
      .map((sel) => (d2.querySelector(sel) ? d2.querySelector(sel).innerHTML : '')).join('\n');
    ok('synthetic: no undefined/NaN in the populated panels', !/undefined|NaN/.test(p2));
    try { if (dom2) dom2.window.close(); } catch (e) { /* noop */ }
}

// the page installs polling timers; release them so the test process can exit
try { if (dom) dom.window.close(); } catch (e) { /* already closed */ }
console.log(`\n${checks - fails.length}/${checks} portfolio checks passed`);
process.exit(fails.length ? 1 : 0);
