// Builds data/snapshot.json from the official Kalshi demo Trade API.
// Run in CI (see .github/workflows/pages.yml). Read-only public endpoints only;
// no credentials are used or stored.
//
//   node scripts/build_snapshot.mjs [--base demo|prod] [--out data/snapshot.json]
//
// Endpoints used (documented at https://docs.kalshi.com/api-reference):
//   GET /events?status=open|closed|settled&with_nested_markets=true&limit=200&cursor=
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { API_BASES, TOPICS, classifyEvent, rowsFromEvents, fetchPaged } from '../assets/lib.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
  return acc;
}, []));
const baseKey = args.base || 'demo';
const base = API_BASES[baseKey];
if (!base) throw new Error(`unknown --base ${baseKey}`);
const outFile = args.out || 'data/snapshot.json';

const LIMITS = { open: 40, closed: 10, settled: 10 }; // pages of 200 events each
const log = (...m) => console.log(new Date().toISOString(), ...m);

const generatedAt = new Date().toISOString();
const coverage = {};
const allEvents = new Map();
const statusOfEvent = new Map();

for (const status of ['open', 'closed', 'settled']) {
  const url = `${base}/events?status=${status}&with_nested_markets=true&limit=200`;
  log(`fetching events status=${status} (max ${LIMITS[status]} pages)`);
  const { items, pages, truncated } = await fetchPaged(url, 'events', { maxPages: LIMITS[status], pageDelayMs: 200, log });
  coverage[status] = { url, pages, events_scanned: items.length, truncated };
  for (const ev of items) {
    if (!allEvents.has(ev.event_ticker)) { allEvents.set(ev.event_ticker, ev); statusOfEvent.set(ev.event_ticker, status); }
  }
  log(`  ${status}: ${items.length} events, ${pages} pages, truncated=${truncated}`);
}

const events = [...allEvents.values()];
const rows = rowsFromEvents(events, base);

// Keep only markets whose status is known; record counts per topic for the site.
const perTopic = Object.fromEntries(TOPICS.map(t => [t.id, { markets: 0, open: 0, closed: 0, settled_or_finalized: 0 }]));
for (const r of rows) {
  for (const t of r.topics) {
    perTopic[t].markets += 1;
    if (r.status === 'active') perTopic[t].open += 1;
    else if (r.status === 'closed' || r.status === 'determined' || r.status === 'disputed' || r.status === 'amended') perTopic[t].closed += 1;
    else if (r.status === 'finalized') perTopic[t].settled_or_finalized += 1;
  }
}

// Resolved outcomes: markets with an official result set (yes/no/scalar).
const resolved = rows.filter(r => r.result && (r.status === 'finalized' || r.status === 'determined' || r.status === 'amended'));

const snapshot = {
  generated_at: generatedAt,
  api_base: base,
  api_base_key: baseKey,
  method: 'Public unauthenticated GET requests to the Kalshi Trade API. Topic = official event category and/or keyword rule (see lib.mjs). Every row links to its official API endpoint.',
  docs: {
    environments: 'https://docs.kalshi.com/getting_started/api_environments',
    get_events: 'https://docs.kalshi.com/api-reference/market/get-events',
    get_markets: 'https://docs.kalshi.com/api-reference/market/get-markets',
    lifecycle: 'https://docs.kalshi.com/getting_started/market_lifecycle',
    pagination: 'https://docs.kalshi.com/getting_started/pagination',
    orderbook: 'https://docs.kalshi.com/api-reference/market/get-market-order-book',
    orderbook_format: 'https://docs.kalshi.com/getting_started/orderbook_responses',
    trades: 'https://docs.kalshi.com/api-reference/market/get-trades',
  },
  coverage: { ...coverage, events_total_unique: events.length, events_matching_topics: new Set(rows.map(r => r.event_ticker)).size },
  topics: perTopic,
  topic_rules: TOPICS.map(t => ({ id: t.id, label: t.label, official_categories: t.categories, keyword_patterns: t.keywords.map(k => k.source) })),
  categories_seen: [...new Set(events.map(e => e.category).filter(Boolean))].sort(),
  unmatched_categories_sample: [...new Set(events.filter(e => classifyEvent(e).length === 0).map(e => e.category || '(none)'))].sort().slice(0, 60),
  counts: { rows: rows.length, resolved_rows: resolved.length },
  rows,
  resolved: resolved.map(r => ({ ticker: r.ticker, title: r.title, topics: r.topics, result: r.result, settlement_value: r.settlement_value, settlement_ts: r.settlement_ts, status: r.status, source_url: r.source_url, kalshi_url: r.kalshi_url, event_settlement_sources: r.event_settlement_sources })),
};

await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, JSON.stringify(snapshot, null, 1) + '\n');
log(`wrote ${outFile}: ${rows.length} topic rows, ${resolved.length} resolved, ${events.length} events scanned`);
for (const [k, v] of Object.entries(perTopic)) log(`  topic ${k}: ${JSON.stringify(v)}`);
