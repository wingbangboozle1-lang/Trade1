#!/usr/bin/env node
/* Topic-classification tests for the browser classifier (assets/model.js).
 *
 * Run: node tests/collector.test.mjs
 *
 * These run the REAL shipped model.js against the official Kalshi demo
 * records in tests/fixtures/topic_cases.json — the same corpus the Python
 * collector test (tests/test_collect.py) uses, so the two implementations
 * that must stay in sync (scripts/collect.py and assets/model.js) are checked
 * against identical inputs.
 *
 * Flagged item 9d-1: two settled markets were labelled gas-prices although
 *   * KXNATGAS15M-26NOV201415-15 is a NATURAL GAS market, and
 *   * KXROMLNBMGAME-26NOV201200PLOPIT-PLO is a basketball match matched on
 *     the substring 'petrol' inside 'Petrolul'.
 */
import { readFileSync } from 'node:fs';

/* ---- minimal browser stubs (same shape as tests/model.test.js) ---- */
const store = {};
global.window = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
global.document = { body: { dataset: {} } };

const ROOT = new URL('..', import.meta.url);
eval(readFileSync(new URL('assets/model.js', ROOT), 'utf8'));
const M = global.window.KalshiModel;
if (!M) throw new Error('model.js did not expose window.KalshiModel');

const CASES = JSON.parse(readFileSync(new URL('tests/fixtures/topic_cases.json', ROOT), 'utf8'));

let passed = 0, failed = 0;
function eq(name, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + ' — got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
}

console.log('1. Official demo records must classify as expected:');
for (const c of CASES.cases) {
  // app.js calls classify(category, title + ' ' + sub_title, series_ticker)
  const title = c.title + ' ' + c.sub_title;
  const got = M.classify(c.category, title, c.series_ticker);
  eq(c.id + ' -> ' + String(c.expect_topic), got, c.expect_topic);
}

console.log('2. The gas topic excludes natural gas even without a category hint:');
eq('natural gas, no category', M.classify('', 'Natural Gas price up in next 15 mins?', 'KXNATGAS15M'), null);
eq('natural gas ticker only', M.classify('Economics', 'Natural Gas price up in next 15 mins?', ''), null);
eq('natgas ticker fragment', M.classify('Economics', 'Some other title', 'KXNATGAS15M'), null);

console.log('3. Word boundaries:');
eq('"petrol" alone matches', M.classify('Economics', 'Will petrol prices rise?', 'KXFUELX'), 'gas-prices');
eq('"Petrolul" does not match', M.classify('Economics', 'CSM BBA Petrolul Ploiesti wins', 'KXROMLNBMW'), null);
eq('"gas prices" matches', M.classify('Economics', 'US gas prices this week', 'KXAAAGASW'), 'gas-prices');
eq('"gasoline" matches', M.classify('Economics', 'Will gasoline hit $5?', 'KXFUELX'), 'gas-prices');

console.log('4. Regression: every snapshot event classified by classify() keeps its topic:');
const changed = [];
let checked = 0;
for (const topicId of ['gas-prices', 'elections', 'culture', 'crypto', 'golf']) {
  const data = JSON.parse(readFileSync(new URL('data/topics/' + topicId + '.json', ROOT), 'utf8'));
  for (const ev of data.events || []) {
    // 'series-discovery' events come from the GET /series?category= listing,
    // not from classify(); they are excluded from this comparison.
    if (ev._match_reason !== 'category' && ev._match_reason !== 'series-prefix') continue;
    checked++;
    const title = (ev.title || '') + ' ' + (ev.sub_title || '');
    const got = M.classify(ev.category, title, ev.series_ticker);
    if (got !== topicId) changed.push([topicId, ev.event_ticker, got]);
  }
}
eq('snapshot events re-classified unchanged (' + checked + ' events)', changed, []);

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
