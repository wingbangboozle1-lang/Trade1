#!/usr/bin/env node
/* Render test for the deployed dashboard pages.
 *
 * Boots each page in jsdom against the real static files, with fetch() proxied
 * to the official Kalshi demo Trade API through a fixture cache (the build
 * sandbox has no direct route to kalshi.co). Reports what each page actually
 * renders: table rows, canvases, alert chat entries, source links, JS errors.
 *
 * Pages that load <script type="module"> (the alternate live view) are NOT
 * renderable here — jsdom does not execute module scripts — so their import
 * graph is verified statically by scripts/check_site.mjs instead. Passing such
 * a page prints a SKIPPED note rather than a false failure.
 *
 * Usage:  node tools/render_test.mjs [--live] [--wait ms] [page ...]
 *   --live   refetch the API (default: use cached fixtures when present)
 *
 * Nothing here writes to the site. Fixtures live in .render-cache/ (gitignored).
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CACHE = path.join(ROOT, '.render-cache');
const ARGS = process.argv.slice(2);
const LIVE = ARGS.includes('--live');
const WAIT = Number((ARGS.find((a) => a.startsWith('--wait=')) || '--wait=9000').split('=')[1]);
const PAGES = ARGS.filter((a) => !a.startsWith('--'));
const BASE = 'https://external-api.demo.kalshi.co/trade-api/v2';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png',
};

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

async function cachedFetch(url) {
  const key = crypto.createHash('sha1').update(url).digest('hex');
  const file = path.join(CACHE, key + '.json');
  if (!LIVE && existsSync(file)) {
    const raw = await readFile(file, 'utf8');
    return { status: 200, body: raw, cached: true };
  }
  const t0 = Date.now();
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  const body = await r.text();
  await writeFile(file, body);
  await writeFile(file + '.meta', JSON.stringify({ url, status: r.status, ms: Date.now() - t0, at: new Date().toISOString() }));
  return { status: r.status, body, cached: false };
}

const results = [];
const apiLog = new Map();
const { srv, port } = await startServer();
const ORIGIN = `http://127.0.0.1:${port}`;

for (const page of PAGES.length ? PAGES : ['index.html']) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    // jsdom ships no canvas backend: getContext() returning null is a harness
    // gap, not a page defect. Every other JS error still fails the run.
    if (/Not implemented: HTMLCanvasElement/.test(e.message)) return;
    errors.push('jsdomError: ' + e.message);
  });
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
  vc.on('warn', () => {}); vc.on('log', () => {}); vc.on('info', () => {});

  const dom = await JSDOM.fromURL(ORIGIN + '/' + page, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.__nodeFetch = globalThis.fetch;
      win.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input.url;
        if (/kalshi\.co/.test(url)) {
          apiLog.set(url.replace(BASE, ''), (apiLog.get(url.replace(BASE, '')) || 0) + 1);
          try {
            const { status, body } = await cachedFetch(url);
            return new Response(body, { status, headers: { 'content-type': 'application/json' } });
          } catch (e) {
            return new Response(JSON.stringify({ error: String(e) }), { status: 599 });
          }
        }
        return win.__nodeFetch(new URL(url, win.location.href).toString(), init);
      };
    },
  });

  await new Promise((r) => setTimeout(r, WAIT));
  const doc = dom.window.document;
  if (doc.querySelector('script[type="module"]') && !(doc.querySelector('#kalshi-app') || doc.querySelector('#meta-line'))) {
    results.push({ page, skipped: 'page renders via an ES module, which jsdom cannot execute; import graph checked statically by scripts/check_site.mjs', errors: [] });
    dom.window.close();
    continue;
  }
  const app = doc.querySelector('#kalshi-app') || doc.body;
  const q = (s) => app.querySelectorAll(s).length;
  const text = (app.textContent || '').replace(/\s+/g, ' ').trim();
  const chatEntries = app.querySelectorAll('[data-alert], .alert, .chat-item, #kx-chat-all > *, #kx-chat-picks > *').length;
  const withSource = [...app.querySelectorAll('a[href]')].filter((a) => /kalshi\.co|kalshi\.com/.test(a.href)).length;
  results.push({
    page,
    renderedChars: (app.innerHTML || '').length,
    tables: q('table'), rows: q('tbody tr'), canvases: q('canvas'), svgs: q('svg'),
    links: q('a[href]'), kalshiSourceLinks: withSource, chatEntries,
    textHead: text.slice(0, 500),
    errors: errors.slice(0, 6),
  });
  await mkdir(CACHE, { recursive: true });
  await writeFile(path.join(CACHE, page.replace(/[\/]/g, '_') + '.render.html'), app.innerHTML, 'utf8');
  dom.window.close();
}

srv.close();

console.log(JSON.stringify({
  live: LIVE,
  apiRequests: [...apiLog.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25),
  pages: results,
}, null, 1));

// Fail loudly on empty renders or JS errors so CI can gate on it.
const bad = results.filter((r) => r.errors.length || r.renderedChars < 200);
if (bad.length) {
  console.error('RENDER TEST FAILED:', bad.map((b) => b.page).join(', '));
  process.exitCode = 1;
}
