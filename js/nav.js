/* Injects the shared top navigation so every page stays consistent. */
(function (global) {
  "use strict";

  const CFG = global.KD_CONFIG;
  const LINKS = [
    { href: "../index.html", label: "Home", key: "home" },
    { href: "pages/gas.html", label: "⛽ Gas", key: "gas" },
    { href: "pages/elections.html", label: "🗳️ Elections", key: "elections" },
    { href: "pages/culture.html", label: "🎬 Culture", key: "culture" },
    { href: "pages/crypto.html", label: "₿ Crypto", key: "crypto" },
    { href: "pages/golf.html", label: "⛳ Golf", key: "golf" },
    { href: "pages/portfolio.html", label: "📈 Portfolio", key: "portfolio" },
    { href: "pages/flagged.html", label: "⚠ Flagged", key: "flagged" },
  ];

  function activeKey() {
    const p = location.pathname;
    if (p.endsWith("index.html") || p.endsWith("/")) return "home";
    const match = LINKS.find((l) => p.endsWith(l.label.replace(/^[^\p{L}]+/u, "") + ".html"));
    return match ? match.key : "";
  }

  function render() {
    const host = document.getElementById("topbar");
    if (!host) return;
    const cur = activeKey();
    const links = LINKS.map((l) =>
      `<a href="${l.href}" class="${l.key === cur ? "active" : ""}">${l.label}</a>`
    ).join("");
    host.innerHTML = `
      <div class="topbar-inner">
        <a class="brand" href="../index.html">Kalshi<span>Dash</span></a>
        <nav class="topnav">${links}</nav>
        <div class="conn" id="conn-status"><span class="dot dot-off"></span> connecting…</div>
      </div>`;
  }

  global.KD_nav = { render };
  document.addEventListener("DOMContentLoaded", render);
})(window);
