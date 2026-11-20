// Read-only snapshot of the Kalshi DEMO account: balance and non-zero positions.
// Endpoints (official):
//   GET /portfolio/balance    https://docs.kalshi.com/api-reference/portfolio/get-balance
//   GET /portfolio/positions  https://docs.kalshi.com/api-reference/portfolio/get-positions
// Scope needed: read (balance can also use read::portfolio_balance).
//
// Without credentials the script sends NO request and exits 0 ("not configured").
// Output: data/demo_account/snapshot.json (only when credentials are present), and
// data/demo_account/status.json (when WRITE_STATUS=true, so a dispatch run can record the state).

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadCredentials, demoRequest, DEMO_API } from './kalshi_auth.mjs';

const OUT_SNAPSHOT = 'data/demo_account/snapshot.json';
const OUT_STATUS = 'data/demo_account/status.json';
const SOURCES = [
  'https://docs.kalshi.com/api-reference/portfolio/get-balance',
  'https://docs.kalshi.com/api-reference/portfolio/get-positions',
  'https://docs.kalshi.com/getting_started/quick_start_authenticated_requests',
];

async function writeJson(path, obj) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(obj, null, 2) + '\n');
}

const checkedAt = new Date().toISOString();
const creds = loadCredentials();

if (!creds) {
  const msg = 'Demo account not configured: KALSHI_DEMO_KEY_ID and/or KALSHI_DEMO_PRIVATE_KEY are not set. No request was sent.';
  console.log(msg);
  if (process.env.WRITE_STATUS === 'true') {
    await writeJson(OUT_STATUS, { checked_at: checkedAt, configured: false, environment: 'demo', message: msg, sources: SOURCES });
  }
  process.exit(0);
}

try {
  const balance = await demoRequest(creds, 'GET', '/portfolio/balance');

  // Positions paginate with `cursor`; request only non-zero net holdings.
  const positions = [];
  let cursor = '';
  for (let page = 0; page < 50; page++) {
    const q = `/portfolio/positions?count_filter=position&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await demoRequest(creds, 'GET', q);
    positions.push(...(res.market_positions || []));
    cursor = res.cursor || '';
    if (!cursor) break;
  }

  await writeJson(OUT_SNAPSHOT, {
    checked_at: checkedAt,
    environment: 'demo',
    api_base: DEMO_API,
    endpoints: ['GET /portfolio/balance', 'GET /portfolio/positions?count_filter=position'],
    balance, // raw API response (balance in cents, balance_dollars, portfolio_value in cents, updated_ts)
    position_count: positions.length,
    market_positions: positions, // raw API objects, unmodified
    sources: SOURCES,
  });
  if (process.env.WRITE_STATUS === 'true') {
    await writeJson(OUT_STATUS, { checked_at: checkedAt, configured: true, environment: 'demo', message: 'Snapshot succeeded.', sources: SOURCES });
  }
  console.log(`Demo snapshot written: ${positions.length} non-zero positions.`);
} catch (err) {
  // Never print the credentials. Print only Kalshi's status and error body.
  const msg = `Demo snapshot failed: ${err.message}`;
  console.error(msg);
  if (process.env.WRITE_STATUS === 'true') {
    await writeJson(OUT_STATUS, { checked_at: checkedAt, configured: true, environment: 'demo', message: msg, sources: SOURCES });
  }
  process.exit(1);
}
