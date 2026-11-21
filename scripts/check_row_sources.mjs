#!/usr/bin/env node
/* Row-level official-source check for the PUBLISHED data pages.
 *
 * Why this exists: the brief requires that every table row on the site links
 * to an official source, and `scripts/check_site.mjs` proves that for
 * `data/snapshot.json` — a frozen artifact that no published page renders.
 * The pages that ARE published (`data.html`, `resolved.html`) render from
 * `data/topics/*.json` and `data/resolved.json` and build each row's link in
 * JavaScript at render time, so a static check of the HTML cannot see it.
 *
 * This script renders the real pages in jsdom against the real data files and
 * then asserts, row by row:
 *   1. every rendered table row carries at least one link on the official demo
 *      base (https://external-api.demo.kalshi.co/trade-api/v2);
 *   2. that link is the official record for THAT row — the per-market record
 *      /markets/{ticker} for a market row, the per-event record
 *      /events/{event_ticker} for an event row;
 *   3. every row in the data files the pages read is rendered with its own
 *      official link (nothing silently dropped).
 *
 * No network access is needed: the pages fetch the committed data files from
 * a local static server.
 *
 * Usage: node scripts/check_row_sources.mjs   (exit 1 on any failure)
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BASE = 'https://external-api.demo.kalshi.co/trade-api/v2';
const TOPICS = ['gas-prices', 'elections', 'culture', 'crypto', 'golf'];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
};

const failures = [];
const counts = { rows: 0, rowLinks: 0, expected: 0 };

function startServer() {
  return new Promise((resolve) => {
    const srv = createServer(async (req, res) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      const file = path.join(ROOT, p === '/' ? 'index.html' : p);
      if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); res.end('nf'); return; }
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(body);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

async function render(page, port, readySelector, waitMs = 15000) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message));
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
  vc.on('warn', () => {}); vc.on('log', () => {}); vc.on('info', () => {});
  const dom = await JSDOM.fromURL(`http://127.0.0.1:${port}/${page}`, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      // local files only; no Kalshi request is needed by these two pages
      win.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input.url;
        return globalThis.fetch(new URL(url, win.location.href).toString(), init);
      };
    },
  });
  // wait until the page has rendered its rows (not a fixed sleep)
  const t0 = Date.now();
  while (Date.now() - t0 < waitMs) {
    const doc = dom.window.document;
    if (doc.querySelector(readySelector)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  await new Promise((r) => setTimeout(r, 500));
  const doc = dom.window.document;
  // collect everything BEFORE closing the window (close() empties the document)
  const out = {
    errors,
    window: dom.window,          /* kept alive: callers read rows, then close it */
    tables: [...doc.querySelectorAll('table')],
    topicTables: [...doc.querySelectorAll('#topic-tables table')],
    resolvedRows: [...doc.querySelectorAll('#rs-body tr')],
  };
  return out;
}

