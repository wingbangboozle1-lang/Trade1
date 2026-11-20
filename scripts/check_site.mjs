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
  'data.html','methods.html','flagged.html','sources.html','suggestions.html','resolved.html',
  'topics/gas-prices.html','topics/elections.html','topics/culture.html','topics/crypto.html','topics/golf.html',
  'demo-account/index.html','demo-account/flagged.html']);
const allFiles = (await walk(SITE)).map(f => f.replace(/^\.\//, ''));
const files = allFiles.filter(f => PUBLISHED.has(f) || !f.endsWith('.html'));
const unknown = allFiles.filter(f => f.endsWith('.html') && !PUBLISHED.has(f));
if (unknown.length) { console.log('FAIL unpublished page not in the check list: ' + unknown.join(', ')); process.exit(1); }
for (const f of files.filter(f => f.endsWith('.html'))) {
  checked.html++;
  // Inline scripts build URLs by concatenation (`href="'+esc(u)+'"`), which is not a
  // static link; strip <script> bodies before scanning or every template produces
  // false "broken link" failures.
  const html = (await readFile(f, 'utf8')).replace(/<script\b[\s\S]*?<\/script>/gi, '');
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

try {
  const snap = JSON.parse(await readFile('data/snapshot.json', 'utf8'));
  const base = API_BASES[snap.api_base_key] || snap.api_base;
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

await import('../assets/lib.mjs');
console.log(JSON.stringify({ checked, failures: failures.length }));
if (failures.length) { console.error(failures.slice(0, 50).join('\n')); process.exit(1); }
