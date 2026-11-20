/* Trade1 — connector.js — OPTIONAL demo-account connector (authenticated endpoints).
 *
 * Kalshi authenticated requests sign `timestamp + METHOD + path` (path excludes query + host) with an
 * API key: headers KALSHI-ACCESS-KEY / KALSHI-ACCESS-TIMESTAMP / KALSHI-ACCESS-SIGNATURE.
 *   Sources: https://docs.kalshi.com/getting_started/quick_start_authenticated_requests.md
 *            https://docs.kalshi.com/getting_started/api_keys.md
 *            https://docs.kalshi.com/getting_started/api_environments.md (demo keys ↔ demo hosts only)
 *
 * SCOPE (honest + flagged): this connector implements READ-ONLY portfolio sync (balance, positions).
 * Order placement on the real demo account is intentionally NOT enabled — it cannot be verified
 * without credentials and is tracked on the Flagged page. Keys stay in this browser's localStorage
 * and are sent ONLY to the official demo host.
 */
"use strict";

(function () {
  const KEY_STORE = "connector";

  function creds() { return Store.get(KEY_STORE, null); }
  function setCreds(c) { Store.set(KEY_STORE, c); }

  function pemToArrayBuffer(pem) {
    const b64 = pem.replace(/-----BEGIN[A-Z ]+-----/, "").replace(/-----END[A-Z ]+-----/, "").replace(/\s+/g, "");
    const raw = atob(b64);
    const buf = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
    return buf.buffer;
  }

  let privateKey = null;
  async function importKey(pem) {
    // Kalshi keys are PEM PKCS#8; RSA-PSS / SHA-256 with digest-length salt (32 bytes for SHA-256).
    privateKey = await crypto.subtle.importKey(
      "pkcs8", pemToArrayBuffer(pem),
      { name: "RSASSA-PSS", hash: "SHA-256" },
      false, ["sign"]
    );
  }

  async function request(method, path, params) {
    const c = creds();
    if (!c || !privateKey) throw new Error("Not connected");
    const ts = String(Date.now());
    const sigBytes = await crypto.subtle.sign(
      { name: "RSASSA-PSS", saltLength: 32 }, privateKey,
      new TextEncoder().encode(ts + method + path)
    );
    const sig = btoa(String.fromCharCode(...new Uint8Array(sigBytes)));
    const qs = params ? "?" + Object.entries(params).filter(([, v]) => v != null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&") : "";
    const res = await fetch(T1.API_BASE + path + qs, {
      method,
      headers: {
        "KALSHI-ACCESS-KEY": c.keyId,
        "KALSHI-ACCESS-TIMESTAMP": ts,
        "KALSHI-ACCESS-SIGNATURE": sig,
        Accept: "application/json",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${path}`);
    return res.json();
  }

  const DemoConnector = {
    async connect(keyId, pem) {
      await importKey(pem);
      setCreds({ keyId, connected: Date.now() });
      await this.syncNow();
    },
    disconnect() { Store.remove(KEY_STORE); privateKey = null; this.render(); },
    async syncNow() {
      if (!creds() || !privateKey) return;
      try {
        const balance = await request("GET", "/portfolio/balance"); // official: rate_limits.md balance bucket
        const positions = await request("GET", "/portfolio/positions"); // official API reference (portfolio group)
        window.T1DemoAccount = { balance: balance.balance || balance, positions: positions.market_positions || positions };
        this.render();
      } catch (e) {
        window.T1DemoAccount = { error: e.message };
        this.render();
      }
    },
    render() {
      const box = document.getElementById("connector-panel");
      if (!box) return;
      const c = creds();
      const acct = window.T1DemoAccount;
      if (!c) {
        box.innerHTML = `<p class="muted">Optional: connect your <b>demo</b> API key to display your real demo balance/positions.
          Keys are stored only in this browser and sent only to <code>${T1.API_BASE}</code>.
          Demo accounts are created at <a href="${T1.DEMO_SITE_URL}" target="_blank" rel="noopener">demo.kalshi.co</a>
          (see <a href="https://help.kalshi.com/en/articles/13823775-creating-and-using-a-demo-account" target="_blank" rel="noopener">official tutorial</a>).
          Until then, the paper engine below tracks portfolio performance automatically. <b>Order placement is intentionally not enabled</b> — see the Flagged page (F2/F11).</p>
          <div class="connector-form">
            <input type="text" id="c-key-id" placeholder="Demo API key ID">
            <input type="password" id="c-pem" placeholder="Paste demo private key (PEM)">
            <button class="btn" id="c-connect">Connect (read-only)</button>
          </div>`;
        document.getElementById("c-connect").addEventListener("click", async () => {
          try { await this.connect(document.getElementById("c-key-id").value.trim(), document.getElementById("c-pem").value.trim()); }
          catch (e) { alert("Connect failed: " + e.message); }
        });
        return;
      }
      box.innerHTML = `<p><span class="chip chip-run">connected (read-only)</span> key <code>${UI.esc(c.keyId.slice(0, 8))}…</code>
        <button class="btn btn-sm" id="c-disconnect">Disconnect</button></p>
        ${acct ? acct.error
          ? `<p class="muted">Sync error: ${UI.esc(acct.error)} (keys must be <i>demo</i> keys; production keys are rejected on demo hosts — official docs).</p>`
          : `<div class="grid-3">
              <div class="q"><span>Demo balance</span><b>${UI.money(acct.balance?.balance)}</b></div>
              <div class="q"><span>Demo P&L</span><b>${UI.money(acct.balance?.profit_loss)}</b></div>
              <div class="q"><span>Demo positions</span><b>${acct.positions?.length ?? ""}</b></div>
             </div>
             <p class="muted">Refreshed on demand via <a class="src" href="#" id="c-resync">signed GET /portfolio/balance + /portfolio/positions</a>.</p>`
        : `<p class="muted">Syncing…</p>`}`;
      const d = document.getElementById("c-disconnect");
      if (d) d.addEventListener("click", () => this.disconnect());
      const r = document.getElementById("c-resync");
      if (r) r.addEventListener("click", (e) => { e.preventDefault(); this.syncNow(); });
    },
    init() {
      this.render();
      if (creds()) {
        const pem = Store.get("connectorPem", "");
        if (pem) importKey(pem).then(() => this.syncNow()).catch(() => {});
      }
    },
  };

  // persist the PEM separately so a reconnect after reload can sign again without re-pasting
  const _origConnect = DemoConnector.connect.bind(DemoConnector);
  DemoConnector.connect = async function (keyId, pem) {
    Store.set("connectorPem", pem);
    return _origConnect(keyId, pem);
  };

  window.DemoConnector = DemoConnector;
})();
