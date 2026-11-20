export const API_BASE = "https://external-api.demo.kalshi.co/trade-api/v2";
export const ALERT_THRESHOLD_DOLLARS = 0.10;
export const MODEL_RULES = Object.freeze({
  maxYesSpread: 0.05,
  minBestLevelContracts: 5,
  acceptedMarketType: "binary",
  acceptedSettlementBounds: "default",
});

export const OFFICIAL_SOURCES = Object.freeze({
  environments: "https://docs.kalshi.com/getting_started/api_environments",
  marketData: "https://docs.kalshi.com/getting_started/quick_start_market_data",
  markets: "https://docs.kalshi.com/api-reference/market/get-markets",
  market: "https://docs.kalshi.com/api-reference/market/get-market",
  orderbook: "https://docs.kalshi.com/getting_started/orderbook_responses",
  websockets: "https://docs.kalshi.com/getting_started/quick_start_websockets",
  authentication: "https://docs.kalshi.com/getting_started/quick_start_authenticated_requests",
  pagination: "https://docs.kalshi.com/getting_started/pagination",
  settlement: "https://docs.kalshi.com/getting_started/market_settlement",
  githubPages:
    "https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages",
});

export const TOPICS = Object.freeze([
  { id: "gas-prices", label: "Gas prices", href: "topics/gas-prices.html" },
  { id: "elections", label: "Elections", href: "topics/elections.html" },
  { id: "culture", label: "Culture", href: "topics/culture.html" },
  { id: "crypto", label: "Crypto", href: "topics/crypto.html" },
  { id: "golf", label: "Golf", href: "topics/golf.html" },
]);

const TOPIC_RULES = Object.freeze([
  {
    id: "gas-prices",
    pattern: /\b(gas prices?|gasoline|petrol prices?|fuel prices?|natural gas prices?)\b/i,
  },
  {
    id: "elections",
    pattern: /\b(election|elections|president|presidential|senate|senator|governor|congress|primary|ballot|vote|voting|nominee|electoral)\b/i,
  },
  {
    id: "culture",
    pattern: /\b(culture|music|movie|movies|film|television|tv|celebrity|entertainment|oscars?|grammys?|emmys?|box office|album|pop culture)\b/i,
  },
  {
    id: "crypto",
    pattern: /\b(crypto|cryptocurrency|bitcoin|btc|ethereum|eth|solana|xrp|dogecoin|doge)\b/i,
  },
  {
    id: "golf",
    pattern: /\b(golf|pga|lpga|ryder cup)\b/i,
  },
]);

/** Parse an API numeric/fixed-point field without treating a missing value as zero. */
export function readNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Best-effort topic classifier. This is intentionally not described as Kalshi metadata. */
export function classifyTopic(market) {
  if (!market || typeof market !== "object") return null;
  const text = [
    market.title,
    market.subtitle,
    market.yes_sub_title,
    market.no_sub_title,
    market.event_ticker,
    market.ticker,
    market.series_ticker,
    market.category,
  ]
    .filter((part) => typeof part === "string" && part.trim())
    .join(" ");

  return TOPIC_RULES.find(({ pattern }) => pattern.test(text))?.id ?? null;
}

/** Return a price move only after two observed, finite YES-bid values. */
export function detectMove(previousValue, currentValue, threshold = ALERT_THRESHOLD_DOLLARS) {
  const previous = readNumber(previousValue);
  const current = readNumber(currentValue);
  const minimum = readNumber(threshold);
  if (previous === null || current === null || minimum === null || minimum < 0) return null;

  const delta = current - previous;
  if (Math.abs(delta) + Number.EPSILON < minimum) return null;
  return {
    previous,
    current,
    delta,
    direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
  };
}

/**
 * Transparent candidate screen, not an ROI or profitability prediction.
 * Required fields are read from the official market response; missing fields fail closed.
 */
