import {
  ALERT_THRESHOLD_DOLLARS,
  API_BASE,
  MODEL_RULES,
  OFFICIAL_SOURCES,
  TOPICS,
  classifyTopic,
  detectMove,
  evaluateCandidate,
  isClosedOrTerminalMarket,
  isTerminalMarketStatus,
  isYesNoSettled,
  marketApiUrl,
  orderbookApiUrl,
  orderbookLevels,
  paperProfitLoss,
  readNumber,
  settledPaperProfitLoss,
} from "./logic.js";

const POLL_INTERVAL_MS = 30_000;
const DISCOVERY_INTERVAL_MS = 5 * 60_000;
const RESOLUTION_INTERVAL_MS = 60_000;
const MAX_OPEN_MARKET_PAGES = 20;
const PAGE_SIZE = 1000;
const TICKER_BATCH_SIZE = 100;
const MAX_RESOLUTION_BATCHES_PER_POLL = 5;
const MAX_ALERTS = 100;
const MAX_PAPER_TRADES = 2_000;
const MAX_TRACKED_MARKETS = 5_000;
const MAX_CHART_POINTS = 2_000;
const CATEGORY = document.body.dataset.category || "all";

const STORAGE_KEYS = Object.freeze({
  alerts: "market-lens.kalshi-demo.alerts.v1",
  candidates: "market-lens.kalshi-demo.candidates.v1",
  tracked: "market-lens.kalshi-demo.tracked.v1",
  paperTrades: "market-lens.kalshi-demo.paper-trades.v1",
  settings: "market-lens.kalshi-demo.settings.v1",
});

const $ = (id) => document.getElementById(id);
const state = {
  liveMarkets: new Map(),
  trackedMarkets: new Map(),
  previousYesBids: new Map(),
  chartHistory: new Map(),
  alerts: readList(STORAGE_KEYS.alerts).slice(0, MAX_ALERTS),
  candidates: readList(STORAGE_KEYS.candidates).slice(0, MAX_ALERTS),
  paperTrades: readList(STORAGE_KEYS.paperTrades).slice(0, MAX_PAPER_TRADES),
  settings: readSettings(),
  selectedTicker: "",
  lastDiscoveryAt: 0,
  lastSuccessfulSnapshotAt: 0,
  lastResolutionPollAt: 0,
  openListComplete: false,
  refreshing: false,
  orderbookRequest: 0,
};

for (const item of readObjectValues(STORAGE_KEYS.tracked)) {
  if (item && item.ticker) state.trackedMarkets.set(item.ticker, item);
}

function readJSON(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function readList(key) {
  const value = readJSON(key, []);
  return Array.isArray(value) ? value : [];
}

function readObjectValues(key) {
  const value = readJSON(key, {});
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.values(value)
    : [];
}

function readSettings() {
  const stored = readJSON(STORAGE_KEYS.settings, {});
  const strategyMode = ["both", "momentum", "mean-reversion"].includes(stored?.strategyMode)
    ? stored.strategyMode
    : "both";
  const quantity = Number.isInteger(Number(stored?.quantity))
    ? Math.min(20, Math.max(1, Number(stored.quantity)))
    : 1;
  return {
    autoPaper: typeof stored?.autoPaper === "boolean" ? stored.autoPaper : true,
    strategyMode,
    quantity,
  };
}

function persistTrackedMarkets() {
  const records = [...state.trackedMarkets.values()].slice(-MAX_TRACKED_MARKETS);
  const store = Object.fromEntries(records.map((item) => [item.ticker, item]));
  writeJSON(STORAGE_KEYS.tracked, store);
}

function persistAlerts() {
  state.alerts = state.alerts.slice(0, MAX_ALERTS);
  state.candidates = state.candidates.slice(0, MAX_ALERTS);
  writeJSON(STORAGE_KEYS.alerts, state.alerts);
  writeJSON(STORAGE_KEYS.candidates, state.candidates);
}

function persistPaperTrades() {
  state.paperTrades = state.paperTrades.slice(0, MAX_PAPER_TRADES);
  writeJSON(STORAGE_KEYS.paperTrades, state.paperTrades);
}

function persistSettings() {
  writeJSON(STORAGE_KEYS.settings, state.settings);
}

function makeElement(tag, className = "", text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== "") element.textContent = text;
  return element;
}

function addOfficialLink(parent, href, label = "Official API ↗", className = "source-link") {
  const link = makeElement("a", className, label);
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  parent.append(link);
  return link;
}

function labelForTopic(topicId) {
  return TOPICS.find((topic) => topic.id === topicId)?.label ?? "Unclassified";
}

function localTime(value, options = {}) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleString(undefined, options);
}

