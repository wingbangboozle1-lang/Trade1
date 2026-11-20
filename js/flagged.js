/*
 * Flagged-for-Review page. Lists irregularities and unverified values found while
 * building the dashboard. Each item carries the official source links used and the
 * status of verification. Nothing is invented; unverified values are shown blank.
 */

(function (global) {
  "use strict";

  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const FLAGGED = [
    {
      kind: "Irregularity",
      title: "Demo base host discrepancy",
      detail:
        "The task lists the recommended demo endpoint as " +
        "https://external-api.demo.kalshi.co/trade-api/v2. The official Kalshi starter code " +
        "(Kalshi/kalshi-starter-code-python) uses https://demo-api.kalshi.co/trade-api/v2 for the demo " +
        "environment. Both are Kalshi demo hosts; the dashboard tries the task host first and falls " +
        "back to the official-starter host, and reports which base is live.",
      sources: [
        "https://github.com/Kalshi/kalshi-starter-code-python",
        "https://external-api.demo.kalshi.co/trade-api/v2",
        "https://demo-api.kalshi.co/trade-api/v2",
      ],
      status: "Needs review — both hosts documented, live reachability untested from build sandbox.",
    },
    {
      kind: "Unverified",
      title: "Live market data",
      detail:
        "No market values could be fetched or confirmed from this build sandbox: outbound access is " +
        "restricted to github.com, registry.npmjs.org, pypi.org, and files.pythonhosted.org, so all " +
        "Kalshi hosts are unreachable (curl returns code 000 / TLS reset). All price, volume, and " +
        "liquidity cells are therefore blank here and are populated live in the browser directly from " +
        "the Kalshi demo API. No values were inferred or fabricated.",
      sources: [
        "https://external-api.demo.kalshi.co/trade-api/v2/markets",
        "https://demo-api.kalshi.co/trade-api/v2/markets",
      ],
      status: "Unverified in sandbox; verified live path in-browser (client-side fetch).",
    },
    {
      kind: "Unverified",
      title: "Topic series ticker mappings",
      detail:
        "The five topic categories (gas prices, elections, culture, crypto, golf) are mapped to " +
        "Kalshi series by keyword discovery against Kalshi's own /series response at runtime. Specific " +
        "series tickers could not be confirmed from the sandbox, so no ticker is hard-coded as fact. " +
        "The mapping is data-driven and re-discovered each load.",
      sources: [
        "https://docs.kalshi.com/getting_started/quick_start_market_data",
        "https://github.com/Kalshi/kalshi-starter-code-python",
      ],
      status: "Unverified — keyword hints only; live series discovered at runtime.",
    },
    {
      kind: "Unverified",
      title: "WebSocket private-channel auth",
      detail:
        "The public WebSocket ticker channel is documented and used for live price updates. Private " +
        "channels (orderbook_delta, market_positions) require an authenticated handshake that the " +
        "browser cannot perform with custom WebSocket headers. The dashboard uses the public ticker " +
        "channel and REST orderbook polling instead.",
      sources: [
        "https://github.com/Kalshi/kalshi-starter-code-python/blob/main/clients.py",
        "https://docs.kalshi.com",
      ],
      status: "Unverified — private WS auth flow not exercised from browser.",
    },
    {
      kind: "Unverified",
      title: "v2 order-create request body",
      detail:
        "The exact JSON body for POST /portfolio/events/orders could not be confirmed against a live " +
        "response (Kalshi unreachable). The body uses the documented shape " +
        "{ticker, action, side, type, count, yes_price/no_price} with prices in cents. Real execution " +
        "is opt-in only and should be validated against the demo account before use.",
      sources: [
        "https://github.com/Kalshi/kalshi-starter-code-python",
        "https://docs.kalshi.com",
      ],
      status: "Unverified — validate the request body against the live demo endpoint.",
    },
  ];

  function render() {
    const host = document.getElementById("flagged-list");
    if (!host) return;
    host.innerHTML = FLAGGED.map((f, i) => `
      <article class="flag-card">
        <div class="flag-kind">${esc(f.kind)}</div>
        <h2>${esc(f.title)}</h2>
        <p>${esc(f.detail)}</p>
        <p class="muted small"><strong>Verification:</strong> ${esc(f.status)}</p>
        <p class="muted small"><strong>Sources:</strong>
          ${f.sources.map((s) => `<a href="${s}" target="_blank" rel="noopener">${esc(s)}</a>`).join(" · ") || "—"}
        </p>
      </article>`).join("");
  }

  global.KD_flagged = { render };
})(window);
