#!/usr/bin/env node
/* Publication-integrity checks for the published site.
 *
 * These catch the class of defect that every other gate is blind to: the code
 * runs, the rows render, and the page still tells the reader something false.
 * Everything here is a statement the site makes about itself, checked against
 * the repository file that would make it true. Offline, no network, stdlib +
 * jsdom only.
 *
 * Each check names the flagged item it closes (see flagged.html).
 *
 *   1. Snapshot cadence claims match `.github/workflows/pages.yml`'s cron.
 *   2. Every workflow file a published page names exists in the repository.
 *   3. Every local file a published page links exists (catches renames).
 *   4. The landing status strip reports "fresh" ONLY for a healthy, in-date
 *      snapshot — proven by running its real script against four synthetic
 *      snapshot states, not by grepping for a string.
 *   5. A degraded collector run is never rendered as healthy.
 *
 * Usage: node tests/publication.test.mjs    (exit 1 on any failure)
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0;
const failures = [];
function ok(name, fn) {
  try { fn(); pass++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const PAGES = [
  'index.html', 'dashboard.html', 'trades.html', 'portfolio.html', 'data.html',
  'methods.html', 'flagged.html', 'sources.html', 'suggestions.html',
  'executive-summary.html', 'resolved.html',
  'demo-account/index.html', 'demo-account/flagged.html',
  'topics/gas-prices.html', 'topics/elections.html', 'topics/culture.html',
  'topics/crypto.html', 'topics/golf.html',
].filter((p) => existsSync(path.join(ROOT, p)));

const pageText = new Map(PAGES.map((p) => [p, read(p)]));
const pagesMatching = (re) => [...pageText.entries()].filter(([, s]) => re.test(s)).map(([p]) => p);

/* ---------- 1. snapshot cadence claims vs the workflow ------------------ */
const pagesYml = read('.github/workflows/pages.yml');
const cronMatch = pagesYml.match(/- cron:\s*'([^']+)'/);
const cron = cronMatch ? cronMatch[1] : null;
const stepHours = (() => {
  if (!cron) return null;
  const f = cron.split(/\s+/);
  const hourField = f[1];
  const step = hourField.match(/^\*\/(\d+)$/);
  if (step) return Number(step[1]);
  // a list of hours ("7,37") => hourly-ish; count the gaps
  const list = hourField.match(/^[\d,]+$/);
  if (list) return 'list:' + hourField;
  return null;
})();

ok('the snapshot workflow publishes a parseable cron schedule', () => {
  assert(cron, 'no cron found in .github/workflows/pages.yml');
  assert(stepHours !== null, `cron "${cron}" is not a fixed-interval schedule this test can verify`);
});

ok('no published page claims a snapshot cadence the workflow contradicts (was: "twice hourly")', () => {
  // pages.yml refreshes data/ every 3 hours. Any page that says "twice hourly"
  // for the SNAPSHOT is wrong. The ledger really is twice-hourly, so a sentence
  // that names portfolio.yml / the ledger is allowed to say so.
  const offenders = [];
  for (const [p, s] of pageText) {
    for (const m of s.matchAll(/[^<>]{0,220}twice hourly[^<>]{0,220}/gi)) {
      const ctx = m[0];
      // A sentence about the LEDGER is allowed to say twice-hourly: portfolio.yml
      // really is `13,43 * * * *`.
      if (/portfolio|ledger/i.test(ctx)) continue;
      // A record of a past defect is not a current claim ("…was first labelled…",
      // "…the correction — a 'twice hourly' claim for a 3-hourly job — …").
      if (/was|were|had|previous|previou|earlier|fixed|corrected|contradict|caught|defect|no longer|used to|renamed/i.test(ctx)) continue;
      if (!/snapshot|collect|data\/|pages\.yml/i.test(ctx)) continue;
      offenders.push(`${p}: …${ctx.trim()}…`);
    }
  }
  assert(offenders.length === 0, 'pages claim a twice-hourly snapshot refresh, but pages.yml is every 3 h:\n    ' + offenders.join('\n    '));
});

ok('the pages that state the snapshot schedule state the real one', () => {
  const expected = 'every 3 hours';
  for (const p of ['index.html', 'data.html']) {
    assert(pageText.get(p).includes(expected), `${p} does not state "every 3 hours"`);
  }
});