function formatPrice(value) {
  const number = readNumber(value);
  return number === null
    ? "—"
    : `$${number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
}

function formatDollarValue(value) {
  const number = readNumber(value);
  if (number === null) return "—";
  const sign = number > 0 ? "+" : number < 0 ? "−" : "";
  const formatted = Math.abs(number).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  return `${sign}$${formatted}`;
}

function formatContracts(value) {
  const number = readNumber(value);
  return number === null
    ? "—"
    : number.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function formatSignedMoney(value) {
  const number = readNumber(value);
  if (number === null) return "—";
  const sign = number > 0 ? "+" : number < 0 ? "−" : "";
  const formatted = Math.abs(number).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  return `${sign}$${formatted}`;
}

function setConnection(kind, label, detail = "") {
  const dot = $("connectionDot");
  const heading = $("connectionLabel");
  const updated = $("lastUpdated");
  if (dot) dot.className = `connection-dot ${kind}`;
  if (heading) heading.textContent = label;
  if (updated && detail) updated.textContent = detail;
}

function announce(message) {
  const target = $("announcer");
  if (target) target.textContent = message;
}

function currentPageMarkets() {
  const all = [...state.liveMarkets.values()];
  return CATEGORY === "all" ? all : all.filter((market) => market.topic === CATEGORY);
}

function setPageCopy() {
  const title = $("pageTitle");
  const description = $("pageDescription");
  if (CATEGORY === "all") return;
  const topic = TOPICS.find((item) => item.id === CATEGORY);
  if (!topic) return;
  document.title = `Kalshi Demo Monitor · ${topic.label}`;
  if (title) title.textContent = `${topic.label} markets`;
  if (description) {
    description.textContent = `Open Kalshi demo markets matched to ${topic.label.toLowerCase()}. Text matching is a best-effort filter, not an official Kalshi category.`;
  }
}

function setActiveNavigation() {
  document.querySelectorAll("[data-nav-category]").forEach((link) => {
    const active = link.dataset.navCategory === CATEGORY;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function addCell(row, text, className = "") {
  const cell = makeElement("td", className, text);
  row.append(cell);
  return cell;
}

function marketIsFreshForDisplay(market) {
  return market.quoteFresh !== false;
}

function renderMarkets() {
  const body = $("marketRows");
  if (!body) return;
  const markets = currentPageMarkets();
  const topicOrder = new Map(TOPICS.map((topic, index) => [topic.id, index]));
  const grouped = new Map();

  for (const market of markets) {
    const eventTicker = market.event_ticker || market.ticker;
    const key = `${market.topic}::${eventTicker}`;
    if (!grouped.has(key)) grouped.set(key, { topic: market.topic, eventTicker, markets: [] });
    grouped.get(key).markets.push(market);
  }

  const groups = [...grouped.values()];
  for (const group of groups) {
    group.markets.sort((a, b) => {
      const left = marketIsFreshForDisplay(a) ? readNumber(a.volume_24h_fp) ?? -1 : -1;
      const right = marketIsFreshForDisplay(b) ? readNumber(b.volume_24h_fp) ?? -1 : -1;
      return right - left || String(a.ticker).localeCompare(String(b.ticker));
    });
    group.maxVolume = group.markets.reduce((maximum, market) => {
      const volume = marketIsFreshForDisplay(market) ? readNumber(market.volume_24h_fp) ?? -1 : -1;
      return Math.max(maximum, volume);
    }, -1);
  }
  groups.sort((a, b) =>
    b.maxVolume - a.maxVolume ||
    (topicOrder.get(a.topic) ?? 99) - (topicOrder.get(b.topic) ?? 99) ||
    a.eventTicker.localeCompare(b.eventTicker),
  );

  body.replaceChildren();
  if (markets.length === 0) {
    const row = makeElement("tr");
    const cell = makeElement(
      "td",
      "empty-cell",
      state.lastSuccessfulSnapshotAt
        ? "No matching open markets were returned for this topic. No example values are substituted."
        : "Waiting for the official Kalshi demo API response…",
    );
    cell.colSpan = 10;
    row.append(cell);
    body.append(row);
  } else {
    for (const group of groups) {
      const groupRow = makeElement("tr", "event-group-row");
      const groupCell = makeElement("td");
      groupCell.colSpan = 10;
      const topicTag = makeElement("span", "topic-tag", labelForTopic(group.topic));
      const eventName = makeElement("strong", "event-group-name", group.eventTicker);
      const count = makeElement("span", "event-group-count", `${group.markets.length} market${group.markets.length === 1 ? "" : "s"}`);
      groupCell.append(topicTag, eventName, count);
      groupRow.append(groupCell);
      body.append(groupRow);

      for (const market of group.markets) {
        const row = makeElement("tr", "market-row");
        row.dataset.marketRow = market.ticker;
        if (market.ticker === state.selectedTicker) row.classList.add("selected-row");

        const marketCell = makeElement("td", "market-name-cell");
        const selectButton = makeElement("button", "market-select", market.title || market.ticker || "Untitled market");
        selectButton.type = "button";
        selectButton.dataset.selectMarket = market.ticker;
        selectButton.setAttribute("aria-label", `Select market ${market.title || market.ticker}`);
        marketCell.append(selectButton);
        const tickerLine = makeElement("span", "market-ticker", market.ticker || "");
        const eventLine = makeElement("span", "market-event", `Event ${market.event_ticker || "—"}`);
        marketCell.append(tickerLine, eventLine);
        row.append(marketCell);

        const topicCell = makeElement("td", "topic-cell");
        topicCell.append(makeElement("span", "topic-cell-label", labelForTopic(market.topic)));
        if (market.topicMatchStale) {
          topicCell.append(makeElement("span", "unverified-chip resolution-status-note", "Last match"));
        }
        row.append(topicCell);
        const fresh = marketIsFreshForDisplay(market);
        addCell(row, fresh ? formatPrice(market.yes_bid_dollars) : "—", "numeric-cell");
        addCell(row, fresh ? formatPrice(market.yes_ask_dollars) : "—", "numeric-cell");
        addCell(row, fresh ? formatContracts(market.yes_bid_size_fp) : "—", "numeric-cell");
        addCell(row, fresh ? formatContracts(market.yes_ask_size_fp) : "—", "numeric-cell");
        addCell(row, fresh ? formatContracts(market.volume_24h_fp) : "—", "numeric-cell");

        const notionalCell = makeElement("td", "numeric-cell");
        const unverified = makeElement("span", "unverified-chip", "Unverified");
        unverified.title = "No aggregate dollar notional is displayed; the field semantics are not verified for this ranking.";
        notionalCell.append(unverified);
        row.append(notionalCell);

        const statusCell = makeElement("td", "status-cell");
        const status = String(market.status ?? "").trim();
        statusCell.append(makeElement("span", "raw-status", status || "Unverified"));
        if (!status) statusCell.classList.add("text-warning");
        if (!fresh) {
          statusCell.append(makeElement("span", "unverified-chip resolution-status-note", "No fresh quote"));
        }
        row.append(statusCell);

        const sourceCell = makeElement("td");
        addOfficialLink(sourceCell, marketApiUrl(market.ticker), "Market API ↗", "source-link source-link-table");
        row.append(sourceCell);
        body.append(row);
      }
    }
  }

  body.querySelectorAll("[data-select-market]").forEach((button) => {
    button.addEventListener("click", () => selectMarket(button.dataset.selectMarket));
  });

  const count = $("marketCount");
  if (count) count.textContent = markets.length.toLocaleString();
  const rawCount = state.lastOpenMarketCount;
  const countNote = $("marketCountNote");
  if (countNote) {
    countNote.textContent = state.lastSuccessfulSnapshotAt === 0
      ? "Waiting for the official open-market response"
      : `${rawCount?.toLocaleString() ?? "—"} markets in the last open-list scan${state.openListComplete ? "" : " · partial list"}`;
  }

  const topVolumeNode = $("topVolume");
  const topVolumeNote = $("topVolumeNote");
  const highestVolume = markets
    .filter((market) => marketIsFreshForDisplay(market))
    .map((market) => ({ market, volume: readNumber(market.volume_24h_fp) }))
    .filter((item) => item.volume !== null)
    .sort((a, b) => b.volume - a.volume)[0];
  if (topVolumeNode) topVolumeNode.textContent = highestVolume ? formatContracts(highestVolume.volume) : "—";
  if (topVolumeNote) {
    topVolumeNote.textContent = highestVolume
      ? `Contracts · ${highestVolume.market.title || highestVolume.market.ticker}`
      : "No confirmed 24h contract-volume value";
  }

  const tableStatus = $("marketTableStatus");
  if (tableStatus) {
    const time = state.lastSuccessfulSnapshotAt ? localTime(state.lastSuccessfulSnapshotAt, { hour: "numeric", minute: "2-digit", second: "2-digit" }) : "—";
    tableStatus.textContent = `${markets.length.toLocaleString()} matching markets shown · last successful snapshot ${time}${state.openListComplete ? "" : " · listing may be partial"}`;
  }

  const isSelectionVisible = markets.some((market) => market.ticker === state.selectedTicker);
  if (!isSelectionVisible) state.selectedTicker = markets[0]?.ticker || "";
  const selectedMarket = state.liveMarkets.get(state.selectedTicker);
  const selectedHistory = state.chartHistory.get(state.selectedTicker) || [];
  if (selectedMarket && selectedHistory.length === 0) {
    appendChartPoint(selectedMarket, selectedMarket.lastObservedAt || Date.now());
  }
  updateSelectedMarketLabels();
  drawChart();
}

function updateSelectedMarketLabels() {
  const market = state.liveMarkets.get(state.selectedTicker);
  const selectedLabel = $("selectedMarketLabel");
  const bookLabel = $("orderbookMarketLabel");
  if (selectedLabel) selectedLabel.textContent = market ? `${market.title || market.ticker} · ${market.ticker}` : "Select a market row to start a chart.";
  if (bookLabel) bookLabel.textContent = market ? `${market.title || market.ticker} · ${market.ticker}` : "Select a market to load its book.";
  const source = $("orderbookSource");
  if (source) {
    source.href = market ? orderbookApiUrl(market.ticker) : OFFICIAL_SOURCES.orderbook;
    source.textContent = market ? "Market book ↗" : "API guide ↗";
  }
}

function visibleAlerts(items) {
  return items.filter((item) => CATEGORY === "all" || item.topic === CATEGORY).slice(0, MAX_ALERTS);
}

function renderAlertFeed(container, items, emptyText, isCandidate = false) {
  if (!container) return;
  const wasNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 60;
  const previousScrollTop = container.scrollTop;
  const filtered = visibleAlerts(items).slice(0, 50).reverse();
  container.replaceChildren();
  if (filtered.length === 0) {
    container.append(makeElement("div", "feed-empty", emptyText));
    return;
  }

  for (const item of filtered) {
    const card = makeElement("article", `chat-item ${item.delta >= 0 ? "chat-item-up" : "chat-item-down"}`);
    const head = makeElement("div", "chat-item-head");
    const direction = item.delta >= 0 ? "▲" : "▼";
    const directionText = `${direction} ${formatDollarValue(item.delta)}`;
    const move = makeElement("strong", "chat-move", directionText);
    const time = makeElement("time", "chat-time", localTime(item.observedAt, { hour: "numeric", minute: "2-digit", second: "2-digit" }));
    if (item.observedAt) time.dateTime = item.observedAt;
    head.append(move, time);

    const topic = makeElement("span", "chat-topic", labelForTopic(item.topic));
    const title = makeElement("p", "chat-title", item.title || item.ticker || "Market");
    const prices = makeElement("p", "chat-prices", `${formatPrice(item.previous)} → ${formatPrice(item.current)} YES bid`);
    const foot = makeElement("div", "chat-item-foot");
    const note = makeElement("span", "cause-unverified", isCandidate ? "Cause not verified · screen passed" : "Cause not verified");
    foot.append(note);
    addOfficialLink(foot, marketApiUrl(item.ticker), "Market record ↗", "source-link");
    const newsSearch = makeElement("a", "source-link", "News search · context only ↗");
    newsSearch.href = `https://news.google.com/search?q=${encodeURIComponent(`${item.title || item.ticker} market news`)}`;
    newsSearch.target = "_blank";
    newsSearch.rel = "noopener noreferrer";
    foot.append(newsSearch);
    card.append(head, topic, title, prices, foot);
    container.append(card);
  }
  container.scrollTop = wasNearBottom ? container.scrollHeight : previousScrollTop;
}

