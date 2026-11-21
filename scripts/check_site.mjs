// Pre-deploy checks for the published site (repository root, served by GitHub Pages):
//  1. every local href/src in **/*.html resolves to an existing file (no broken links);
//  2. every snapshot row and resolved row carries an official source_url on the configured API base;
//  3. shared modules import cleanly;
//  4. verification-audit gates (2026-11-21): one-topic event grouping, result enums,
//     rule-set provenance (scripts/topics.json, assets/lib.mjs), and the top-events
//     totals disclosure on data.html.
// Exits non-zero on any failure.
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { API_BASES, TOPICS as LIB_TOPICS } from '../assets/lib.mjs';

const SITE = '.';
const SKIP = new Set(['.git', '.github', 'node_modules', 'scripts', '.render-cache']);
const failures = [];
const checked = { html: 0, links: 0, rows: 0, resolved: 0 };

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) out.push(...await walk(p)); } else out.push(p);
  }
  return out;
}

// Scope: every published page. Before consolidation several parallel sessions each
// shipped their own HTML tree on the same branch and this check was scoped to avoid
// failing on theirs; there is now one site, so every page is verified.
const PUBLISHED = new Set(['index.html','executive-summary.html','dashboard.html','trades.html',
  'data.html','methods.html','flagged.html','sources.html','suggestions.html','resolved.html','portfolio.html',
  'topics/gas-prices.html','topics/elections.html','topics/culture.html','topics/crypto.html','topics/golf.html',
  'demo-account/index.html','demo-account/flagged.html']);
