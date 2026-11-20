import test from "node:test";
import assert from "node:assert/strict";
import {
  ALERT_THRESHOLD_DOLLARS,
  MODEL_RULES,
  classifyTopic,
  detectMove,
  evaluateCandidate,
  isClosedOrTerminalMarket,
  isTerminalMarketStatus,
  isYesNoSettled,
  marketApiUrl,
  orderbookLevels,
  paperProfitLoss,
  payoutForResult,
  readNumber,
  settledPaperProfitLoss,
} from "../logic.js";

const candidateMarket = {
  market_type: "binary",
  settlement_bounds_type: "default",
  yes_bid_dollars: "0.4000",
  yes_ask_dollars: "0.4500",
  yes_bid_size_fp: "5.00",
  yes_ask_size_fp: "5.00",
};

test("missing numeric fields remain missing while a reported zero stays zero", () => {
  assert.equal(readNumber(undefined), null);
  assert.equal(readNumber(null), null);
  assert.equal(readNumber(""), null);
  assert.equal(readNumber("  "), null);
  assert.equal(readNumber(false), null);
  assert.equal(readNumber("0.0000"), 0);
});

test("the topic filter recognizes the five requested topics and excludes unrelated text", () => {
  assert.equal(classifyTopic({ title: "US gasoline prices next month" }), "gas-prices");
  assert.equal(classifyTopic({ title: "Natural gas prices this winter" }), "gas-prices");
  assert.equal(classifyTopic({ title: "Who will win the Senate election?" }), "elections");
  assert.equal(classifyTopic({ title: "Oscars best picture winner" }), "culture");
  assert.equal(classifyTopic({ title: "BTC price above a threshold" }), "crypto");
  assert.equal(classifyTopic({ title: "PGA Championship winner" }), "golf");
  assert.equal(classifyTopic({ title: "Will it rain tomorrow?" }), null);
  assert.equal(classifyTopic(null), null);
});

test("a YES-bid move triggers at the exact threshold in either direction", () => {
  assert.equal(ALERT_THRESHOLD_DOLLARS, 0.1);
  assert.deepEqual(detectMove("0.5000", "0.6000"), {
    previous: 0.5,
    current: 0.6,
    delta: 0.09999999999999998,
    direction: "up",
  });
  const down = detectMove("0.6000", "0.5000");
  assert.ok(down);
  assert.equal(down.direction, "down");
  assert.ok(Math.abs(down.delta + 0.1) < 1e-12);
  assert.equal(detectMove("0.5000", "0.5999"), null);
  assert.equal(detectMove(null, "0.7000"), null);
});

test("the candidate screen is transparent and fails closed on missing or weak liquidity", () => {
  const accepted = evaluateCandidate(candidateMarket, 0.1);
  assert.equal(accepted.eligible, true);
  assert.ok(Math.abs(accepted.spread - 0.05) < 1e-12);
  assert.equal(accepted.reasons.length, 0);

  const missingSize = evaluateCandidate({ ...candidateMarket, yes_ask_size_fp: null }, 0.1);
  assert.equal(missingSize.eligible, false);
  assert.ok(missingSize.reasons.some((reason) => reason.includes("YES-ask size")));

  const wideSpread = evaluateCandidate({ ...candidateMarket, yes_ask_dollars: "0.4600" }, 0.1);
  assert.equal(wideSpread.eligible, false);
  assert.ok(wideSpread.reasons.some((reason) => reason.includes("spread")));

  const unknownSettlement = evaluateCandidate({ ...candidateMarket, settlement_bounds_type: undefined }, 0.1);
  assert.equal(unknownSettlement.eligible, false);
  assert.equal(MODEL_RULES.minBestLevelContracts, 5);
});

test("orderbook levels show highest bid first and preserve contract quantities", () => {
  const orderbook = {
    orderbook_fp: {
      yes_dollars: [["0.10", "2.00"], ["0.45", "8.50"], ["0.32", "4.00"]],
      no_dollars: [["0.20", "1.00"]],
    },
  };
  assert.deepEqual(orderbookLevels(orderbook, "yes", 2), [
    { price: 0.45, contracts: 8.5 },
    { price: 0.32, contracts: 4 },
  ]);
  assert.deepEqual(orderbookLevels(orderbook, "no", 5), [{ price: 0.2, contracts: 1 }]);
  assert.deepEqual(orderbookLevels(orderbook, "ask", 5), []);
  assert.deepEqual(orderbookLevels({ orderbook_fp: { yes_dollars: [] } }, "yes"), []);
  assert.deepEqual(orderbookLevels({ orderbook_fp: { yes_dollars: [["1.01", "3"], ["0.30", "-1"]] } }, "yes"), []);
});

test("paper P&L uses observed prices and documented yes/no settlement outcomes", () => {
  assert.ok(Math.abs(paperProfitLoss("0.45", "0.50", 2) - 0.1) < 1e-12);
  assert.ok(Math.abs(paperProfitLoss("0.45", "0.40", 2) + 0.1) < 1e-12);
  assert.equal(payoutForResult("yes", "yes"), 1);
  assert.equal(payoutForResult("no", "no"), 1);
  assert.equal(payoutForResult("yes", "no"), 0);
  assert.equal(payoutForResult("no", "yes"), 0);
  assert.equal(payoutForResult("yes", ""), null);
  assert.equal(settledPaperProfitLoss("0.45", "yes", "yes", 2), 1.1);
  assert.equal(settledPaperProfitLoss("0.45", "no", "yes", 2), -0.9);
  assert.equal(settledPaperProfitLoss("0.45", "yes", "pending", 1), null);
  assert.equal(isYesNoSettled({ status: "settled", result: "yes" }), true);
  assert.equal(isYesNoSettled({ status: "finalized", result: "no" }), true);
  assert.equal(isYesNoSettled({ status: "closed", result: "yes" }), false);
  assert.equal(isYesNoSettled({ status: "settled", result: "" }), false);
  assert.equal(isTerminalMarketStatus({ status: "finalized" }), true);
  assert.equal(isClosedOrTerminalMarket({ status: "closed" }), true);
  assert.equal(isClosedOrTerminalMarket({ status: "active" }), false);
});

test("market API source links encode a ticker as one path component", () => {
  assert.equal(
    marketApiUrl("SERIES / MARKET"),
    "https://external-api.demo.kalshi.co/trade-api/v2/markets/SERIES%20%2F%20MARKET",
  );
});
