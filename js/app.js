/*
 * Shared bootstrap for all pages: instantiate the Kalshi client, init the store,
 * handle the (optional) demo credentials form, and start live polling.
 */

(function (global) {
  "use strict";

  let started = false;

  async function start() {
    if (started) return;
    started = true;

    const client = new global.KalshiClient();
    global.KD_store.client = client;

    await global.KD_store.init(client);

    // Optional demo credentials (stored only in the browser session).
    const form = document.getElementById("cred-form");
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const keyId = document.getElementById("keyid").value.trim();
        const pem = document.getElementById("keyfile").value.trim();
        if (!keyId || !pem) { alert("Enter a Kalshi demo API key ID and a private key (PEM)."); return; }
        try {
          await client.importPrivateKey(pem);
          client.keyId = keyId;
          const status = document.getElementById("cred-status");
          status.textContent = "Credentials loaded. Live portfolio + execution are enabled.";
          status.className = "ok";
          global.KD_store.refreshPortfolio();
        } catch (err) {
          const status = document.getElementById("cred-status");
          status.textContent = "Failed to load credentials: " + err.message;
          status.className = "flag";
        }
      });
    }

    // live status
    renderStatus();

    // start live polling + strategy engine
    global.KD_store.startPolling(15000);
    global.KD_strategy.engine.start(20000);

    // re-render on every state change
    global.KD_store.subscribe(() => {
      renderStatus();
      if (global.KD_dashboard) {
        const topic = document.body.dataset.topic;
        if (topic) global.KD_dashboard.renderTopicTable(topic);
        global.KD_dashboard.renderMarketDetail();
      }
      if (global.KD_portfolio) {
        global.KD_portfolio.renderPerformance();
        global.KD_portfolio.renderTrades();
        global.KD_portfolio.renderLivePortfolio();
      }
    });
  }

  function renderStatus() {
    const el = document.getElementById("conn-status");
    if (!el) return;
    const s = global.KD_store.state;
    if (s.connected) {
      el.innerHTML = `<span class="dot dot-on"></span> Live · ${esc(s.base || "")}`;
    } else {
      el.innerHTML = `<span class="dot dot-off"></span> Kalshi unreachable — ${esc(s.error || "offline")}. <span class="flag">unverified</span>`;
    }
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  document.addEventListener("DOMContentLoaded", () => {
    global.KD_dashboard.init();
    global.KD_portfolio.init();
    if (document.body.dataset.flagged) global.KD_flagged.render();
    start();
  });

  global.KD_app = { start };
})(window);
