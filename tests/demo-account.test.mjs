// tests/demo-account.test.mjs — offline verification for the demo-account track.
// Run: node tests/demo-account.test.mjs
// Covers:
//   1. Taker fees reproduce EVERY cell of the official Kalshi fee table (42 cells + formula rows)
//      Source: https://kalshi.com/docs/kalshi-fee-schedule.pdf (fetched 2026-11-20, eff. 2026-07-07)
//   2. Request signing round-trip (RSA-PSS SHA-256 salt=digest, Ed25519) against node:crypto
//      Source: https://docs.kalshi.com/getting_started/quick_start_authenticated_requests
//   3. Order-plan guard rules (adopted from scripts/demo_account/order_rules.mjs)
//   4. Paper portfolio: signals, >= $0.10 integer-cent threshold, settlement P&L, analysis
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  dollarsToUnits, unitsToDollars, takerFeeUnits, makerFeeUnits,
  classifyTopic, generateSignals, createPortfolio, openPosition, settlePositions,
  equityUnits, analyzeBy, portfolioStats, JUMP_THRESHOLD_UNITS, feeMultipliersForSeries,
} from '../demo-account/assets/engine.js';
import { validatePlan, dollarsToUnits as planDollarsToUnits, isOnPriceGrid } from '../scripts/demo_account/order_rules.mjs';
import { preSignText, signText, authHeaders } from '../scripts/demo_account/kalshi_auth.mjs';

let passed = 0;
const fail = [];
function ok(cond, name) {
  if (cond) { passed++; } else { fail.push(name); console.error('FAIL:', name); }
}

// ---------------------------------------------------------------------------
// 1. Official fee table (General Trading Fees Table, both columns)
//    [price$, fee1contract$, fee100contracts$] — transcribed verbatim from the PDF.
// ---------------------------------------------------------------------------
const OFFICIAL_TABLE = [
  [0.01, 0.01, 0.07], [0.05, 0.01, 0.34], [0.10, 0.01, 0.63], [0.15, 0.01, 0.90],
  [0.20, 0.02, 1.12], [0.25, 0.02, 1.32], [0.30, 0.02, 1.47], [0.35, 0.02, 1.60],
  [0.40, 0.02, 1.68], [0.45, 0.02, 1.74], [0.50, 0.02, 1.75], [0.55, 0.02, 1.74],
  [0.60, 0.02, 1.68], [0.65, 0.02, 1.60], [0.70, 0.02, 1.47], [0.75, 0.02, 1.32],
  [0.80, 0.02, 1.12], [0.85, 0.01, 0.90], [0.90, 0.01, 0.63], [0.95, 0.01, 0.34],
  [0.99, 0.01, 0.07],
];
for (const [price, fee1, fee100] of OFFICIAL_TABLE) {
  const p = dollarsToUnits(price.toFixed(2));
  ok(takerFeeUnits(p, p, 1, 1) === dollarsToUnits(fee1.toFixed(2)),
    `fee 1 @ $${price} = $${fee1}`);
  const cost100 = p * 100;
  ok(takerFeeUnits(cost100, p, 100, 1) === dollarsToUnits(fee100.toFixed(2)),
    `fee 100 @ $${price} = $${fee100}`);
}
// Series multiplier: KXBTCY has taker multiplier 0 -> fee 0 (official non-standard table)
ok(takerFeeUnits(dollarsToUnits('10.00'), dollarsToUnits('0.50'), 100, 0) === 0, 'KXBTCY taker fee 0');
// Maker multiplier default 0 -> 0; KXAAAGASM maker multiplier 1 -> nonzero (0.0175 rule)
ok(makerFeeUnits(dollarsToUnits('50.00'), dollarsToUnits('0.50'), 100, 0) === 0, 'maker default fee 0');
// maker 100 @ 0.50, M=1: raw = 0.0175*100*0.25 = 0.4375 -> cost 50 + 0.4375 = 50.4375 -> 50.44 -> 0.44
ok(makerFeeUnits(dollarsToUnits('50.00'), dollarsToUnits('0.50'), 100, 1) === dollarsToUnits('0.44'),
  'maker 100 @ $0.50 M=1 = $0.44');
ok(JSON.stringify(feeMultipliersForSeries('KXBTCY')) === '[0,0]', 'KXBTCY multiplier map');
ok(JSON.stringify(feeMultipliersForSeries('KXUNKNOWN')) === '[0,1]', 'default multipliers');

// ---------------------------------------------------------------------------
// 1b. Topic classification against LIVE series shapes observed 2026-11-20
// ---------------------------------------------------------------------------
ok(classifyTopic({ title: 'House TX 34', ticker: 'HOUSETX34', category: 'Elections', tags: ['House'] }) === 'elections',
  'House race -> elections (live category Elections)');
