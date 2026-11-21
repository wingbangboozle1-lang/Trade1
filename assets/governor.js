/* Trade1 — request governor for the Kalshi demo REST client (used by assets/app.js).
 *
 * Why this exists. The dashboard polls several public REST endpoints per cycle
 * (watchlist poll, order book, trade tape, candlesticks, plus a discovery sweep that
 * walks /events pages, per-topic /series listings and one /markets call per event).
 * Fired unpaced, that burst is what the exchange throttles: the Actions collector hit
 * 220 HTTP 429 responses inside 2.2 s on 2026-11-21T06:58:35Z (data/log.md), which is
 * why data/resolved.json reported settled_total 0 and data/meta.json recorded
 * markets_status_open_accepted false — findings that were artifacts of throttling, not
 * of the API. A throttled browser client silently stops alerting, which defeats the
 * whole point of a live alerting system.
 *
 * Official rules this module follows — https://docs.kalshi.com/getting_started/rate_limits
 *   "Unauthenticated public requests are subject to separate limits. Authenticate
 *    requests where supported and back off on 429."            (the browser is unauthenticated)
 *   "A rate-limited request returns 429 Too Many Requests ... 429 responses carry the
 *    rate limit headers below, but not Retry-After. There is no penalty or cooldown.
 *    The bucket keeps refilling, and your next request succeeds once the balance covers
 *    its cost ... Apply exponential backoff on 429."            (exponential backoff, no Retry-After)
 *   "Each budget is a token bucket. The bucket refills continuously at your per-second
 *    budget, up to its capacity, and a request is allowed whenever the bucket holds
 *    enough tokens to cover its cost."                          (the pacing model below)
 *   "Most GET requests are counted in batches, so only some GET responses include
 *    X-RateLimit-Remaining and X-RateLimit-Reset." and "Publicly cacheable responses
 *    (Cache-Control: public), which include most market data, carry none of these
 *    headers."                     (headers are a bonus signal, never a requirement)
 *   "X-RateLimit-Remaining and X-RateLimit-Reset are omitted when the server has no
 *    current reading for the bucket."                           (absence is normal)
 *
 * The numbers below (ratePerSec, burst, maxInFlight, backoffMs) are OUR client-side
 * pacing choice. Kalshi publishes per-tier budgets only for authenticated requests
 * (Basic Predictions Read = 200 tokens/s at the default 10 tokens per request
 * = 20 requests/s sustained) and states that unauthenticated traffic has separate,
 * unpublished limits. We pace far below the smallest published rate and yield on the
 * first 429. No official unauthenticated request-per-second figure is claimed here.
 */
