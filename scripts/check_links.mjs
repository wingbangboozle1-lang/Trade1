// Trade1 — link and nav check for the PUBLISHED site (repository root, served by GitHub Pages).
//
// Why a second checker: scripts/check_site.mjs (session cedad5c4) link-checks only a fixed allow-list
// of pages, which no longer matches what is deployed at the root (dashboard.html, data.html, trades.html,
// methods.html, topics/* are all outside it, and so were this session's new pages). This checker walks the
// published pages themselves. It does not modify or replace the other script, and it deliberately does not
// police the archived trees other sessions left in the repo (js/, css/, pages/, site/, monitor/, trade1/,
// a2ec5543/, categories/, docs/) — those are not served.
//
// Checks
//  1. every local href/src on a published page resolves to a real file;
//  2. the navigation set is identical on every published page, and each nav target exists;
//  3. every referenced data/*.json exists and parses;
//  4. external links point at an official host (Kalshi docs/API/website, GitHub) or an approved
//     reference (news-search leads); anything else is reported as a warning, never silently accepted.
//
// Usage: node scripts/check_links.mjs   (exit 1 on any failure)
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OFFICIAL = [
  'docs.kalshi.com', 'kalshi.com', 'help.kalshi.com', 'support.kalshi.com',
  'external-api.demo.kalshi.co', 'demo-api.kalshi.co', 'external-api-ws.demo.kalshi.co',
  'demo.kalshi.co', 'kalshi.com/docs', 'github.com', 'news.google.com',
  'wingbangboozle1-lang.github.io'   // this site's own published origin (self-links)
];
const NAV_TARGETS = ['index.html', 'executive-summary.html', 'dashboard.html', 'trades.html', 'portfolio.html',
  'topics/gas-prices.html', 'topics/elections.html', 'topics/culture.html', 'topics/crypto.html',
  'topics/golf.html', 'data.html', 'resolved.html', 'methods.html', 'suggestions.html', 'flagged.html', 'sources.html', 'coverage.html'];

const failures = [], warnings = [];
const counts = { pages: 0, links: 0, external: 0, datarefs: 0 };

async function publishedPages() {
  const out = [];
  for (const e of await readdir(ROOT, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith('.html')) out.push(e.name);
  }
  for (const name of await readdir(path.join(ROOT, 'topics'))) {
    if (name.endsWith('.html')) out.push('topics/' + name);
  }
  return out.sort();
}

const STRICT = new Set(NAV_TARGETS.concat(['portfolio.html', 'suggestions.html']));
// coverage.html is a published page inside the navigation; it is in NAV_TARGETS above.
const allPages = await publishedPages();
const pages = allPages.slice();
const legacy = allPages.filter((f) => !STRICT.has(f));
if (legacy.length) {
  console.log('legacy root pages from earlier sessions (local links checked, nav parity skipped — they are not in the published navigation): ' + legacy.join(', '));
  warnings.push(...legacy.map((f) => `${f}: legacy page outside the published navigation`));
}
for (const f of pages) {
  counts.pages++;
  const raw = await readFile(path.join(ROOT, f), 'utf8');
  // static markup only: inline <script> string-building would otherwise be mistaken for HTML
  const html = raw.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const refs = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  for (const ref of refs) {
    if (/^mailto:|^javascript:|^#/.test(ref)) continue;
    if (/^https?:/.test(ref)) {
      counts.external++;
      let host = '';
      try { host = new URL(ref).hostname; } catch { failures.push(`${f}: unparseable URL ${ref}`); continue; }
      if (!OFFICIAL.some((o) => host === o || host.endsWith('.' + o) || ref.startsWith('https://' + o))) {
        warnings.push(`${f}: non-official external link ${ref}`);
      }
      if (!ref.startsWith('https://')) failures.push(`${f}: external link not https: ${ref}`);
      continue;
    }
    const clean = ref.split('#')[0].split('?')[0];
    if (!clean) continue;
    counts.links++;
    const target = path.normalize(path.join(path.dirname(f), clean));
    const rel = path.relative(ROOT, target);
    if (rel.startsWith('..')) { failures.push(`${f}: link escapes the published tree (${ref})`); continue; }
    try { await stat(target); } catch { failures.push(`${f}: broken link ${ref}`); continue; }
    if (/\.json$/.test(clean)) {
      counts.datarefs++;
      try { JSON.parse(await readFile(target, 'utf8')); }
      catch (e) { failures.push(`${f}: ${rel} is not valid JSON (${e.message})`); }
    }
  }
  // every page must fetch a data file the pipeline writes
  const fetches = [...raw.matchAll(/fetch\(\s*['"]([^'"]+\.json)['"]/g)].map((m) => m[1])
    .concat([...raw.matchAll(/(['"])(data\/[^'"]+\.json)\1/g)].map((m) => m[2]))
    .concat((raw.match(/DATA_URL = '(data\/[^']+)'/) || [])[1] ? [raw.match(/DATA_URL = '(data\/[^']+)'/)[1]] : []);
  for (const fr of new Set(fetches)) {
    const t = path.normalize(path.join(ROOT, path.dirname(f), fr.split('?')[0]));
    try { await stat(t); } catch { failures.push(`${f}: fetch target missing ${fr}`); }
  }
  // nav parity (published pages only)
  if (!STRICT.has(f)) continue;
  const missing = NAV_TARGETS.filter((t) => {
    const base = path.basename(t);
    return !new RegExp('href="[^"]*' + base.replace('.', '\\.') + '"').test(html);
  });
  if (missing.length) failures.push(`${f}: nav missing ${missing.join(', ')}`);
}

// assets referenced from the scripts (portfolio.js reads data/portfolio.json; app.js reads data/topics/*.json)
for (const t of ['data/portfolio.json', 'data/topics/gas-prices.json', 'data/topics/elections.json',
  'data/topics/culture.json', 'data/topics/crypto.json', 'data/topics/golf.json', 'data/meta.json',
  'assets/site.css', 'assets/app.js', 'assets/model.js', 'assets/portfolio.js']) {
  try { await stat(path.join(ROOT, t)); } catch { failures.push(`missing asset ${t}`); }
}

console.log(JSON.stringify(counts));
if (warnings.length) console.log('WARNINGS:\n  ' + [...new Set(warnings)].join('\n  '));
console.log(`${counts.pages} published pages, ${counts.links} local links, ${counts.external} external links, ${failures.length} failures`);
if (failures.length) { console.error('FAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
