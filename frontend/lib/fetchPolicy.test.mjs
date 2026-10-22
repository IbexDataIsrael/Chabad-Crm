// fixes107: request budget covers headers AND body, listeners/timers are
// cleaned up, overload (503) is retried at most once and never past the budget.
// From frontend/ run:  node --test lib/fetchPolicy.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { RequestTimeoutError, fetchText, fetchWithPolicy, retryDelay } from "./fetchPolicy.ts";

/** A fetch whose response headers arrive at once but whose body never ends
 * (until aborted — real fetch errors the body stream on abort, so does this). */
function headersThenStalledBody() {
  return (url, init) => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{\"partial\":"));
        init.signal.addEventListener("abort", () =>
          controller.error(new DOMException("aborted", "AbortError")),
        );
      },
    });
    return Promise.resolve(new Response(body, { status: 200 }));
  };
}

function neverAnswers() {
  return (url, init) =>
    new Promise((_, reject) =>
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))),
    );
}

function respond(status, text = "{}", headers = {}) {
  return new Response(text, { status, headers });
}

/** Counts live listeners on a caller signal and live timers. */
function spySignal() {
  const target = new EventTarget();
  const live = new Set();
  return {
    live,
    signal: {
      aborted: false,
      reason: undefined,
      addEventListener(type, fn, opts) {
        live.add(fn);
        target.addEventListener(type, fn, opts);
      },
      removeEventListener(type, fn) {
        live.delete(fn);
        target.removeEventListener(type, fn);
      },
    },
  };
}

function trackTimers(t) {
  const live = new Set();
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  t.mock.method(globalThis, "setTimeout", (fn, ms, ...args) => {
    const id = realSet(() => {
      live.delete(id);
      fn(...args);
    }, ms);
    live.add(id);
    return id;
  });
  t.mock.method(globalThis, "clearTimeout", (id) => {
    live.delete(id);
    realClear(id);
  });
  return live;
}

test("the timeout also covers reading the body, not just the headers", async () => {
  const started = Date.now();
  await assert.rejects(fetchText("http://x", {}, 80, headersThenStalledBody()), RequestTimeoutError);
  assert.ok(Date.now() - started < 1000);
});

test("a request that never answers times out", async () => {
  await assert.rejects(fetchText("http://x", {}, 50, neverAnswers()), RequestTimeoutError);
});

test("timer and caller-abort listener are removed after success and after failure", async (t) => {
  const timers = trackTimers(t);
  const ok = spySignal();
  const { text } = await fetchText("http://x", { signal: ok.signal }, 5000, async () => respond(200, "hi"));
  assert.equal(text, "hi");
  assert.equal(ok.live.size, 0);
  assert.equal(timers.size, 0);

  const bad = spySignal();
  await assert.rejects(
    fetchText("http://x", { signal: bad.signal }, 5000, async () => {
      throw new TypeError("Failed to fetch");
    }),
    TypeError,
  );
  assert.equal(bad.live.size, 0);
  assert.equal(timers.size, 0);
});

test("a caller abort is passed through, not reported as a timeout", async () => {
  const controller = new AbortController();
  const p = fetchText("http://x", { signal: controller.signal }, 5000, neverAnswers());
  controller.abort();
  await assert.rejects(p, (err) => !(err instanceof RequestTimeoutError));
});

test("503 overload: retried once after Retry-After + jitter, never twice", () => {
  const base = { status: 503, retries: 0, remainingMs: 30000, random: () => 0.5 };
  assert.equal(retryDelay({ ...base, retryAfter: "5", overloadRetries: 0 }), 5500);
  assert.equal(retryDelay({ ...base, retryAfter: null, overloadRetries: 0 }), 5500); // default 5s
  assert.equal(retryDelay({ ...base, retryAfter: "5", overloadRetries: 1 }), null);
});

test("no retry is scheduled that would not fit in the remaining budget", () => {
  assert.equal(
    retryDelay({ status: 503, retryAfter: "5", retries: 0, overloadRetries: 0, remainingMs: 6000, random: () => 0 }),
    null, // 5s wait + 2s minimum attempt > 6s left
  );
  assert.equal(retryDelay({ status: 502, retries: 0, overloadRetries: 0, remainingMs: 2500 }), null);
});

test("502/504/network: at most two short retries; other statuses never", () => {
  const o = { overloadRetries: 0, remainingMs: 30000 };
  assert.equal(retryDelay({ ...o, status: 502, retries: 0 }), 1000);
  assert.equal(retryDelay({ ...o, status: 504, retries: 1 }), 3000);
  assert.equal(retryDelay({ ...o, networkError: true, retries: 2 }), null);
  assert.equal(retryDelay({ ...o, status: 500, retries: 0 }), null);
  assert.equal(retryDelay({ ...o, status: 429, retries: 0 }), null);
});

test("fetchWithPolicy: 503 then 200 → one retry; returns the 200", async () => {
  const replies = [respond(503, '{"detail":"Server is busy, please try again"}', { "Retry-After": "5" }), respond(200, '{"ok":1}')];
  const sleeps = [];
  const { res, text } = await fetchWithPolicy("http://x", {}, {
    budgetMs: 30000, retry: true, fetchImpl: async () => replies.shift(),
    sleep: async (ms) => sleeps.push(ms), random: () => 0,
  });
  assert.equal(res.status, 200);
  assert.equal(text, '{"ok":1}');
  assert.deepEqual(sleeps, [5000]);
});

test("fetchWithPolicy: persistent 503 → one retry, then the 503 is returned (no hammering)", async () => {
  let calls = 0;
  const { res } = await fetchWithPolicy("http://x", {}, {
    budgetMs: 30000, retry: true,
    fetchImpl: async () => (calls++, respond(503, "{}", { "Retry-After": "5" })),
    sleep: async () => {}, random: () => 0,
  });
  assert.equal(res.status, 503);
  assert.equal(calls, 2);
});

test("fetchWithPolicy: the budget spans all attempts", async () => {
  let clock = 0;
  let calls = 0;
  // Each attempt "takes" 13s and fails at the network level.
  const fetchImpl = async () => {
    calls++;
    clock += 13000;
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(
    fetchWithPolicy("http://x", {}, {
      budgetMs: 30000, retry: true, fetchImpl, now: () => clock,
      sleep: async (ms) => { clock += ms; },
    }),
    TypeError,
  );
  // 13s + 1s wait + 13s = 27s; a third try (3s wait + 2s min) would pass 30s.
  assert.equal(calls, 2);
});

test("fetchWithPolicy: writes (retry=false) are never retried", async () => {
  let calls = 0;
  const { res } = await fetchWithPolicy("http://x", { method: "POST" }, {
    budgetMs: 30000, retry: false,
    fetchImpl: async () => (calls++, respond(503)), sleep: async () => {},
  });
  assert.equal(res.status, 503);
  assert.equal(calls, 1);
});