(function (root) {
  'use strict';

  var DEFAULTS = {
    ratePerSec: 3,      // sustained dispatch rate chosen by us (see header note)
    burst: 6,           // bucket capacity in requests (mirrors the exchange's model)
    maxInFlight: 2,     // concurrent requests the page will allow
    queueCap: 150,      // total queued jobs before low-priority work is dropped
    backoffMs: 1200,    // first 429 cooldown; doubles per consecutive 429
    backoffMaxMs: 30000,
    priorities: 4,      // 0 = watchlist poll, 1 = order book, 2 = chart, 3 = discovery
    dropFloor: 1        // priorities below this are never dropped from a full queue
  };

  var EPS = 1e-9;

  function mkErr(msg, code, status) {
    var e = new Error(msg);
    e.code = code;
    if (status) e.status = status;
    return e;
  }

  function create(opts) {
    opts = opts || {};
    var cfg = {};
    for (var k in DEFAULTS) cfg[k] = (opts[k] === undefined ? DEFAULTS[k] : opts[k]);
    var now = opts.now || function () { return Date.now(); };
    var schedule = opts.schedule || function (fn, ms) { return setTimeout(fn, ms); };
    var cancel = opts.cancel || function (id) { return clearTimeout(id); };

    var tokens = cfg.burst;
    var lastRefill = now();
    var queues = [];
    for (var i = 0; i < cfg.priorities; i++) queues.push([]);
    var byKey = Object.create(null);      // key -> job (queued or in flight)
    var inflight = 0, timer = null;
    var cooldownUntil = 0, streak = 0;
    var st = {
      sent: 0, completed: 0, failed: 0, throttled429: 0, dropped: 0,
      coalesced: 0, requeued: 0, backoffStreak: 0, cooldownUntil: 0,
      limit: null, remaining: null, resetSeconds: null, budgetAt: 0,
      lastThrottleAt: 0, lastOkAt: 0
    };

    /* ---------- bucket bookkeeping ---------- */
    function refill() {
      var t = now();
      if (t > lastRefill) {
        tokens = Math.min(cfg.burst, tokens + ((t - lastRefill) / 1000) * cfg.ratePerSec);
        lastRefill = t;
      }
    }
    /* The 1e-9 guard keeps float noise (0.9/5*1000 = 180.00000000000003) from
     * pushing every wait up a millisecond and drifting the whole schedule. */
    function msToNextToken() {
      if (tokens >= 1 - EPS) return 0;
      return Math.max(1, Math.ceil(((1 - tokens) / cfg.ratePerSec) * 1000 - EPS));
    }
    function queuedCount() {
      var n = 0;
      for (var p = 0; p < queues.length; p++) n += queues[p].length;
      return n;
    }
    function arm(ms) {
      if (timer !== null) return;
      timer = schedule(function () { timer = null; pump(); }, Math.max(0, Math.ceil(ms)));
    }

    /* ---------- queue helpers ---------- */
    function pick() {
      for (var p = 0; p < queues.length; p++) {
        if (queues[p].length) return queues[p].shift();
      }
      return null;
    }
    function dequeue(job) {
      var q = queues[job.pri];
      for (var ix = 0; ix < q.length; ix++) {
        if (q[ix] === job) { q.splice(ix, 1); return true; }
      }
      return false;
    }
    function dropOne() {
      /* Queue overflow: shed the least important waiting work first, never the
       * alert path (priority < dropFloor). */
      for (var p = queues.length - 1; p >= cfg.dropFloor; p--) {
        if (queues[p].length) {
          var job = queues[p].pop();
          st.dropped++;
          if (job.key) delete byKey[job.key];
          job.reject(mkErr('dropped: request queue full while throttled', 'dropped'));
          return true;
        }
      }
      return false;
    }

    /* ---------- 429 handling ---------- */
    function noteThrottle() {
      st.throttled429++;
      st.lastThrottleAt = now();
      streak = Math.min(streak + 1, 14);
      var ms = Math.min(cfg.backoffMaxMs, cfg.backoffMs * Math.pow(2, streak - 1));
      cooldownUntil = now() + ms;
      st.backoffStreak = streak;
      st.cooldownUntil = cooldownUntil;
    }
    function noteOk() {
      st.lastOkAt = now();
      /* Recovery is deliberately faster than the penalty: each clean response gives
       * back one level of the streak, so a quiet exchange returns to full rate within
       * a couple of responses while a busy one keeps backing off exponentially. */
      if (streak > 0) streak = Math.max(0, streak - 1);
      st.backoffStreak = streak;
      st.cooldownUntil = cooldownUntil;
    }
    function observeHeaders(res) {
      /* Only some GET responses carry these (official docs), and cacheable market
       * data carries none. Read them when present; never assume them. */
      var h = res && res.headers;
      if (!h || typeof h.get !== 'function') return;
      var lim = h.get('x-ratelimit-limit'), rem = h.get('x-ratelimit-remaining'),
          reset = h.get('x-ratelimit-reset');
      if (lim === null && rem === null && reset === null) return;
      st.budgetAt = now();
      if (lim !== null) st.limit = Number(lim);
      if (rem !== null) st.remaining = Number(rem);
      if (reset !== null) {
        st.resetSeconds = Number(reset);
        /* X-RateLimit-Reset is "seconds, to the millisecond, until the bucket is full
         * again" — not a window boundary. Only a fully drained reading is actionable;
         * waiting for a full bucket on every request would starve the page. */
        if (st.remaining === 0 && isFinite(st.resetSeconds) && st.resetSeconds > 0) {
          cooldownUntil = now() + Math.min(cfg.backoffMaxMs, st.resetSeconds * 1000);
          st.cooldownUntil = cooldownUntil;
        }
      }
    }

    /* ---------- dispatch ---------- */
    function settle(job, res) {
      if (job.key) delete byKey[job.key];
      st.completed++;
      job.resolve(res);
    }
    function fail(job, err) {
      if (job.key) delete byKey[job.key];
      st.failed++;
      job.reject(err);
    }
    function dispatch(job) {
      job.dispatched = true;
      inflight++;
      tokens -= 1;
      st.sent++;
      var p;
      try { p = Promise.resolve(job.worker(job.attempt || 0)); }
      catch (e) { inflight--; fail(job, e); pump(); return; }
      p.then(function (res) {
        inflight--;
        var status = res && res.status;
        observeHeaders(res);
        if (status === 429) {
          noteThrottle();
          if ((job.retry429 || 0) > (job.attempt || 0)) {
            /* Re-queue rather than hammer: the retry waits for the cooldown the
             * governor just opened, which is what "exponential backoff" means here. */
            job.dispatched = false;
            job.attempt = (job.attempt || 0) + 1;
            st.requeued++;
            if (job.key) byKey[job.key] = job;
            queues[job.pri].push(job);
            pump();
            return;
          }
          return fail(job, mkErr('throttled by the exchange (HTTP 429)', 'throttled', 429));
        }
        if (status >= 400) {
          return fail(job, mkErr('HTTP ' + status, 'http', status));
        }
        noteOk();
        settle(job, res);
        pump();
      }, function (e) {
        inflight--;
        fail(job, mkErr(String((e && e.message) || e), 'network'));
        pump();
      });
    }
    function pump() {
      var guard = 0;
      while (guard++ < 5000) {
        refill();
        if (now() < cooldownUntil) { arm(cooldownUntil - now()); return; }
        var job = null;
        if (inflight < cfg.maxInFlight && tokens >= 1 - EPS) job = pick();
        if (!job) {
          if (queuedCount() === 0) return;
          arm(inflight >= cfg.maxInFlight ? 20 : msToNextToken());
          return;
        }
        dispatch(job);
      }
    }

    /* ---------- public surface ---------- */
    function submit(job) {
      job.pri = Math.max(0, Math.min(cfg.priorities - 1, job.pri || 0));
      job.attempt = 0;
      var pr = new Promise(function (res, rej) { job.resolve = res; job.reject = rej; });
      if (job.key && byKey[job.key]) {
        var held = byKey[job.key];
        st.coalesced++;
        /* Same URL already queued or in flight: reuse that response instead of
         * sending a second request. Let the more urgent caller raise its priority
         * (never lower it). */
        if (!held.dispatched && held.pri > job.pri && dequeue(held)) {
          held.pri = job.pri;
          queues[job.pri].push(held);
        }
        arm(0);
        return held.promise || pr;
      }
      job.promise = pr;
      if (job.key) byKey[job.key] = job;
      if (queuedCount() >= cfg.queueCap) dropOne();
      queues[job.pri].push(job);
      arm(0);
      return pr;
    }

    return {
      submit: submit,
      /* Feed an observation from a caller that bypasses submit() (none today). */
      noteThrottle: function () { noteThrottle(); pump(); },
      cooling: function () { return now() < cooldownUntil; },
      cooldownMs: function () { return Math.max(0, cooldownUntil - now()); },
      stats: function () {
        return {
          queued: queuedCount(), inflight: inflight, burst: cfg.burst,
          ratePerSec: cfg.ratePerSec, tokens: Math.round(tokens * 100) / 100,
          sent: st.sent, completed: st.completed, failed: st.failed,
          throttled429: st.throttled429, requeued: st.requeued, dropped: st.dropped,
          coalesced: st.coalesced, backoffStreak: st.backoffStreak,
          cooldownMs: Math.max(0, cooldownUntil - now()),
          limit: st.limit, remaining: st.remaining, resetSeconds: st.resetSeconds,
          budgetAt: st.budgetAt, lastThrottleAt: st.lastThrottleAt, lastOkAt: st.lastOkAt
        };
      },
      config: function () { return { ratePerSec: cfg.ratePerSec, burst: cfg.burst, maxInFlight: cfg.maxInFlight, queueCap: cfg.queueCap, backoffMs: cfg.backoffMs, backoffMaxMs: cfg.backoffMaxMs }; },
      /* Test/inspection hook: run the scheduler once without waiting. */
      pump: pump
    };
  }

  root.KalshiGovernor = { create: create, DEFAULTS: DEFAULTS };
})(typeof window !== 'undefined' ? window : globalThis);