export function evaluateCandidate(market, delta, rules = MODEL_RULES) {
  const reasons = [];
  const move = readNumber(delta);
  const bid = readNumber(market?.yes_bid_dollars);
  const ask = readNumber(market?.yes_ask_dollars);
  const bidSize = readNumber(market?.yes_bid_size_fp);
  const askSize = readNumber(market?.yes_ask_size_fp);

  if (move === null || Math.abs(move) + Number.EPSILON < ALERT_THRESHOLD_DOLLARS) {
    reasons.push("Observed YES-bid move is below $0.10");
  }
  if (market?.market_type !== rules.acceptedMarketType) {
    reasons.push("Market type is not confirmed as binary");
  }
  if (market?.settlement_bounds_type !== rules.acceptedSettlementBounds) {
    reasons.push("Default yes/no settlement is not confirmed");
  }
  if (bid === null || ask === null || bid < 0 || ask > 1 || ask < bid) {
    reasons.push("Valid YES bid and ask are not both available");
  } else if (ask - bid > rules.maxYesSpread + Number.EPSILON) {
    reasons.push("YES spread is wider than the screen limit");
  }
  if (bidSize === null || bidSize < rules.minBestLevelContracts) {
    reasons.push("Best YES-bid size is missing or below the screen limit");
  }
  if (askSize === null || askSize < rules.minBestLevelContracts) {
    reasons.push("Best YES-ask size is missing or below the screen limit");
  }

  return {
    eligible: reasons.length === 0,
    spread: bid !== null && ask !== null ? ask - bid : null,
    reasons,
  };
}

/** Convert the documented fixed-point orderbook arrays into best-price-first rows. */
export function orderbookLevels(orderbook, side, limit = 5) {
  if (side !== "yes" && side !== "no") return [];
  const raw = orderbook?.orderbook_fp?.[`${side}_dollars`];
  if (!Array.isArray(raw)) return [];
  const count = Number.isFinite(Number(limit)) ? Math.max(0, Math.floor(Number(limit))) : 5;

  return raw
    .map((level) => {
      if (!Array.isArray(level) || level.length < 2) return null;
      const price = readNumber(level[0]);
      const contracts = readNumber(level[1]);
      if (price === null || price < 0 || price > 1 || contracts === null || contracts < 0) return null;
      return { price, contracts };
    })
    .filter(Boolean)
    .sort((a, b) => b.price - a.price)
    .slice(0, count);
}

export function marketApiUrl(ticker) {
  return `${API_BASE}/markets/${encodeURIComponent(String(ticker ?? ""))}`;
}

export function orderbookApiUrl(ticker) {
  return `${marketApiUrl(ticker)}/orderbook`;
}

export function payoutForResult(positionSide, result) {
  const side = String(positionSide ?? "").toLowerCase();
  const outcome = String(result ?? "").toLowerCase();
  if (!["yes", "no"].includes(side) || !["yes", "no"].includes(outcome)) return null;
  return side === outcome ? 1 : 0;
}

export function paperProfitLoss(entryPrice, markPrice, contracts = 1) {
  const entry = readNumber(entryPrice);
  const mark = readNumber(markPrice);
  const quantity = readNumber(contracts);
  if (entry === null || mark === null || quantity === null || quantity < 0) return null;
  return (mark - entry) * quantity;
}

export function settledPaperProfitLoss(entryPrice, positionSide, result, contracts = 1) {
  const entry = readNumber(entryPrice);
  const quantity = readNumber(contracts);
  const payout = payoutForResult(positionSide, result);
  if (entry === null || quantity === null || quantity < 0 || payout === null) return null;
  return (payout - entry) * quantity;
}

export function isTerminalMarketStatus(market) {
  // `finalized` has been observed in official demo responses to a settled-market query.
  // Keep the raw status visible in the UI; this helper only gates result/payout handling.
  return ["settled", "finalized"].includes(String(market?.status ?? "").toLowerCase());
}

export function isClosedOrTerminalMarket(market) {
  const status = String(market?.status ?? "").toLowerCase();
  return status === "closed" || isTerminalMarketStatus(market);
}

export function isYesNoSettled(market) {
  return (
    isTerminalMarketStatus(market) &&
    ["yes", "no"].includes(String(market?.result ?? "").toLowerCase())
  );
}