ok(classifyTopic({ title: 'Will kai Cenat get his haircut during stream', ticker: 'KXSTREAMERHAIRCUT', category: 'Entertainment' }) === 'culture',
  'streamer haircut -> culture (live category Entertainment)');
ok(classifyTopic({ title: 'College Football Overtime', ticker: 'KXNCAAFOT', category: 'Sports', tags: ['Football'] }) === 'other',
  'football -> other (not in the five topics)');
ok(classifyTopic({ title: 'US gas price above 4.50', ticker: 'KXAAAGASM-26NOV21-4.50', category: 'Climate and Weather' }) === 'gas-prices',
  'gas price series -> gas-prices');
ok(classifyTopic({ title: 'PGA Tour winner', ticker: 'KXPGATOUR-26', category: 'Sports', tags: ['Golf'] }) === 'golf',
  'PGA via tags -> golf');
ok(classifyTopic({ title: 'Will Trump buy a golf club in Greenland?', ticker: 'X1', category: 'Politics' }) !== 'golf',
  'political golf-club market is not golf');
ok(classifyTopic({ title: 'Will bitcoin hit 150k?', ticker: 'KXBTCMAX150', category: 'Crypto' }) === 'crypto', 'btc -> crypto');
ok(classifyTopic({ title: 'Will something happen', ticker: 'KXT', category: 'Other' }) === 'other',
  '"something" does not match eth (word boundary)');

// ---------------------------------------------------------------------------
// 2. Signing round-trip (matches official pre-sign text and algorithms)
// ---------------------------------------------------------------------------
ok(preSignText('1703123456789', 'get', '/trade-api/v2/portfolio/balance?limit=5')
  === '1703123456789GET/trade-api/v2/portfolio/balance', 'pre-sign strips query, uppercases method');

{
  // RSA-PSS SHA-256 salt=digest(32)
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const text = '1703123456789GET/trade-api/v2/portfolio/balance';
  const sigB64 = signText(privateKey, text);
  const verified = crypto.verify('sha256', Buffer.from(text), {
    key: publicKey,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  }, Buffer.from(sigB64, 'base64'));
  ok(verified, 'RSA-PSS signature verifies');
  const wrong = crypto.verify('sha256', Buffer.from(text + 'x'), {
    key: publicKey,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  }, Buffer.from(sigB64, 'base64'));
  ok(!wrong, 'RSA-PSS signature rejects tampered text');
  const h = authHeaders({ keyId: 'test-key-id', pem: privateKey }, 'GET', '/portfolio/balance', 1703123456789);
  ok(h['KALSHI-ACCESS-KEY'] === 'test-key-id' && h['KALSHI-ACCESS-TIMESTAMP'] === '1703123456789'
    && typeof h['KALSHI-ACCESS-SIGNATURE'] === 'string' && h['KALSHI-ACCESS-SIGNATURE'].length > 40,
    'authHeaders shape');
}
{
  // Ed25519 signs the message directly
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const text = '1703123456789POST/trade-api/v2/portfolio/events/orders';
  const sigB64 = signText(privateKey, text);
  ok(crypto.verify(null, Buffer.from(text), publicKey, Buffer.from(sigB64, 'base64')), 'Ed25519 signature verifies');
}

// ---------------------------------------------------------------------------
// 3. Order-plan guard rules (adopted code)
// ---------------------------------------------------------------------------
ok(planDollarsToUnits('0.5600') === 5600, 'plan dollarsToUnits');
ok(unitsToDollars(5600) === '0.5600', 'engine unitsToDollars round-trip');
ok(isOnPriceGrid(5600, [{ start: '0.0100', end: '0.9900', step: '0.0010' }]), 'on-grid 0.5600');
ok(!isOnPriceGrid(5605, [{ start: '0.0100', end: '0.9900', step: '0.0010' }]), 'off-grid 0.5605 rejected');
{
  const market = {
    T1: { status: 'active', price_ranges: [{ start: '0.0100', end: '0.9900', step: '0.0010' }] },
    T2: { status: 'finalized', price_ranges: [{ start: '0.0100', end: '0.9900', step: '0.0010' }] },
  };
  const plan = { orders: [
    { ticker: 'T1', side: 'bid', price_dollars: '0.5600', count: 1 },
    { ticker: 'T2', side: 'bid', price_dollars: '0.5600', count: 1 },
    { ticker: 'T1', side: 'ask', price_dollars: '0.5600', count: 1 },
    { ticker: 'T1', side: 'bid', price_dollars: '0.0050', count: 1 },
    { ticker: 'T1', side: 'bid', price_dollars: '0.5600', count: 9 },
    { ticker: 'NOPE', side: 'bid', price_dollars: '0.5600', count: 1 },
  ] };
  const { accepted, rejected } = validatePlan(plan, market);
  ok(accepted.length === 1 && accepted[0].ticker === 'T1', 'exactly the good order accepted');
  ok(rejected.length === 5, 'five bad orders rejected');
  ok(rejected[0].reason.includes('active'), 'finalized market rejected');
  ok(rejected[1].reason.includes('bid'), 'ask side rejected');
  ok(rejected[2].reason.includes('$0.01'), 'below-minimum price rejected');
  ok(rejected[3].reason.includes('count'), 'oversized count rejected');
  ok(rejected[4].reason.includes('not fetched'), 'unknown ticker rejected');
}

