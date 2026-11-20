// Pre-deploy checks for the published site (repository root, served by GitHub Pages):
//  1. every local href/src in **/*.html resolves to an existing file (no broken links);
//  2. every snapshot row and resolved row carries an official source_url on the configured API base;
//  3. shared modules import cleanly.
// Exits non-zero on any failure.
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { API_BASES } from '../assets/lib.mjs';

const SITE = '.';
const SKIP = new Set(['.git', '.github', 'node_modules', 'scripts']);
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
  const rawHtml = await readFile(f, 'utf8');
  /* <script src="..."> targets are checked BEFORE the script bodies are
     stripped below. The old order dropped every script tag with its src
     attribute, so a page could load a deleted module and still pass —
     exactly what happened to resolved.html (assets/app.mjs was removed in
     the consolidation, the page kept pointing at it). */
  for (const m of rawHtml.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)) {
    const ref = m[1];
    if (/^(https?:|\/\/)/.test(ref)) continue;
    const clean = ref.split('#')[0].split('?')[0];
    if (!clean) continue;
    checked.links++;
    const target = path.normalize(path.join(path.dirname(f), clean));
    if (target.startsWith('..')) { failures.push(`${f}: script src escapes repo ${ref}`); continue; }
    try { await stat(target); } catch { failures.push(`${f}: broken script src ${ref}`); }
  }
  // Inline scripts build URLs by concatenation (`href="'+esc(u)+'"`), which is not a
  // static link; strip <script> bodies before scanning or every template produces
  // false "broken link" failures.
  const html = rawHtml.replace(/<script\b[\s\S]*?<\/script>/gi, '');
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

await import('../assets/lib.mjs');
console.log(JSON.stringify({ checked, failures: failures.length }));
if (failures.length) { console.error(failures.slice(0, 50).join('\n')); process.exit(1); }
