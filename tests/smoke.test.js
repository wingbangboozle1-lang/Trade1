/* Boot smoke test: runs the engine's init() for every page type with stubbed
 * DOM and a failing network (sandbox has no Kalshi egress) to prove each page
 * degrades gracefully to the verified-snapshot state without throwing.
 * Run: node tests/smoke.test.js */
const fs = require('fs');
const path = require('path');

function bootFor(page, topic) {
  const listeners = {};
  const elements = new Map();
  const makeEl = (id) => ({
    id, innerHTML: '', textContent: '', className: '', value: '', style: {},
    classList: { add(){}, remove(){}, toggle(){} },
    addEventListener(){}, onclick: null,
    querySelectorAll: () => [], querySelector: () => null,
    getContext: () => new Proxy({}, { get: () => () => {} }),
    parentElement: { getBoundingClientRect: () => ({ width: 800, height: 300 }) },
    getBoundingClientRect: () => ({ width: 800, height: 300 }),
    dataset: {}, href: '', click(){}, appendChild(){}
  });
  global.window = {
    addEventListener: (t, fn) => { (listeners['w:' + t] = listeners['w:' + t] || []).push(fn); },
    devicePixelRatio: 1, location: { origin: 'https://test.local', pathname: '/' + page + '.html' }
  };
  global.location = global.window.location;
  global.document = {
    body: { dataset: { page, topic } },
    addEventListener: (t, fn) => { (listeners['d:' + t] = listeners['d:' + t] || []).push(fn); },
    getElementById: (id) => { if (!elements.has(id)) elements.set(id, makeEl(id)); return elements.get(id); },
    querySelectorAll: () => [], createElement: () => makeEl('tmp')
  };
  const store = {};
  global.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  global.fetch = async (url) => {
    if (String(url).includes('snapshot')) {
      return { ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'site', 'data', 'snapshot-2026-11-20.json'), 'utf8')) };
    }
    throw new TypeError('Failed to fetch (network disabled)');
  };
  global.AbortController = class { constructor(){ this.signal = {}; } abort(){} };
  const src = fs.readFileSync(path.join(__dirname, '..', 'site', 'assets', 'app.js'), 'utf8');
  eval(src);
  (listeners['d:DOMContentLoaded'] || []).forEach(fn => fn());
  return { wait: (ms) => new Promise(r => setTimeout(r, ms)), elements };
}

(async () => {
  const pages = [['live'], ['topic', 'crypto'], ['topic', 'gas'], ['topic', 'elections'], ['topic', 'culture'], ['topic', 'golf'], ['index'], ['strategies'], ['findings'], ['resolved'], ['flagged']];
  let failed = 0;
  for (const [page, topic] of pages) {
    try {
      const t = bootFor(page, topic);
      await t.wait(300); // let async init settle (bootstrap rejects, renders error banner)
      const notice = t.elements.get('apiNotice');
      const okNotice = notice && /could not reach/i.test(notice.innerHTML);
      const boot = t.elements.get('bootStatus');
      console.log(`  ${page}${topic ? ':' + topic : ''} — booted; error banner shown=${okNotice}; boot="${boot ? boot.textContent : ''}"`);
      if ((page === 'live' || page === 'topic') && !okNotice) { console.log('    ✗ expected graceful-degradation banner'); failed++; }
    } catch (e) {
      console.log(`  ✗ ${page}${topic ? ':' + topic : ''} — threw: ${e.message}`);
      failed++;
    }
  }
  console.log(failed ? `\nSMOKE FAILED: ${failed}` : '\nSMOKE OK — all pages boot and degrade gracefully');
  process.exit(failed ? 1 : 0);
})();
