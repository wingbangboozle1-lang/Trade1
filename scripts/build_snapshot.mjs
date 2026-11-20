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

const LIMITS = { open: 20, closed: 5, settled: 5 }; // pages of 200 events each (page caps are recorded in the snapshot)
const TOP_OPEN = 150;      // per topic: most open-interest markets kept in the snapshot
const TOP_RESOLVED = 200;  // per topic: most recently settled markets with an official result kept
const OPEN_STATUSES = new Set(['initialized', 'active', 'inactive', 'closed', 'determined', 'disputed', 'amended']);
const RESOLVED_STATUSES = new Set(['determined', 'amended', 'finalized']);
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
const resolvedAll = rows.filter(r => (r.result === 'yes' || r.result === 'no') && RESOLVED_STATUSES.has(r.status));
const openAll = rows.filter(r => OPEN_STATUSES.has(r.status));

// Size control: keep the top rows per topic so the committed file stays small.
// Selection is per topic; the union of selected tickers is written. Counts above are before caps.
const keep = new Set();
for (const t of TOPICS) {
  openAll.filter(r => r.topics.includes(t.id))
    .sort((a, b) => (b.open_interest_notional_derived ?? -1) - (a.open_interest_notional_derived ?? -1))
    .slice(0, TOP_OPEN).forEach(r => keep.add(r.ticker));
  resolvedAll.filter(r => r.topics.includes(t.id))
    .sort((a, b) => String(b.settlement_ts || '').localeCompare(String(a.settlement_ts || '')))
    .slice(0, TOP_RESOLVED).forEach(r => keep.add(r.ticker));
}
const keptRows = rows.filter(r => keep.has(r.ticker)).map(r => ({ ...r, event_settlement_sources: r.event_settlement_sources.slice(0, 6) }));
const resolved = resolvedAll.filter(r => keep.has(r.ticker));

const snapshot = {
  generated_at: generatedAt,
  api_base: base,
  api_base_key: baseKey,
  method: 'Public unauthenticated GET requests to the Kalshi Trade API. Topic = official event category and/or keyword rule (see lib.mjs). Every row links to its official API endpoint.',
  docs: {
    environments: 'https://docs.kalshi.com/getting_started/api_environments',
    get_events: 'https://docs.kalshi.com/api-reference/events/get-events',
    get_markets: 'https://docs.kalshi.com/api-reference/market/get-markets',
    lifecycle: 'https://docs.kalshi.com/getting_started/market_lifecycle',
    pagination: 'https://docs.kalshi.com/getting_started/pagination',
    orderbook: 'https://docs.kalshi.com/api-reference/market/get-market-orderbook',
    orderbook_format: 'https://docs.kalshi.com/getting_started/orderbook_responses',
    trades: 'https://docs.kalshi.com/api-reference/market/get-trades',
  },
  coverage: { ...coverage, events_total_unique: events.length, events_matching_topics: new Set(rows.map(r => r.event_ticker)).size },
  topics: perTopic,
  topic_rules: TOPICS.map(t => ({ id: t.id, label: t.label, official_categories: t.categories, keyword_patterns: t.keywords.map(k => k.source) })),
  categories_seen: [...new Set(events.map(e => e.category).filter(Boolean))].sort(),
  unmatched_categories_sample: [...new Set(events.filter(e => classifyEvent(e).length === 0).map(e => e.category || '(none)'))].sort().slice(0, 60),
  counts: { matched_rows_before_caps: rows.length, open_rows_before_caps: openAll.length, resolved_rows_before_caps: resolvedAll.length, rows_kept: keptRows.length, resolved_kept: resolved.length, caps: { top_open_per_topic: TOP_OPEN, top_resolved_per_topic: TOP_RESOLVED, page_limits: LIMITS } },
  rows: keptRows,
  resolved: resolved.map(r => ({ ticker: r.ticker, title: r.title, topics: r.topics, result: r.result, settlement_value: r.settlement_value, settlement_ts: r.settlement_ts, status: r.status, source_url: r.source_url, kalshi_url: r.kalshi_url, event_settlement_sources: r.event_settlement_sources.slice(0, 6) })),
};

await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, JSON.stringify(snapshot) + '\n');
log(`wrote ${outFile}: ${keptRows.length} rows kept (of ${rows.length} matched), ${resolved.length} resolved kept, ${events.length} events scanned`);
for (const [k, v] of Object.entries(perTopic)) log(`  topic ${k}: ${JSON.stringify(v)}`);
