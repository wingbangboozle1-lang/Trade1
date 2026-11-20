/* Trade1 — strategies.js — paper strategy engine UI + portfolio performance + demo-account connector.
 * Trading against the real demo account requires demo API keys (official: authenticated endpoints).
 * The paper engine below trades simulated fills against LIVE demo market data with official fees.
 */
"use strict";

(function () {
  let universe = [];      // tickers being polled
  let books = {};         // ticker -> latest orderbook (for imbalance strategy)
  let statsTimer = null;

  document.addEventListener("DOMContentLoaded", () => {
    UI.initStatus("status-pill", "net-banner");
    renderStrategyControls();
    renderAll();
    document.getElementById("engine-toggle").addEventListener("change", (e) => {
      const s = Store.settings();
      s.enabled = e.target.checked;
      Store.setSettings(s);
      renderEngineState();
    });
    document.getElementById("btn-reset").addEventListener("click", () => {
      if (confirm("Reset the paper portfolio (cash, positions, trades, equity)?")) { Store.resetPaper(); renderAll(); }
    });
    document.getElementById("btn-export-trades").addEventListener("click", exportTradesCSV);
    document.getElementById("btn-export-all").addEventListener("click", () => {
      downloadJSON("trade1-state.json", Store.exportAll());
    });
    document.getElementById("btn-refresh-universe").addEventListener("click", () => bootstrapUniverse(true));
    setupFilters();
    bootstrapUniverse(false);
    startLoops();
    DemoConnector.init("connector-panel");
  });

  // ---------- Universe bootstrap: seeds of every topic + everything in the watchlist ----------
  async function bootstrapUniverse(force) {
    const set = new Set(Object.keys(Store.watchlist()));
    for (const id of T1.TOPIC_ORDER) {
      for (const seed of T1.TOPICS[id].seeds) {
        try {
          for (const m of await KalshiAPI.getMarketsBySeries(seed, 1)) {
            if (m.status === "active") {
              set.add(m.ticker);
              T1Track.latest[m.ticker] = m;
              T1Track.observe(m, id);
            }
          }
        } catch (e) {}
      }
    }
    universe = [...set].slice(0, 60);
    renderUniverse();
  }

  function renderUniverse() {
    UI.html("universe-note", universe.length
      ? `Polling ${universe.length} market${universe.length > 1 ? "s" : ""} (topic seeds + every market you've viewed). Prices update every 5s in one batch call.`
      : "No markets yet — visit a topic page or click “Refresh universe”. Strategies fire on live demo prices.");
  }

  // ---------- Strategy controls ----------
  function renderStrategyControls() {
    const s = Store.settings();
    for (const id of Object.keys(T1.STRATEGIES)) {
      if (!s.strategies[id]) {
        s.strategies[id] = Object.assign({ on: false }, T1.STRATEGIES[id].defaults);
      }
    }
    Store.setSettings(s);
    const box = document.getElementById("strategies-box");
    box.innerHTML = Object.entries(T1.STRATEGIES).map(([id, meta]) => {
      const cfg = s.strategies[id];
      const fields = Object.entries(T1.STRATEGIES[id].defaults).filter(([k]) => k !== "stake").map(([k, v]) => `
        <label class="num-field" title="${UI.esc(k)}">${UI.esc(k)}
          <input type="number" step="0.01" data-strat="${id}" data-key="${k}" value="${cfg[k] ?? v}">
        </label>`).join("");
      return `<div class="card strat-card" data-strat-card="${id}">
        <div class="strat-head">
          <label class="switch"><input type="checkbox" data-strat-toggle="${id}" ${cfg.on ? "checked" : ""}> <b>${UI.esc(meta.label)}</b></label>
          <span class="muted">${UI.esc(meta.desc)}</span>
        </div>
        <div class="strat-params">${fields}
          <label class="num-field">stake ($/trade)<input type="number" step="1" data-strat="${id}" data-key="stake" value="${cfg.stake}"></label>
        </div>
        <div class="strat-pnl muted" data-strat-pnl="${id}"></div>
      </div>`;
    }).join("");
    box.querySelectorAll("[data-strat-toggle]").forEach((el) => el.addEventListener("change", () => {
      const st = Store.settings();
      st.strategies[el.dataset.stratToggle].on = el.checked;
      Store.setSettings(st);
      renderEngineState();
    }));
    box.querySelectorAll("[data-key]").forEach((el) => el.addEventListener("change", () => {
      const st = Store.settings();
      const v = parseFloat(el.value);
      if (!isNaN(v)) st.strategies[el.dataset.strat][el.dataset.key] = v;
      Store.setSettings(st);
    }));
  }

  function renderEngineState() {
    const s = Store.settings();
    const t = document.getElementById("engine-toggle");
    if (t) t.checked = !!s.enabled;
    const chip = document.getElementById("engine-state");
    if (chip) {
      chip.textContent = s.enabled ? "RUNNING — paper trades execute on live demo prices" : "PAUSED — toggle to start";
      chip.className = "chip " + (s.enabled ? "chip-run" : "chip-other");
    }
  }

  // ---------- Loops ----------
  function startLoops() {
    renderEngineState();
    setInterval(async () => {
      if (document.hidden || !universe.length) return;
      try {
        const quoteMap = {};
        for (let i = 0; i < universe.length; i += 40) {
          const markets = await KalshiAPI.getMarketsByTickers(universe.slice(i, i + 40));
          for (const m of markets) {
            quoteMap[m.ticker] = m;
            T1Track.latest[m.ticker] = m;
            T1Track.observe(m, guessTopicId(m));
            if (Store.settings().enabled) Engine.tick(m, books[m.ticker] || null);
          }
        }
        lastQuoteMap = quoteMap;
        renderAll();
      } catch (e) { console.debug(e); }
    }, T1.POLL_MS.index);

    // orderbooks for open positions (≤4) so the imbalance strategy can manage exits
    setInterval(async () => {
      if (document.hidden) return;
      const p = Store.paper();
      const open = Object.keys(p.positions).filter((t) => p.positions[t].strategy === "imbalance").slice(0, 4);
      for (const t of open) {
        try {
          const book = await KalshiAPI.getOrderbook(t);
          books[t] = book;
          const m = lastQuoteMap[t] || T1Track.latest[t];
          if (m && Store.settings().enabled) Engine.tick(m, book);
        } catch (e) {}
      }
    }, T1.POLL_MS.selectedBook);

    setInterval(async () => {
      if (document.hidden) return;
      await Engine.checkResolutions();
      renderAll();
    }, T1.POLL_MS.watchlist);
  }

  let lastQuoteMap = {};

  function guessTopicId(m) {
    const hay = ((m.title || "") + " " + (m.ticker || "")).toLowerCase();
    for (const id of T1.TOPIC_ORDER) {
      const t = T1.TOPICS[id];
      if (t.seeds.some((s) => m.ticker.startsWith(s))) return id;
      if (t.keywords.some((k) => hay.includes(k))) return id;
    }
    return "other";
  }

  // ---------- Rendering ----------
  function renderAll() {
    const st = Engine.stats();
    renderStats(st);
    renderEquity(st);
    renderTables(st);
    UI.stamp("perf-stamp", Date.now());
  }

  function renderStats(st) {
    const start = T1.PAPER_BANKROLL;
    const totalReturn = st.equity !== null ? ((st.equity - start) / start) * 100 : null;
    UI.html("stat-cash", UI.money(st.cash));
    UI.html("stat-equity", st.equity !== null ? UI.money(st.equity) : UI.money(start));
    UI.html("stat-return", totalReturn !== null ? `${totalReturn >= 0 ? "+" : ""}${totalReturn.toFixed(2)}%` : "");
    UI.html("stat-realized", `${st.realized >= 0 ? "+" : ""}${UI.money(st.realized)}`);
    UI.html("stat-unrealized", `${st.unrealized >= 0 ? "+" : ""}${UI.money(st.unrealized)}`);
    UI.html("stat-fees", UI.money(st.fees));
    UI.html("stat-wr", st.winRate !== null ? st.winRate + "%" : "—");
    UI.html("stat-dd", st.maxDrawdown ? (st.maxDrawdown * 100).toFixed(2) + "%" : "0%");
    UI.html("stat-open", String(st.openPositions));
    document.getElementById("stat-return").className = "stat-value " + (totalReturn >= 0 ? "up" : "down");
    document.getElementById("stat-realized").className = "stat-value " + (st.realized >= 0 ? "up" : "down");
    document.getElementById("stat-unrealized").className = "stat-value " + (st.unrealized >= 0 ? "up" : "down");
    // per-strategy pnl lines
    document.querySelectorAll("[data-strat-pnl]").forEach((el) => {
      const s = st.byStrategy[el.dataset.stratPnl];
      el.textContent = s ? `Simulated P&L: ${s.pnl >= 0 ? "+" : ""}${UI.money(s.pnl)} · ${s.n} closed · ${s.wins}W/${s.losses}L` : "No closed trades yet for this strategy.";
    });
  }

  let equityChart = null;
  function renderEquity(st) {
    if (!equityChart) equityChart = new T1Charts.LineChart("equity-chart", "Portfolio equity ($)", "#16a34a");
    equityChart.setSeries(st.equitySeries.length > 1 ? st.equitySeries : [[Date.now(), st.equity ?? T1.PAPER_BANKROLL]]);
  }

  function renderTables(st) {
    const f = getFilters();
    // Open positions
    const p = Store.paper();
    const posRows = Object.entries(p.positions).map(([t, pos]) => {
      const m = lastQuoteMap[t] || T1Track.latest[t];
      const q = m ? Engine._quote(m) : {};
      const mark = pos.side === "yes" ? q.yesBid : q.noBid;
      const upl = mark !== null && mark > 0 ? pos.contracts * (mark - pos.entryPrice) : null;
      return `<tr>
        <td>${UI.esc(trunc(pos.market.title || "", 40))} <span class="event-ticker">${UI.esc(pos.market.subtitle || "")}</span></td>
        <td class="mono">${UI.esc(t)}</td>
        <td>${topicBadge(pos.topic)}</td>
        <td>${UI.esc(pos.strategy)}</td>
        <td><span class="chip ${pos.side === "yes" ? "chip-open" : "chip-no"}">${pos.side.toUpperCase()}</span></td>
        <td class="mono">${pos.contracts}</td>
        <td class="mono">${UI.cents(pos.entryPrice)}</td>
        <td class="mono">${mark ? UI.cents(mark) : ""}</td>
        <td class="mono">${upl !== null ? `<span class="${upl >= 0 ? "up" : "down"}">${(upl >= 0 ? "+" : "") + UI.money(upl)}</span>` : ""}</td>
        <td class="mono">${UI.esc(UI.dateTime(pos.entryTs))}</td>
      </tr>`;
    }).join("");
    UI.html("positions-tbody", posRows || `<tr><td colspan="10" class="muted">No open positions. Enable the engine and it will trade live demo prices automatically.</td></tr>`);

    // Trade stream (opens/closes)
    const logRows = (p.openLog || []).slice(0, 40).map((e) => `<tr>
      <td class="mono">${UI.esc(UI.clock(e.ts))}</td>
      <td><span class="chip ${e.kind === "buy" ? "chip-open" : e.kind === "settle" ? "chip-settled" : "chip-no"}">${UI.esc(e.kind)}</span></td>
      <td>${UI.esc(trunc(e.title || e.ticker, 38))}</td>
      <td>${topicBadge(e.topic)}</td>
      <td>${UI.esc(e.strategy)}</td>
      <td class="mono">${UI.esc(e.side)} × ${e.contracts} @ ${UI.cents(e.price)}</td>
      <td class="mono">${e.pnl !== undefined ? `<span class="${e.pnl >= 0 ? "up" : "down"}">${(e.pnl >= 0 ? "+" : "") + UI.money(e.pnl)}</span>` : ""}</td>
    </tr>`).join("");
    UI.html("stream-tbody", logRows || `<tr><td colspan="7" class="muted">No activity yet.</td></tr>`);

    // Closed trades (filterable)
    const trades = (st.trades || []).filter((t) =>
      (!f.strategy || t.strategy === f.strategy) && (!f.topic || t.topic === f.topic) && (!f.outcome || t.outcome === f.outcome));
    const trRows = trades.slice(0, 100).map((t) => `<tr>
      <td class="mono">${UI.esc(UI.dateTime(t.closedTs))}</td>
      <td>${UI.esc(trunc(t.title || t.ticker, 34))} <span class="event-ticker">${UI.esc(t.subtitle || "")}</span></td>
      <td>${topicBadge(t.topic)}</td>
      <td>${UI.esc(t.strategy)}</td>
      <td class="mono">${UI.esc(t.side.toUpperCase())} × ${t.contracts}</td>
      <td class="mono">${UI.cents(t.entryPrice)} → ${UI.cents(t.exitPrice)}</td>
      <td class="mono">${UI.money(t.fees)}</td>
      <td class="mono"><span class="${t.pnl >= 0 ? "up" : "down"}">${(t.pnl >= 0 ? "+" : "") + UI.money(t.pnl)}</span></td>
      <td>${UI.esc(t.outcome)} <span class="muted">(${UI.esc(t.reason)}${t.result ? ", " + t.result.toUpperCase() : ""})</span></td>
      <td class="mono">${t.holdSec}s</td>
    </tr>`).join("");
    UI.html("trades-tbody", trRows || `<tr><td colspan="10" class="muted">No closed trades${anyFilterSet(f) ? " for the current filter" : ""} yet.</td></tr>`);

    // P&L by strategy / by topic
    const stratRows = Object.entries(st.byStrategy).map(([k, v]) => `<tr>
      <td>${UI.esc(k)}</td><td class="mono">${v.n}</td>
      <td class="mono">${v.wins}/${v.losses}</td>
      <td class="mono"><span class="${v.pnl >= 0 ? "up" : "down"}">${(v.pnl >= 0 ? "+" : "") + UI.money(v.pnl)}</span></td></tr>`).join("");
    UI.html("by-strategy-tbody", stratRows || `<tr><td colspan="4" class="muted">No closed trades yet.</td></tr>`);
    const topicRows = Object.entries(st.byTopic).map(([k, v]) => `<tr>
      <td>${topicBadge(k)}</td><td class="mono">${v.n}</td>
      <td class="mono">${v.wins}/${v.losses}</td>
      <td class="mono"><span class="${v.pnl >= 0 ? "up" : "down"}">${(v.pnl >= 0 ? "+" : "") + UI.money(v.pnl)}</span></td></tr>`).join("");
    UI.html("by-topic-tbody", topicRows || `<tr><td colspan="4" class="muted">No closed trades yet.</td></tr>`);
  }

  function topicBadge(id) {
    const t = T1.TOPICS[id];
    return t ? `<span class="topic-badge" style="background:${t.accent}1a;color:${t.accent}">${t.icon} ${UI.esc(t.label)}</span>`
      : `<span class="topic-badge">${UI.esc(id)}</span>`;
  }
  function trunc(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

  // ---------- filters / export ----------
  function getFilters() {
    return {
      strategy: document.getElementById("f-strategy").value,
      topic: document.getElementById("f-topic").value,
      outcome: document.getElementById("f-outcome").value,
    };
  }
  function anyFilterSet(f) { return f.strategy || f.topic || f.outcome; }
  function setupFilters() {
    const st = Store.settings();
    const selStrat = document.getElementById("f-strategy");
    selStrat.innerHTML = `<option value="">All strategies</option>` + Object.keys(T1.STRATEGIES).map((id) => `<option value="${id}">${UI.esc(T1.STRATEGIES[id].label)}</option>`).join("");
    const selTopic = document.getElementById("f-topic");
    selTopic.innerHTML = `<option value="">All topics</option><option value="other">Other</option>` + T1.TOPIC_ORDER.map((id) => `<option value="${id}">${UI.esc(T1.TOPICS[id].label)}</option>`).join("");
    ["f-strategy", "f-topic", "f-outcome"].forEach((id) => document.getElementById(id).addEventListener("change", renderAll));
  }
  function exportTradesCSV() {
    const st = Engine.stats();
    UI.downloadCSV("trade1-trades.csv",
      ["closed", "title", "ticker", "topic", "strategy", "side", "contracts", "entry", "exit", "fees", "pnl", "outcome", "reason", "hold_sec", "settlement_result"],
      st.trades.map((t) => [new Date(t.closedTs).toISOString(), t.title, t.ticker, t.topic, t.strategy, t.side, t.contracts, t.entryPrice, t.exitPrice, t.fees, t.pnl, t.outcome, t.reason, t.holdSec, t.result || ""]));
  }
  function downloadJSON(name, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
  }

  window.T1Strategies = { renderAll };
})();