/* Collect the official links in one rendered row. */
function rowLinks(tr) {
  return [...tr.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
}
function officialLinks(tr) {
  return rowLinks(tr).filter((h) => h && h.startsWith(BASE + '/'));
}

const { srv, port } = await startServer();

/* ---------- data.html: the per-topic event tables ---------- */
const data = await render('data.html', port, '#topic-tables table');
if (data.errors.length) failures.push(`data.html JS errors: ${data.errors.slice(0, 3).join(' | ')}`);

const topicTables = data.topicTables;
const topicRows = [];
topicTables.forEach((t, i) => {
  for (const tr of t.querySelectorAll('tr')) {
    if (tr.querySelector('th')) continue;   // header row, not a data row
    topicRows.push({ id: 'topic-table-' + i, tr });
  }
});

/* data.html renders the first 15 events of each topic (its own cap), each
 * with the official /events/{event_ticker} record for that row. */
const expectedEvents = [];
for (const t of TOPICS) {
  const d = JSON.parse(await readFile(path.join(ROOT, `data/topics/${t}.json`), 'utf8'));
  for (const ev of (d.events || []).slice(0, 15)) {
    expectedEvents.push({ topic: t, event_ticker: ev.event_ticker, title: ev.title });
  }
}
counts.expected += expectedEvents.length;

for (const { id, tr } of topicRows) {
  counts.rows++;
  const links = officialLinks(tr);
  counts.rowLinks += links.length;
  if (!links.length) { failures.push(`data.html topic row ${id} has no official source link`); continue; }
  // the row's own per-event record must be among them
  const evLink = links.find((h) => /\/events\/[^/?]+$/.test(h));
  if (!evLink) failures.push(`data.html topic row ${id} has no official /events/{event_ticker} link`);
  // every official link must point at the demo Trade API (no search page, no third party)
  for (const h of links) {
    if (!h.startsWith(BASE + '/')) {
      failures.push(`data.html topic row ${id} has an official link outside the demo base ${h}`);
    }
  }
}
// every event the page shows must be rendered with its own official link
const renderedEventLinks = new Set(
  topicRows.flatMap(({ tr }) => officialLinks(tr).filter((h) => /\/events\/[^/?]+$/.test(h)))
);
for (const ev of expectedEvents) {
  if (!renderedEventLinks.has(BASE + '/events/' + ev.event_ticker)) {
    failures.push(`data.html does not render ${ev.topic} event ${ev.event_ticker} with its official link`);
  }
}

data.window.close();

/* ---------- resolved.html: the resolved market table ---------- */
const res = await render('resolved.html', port, '#rs-body tr');
if (res.errors.length) failures.push(`resolved.html JS errors: ${res.errors.slice(0, 3).join(' | ')}`);
const resolvedRows = res.resolvedRows.filter((tr) => !tr.querySelector('th'));

const resolvedData = JSON.parse(await readFile(path.join(ROOT, 'data/resolved.json'), 'utf8'));
for (const tr of resolvedRows) {
  counts.rows++;
  const links = officialLinks(tr);
  counts.rowLinks += links.length;
  if (!links.length) { failures.push('resolved.html row has no official source link'); continue; }
  const mkt = links.find((h) => /\/markets\/[^/?]+$/.test(h));
  if (!mkt) failures.push('resolved.html row has no official /markets/{ticker} link');
}
const renderedMarketLinks = new Set(
  resolvedRows.flatMap((tr) => officialLinks(tr).filter((h) => /\/markets\/[^/?]+$/.test(h)))
);
for (const m of resolvedData.markets || []) {
  counts.expected++;
  if (!renderedMarketLinks.has(BASE + '/markets/' + m.ticker)) {
    failures.push(`resolved.html does not render ${m.ticker} with its official link`);
  }
}
res.window.close();

/* ---------- portfolio.html: the always-on CI ledger ----------
 * Same rule, applied to the ledger the site actually publishes. Each ledger row
 * must carry its OWN per-market official record (/markets/{ticker}), not the
 * batched /markets?tickers=… quote request that priced the whole watchlist —
 * a batch URL is not the record of that row. The watchlist table is the one
 * exception by construction: its rows ARE quotes for the current cycle, so a
 * batched quote URL is the correct record there; the rows are still required to
 * carry one.
 * Reference: flagged item D2 in reports/REPO_REVIEW_725b09a7.md.
 */
const LEDGER = JSON.parse(await readFile(path.join(ROOT, 'data/portfolio.json'), 'utf8'));
const pf = await render('portfolio.html', port, '#pf-trades table');
if (pf.errors.length) failures.push(`portfolio.html JS errors: ${pf.errors.slice(0, 3).join(' | ')}`);

function ledgerRows(id) {
  return [...pf.window.document.querySelectorAll(`#${id} tr`)].filter((tr) => !tr.querySelector('th'));
}
function requireOwnMarketRecord(rows, id) {
  for (const tr of rows) {
    counts.rows++;
    const links = officialLinks(tr);
    counts.rowLinks += links.length;
    if (!links.length) { failures.push(`portfolio.html #${id} row has no official source link`); continue; }
    const own = links.find((h) => /\/markets\/[^/?]+$/.test(h));
    if (!own) failures.push(`portfolio.html #${id} row links no per-market official record (only a batched quote URL)`);
  }
}

requireOwnMarketRecord(ledgerRows('pf-trades'), 'pf-trades');
requireOwnMarketRecord(ledgerRows('pf-positions'), 'pf-positions');
requireOwnMarketRecord(ledgerRows('pf-resolutions'), 'pf-resolutions');

/* every trade / position / resolution in the artifact must be rendered with its record */
for (const id of ['pf-trades', 'pf-positions', 'pf-resolutions']) {
  const hrefs = new Set(ledgerRows(id).flatMap((tr) => officialLinks(tr)));
  const from = id === 'pf-trades' ? (LEDGER.trades || [])
    : id === 'pf-positions' ? (LEDGER.positions || [])
      : (LEDGER.resolutions || []);
  for (const row of from) {
    if (!row.ticker) continue;
    counts.expected++;
    if (!hrefs.has(BASE + '/markets/' + row.ticker)) {
      failures.push(`portfolio.html ${id} does not render ${row.ticker} with its own official record`);
    }
  }
}

/* The watchlist is a live quote table: a batched quote URL is the correct record. */
for (const tr of ledgerRows('pf-watchlist')) {
  counts.rows++;
  const links = officialLinks(tr);
  counts.rowLinks += links.length;
  if (!links.some((h) => h.startsWith(BASE + '/markets'))) {
    failures.push('portfolio.html watchlist row has no official demo-API quote link');
  }
}

/* count BEFORE closing: close() empties the document */
const ledgerCount = ['pf-trades', 'pf-positions', 'pf-resolutions', 'pf-watchlist']
  .reduce((n, id) => n + ledgerRows(id).length, 0);
pf.window.close();
srv.close();

console.log(JSON.stringify({ counts, renderedTopicRows: topicRows.length, renderedResolvedRows: resolvedRows.length, renderedLedgerRows: ledgerCount, failures: failures.length }));
if (failures.length) { console.error('FAILURES:\n  ' + failures.slice(0, 40).join('\n  ')); process.exit(1); }
console.log(`every rendered row links its own official record (${counts.rows} rows, ${counts.rowLinks} official links)`);