function renderAlerts() {
  const all = visibleAlerts(state.alerts);
  const candidate = visibleAlerts(state.candidates);
  const allCount = $("allAlertCount");
  const candidateCount = $("candidateCount");
  const moveCount = $("moveCount");
  if (allCount) allCount.textContent = String(all.length);
  if (candidateCount) candidateCount.textContent = String(candidate.length);
  if (moveCount) moveCount.textContent = String(all.length);
  renderAlertFeed($("allAlerts"), state.alerts, "No qualifying sampled moves yet.");
  renderAlertFeed($("candidateAlerts"), state.candidates, "No move has passed the transparent screen.", true);
}

function appendPriceAlert(market, move, now, candidateResult) {
  const alert = {
    ticker: market.ticker,
    eventTicker: market.event_ticker || "",
    title: market.title || market.ticker,
    topic: market.topic,
    previous: move.previous,
    current: move.current,
    delta: move.delta,
    observedAt: new Date(now).toISOString(),
  };
  state.alerts.unshift(alert);
  state.alerts = state.alerts.slice(0, MAX_ALERTS);

  if (candidateResult?.eligible) {
    state.candidates.unshift({ ...alert, spread: candidateResult.spread });
    state.candidates = state.candidates.slice(0, MAX_ALERTS);
  }

  persistAlerts();
  renderAlerts();
  const message = `${labelForTopic(market.topic)}: ${market.title || market.ticker} YES bid moved ${formatPrice(move.previous)} to ${formatPrice(move.current)}.`;
  announce(message);
}

function appendChartPoint(market, observedAt) {
  if (!market || market.ticker !== state.selectedTicker) return;
  const price = readNumber(market.yes_bid_dollars);
  if (price === null || price < 0 || price > 1) return;
  const points = state.chartHistory.get(market.ticker) || [];
  const timestamp = Number(observedAt) || Date.now();
  if (points.length && points[points.length - 1].time === timestamp) return;
  points.push({ time: timestamp, price });
  const cutoff = timestamp - 24 * 60 * 60_000;
  state.chartHistory.set(
    market.ticker,
    points.filter((point) => point.time >= cutoff).slice(-MAX_CHART_POINTS),
  );
  drawChart();
}