// ---------------------------------------------------------------------------
// 4. Paper portfolio: threshold, signals, settlement, analysis
// ---------------------------------------------------------------------------
ok(JUMP_THRESHOLD_UNITS === 1000, 'jump threshold is exactly $0.10 (1000 units)');
{
  // integer-cent edge case from session f6094c46: 0.66 -> 0.56 is exactly 0.10
  const prev = { lastUnits: 6600, tsMs: 1 };
  const curr = {
    ticker: 'T', title: 'Test market', series_ticker: 'KXTEST', status: 'active',
    lastUnits: 5600, yesAskUnits: 5700, noAskUnits: 4400, vol24: 500, tsMs: 2,
  };
  const sigs = generateSignals(prev, curr, false);
  ok(sigs.some((s) => s.strategy === 'momentum-jump' && s.side === 'no'), 'exact-cent down-jump fires');
  ok(sigs.some((s) => s.strategy === 'fade-jump' && s.side === 'yes'), 'fade fires on down-jump');
  // a 9-cent move must NOT fire the jump strategies
  const sigs2 = generateSignals({ lastUnits: 6000 }, { ...curr, lastUnits: 5100 }, false);
  ok(!sigs2.some((s) => s.strategy === 'momentum-jump' || s.strategy === 'fade-jump'),
    '0.09 move does not fire jump signals');
  // value-ask fires when cheap and active
  const cheap = { ...curr, lastUnits: 2000, yesAskUnits: 2000, noAskUnits: 8100 };
  ok(generateSignals(null, cheap, false).some((s) => s.strategy === 'value-ask'), 'value-ask fires');
  ok(generateSignals(null, { ...cheap, vol24: 10 }, false).every((s) => s.strategy !== 'value-ask'),
    'value-ask needs volume');
}
{
  const pf = createPortfolio();
  const mkt = {
    ticker: 'KXBTC-26NOV30-B100', event_ticker: 'KXBTC-26NOV30', title: 'BTC above 100k?',
    series_ticker: 'KXBTC', status: 'active', sourceUrl: 'https://external-api.demo.kalshi.co/trade-api/v2/markets/KXBTC-26NOV30-B100',
  };
  const sig = { strategy: 'momentum-jump', trigger: 'jump-up', side: 'yes', priceUnits: 6000, reason: 'test' };
  const pos = openPosition(pf, sig, mkt, 'crypto', 1000);
  ok(pos && pf.positions.length === 1, 'position opened');
  // cost 6000 + fee (1 @ 0.60 -> $0.02 = 200 units) debited
  ok(pf.cashUnits === 1000000 - 6000 - 200, `cash debited cost+fee (got ${pf.cashUnits})`);
  const [settled] = settlePositions(pf, { [mkt.ticker]: 'yes' }, 2000);
  ok(settled && settled.won && settled.pnlUnits === 10000 - 6000 - 200, 'win P&L = payout - cost - fee');
  ok(pf.cashUnits === 1000000 - 6000 - 200 + 10000, 'payout credited');
  ok(pf.trades.length === 1 && pf.positions.length === 0, 'trade closed');

  // losing side: NO position resolves 'yes' -> payout 0
  const pos2 = openPosition(pf, { strategy: 'fade-jump', trigger: 'jump-down-fade', side: 'no', priceUnits: 3000, reason: 't' }, mkt, 'crypto', 3000);
  ok(pos2, 'second position opened');
  const [lost] = settlePositions(pf, { [mkt.ticker]: 'yes' }, 4000);
  ok(lost && !lost.won && lost.pnlUnits === -(3000 + 200), `loss P&L = -(cost+fee) (got ${lost?.pnlUnits})`);

  const stats = portfolioStats(pf);
  ok(stats.closedTrades === 2 && stats.wins === 1 && stats.losses === 1, 'stats counts');
  ok(Math.abs(stats.winRate - 0.5) < 1e-9, 'win rate 50%');

  const byTopic = analyzeBy(pf.trades, 'topic');
  ok(byTopic.length === 1 && byTopic[0].key === 'crypto' && byTopic[0].trades === 2, 'analysis by topic');
  const byStrat = analyzeBy(pf.trades, 'strategy');
  ok(byStrat.length === 2, 'analysis by strategy');
  const eq = equityUnits(pf, {});
  ok(eq === pf.cashUnits, 'equity with no open positions is cash');
}

console.log(`\ndemo-account tests: ${passed} passed, ${fail.length} failed`);
if (fail.length) { process.exit(1); }