/* ---------- 2. workflow files named by a page must exist ---------------- */
ok('every workflow file a published page names exists (was: verify-and-collect.yml)', () => {
  const named = new Map();
  for (const [p, s] of pageText) {
    for (const m of s.matchAll(/(?:\.github\/workflows\/)?([\w.-]+\.ya?ml)/g)) {
      const name = m[1];
      if (!named.has(name)) named.set(name, new Set());
      named.get(name).add(p);
    }
  }
  const missing = [];
  for (const [name, pages] of named) {
    const candidates = [
      path.join('.github/workflows', name),
      name,
    ];
    if (!candidates.some((c) => existsSync(path.join(ROOT, c)))) {
      missing.push(`${name} (named on ${[...pages].join(', ')})`);
    }
  }
  assert(missing.length === 0, 'pages name workflow files that do not exist:\n    ' + missing.join('\n    '));
});

/* ---------- 3. local links from pages resolve ------------------------- */
ok('every local file link in a published page resolves', () => {
  const bad = [];
  for (const [p, s] of pageText) {
    const dir = path.dirname(p);
    for (const m of s.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const href = m[1];
      if (/^(https?:|mailto:|#|data:)/.test(href)) continue;
      // skip anything built in JS at render time (string concatenation/templates)
      if (/['"+`]/.test(href) || href.includes('$') || href.includes('{')) continue;
      const target = href.split('#')[0].split('?')[0];
      if (!target) continue;
      const resolved = target.startsWith('/') ? target.slice(1) : path.join(dir, target);
      if (!existsSync(path.join(ROOT, resolved))) bad.push(`${p} -> ${href}`);
    }
  }
  assert(bad.length === 0, 'broken local links:\n    ' + [...new Set(bad)].join('\n    '));
});

/* ---------- 4/5. the landing status strip, executed --------------------- */
/* Run the page's real inline status script against a synthetic
 * (meta.json, collect_status.json) pair and report what the pill says. */
function stripVerdict(meta, status) {
  const html = pageText.get('index.html');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert(scripts.length, 'index.html has no inline script');
  const code = scripts.find((s) => s.includes('SNAPSHOT_MAX_AGE_H'));
  assert(code, 'the landing status script (SNAPSHOT_MAX_AGE_H) is missing — was it removed?');

  const shell = `<!doctype html><html><body>
    <span class="pill" id="home-mode">checking…</span><span id="home-snap"></span>
    <ul id="snap-health"></ul></body></html>`;
  const vc = new VirtualConsole();        // swallow the page's own logs
  vc.on('jsdomError', () => {}); vc.on('error', () => {}); vc.on('warn', () => {});
  vc.on('log', () => {}); vc.on('info', () => {});
  const dom = new JSDOM(shell, { runScripts: 'outside-only', virtualConsole: vc, url: 'https://example.test/' });
  const w = dom.window;
  w.fetch = async (u) => {
    const key = String(u);
    const body = key.includes('collect_status') ? status : meta;
    return body === null
      ? { ok: false, json: async () => null }
      : { ok: true, json: async () => JSON.parse(JSON.stringify(body)) };
  };
  w.eval(code);
  // let the promise chain settle
  return new Promise((resolve) => setTimeout(() => {
    const pill = w.document.getElementById('home-mode');
    const out = {
      pill: pill.className + '|' + pill.textContent,
      note: w.document.getElementById('home-snap').textContent,
      health: w.document.getElementById('snap-health').innerHTML,
    };
    w.close();
    resolve(out);
  }, 0));
}

const now = Date.now();
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');
const fresh = iso(now - 20 * 60 * 1000);       // 20 min old — inside one 3 h window
const stale = iso(now - 9 * 3600 * 1000);      // 9 h old — two windows missed
const healthy = { status: 'ok', transient_read_failures: 0, kept_previous_artifacts: [] };
const degraded = { status: 'degraded: previous verified artifacts kept', transient_read_failures: 220, kept_previous_artifacts: ['resolved.json'] };

const cases = [
  { name: 'fresh + healthy', meta: { generated_at: fresh, findings: { markets_open_count: 14646 } }, status: healthy, want: 'snapshot fresh', not: /degraded|stale/ },
  { name: 'stale + healthy', meta: { generated_at: stale, findings: {} }, status: healthy, want: 'stale', not: /fresh|degraded/ },
  { name: 'fresh + degraded', meta: { generated_at: fresh, findings: {} }, status: degraded, want: 'snapshot degraded', not: /snapshot fresh|stale/ },
  { name: 'status file missing', meta: { generated_at: fresh, findings: {} }, status: null, want: 'degraded', not: /snapshot fresh/ },
  { name: 'meta missing', meta: null, status: healthy, want: 'unavailable', not: /snapshot fresh/ },
];

const verdicts = [];
for (const c of cases) verdicts.push({ c, v: await stripVerdict(c.meta, c.status) });

for (const { c, v } of verdicts) {
  ok(`landing pill says "${c.want}" for a ${c.name} snapshot (got ${v.pill})`, () => {
    assert(v.pill.includes(c.want), `expected the pill to contain "${c.want}", got "${v.pill}"`);
    assert(!c.not.test(v.pill), `the pill also matched a forbidden state ${c.not} -> "${v.pill}"`);
  });
}

ok('a degraded run is disclosed in words, not only in the pill colour', () => {
  const v = verdicts.find((x) => x.c.name === 'fresh + degraded').v;
  assert(/degraded/.test(v.health), 'the health list does not mention that the run was degraded');
  assert(/220/.test(v.health), 'the health list does not surface the number of upstream read failures');
  assert(/resolved\.json/.test(v.health), 'the health list does not name the artifacts that were kept');
});

ok('the health list always links the evidence files', () => {
  for (const { c, v } of verdicts) {
    if (c.name === 'meta missing') continue;
    assert(/data\/meta\.json/.test(v.health), `${c.name}: no link to data/meta.json`);
    assert(/data\/log\.md/.test(v.health), `${c.name}: no link to data/log.md`);
    assert(/pages\.yml/.test(v.health), `${c.name}: no link to the workflow that schedules the refresh`);
  }
});

ok('a stale snapshot points the reader at the live dashboard instead', () => {
  const v = verdicts.find((x) => x.c.name === 'stale + healthy').v;
  assert(/dashboard\.html/.test(v.health), 'the stale case does not link the live dashboard');
});

/* ---------- 6. the committed data must not disagree with itself -------- */
ok('committed snapshot metadata is self-consistent', () => {
  const meta = JSON.parse(read('data/meta.json'));
  assert(meta.generated_at, 'data/meta.json has no generated_at');
  assert(!isNaN(Date.parse(meta.generated_at)), 'data/meta.json generated_at is not a timestamp');
  assert(meta.base === 'https://external-api.demo.kalshi.co/trade-api/v2',
    `data/meta.json base is ${meta.base}, expected the official demo base`);
});

ok('collect_status.json, when present, only reports known states', () => {
  if (!existsSync(path.join(ROOT, 'data/collect_status.json'))) return;   // written only by a collector run
  const st = JSON.parse(read('data/collect_status.json'));
  assert(typeof st.status === 'string', 'collect_status.json has no status');
  assert(st.status === 'ok' || st.status.startsWith('degraded'),
    `collect_status.json status "${st.status}" is not one this site knows how to render`);
  assert(Array.isArray(st.kept_previous_artifacts), 'kept_previous_artifacts must be an array');
});

/* ---------- 7. the row-source gate must still be wired in ------------- */
ok('the per-row official-source gate covers the ledger page too', () => {
  const gate = read('scripts/check_row_sources.mjs');
  for (const id of ['pf-trades', 'pf-positions', 'pf-resolutions', 'pf-watchlist']) {
    assert(gate.includes(id), `scripts/check_row_sources.mjs does not check #${id}`);
  }
  const pkg = JSON.parse(read('package.json'));
  assert(/check_row_sources\.mjs/.test(pkg.scripts.check || ''), 'npm run check does not run check_row_sources.mjs');
  assert(/publication\.test\.mjs/.test(pkg.scripts.test || ''), 'npm test does not run this file');
});

/* ---------- report ----------------------------------------------------- */
if (failures.length) {
  console.error(`${failures.length} publication check(s) FAILED, ${pass} passed:\n  - ` + failures.join('\n  - '));
  process.exit(1);
}
console.log(`publication checks: ${pass}/${pass} passed`);