const allFiles = (await walk(SITE)).map(f => f.replace(/^\.\//, ''));
const files = allFiles.filter(f => PUBLISHED.has(f) || !f.endsWith('.html'));
const unknown = allFiles.filter(f => f.endsWith('.html') && !PUBLISHED.has(f));
if (unknown.length) { console.log('FAIL unpublished page not in the check list: ' + unknown.join(', ')); process.exit(1); }
for (const f of files.filter(f => f.endsWith('.html'))) {
  checked.html++;
  // Inline scripts build URLs by concatenation (`href="'+esc(u)+'"`), which is not a
  // static link; strip <script> BODIES before scanning or every template produces
  // false "broken link" failures. The opening tag is kept so that a <script src=...>
  // pointing at a file that does not exist is still caught (this is how the missing
  // assets/app.mjs behind resolved.html was found).
  const html = (await readFile(f, 'utf8')).replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi, '$1');
  const refs = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)].map(m => m[1]);
  for (const ref of refs) {
    if (/^(https?:|mailto:|#|javascript:)/.test(ref)) continue;
    /* Skip hrefs built by inline JS (e.g. href="'+esc(url)+'") — those are
       runtime-built and validated by the page's own render path, not here. */
    if (/['"$`{}]|\+/.test(ref)) continue;
    const clean = ref.split('#')[0].split('?')[0];
    if (!clean) continue;
    checked.links++;
    const target = path.normalize(path.join(path.dirname(f), clean));
    if (target.startsWith('..')) { failures.push(`${f}: link escapes repo ${ref}`); continue; }
    try { await stat(target); } catch { failures.push(`${f}: broken link ${ref}`); }
  }
}

const base = API_BASES.demo;
try {
  const snap = JSON.parse(await readFile('data/snapshot.json', 'utf8'));
  const snapBase = API_BASES[snap.api_base_key] || snap.api_base;
  if (snapBase !== base) failures.push(`snapshot api_base ${snapBase} != configured ${base}`);
  for (const r of snap.rows || []) {
    checked.rows++;
    if (!r.source_url || !r.source_url.startsWith(base + '/markets/')) failures.push(`row ${r.ticker}: missing or foreign source_url`);
  }
  for (const r of snap.resolved || []) {
    checked.resolved++;
    if (!r.source_url || !r.source_url.startsWith(base + '/markets/')) failures.push(`resolved ${r.ticker}: missing source_url`);
  }
  if (!snap.generated_at) failures.push('snapshot: generated_at missing');
} catch (e) {
  failures.push(`snapshot unreadable: ${e.message}`);
}

// Per-topic snapshots rendered by data.html: file-level official request URLs (the links
// every row shows) plus the verbatim identifiers each row needs.
try {
  for (const t of ['gas-prices', 'elections', 'culture', 'crypto', 'golf']) {
    const f = `data/topics/${t}.json`;
    const d = JSON.parse(await readFile(f, 'utf8'));
    if (!d.generated_at) failures.push(`${f}: generated_at missing`);
    const urls = (d.source_urls && (d.source_urls.events || d.source_urls)) || [];
    if (!Array.isArray(urls) || !urls.length) failures.push(`${f}: no source_urls recorded`);
    else for (const u of urls) if (typeof u !== 'string' || !u.startsWith(base + '/')) failures.push(`${f}: foreign source_url ${u}`);
    for (const ev of d.events || []) {
      checked.rows++;
      if (!ev.event_ticker) failures.push(`${f}: event row without event_ticker`);
      if (!ev.title && !ev.sub_title) failures.push(`${f}: event ${ev.event_ticker || '(?)'} without title`);
    }
  }
} catch (e) {
  failures.push(`topic snapshots unreadable: ${e.message}`);
}

// Resolved archive rendered by data.html: verbatim yes/no results and official source URLs.
try {
  const d = JSON.parse(await readFile('data/resolved.json', 'utf8'));
  if (!d.generated_at) failures.push('data/resolved.json: generated_at missing');
  for (const u of d.source_urls || []) if (typeof u !== 'string' || !u.startsWith(base + '/')) failures.push(`data/resolved.json: foreign source_url ${u}`);
  for (const m of d.markets || []) {
    checked.resolved++;
    if (!m.ticker) failures.push('data/resolved.json: row without ticker');
    if (m.result !== 'yes' && m.result !== 'no') failures.push(`resolved ${m.ticker}: result not verbatim yes/no (got ${JSON.stringify(m.result)})`);
  }
} catch (e) {
  failures.push(`data/resolved.json unreadable: ${e.message}`);
}

// ---- Verification-audit gates (session arena/86c45cd3-trade1, 2026-11-21) ----
// Brief rules pinned here: topics stay separate and each event is grouped in
// exactly one topic; published values are never invented (result enum, official
// URLs only); each file's published rule "definition" is exactly the rule of
// record in scripts/topics.json; data/snapshot.json topic_rules serializes from
// assets/lib.mjs TOPICS exactly the way scripts/build_snapshot.mjs maps it; and
// the "top events" tables on data.html keep their totals disclosure so a reader
// is never misled about what is (and is not) shown.
try {
  const rules = JSON.parse(await readFile('scripts/topics.json', 'utf8'));
  const ruleById = Object.fromEntries(rules.topics.map(t => [t.id, t]));
  const seenEvents = new Map();   // event_ticker -> topic id
  const seenTickers = new Map();  // market ticker -> topic id
  for (const t of ['gas-prices', 'elections', 'culture', 'crypto', 'golf']) {
    const f = `data/topics/${t}.json`;
    const d = JSON.parse(await readFile(f, 'utf8'));
    const r = ruleById[t];
    if (!r) { failures.push(`scripts/topics.json: no rule for ${t}`); continue; }
    // collect.py publishes definition as exactly these three classification
    // fields (exclusion rules live in scripts/topics.json / methods.html).
    const want = { categories: r.categories, title_keywords: r.title_keywords, series_prefix: r.series_prefix };
    if (JSON.stringify(d.definition) !== JSON.stringify(want)) {
      failures.push(`${f}: definition diverges from scripts/topics.json`);
    }
    for (const group of Object.values(d.source_urls || {})) {
      for (const u of Array.isArray(group) ? group : []) {
        if (typeof u !== 'string' || !u.startsWith(base + '/')) failures.push(`${f}: foreign source_url ${u}`);
      }
    }
    const events = d.events || [];
    if (d.event_count != null && d.event_count < events.length) {
      failures.push(`${f}: event_count ${d.event_count} < stored events ${events.length}`);
    }
    if (events.length > 30) failures.push(`${f}: stores ${events.length} events (cap is 30 — collect.py rows[:30])`);
    for (const ev of events) {
      if (seenEvents.has(ev.event_ticker)) {
        failures.push(`${f}: event ${ev.event_ticker} also in ${seenEvents.get(ev.event_ticker)} — events must stay grouped in one topic`);
      }
      seenEvents.set(ev.event_ticker, t);
      for (const m of ev._markets || []) {
        if (!m.ticker) { failures.push(`${f}: market row without ticker in ${ev.event_ticker}`); continue; }
        if (seenTickers.has(m.ticker)) failures.push(`${f}: market ${m.ticker} also filed under ${seenTickers.get(m.ticker)}`);
        seenTickers.set(m.ticker, t);
        if (!['', 'yes', 'no'].includes(m.result)) {
          failures.push(`${f}: market ${m.ticker} result not blank/yes/no: ${JSON.stringify(m.result)}`);
        }
      }
    }
  }

  // data/snapshot.json topic_rules must be the lib.mjs TOPICS serialization
  // (exact mapping of scripts/build_snapshot.mjs) — pin the derived pair so a
  // hand edit to either side cannot go unnoticed.
  const snap2 = JSON.parse(await readFile('data/snapshot.json', 'utf8'));
  const wantRules = LIB_TOPICS.map(t => ({
    id: t.id, label: t.label, official_categories: t.categories,
    keyword_patterns: t.keywords.map(k => k.source),
  }));
  if (JSON.stringify(snap2.topic_rules) !== JSON.stringify(wantRules)) {
    failures.push('data/snapshot.json: topic_rules diverges from assets/lib.mjs TOPICS (build_snapshot.mjs mapping)');
  }
  for (const r of [...(snap2.rows || []), ...(snap2.resolved || [])]) {
    if (r.result != null && !['', 'yes', 'no'].includes(r.result)) {
      failures.push(`data/snapshot.json: ${r.ticker} result not blank/yes/no: ${JSON.stringify(r.result)}`);
    }
    if (r.kalshi_url && !String(r.kalshi_url).startsWith('https://kalshi.com/')) {
      failures.push(`data/snapshot.json: ${r.ticker} kalshi_url not official: ${r.kalshi_url}`);
    }
  }

  // data.html must keep the totals disclosure above its "top events" tables.
  const page = await readFile('data.html', 'utf8');
  if (!page.includes('matched open events')) {
    failures.push('data.html: "top events" tables lost their matched-open-events totals disclosure');
  }
} catch (e) {
  failures.push(`verification-audit gates: ${e.message}`);
}

console.log(JSON.stringify({ checked, failures: failures.length }));
if (failures.length) { console.error(failures.slice(0, 50).join('\n')); process.exit(1); }
