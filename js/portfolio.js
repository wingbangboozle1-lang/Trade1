/*
 * Portfolio tracker + real (opt-in) demo execution.
 *  - Loads balance / open positions from the Kalshi demo account (RSA-PSS auth).
 *  - Executes real orders on the demo account only when credentials are provided
 *    and the user explicitly enables execution.
 *  - Shows performance analysis grouped by strategy category and topic.
 */

(function (global) {
  "use strict";

  const CFG = global.KD_CONFIG;
  const esc = (global.KD_dashboard ? global.KD_dashboard.escapeHtml : (s) => String(s));
  const fmt$ = (v) => (v === null || v === undefined ? "" : "$" + Number(v).toFixed(2));

  /* Reconcile paper trades with resolved Kalshi events (resolution tracking). */
  function renderPerformance() {
    const host = document.getElementById("perf-table");
    if (!host) return;
    const perf = global.KD_strategy.engine.performance();
    if (!perf.totalTrades) {
      host.innerHTML = `<div class="empty">No closed trades yet. The strategy engine will open and close simulated trades automatically while the dashboard runs. <span class="flag">unverified</span></div>`;
      return;
    }
    const rows = Object.entries(perf.byCategory).map(([cat, v]) => `
      <tr>
        <td>${esc(cat)}</td>
        <td class="num">${v.trades}</td>
        <td class="num">${v.wins}</td>
        <td class="num">${v.wins / v.trades ? (v.wins / v.trades * 100).toFixed(0) + "%" : ""}</td>
        <td class="num ${v.pnl >= 0 ? 'pos' : 'neg'}">${fmt$(v.pnl)}</td>
      </tr>`).join("");
    host.innerHTML = `
      <div class="stat-row">
        <div class="stat"><div class="stat-label">Closed trades</div><div class="stat-val">${perf.totalTrades}</div></div>
        <div class="stat"><div class="stat-label">Win rate</div><div class="stat-val">${(perf.winRate * 100).toFixed(0)}%</div></div>
        <div class="stat"><div class="stat-label">Realized P&amp;L</div><div class="stat-val ${perf.realizedPnl >= 0 ? 'pos' : 'neg'}">${fmt$(perf.realizedPnl)}</div></div>
        <div class="stat"><div class="stat-label">Contracts traded</div><div class="stat-val">${perf.totalContracts}</div></div>
      </div>
      <table class="data-table"><thead><tr>
        <th>Strategy category</th><th>Trades</th><th>Wins</th><th>Win rate</th><th>Realized P&amp;L</th>
      </tr></thead><tbody>${rows}</tbody></table>
      <p class="muted small">Simulated (paper) trades. No real funds are committed.</p>
    `;
  }

  function renderTrades() {
    const host = document.getElementById("trades-table");
    if (!host) return;
    const trades = global.KD_store.allTrades();
    if (!trades.length) {
      host.innerHTML = `<div class="empty">No trades yet.</div>`;
      return;
    }
    host.innerHTML = `<table class="data-table"><thead><tr>
      <th>Opened</th><th>Topic</th><th>Ticker</th><th>Strategy</th><th>Side</th>
      <th>Entry</th><th>Count</th><th>Status</th><th>Resolution</th><th>P&amp;L</th>
    </tr></thead><tbody>${trades.slice(0, 100).map((t) => `
      <tr>
        <td>${new Date(t.opened_at).toLocaleString()}</td>
        <td>${esc(t.topic)}</td>
        <td class="ticker"><code>${esc(t.ticker)}</code></td>
        <td>${esc(t.category)}</td>
        <td>${esc(t.side)}</td>
        <td class="num">${fmt$(t.entry_price)}</td>
        <td class="num">${t.count}</td>
        <td><span class="pill ${t.status === 'open' ? 'pill-open' : t.pnl >= 0 ? 'pill-yes' : 'pill-no'}">${t.status}</span></td>
        <td>${esc(t.resolution || "—")}</td>
        <td class="num ${t.pnl === null ? '' : (t.pnl >= 0 ? 'pos' : 'neg')}">${t.pnl === null ? "" : fmt$(t.pnl)}</td>
      </tr>`).join("")}</tbody></table>`;
  }

  function renderLivePortfolio() {
    const host = document.getElementById("live-portfolio");
    if (!host) return;
    const p = global.KD_store.state.portfolio;
    if (!p || !p.fetchedAt) {
      host.innerHTML = `<div class="empty">Live demo portfolio not loaded. Provide a Kalshi demo API key ID + private key (stored only in your browser session) and click <em>Load portfolio</em>. <span class="flag">unverified</span></div>`;
      return;
    }
    const bal = p.balance || {};
    const balCents = bal.balance !== undefined ? bal.balance : (bal.available !== undefined ? bal.available : null);
    const rows = (p.positions || []).map((pos) => {
      const cnt = pos.position !== undefined ? pos.position : (pos.yes_count || 0);
      const tc = pos.total_cost !== undefined ? pos.total_cost : (pos.total_cost_cents || 0);
      const avg = cnt ? tc / cnt / 100 : null;
      return `<tr><td class="ticker"><code>${esc(pos.ticker || '')}</code></td>
        <td class="num">${cnt}</td><td class="num">${avg === null ? "" : fmt$(avg)}</td>
        <td class="num">${fmt$(tc / 100)}</td></tr>`;
    }).join("");
    host.innerHTML = `
      <div class="stat-row">
        <div class="stat"><div class="stat-label">Balance</div><div class="stat-val">${balCents === null ? "" : fmt$(balCents / 100)}</div></div>
        <div class="stat"><div class="stat-label">Open positions</div><div class="stat-val">${(p.positions || []).length}</div></div>
      </div>
      <table class="data-table"><thead><tr><th>Ticker</th><th>Contracts</th><th>Avg cost</th><th>Total cost</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="4" class="muted">No open positions.</td></tr>`}</tbody></table>
      <p class="muted small">Loaded from the Kalshi demo account at ${esc(global.KD_store.state.base || "")}.</p>
    `;
  }

  /* Real demo execution (opt-in). Body shape follows Kalshi's documented order
     request; this is flagged for review because the sandbox could not reach the
     v2 order-create endpoint to confirm the exact response. */
  async function executeOrder(ticker, side, action, count, price) {
    if (!global.KD_store.client.keyId) {
      throw new Error("Provide Kalshi demo API key ID + private key to execute real orders.");
    }
    const body = {
      ticker,
      action: action || "buy",
      side: side || "yes",
      type: "limit",
      count: count || 10,
      yes_price: side === "yes" ? Math.round(price * 100) : undefined,
      no_price: side === "no" ? Math.round(price * 100) : undefined,
    };
    const order = await global.KD_store.client.createOrder(body);
    return order;
  }

  function init() {
    const btns = document.querySelectorAll("[data-load-portfolio]");
    btns.forEach((b) => b.addEventListener("click", () => global.KD_store.refreshPortfolio()));
    document.querySelectorAll("[data-execute]").forEach((b) => {
      b.addEventListener("click", async () => {
        const { ticker, side, action, count, price } = b.dataset;
        try {
          const order = await executeOrder(ticker, side, action, Number(count), Number(price));
          b.nextElementSibling.textContent = " Executed: " + JSON.stringify(order).slice(0, 120);
        } catch (e) {
          b.nextElementSibling.textContent = " Error: " + e.message;
        }
      });
    });
  }

  global.KD_portfolio = { init, executeOrder, renderPerformance, renderTrades, renderLivePortfolio };
})(window);