function drawChart() {
  const canvas = $("priceChart");
  if (!canvas) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(280, bounds.width);
  const height = Math.max(180, bounds.height);
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const margin = { left: 52, right: 14, top: 12, bottom: 34 };
  const plotWidth = Math.max(1, width - margin.left - margin.right);
  const plotHeight = Math.max(1, height - margin.top - margin.bottom);
  const rangeSeconds = Number($("chartRange")?.value || 300);
  const now = Date.now();
  const start = now - rangeSeconds * 1000;
  const points = (state.chartHistory.get(state.selectedTicker) || []).filter(
    (point) => point.time >= start && point.time <= now && point.price >= 0 && point.price <= 1,
  );

  context.font = "11px system-ui, sans-serif";
  context.lineWidth = 1;
  context.strokeStyle = "rgba(135, 161, 163, .15)";
  context.fillStyle = "#819496";
  for (let index = 0; index <= 4; index += 1) {
    const value = 1 - index * 0.25;
    const y = margin.top + index * (plotHeight / 4);
    context.beginPath();
    context.moveTo(margin.left, y);
    context.lineTo(width - margin.right, y);
    context.stroke();
    context.fillText(`$${value.toFixed(2)}`, 4, y + 4);
  }

  const timeLabel = (timestamp) => {
    const date = new Date(timestamp);
    const options = rangeSeconds <= 300
      ? { hour: "2-digit", minute: "2-digit", second: "2-digit" }
      : { hour: "2-digit", minute: "2-digit" };
    return date.toLocaleTimeString(undefined, options);
  };
  context.fillText(timeLabel(start), margin.left, height - 8);
  const endLabel = timeLabel(now);
  const endWidth = context.measureText(endLabel).width;
  context.fillText(endLabel, width - margin.right - endWidth, height - 8);

  const empty = $("chartEmpty");
  if (points.length === 0) {
    if (empty) {
      empty.hidden = false;
      empty.textContent = state.selectedTicker ? "Waiting for a confirmed YES-bid sample…" : "Select a market row to start a chart.";
    }
    return;
  }
  if (empty) {
    empty.hidden = points.length >= 2;
    empty.textContent = "Collecting samples while this market is selected…";
  }

  context.strokeStyle = "#58d8ad";
  context.fillStyle = "#58d8ad";
  context.lineWidth = 2;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.beginPath();
  points.forEach((point, index) => {
    const x = margin.left + ((point.time - start) / (rangeSeconds * 1000)) * plotWidth;
    const y = margin.top + (1 - point.price) * plotHeight;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
  const last = points[points.length - 1];
  const lastX = margin.left + ((last.time - start) / (rangeSeconds * 1000)) * plotWidth;
  const lastY = margin.top + (1 - last.price) * plotHeight;
  context.beginPath();
  context.arc(lastX, lastY, 3.5, 0, Math.PI * 2);
  context.fill();
}

function selectMarket(ticker) {
  if (!ticker) return;
  state.selectedTicker = ticker;
  document.querySelectorAll("[data-market-row]").forEach((row) => {
    row.classList.toggle("selected-row", row.dataset.marketRow === ticker);
  });
  const market = state.liveMarkets.get(ticker);
  if (market) appendChartPoint(market, market.lastObservedAt || Date.now());
  updateSelectedMarketLabels();
  drawChart();
  void refreshOrderbook();
}

function makeAlertRecord(market, move, now) {
  const candidate = evaluateCandidate(market, move.delta, MODEL_RULES);
  appendPriceAlert(market, move, now, candidate);
  if (candidate.eligible) runPaperStrategies(market, move, now);
}

function processMarketUpdate(market, now, { canAlert = true, isInitial = false } = {}) {
  const ticker = market?.ticker;
  if (!ticker) return;
  const current = readNumber(market.yes_bid_dollars);
  if (current === null || current < 0 || current > 1) {
    state.previousYesBids.delete(ticker);
    return;
  }

  const previous = state.previousYesBids.get(ticker);
  if (canAlert && !isInitial && previous !== undefined) {
    const move = detectMove(previous, current, ALERT_THRESHOLD_DOLLARS);
    if (move) makeAlertRecord(market, move, now);
  }
  state.previousYesBids.set(ticker, current);
  if (ticker === state.selectedTicker) appendChartPoint(market, now);
  updateOpenPaperMarks(market);
}

function trackerRecord(market, topic, now) {
  const ticker = market?.ticker;
  if (!ticker) return null;
  const existing = state.trackedMarkets.get(ticker) || {};
  const record = {
    ticker,
    event_ticker: market.event_ticker || existing.event_ticker || "",
    title: market.title || existing.title || ticker,
    topic: topic || existing.topic || classifyTopic(market),
    status: market.status ?? existing.status ?? "",
    result: market.result ?? existing.result ?? "",
    market_type: market.market_type ?? existing.market_type ?? "",
    settlement_bounds_type: market.settlement_bounds_type ?? existing.settlement_bounds_type ?? "",
    settlement_ts: market.settlement_ts ?? existing.settlement_ts ?? "",
    lastObservedAt: new Date(now).toISOString(),
    lastCheckedAt: existing.lastCheckedAt || "",
    outsideOpenList: existing.outsideOpenList || false,
    needsStatusCheck: existing.needsStatusCheck || false,
  };
  state.trackedMarkets.set(ticker, record);
  return record;
}

function settlePaperTrades(market, now) {
  if (!isYesNoSettled(market)) return;
  let changed = false;
  for (const trade of state.paperTrades) {
    if (trade.ticker !== market.ticker || trade.status !== "open") continue;
    if (trade.marketType !== "binary" || trade.settlementBoundsType !== "default") continue;
    if (market.market_type !== "binary" || market.settlement_bounds_type !== "default") continue;
    const pnl = settledPaperProfitLoss(trade.entryPrice, trade.side, market.result, trade.quantity);
    if (pnl === null) continue;
    trade.status = "settled";
    trade.result = String(market.result).toLowerCase();
    trade.settlementPnl = pnl;
    trade.payout = trade.result === trade.side ? 1 : 0;
    trade.resolvedAt = market.settlement_ts || new Date(now).toISOString();
    trade.lastObservedAt = new Date(now).toISOString();
    changed = true;
  }
  if (changed) {
    persistPaperTrades();
    renderPaperLab();
  }
}

function recordTrackedMarket(market, topic, now) {
  const record = trackerRecord(market, topic, now);
  if (!record) return;
  settlePaperTrades(market, now);
  persistTrackedMarkets();
}

function openPaperStrategies() {
  if (state.settings.strategyMode === "momentum") return ["momentum"];
  if (state.settings.strategyMode === "mean-reversion") return ["mean-reversion"];
  return ["momentum", "mean-reversion"];
}

function runPaperStrategies(market, move, now) {
  if (!state.settings.autoPaper) return;
  const strategies = openPaperStrategies();
  const alreadyTraded = new Set(
    state.paperTrades
      .filter((trade) => trade.ticker === market.ticker)
      .map((trade) => trade.strategy),
  );
  const quantity = state.settings.quantity;
  const created = [];

  for (const strategy of strategies) {
    if (alreadyTraded.has(strategy)) continue;
    const directionUp = move.delta > 0;
    const side = strategy === "momentum"
      ? (directionUp ? "yes" : "no")
      : (directionUp ? "no" : "yes");
    const entryPrice = readNumber(side === "yes" ? market.yes_ask_dollars : market.no_ask_dollars);
    if (entryPrice === null || entryPrice < 0 || entryPrice > 1) continue;

    const trade = {
      id: `${market.ticker}:${strategy}:${now}`,
      ticker: market.ticker,
      eventTicker: market.event_ticker || "",
      title: market.title || market.ticker,
      topic: market.topic,
      strategy,
      side,
      quantity,
      entryPrice,
      entryAt: new Date(now).toISOString(),
      signalDelta: move.delta,
      signalPrevious: move.previous,
      signalCurrent: move.current,
      status: "open",
      markPrice: readNumber(side === "yes" ? market.yes_bid_dollars : market.no_bid_dollars),
      marketType: market.market_type,
      settlementBoundsType: market.settlement_bounds_type,
      marketStatus: market.status || "",
      sourceUrl: marketApiUrl(market.ticker),
    };
    state.paperTrades.unshift(trade);
    alreadyTraded.add(strategy);
    created.push(`${strategy} ${side.toUpperCase()}`);
  }

  if (created.length) {
    persistPaperTrades();
    const status = $("paperStatus");
    if (status) status.textContent = `Auto paper only: recorded ${created.join(" and ")} for ${market.ticker}; no order was sent.`;
    renderPaperLab();
  } else if (strategies.some((strategy) => !alreadyTraded.has(strategy))) {
    const status = $("paperStatus");
    if (status) status.textContent = `Candidate passed, but no confirmed ask was available for a paper entry in ${market.ticker}.`;
  }
}

function updateOpenPaperMarks(market) {
  let changed = false;
  for (const trade of state.paperTrades) {
    if (trade.ticker !== market.ticker || trade.status !== "open") continue;
    const previousStatus = trade.marketStatus;
    trade.marketStatus = market.status || previousStatus || "";
    const mark = readNumber(trade.side === "yes" ? market.yes_bid_dollars : market.no_bid_dollars);
    if (mark !== null) trade.markPrice = mark;
    if (mark !== null || trade.marketStatus !== previousStatus) {
      trade.lastObservedAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) {
    persistPaperTrades();
    renderStrategyStats();
    renderPaperSummaryAndRows();
  }
}

function renderStrategyStats() {
  const body = $("strategyRows");
  if (!body) return;
  body.replaceChildren();
  const trades = CATEGORY === "all"
    ? state.paperTrades
    : state.paperTrades.filter((trade) => trade.topic === CATEGORY);
  const strategies = [
    { id: "momentum", label: "Momentum" },
    { id: "mean-reversion", label: "Mean reversion" },
  ];

  for (const strategy of strategies) {
    const matching = trades.filter((trade) => trade.strategy === strategy.id);
    const settled = matching.filter((trade) => trade.status === "settled" && readNumber(trade.settlementPnl) !== null);
    const open = matching.filter((trade) => trade.status === "open");
    const realized = settled.reduce((sum, trade) => sum + Number(trade.settlementPnl), 0);
    const openValues = open.map((trade) => paperProfitLoss(trade.entryPrice, trade.markPrice, trade.quantity));
    const openPnl = openValues.some((value) => value === null)
      ? null
      : openValues.reduce((sum, value) => sum + value, 0);

    const row = makeElement("tr");
    addCell(row, strategy.label);
    addCell(row, String(matching.length), "numeric-cell");
    addCell(row, String(settled.length), "numeric-cell");
    addCell(row, settled.length ? formatSignedMoney(realized) : "—", "numeric-cell");
    addCell(row, open.length && openPnl !== null ? formatSignedMoney(openPnl) : "—", "numeric-cell");
    const sourceCell = makeElement("td");
    addOfficialLink(sourceCell, OFFICIAL_SOURCES.settlement, "Payout rule ↗", "source-link");
    row.append(sourceCell);
    body.append(row);
  }
}

function renderPaperSummaryAndRows() {
  const body = $("paperRows");
  const trades = CATEGORY === "all"
    ? state.paperTrades
    : state.paperTrades.filter((trade) => trade.topic === CATEGORY);
  const open = trades.filter((trade) => trade.status === "open");
  const settled = trades.filter((trade) => trade.status === "settled" && readNumber(trade.settlementPnl) !== null);
  const realized = settled.reduce((sum, trade) => sum + Number(trade.settlementPnl), 0);
  const marks = open.map((trade) => paperProfitLoss(trade.entryPrice, trade.markPrice, trade.quantity));
  const openPnl = marks.some((value) => value === null) ? null : marks.reduce((sum, value) => sum + value, 0);

  if ($("openPositionCount")) $("openPositionCount").textContent = String(open.length);
  if ($("realizedPnl")) $("realizedPnl").textContent = settled.length ? formatSignedMoney(realized) : "—";
  if ($("unrealizedPnl")) $("unrealizedPnl").textContent = open.length && openPnl !== null ? formatSignedMoney(openPnl) : "—";
  if (!body) return;

  body.replaceChildren();
  if (trades.length === 0) {
    const row = makeElement("tr");
    const cell = makeElement("td", "empty-cell", "No paper entries have been generated.");
    cell.colSpan = 10;
    row.append(cell);
    body.append(row);
    return;
  }

  for (const trade of trades.slice(0, 100)) {
    const row = makeElement("tr");
    const marketCell = makeElement("td", "market-name-cell");
    marketCell.append(
      makeElement("span", "trade-time", localTime(trade.entryAt, { dateStyle: "short", timeStyle: "short" })),
      makeElement("span", "market-ticker", trade.title || trade.ticker),
      makeElement("span", "market-event", trade.ticker),
    );
    row.append(marketCell);
    addCell(row, labelForTopic(trade.topic));
    addCell(row, trade.strategy === "momentum" ? "Momentum" : "Mean reversion");
    addCell(row, String(trade.side || "").toUpperCase());
    addCell(row, formatContracts(trade.quantity), "numeric-cell");
    addCell(row, formatPrice(trade.entryPrice), "numeric-cell");
    const markValue = trade.status === "settled"
      ? (readNumber(trade.payout) === null ? "—" : formatPrice(trade.payout))
      : formatPrice(trade.markPrice);
    addCell(row, markValue, "numeric-cell");
    const pnl = trade.status === "settled"
      ? readNumber(trade.settlementPnl)
      : paperProfitLoss(trade.entryPrice, trade.markPrice, trade.quantity);
    addCell(row, pnl === null ? "—" : formatSignedMoney(pnl), "numeric-cell");
    const marketStatus = String(trade.marketStatus || "").toLowerCase();
    const paperState = trade.status === "settled"
      ? `Settled ${String(trade.result || "").toUpperCase()}`
      : marketStatus === "closed"
        ? "Awaiting result"
        : ["settled", "finalized"].includes(marketStatus)
          ? "Outcome unverified"
          : "Open · simulated";
    addCell(row, paperState, "status-cell");
    const sourceCell = makeElement("td");
    addOfficialLink(sourceCell, marketApiUrl(trade.ticker), "Market API ↗", "source-link");
    row.append(sourceCell);
    body.append(row);
  }
}

function renderPaperLab() {
  const toggle = $("autoPaperToggle");
  const mode = $("strategyMode");
  const quantity = $("paperQuantity");
  if (toggle) toggle.checked = state.settings.autoPaper;
  if (mode) mode.value = state.settings.strategyMode;
  if (quantity) quantity.value = String(state.settings.quantity);
  renderStrategyStats();
  renderPaperSummaryAndRows();
}

function renderResolutionTracker() {
  const body = $("resolutionRows");
  const count = $("resolutionCount");
  if (!body) return;
  const rows = [...state.trackedMarkets.values()]
    .filter((item) => !state.liveMarkets.has(item.ticker))
    .filter((item) => CATEGORY === "all" || item.topic === CATEGORY)
    .sort((a, b) => String(b.lastObservedAt || "").localeCompare(String(a.lastObservedAt || "")))
    .slice(0, 250);
  if (count) count.textContent = `${rows.length} tracked`;
  body.replaceChildren();

  if (rows.length === 0) {
    const row = makeElement("tr");
    const cell = makeElement("td", "empty-cell", "No closed or settled markets have been observed yet.");
    cell.colSpan = 6;
    row.append(cell);
    body.append(row);
    return;
  }

  for (const market of rows) {
    const row = makeElement("tr");
    const marketCell = makeElement("td", "market-name-cell");
    marketCell.append(
      makeElement("span", "market-ticker", market.title || market.ticker),
      makeElement("span", "market-event", `${market.ticker} · Event ${market.event_ticker || "—"}`),
    );
    row.append(marketCell);
    addCell(row, labelForTopic(market.topic));
    const status = String(market.status || "").trim();
    const statusCell = makeElement("td", status ? "status-cell" : "status-cell text-warning");
    statusCell.append(makeElement("span", "raw-status", status || "Unverified"));
    const isTerminal = isTerminalMarketStatus(market);
    if (market.outsideOpenList && !isClosedOrTerminalMarket(market)) {
      statusCell.append(makeElement("span", "unverified-chip resolution-status-note", "Not in current open response"));
    }
    if (status.toLowerCase() === "closed" && !["yes", "no"].includes(String(market.result || "").toLowerCase())) {
      statusCell.append(makeElement("span", "unverified-chip resolution-status-note", "Awaiting result"));
    }
    if (isTerminal && !["yes", "no"].includes(String(market.result || "").toLowerCase())) {
      statusCell.append(makeElement("span", "unverified-chip resolution-status-note", "Result unverified"));
    }
    if (market.needsStatusCheck && !isClosedOrTerminalMarket(market)) {
      statusCell.append(makeElement("span", "unverified-chip resolution-status-note", "Status check pending"));
    }
    if (market.notReturnedByTickerQuery) {
      statusCell.append(makeElement("span", "unverified-chip resolution-status-note", "Ticker lookup omitted"));
    }
    row.append(statusCell);
    const result = String(market.result || "").toLowerCase();
    addCell(row, isYesNoSettled(market) ? result.toUpperCase() : "—", "result-cell");
    addCell(row, localTime(market.lastObservedAt, { dateStyle: "short", timeStyle: "short" }));
    const sourceCell = makeElement("td");
    addOfficialLink(sourceCell, marketApiUrl(market.ticker), "Market API ↗", "source-link");
    row.append(sourceCell);
    body.append(row);
  }
}

function renderAll() {
  renderMarkets();
  renderAlerts();
  renderPaperLab();
  renderResolutionTracker();
}

async function getJson(url) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    window.clearTimeout(timeout);
  }
}

function makeApiUrl(path, parameters = {}) {
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== null && value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function fetchOpenMarkets() {
  const markets = [];
  const seenTickers = new Set();
  const seenCursors = new Set();
  let cursor = "";
  let complete = false;
  let pages = 0;

  while (pages < MAX_OPEN_MARKET_PAGES) {
    const url = makeApiUrl("/markets", { status: "open", limit: PAGE_SIZE, cursor });
    const payload = await getJson(url);
    if (!Array.isArray(payload?.markets)) throw new Error("Unexpected Get Markets response: no markets array");
    pages += 1;
    for (const market of payload.markets) {
      if (!market?.ticker || seenTickers.has(market.ticker)) continue;
      seenTickers.add(market.ticker);
      markets.push(market);
    }

    const nextCursor = typeof payload.cursor === "string" ? payload.cursor : "";
    if (!nextCursor) {
      complete = true;
      break;
    }
    if (seenCursors.has(nextCursor)) break;
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  return { markets, complete, pages };
}

async function fetchMarketsByTickers(tickers) {
  const results = [];
  for (let start = 0; start < tickers.length; start += TICKER_BATCH_SIZE) {
    const batch = tickers.slice(start, start + TICKER_BATCH_SIZE);
    const payload = await getJson(makeApiUrl("/markets", { tickers: batch.join(",") }));
    if (!Array.isArray(payload?.markets)) throw new Error("Unexpected ticker lookup response: no markets array");
    results.push(...payload.markets);
  }
  return results;
}

function annotateMarket(rawMarket, fallbackTopic = null) {
  const directTopic = classifyTopic(rawMarket);
  const topic = directTopic || fallbackTopic;
  if (!topic || !rawMarket?.ticker) return null;
  return {
    ...rawMarket,
    topic,
    topicMatchStale: !directTopic && Boolean(fallbackTopic),
    quoteFresh: true,
    lastObservedAt: new Date().toISOString(),
  };
}

function processIncomingMarket(rawMarket, now, { alertIfMoved = true, isInitial = false, fromOpenFilter = false } = {}) {
  const existing = state.liveMarkets.get(rawMarket?.ticker);
  const annotated = annotateMarket(rawMarket, existing?.topic || state.trackedMarkets.get(rawMarket?.ticker)?.topic);
  if (!annotated) return null;

  const status = String(annotated.status || "").toLowerCase();
  const record = trackerRecord(annotated, annotated.topic, now);
  if (record) {
    record.lastCheckedAt = new Date(now).toISOString();
    if (fromOpenFilter) {
      record.outsideOpenList = false;
      record.needsStatusCheck = false;
    }
    state.trackedMarkets.set(record.ticker, record);
  }

  if (isClosedOrTerminalMarket(annotated)) {
    state.liveMarkets.delete(annotated.ticker);
    state.previousYesBids.delete(annotated.ticker);
    if (record) {
      record.outsideOpenList = true;
      record.needsStatusCheck = status === "closed" || !isYesNoSettled(annotated);
      state.trackedMarkets.set(record.ticker, record);
    }
    updateOpenPaperMarks(annotated);
    settlePaperTrades(annotated, now);
    return annotated;
  }

  annotated.inOpenFilter = fromOpenFilter || existing?.inOpenFilter || false;
  state.liveMarkets.set(annotated.ticker, annotated);
  processMarketUpdate(annotated, now, {
    canAlert: alertIfMoved && annotated.inOpenFilter,
    isInitial,
  });
  return annotated;
}

function processDiscovery(result, now) {
  const matching = result.markets
    .map((market) => {
      const fallbackTopic = state.liveMarkets.get(market?.ticker)?.topic || state.trackedMarkets.get(market?.ticker)?.topic;
      return annotateMarket(market, fallbackTopic);
    })
    .filter(Boolean);
  const openTickers = new Set(matching.map((market) => market.ticker));
  state.lastOpenMarketCount = result.markets.length;
  state.openListComplete = result.complete;

  if (result.complete) {
    for (const [ticker, market] of state.liveMarkets) {
      if (openTickers.has(ticker)) continue;
      state.liveMarkets.delete(ticker);
      state.previousYesBids.delete(ticker);
      const record = state.trackedMarkets.get(ticker) || {
        ticker,
        event_ticker: market.event_ticker || "",
        title: market.title || ticker,
        topic: market.topic,
        status: market.status || "",
        result: market.result || "",
        market_type: market.market_type || "",
        settlement_bounds_type: market.settlement_bounds_type || "",
      };
      record.lastObservedAt = new Date(now).toISOString();
      record.outsideOpenList = true;
      record.needsStatusCheck = true;
      state.trackedMarkets.set(ticker, record);
    }
  }

  for (const market of matching) {
    processIncomingMarket(market, now, {
      alertIfMoved: true,
      isInitial: state.lastSuccessfulSnapshotAt === 0,
      fromOpenFilter: true,
    });
  }
  state.lastDiscoveryAt = now;
  persistTrackedMarkets();
}

function processTickerSnapshot(rawMarkets, now) {
  const seen = new Set();
  for (const rawMarket of rawMarkets) {
    if (!rawMarket?.ticker) continue;
    seen.add(rawMarket.ticker);
    const wasOpen = state.liveMarkets.has(rawMarket.ticker);
    const result = processIncomingMarket(rawMarket, now, {
      alertIfMoved: true,
      fromOpenFilter: wasOpen,
    });
    if (result && isClosedOrTerminalMarket(result)) {
      const record = state.trackedMarkets.get(result.ticker);
      if (record) record.needsStatusCheck = String(result.status).toLowerCase() === "closed" || !isYesNoSettled(result);
    }
  }

  for (const [ticker, market] of state.liveMarkets) {
    if (seen.has(ticker)) continue;
    market.quoteFresh = false;
    state.previousYesBids.delete(ticker);
  }
}

async function pollResolutionTrackers(now) {
  if (now - state.lastResolutionPollAt < RESOLUTION_INTERVAL_MS) return;
  const due = [...state.trackedMarkets.values()]
    .filter((item) => !state.liveMarkets.has(item.ticker))
    .filter((item) => !isYesNoSettled(item))
    .filter((item) => !item.lastCheckedAt || now - new Date(item.lastCheckedAt).getTime() >= RESOLUTION_INTERVAL_MS);
  const maxTickers = TICKER_BATCH_SIZE * MAX_RESOLUTION_BATCHES_PER_POLL;
  const batch = due.slice(0, maxTickers);
  if (batch.length === 0) {
    state.lastResolutionPollAt = now;
    return;
  }

  const tickerList = batch.map((item) => item.ticker);
  for (let start = 0; start < tickerList.length; start += TICKER_BATCH_SIZE) {
    const tickers = tickerList.slice(start, start + TICKER_BATCH_SIZE);
    try {
      const markets = await fetchMarketsByTickers(tickers);
      const found = new Set();
      for (const rawMarket of markets) {
        const old = state.trackedMarkets.get(rawMarket.ticker);
        const topic = old?.topic || classifyTopic(rawMarket);
        if (!topic) continue;
        found.add(rawMarket.ticker);
        const record = trackerRecord(rawMarket, topic, now);
        if (!record) continue;
        record.lastCheckedAt = new Date(now).toISOString();
        record.needsStatusCheck = false;
        state.trackedMarkets.set(record.ticker, record);
        settlePaperTrades(rawMarket, now);

        if (String(rawMarket.status || "").toLowerCase() === "open") {
          const annotated = annotateMarket(rawMarket, topic);
          if (annotated) {
            record.outsideOpenList = false;
            record.needsStatusCheck = false;
            annotated.inOpenFilter = true;
            state.liveMarkets.set(annotated.ticker, annotated);
            // A ticker reappearing after a gap becomes a new baseline, not a retrospective alert.
            const price = readNumber(annotated.yes_bid_dollars);
            if (price === null) state.previousYesBids.delete(annotated.ticker);
            else state.previousYesBids.set(annotated.ticker, price);
          }
        }
      }

      for (const ticker of tickers) {
        const item = state.trackedMarkets.get(ticker);
        if (item) {
          item.lastCheckedAt = new Date(now).toISOString();
          if (!found.has(ticker)) item.notReturnedByTickerQuery = true;
        }
      }
    } catch (error) {
      for (const ticker of tickers) {
        const item = state.trackedMarkets.get(ticker);
        if (item) item.lastCheckError = String(error?.message || error);
      }
    }
  }
  state.lastResolutionPollAt = now;
  persistTrackedMarkets();
}

async function refreshOrderbook() {
  const body = $("orderbookRows");
  const market = state.liveMarkets.get(state.selectedTicker);
  if (!body) return;
  if (!market) {
    state.orderbookRequest += 1;
    body.replaceChildren();
    const row = makeElement("tr");
    const cell = makeElement("td", "empty-cell", "Select a market to load its order book.");
    cell.colSpan = 4;
    row.append(cell);
    body.append(row);
    return;
  }

  const requestId = ++state.orderbookRequest;
  const status = $("orderbookStatus");
  if (status) status.textContent = "Loading the public order book…";
  try {
    const payload = await getJson(orderbookApiUrl(market.ticker));
    if (requestId !== state.orderbookRequest) return;
    const orderbook = payload?.orderbook_fp || {};
    const depth = Number($("bookDepth")?.value || 20);
    const yes = orderbookLevels({ orderbook_fp: orderbook }, "yes", depth);
    const no = orderbookLevels({ orderbook_fp: orderbook }, "no", depth);
    body.replaceChildren();
    for (const [side, levels] of [["YES bid", yes], ["NO bid", no]]) {
      for (const level of levels) {
        const row = makeElement("tr");
        addCell(row, side, side.startsWith("YES") ? "side-yes" : "side-no");
        addCell(row, formatPrice(level.price), "numeric-cell");
        addCell(row, formatContracts(level.contracts), "numeric-cell");
        const sourceCell = makeElement("td");
        addOfficialLink(sourceCell, orderbookApiUrl(market.ticker), "Orderbook ↗", "source-link");
        row.append(sourceCell);
        body.append(row);
      }
    }
    if (yes.length + no.length === 0) {
      const row = makeElement("tr");
      const cell = makeElement("td", "empty-cell", "The official response contains no bid levels for this market.");
      cell.colSpan = 4;
      row.append(cell);
      body.append(row);
    }
    if (status) status.textContent = `Best ${depth} bid levels per side where returned · snapshot ${localTime(new Date(), { hour: "numeric", minute: "2-digit", second: "2-digit" })}.`;
  } catch (error) {
    if (requestId !== state.orderbookRequest) return;
    body.replaceChildren();
    const row = makeElement("tr");
    const cell = makeElement("td", "empty-cell", "Orderbook not available. No depth values are substituted.");
    cell.colSpan = 4;
    row.append(cell);
    body.append(row);
    if (status) status.textContent = `Orderbook request failed: ${String(error?.message || error)}.`;
  }
}

async function refresh({ forceDiscovery = false } = {}) {
  if (state.refreshing) return;
  state.refreshing = true;
  setConnection("is-loading", "Reading Kalshi demo market data", "Public REST snapshot · no account authentication");

  try {
    const now = Date.now();
    const needsDiscovery = forceDiscovery || state.lastDiscoveryAt === 0 || now - state.lastDiscoveryAt >= DISCOVERY_INTERVAL_MS;
    if (needsDiscovery) {
      const result = await fetchOpenMarkets();
      processDiscovery(result, now);
    } else {
      const tickers = [...state.liveMarkets.keys()];
      if (tickers.length) {
        const currentMarkets = await fetchMarketsByTickers(tickers);
        processTickerSnapshot(currentMarkets, now);
      }
    }

    await pollResolutionTrackers(now);
    state.lastSuccessfulSnapshotAt = now;
    const detail = `${localTime(now, { hour: "numeric", minute: "2-digit", second: "2-digit" })} · REST polling about every 30s`;
    setConnection("is-live", "Kalshi demo API reachable", detail);
    renderAll();
    if (state.selectedTicker) await refreshOrderbook();
  } catch (error) {
    const stale = state.lastSuccessfulSnapshotAt > 0;
    const detail = stale
      ? `Last confirmed snapshot ${localTime(state.lastSuccessfulSnapshotAt, { hour: "numeric", minute: "2-digit", second: "2-digit" })} · values may be stale`
      : `No confirmed snapshot · ${String(error?.message || error)}`;
    setConnection(stale ? "is-warning" : "is-offline", stale ? "API refresh failed · showing last confirmed data" : "Kalshi demo API unavailable", detail);
    const tableStatus = $("marketTableStatus");
    if (tableStatus) tableStatus.textContent = `Refresh failed: ${String(error?.message || error)}. Last confirmed values are retained with their earlier timestamp.`;
    if (!state.lastSuccessfulSnapshotAt) {
      const body = $("marketRows");
      if (body) {
        const row = makeElement("tr");
        const cell = makeElement("td", "empty-cell", `Could not read the demo endpoint: ${String(error?.message || error)}. Check browser network/CORS access; no sample rows are shown.`);
        cell.colSpan = 10;
        row.append(cell);
        body.replaceChildren(row);
      }
    }
  } finally {
    state.refreshing = false;
  }
}

function initializeControls() {
  const refreshButton = $("refreshNow");
  if (refreshButton) refreshButton.addEventListener("click", () => void refresh({ forceDiscovery: true }));

  const clearAlertsButton = $("clearAlerts");
  if (clearAlertsButton) {
    clearAlertsButton.addEventListener("click", () => {
      if (!window.confirm("Clear both alert feeds stored in this browser? This does not affect Kalshi data or paper trades.")) return;
      state.alerts = [];
      state.candidates = [];
      persistAlerts();
      renderAlerts();
    });
  }

  const range = $("chartRange");
  if (range) range.addEventListener("change", drawChart);
  const bookDepth = $("bookDepth");
  if (bookDepth) bookDepth.addEventListener("change", () => void refreshOrderbook());

  const autoPaper = $("autoPaperToggle");
  if (autoPaper) {
    autoPaper.checked = state.settings.autoPaper;
    autoPaper.addEventListener("change", () => {
      state.settings.autoPaper = autoPaper.checked;
      persistSettings();
      const status = $("paperStatus");
      if (status) status.textContent = state.settings.autoPaper
        ? "Automatic local paper simulation is enabled; it waits for a new screened signal."
        : "Automatic local paper simulation is paused; alerts and the candidate stream remain active.";
    });
  }

  const strategyMode = $("strategyMode");
  if (strategyMode) {
    strategyMode.value = state.settings.strategyMode;
    strategyMode.addEventListener("change", () => {
      state.settings.strategyMode = ["both", "momentum", "mean-reversion"].includes(strategyMode.value)
        ? strategyMode.value
        : "both";
      persistSettings();
    });
  }

  const quantity = $("paperQuantity");
  if (quantity) {
    quantity.value = String(state.settings.quantity);
    quantity.addEventListener("change", () => {
      const value = Number(quantity.value);
      if (!Number.isInteger(value) || value < 1 || value > 20) {
        quantity.value = String(state.settings.quantity);
        return;
      }
      state.settings.quantity = value;
      persistSettings();
    });
  }

  const clear = $("clearLocalData");
  if (clear) {
    clear.addEventListener("click", () => {
      if (!window.confirm("Clear only the paper-trade history stored in this browser? Alerts and Kalshi data are not affected.")) return;
      state.paperTrades = [];
      persistPaperTrades();
      renderPaperLab();
      const status = $("paperStatus");
      if (status) status.textContent = "Local paper-trade history cleared. No Kalshi account data was changed.";
    });
  }
}

function initialize() {
  setPageCopy();
  setActiveNavigation();
  initializeControls();
  renderAlerts();
  renderPaperLab();
  renderResolutionTracker();
  window.addEventListener("resize", drawChart);
  void refresh({ forceDiscovery: true });
  window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
}

initialize();
