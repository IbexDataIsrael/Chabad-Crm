// fixes107: timeouts and retries for API calls. No "@/" imports, so the
// node:test file next to it can load it directly.
//
// A stuck backend used to leave pages spinning forever with a clean console:
// the request simply never answered. Every call made through here has one
// time budget that covers the response headers AND reading the body, across
// all retries. Retries are few and spaced out, because each one is another
// request to a server that may already be overloaded.

export class RequestTimeoutError extends Error {
  constructor() {
    super("Request timed out");
    this.name = "RequestTimeoutError";
  }
}

/** One attempt: fetch and read the whole body as text under one timer.
 * The timer and the caller-abort listener are always removed afterwards. */
export async function fetchText(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<{ res: Response; text: string }> {
  const caller = init.signal ?? null;
  if (caller?.aborted) throw caller.reason ?? new DOMException("Aborted", "AbortError");
  const controller = new AbortController();
  let timedOut = false;
  const onCallerAbort = () => controller.abort(caller?.reason);
  caller?.addEventListener("abort", onCallerAbort, { once: true });
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : undefined;
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    const text = await res.text();
    return { res, text };
  } catch (err) {
    if (timedOut) throw new RequestTimeoutError();
    throw err;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    caller?.removeEventListener("abort", onCallerAbort);
  }
}

const BACKOFF_MS = [1000, 3000];
// Don't start a retry that couldn't get at least this long to run.
const MIN_ATTEMPT_MS = 2000;

/** How long to wait before retrying, or null to stop.
 * - 503 is the server saying it is overloaded: retry once, after its
 *   Retry-After (default 5s) plus up to 1s of jitter so clients don't return
 *   in lockstep.
 * - 502/504 and network errors (a proxy or a restart): up to 2 short retries.
 * - Anything else: no retry.
 * Never schedules a retry that wouldn't fit in the remaining budget. */
export function retryDelay(o: {
  status?: number;
  networkError?: boolean;
  retryAfter?: string | null;
  retries: number;
  overloadRetries: number;
  remainingMs: number;
  random?: () => number;
}): number | null {
  const random = o.random ?? Math.random;
  let delay: number;
  if (o.status === 503) {
    if (o.overloadRetries >= 1) return null;
    const seconds = Number(o.retryAfter);
    delay = (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 5000) + random() * 1000;
  } else if (o.networkError || o.status === 502 || o.status === 504) {
    if (o.retries >= BACKOFF_MS.length) return null;
    delay = BACKOFF_MS[o.retries];
  } else {
    return null;
  }
  return delay + MIN_ATTEMPT_MS <= o.remainingMs ? delay : null;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** fetchText with an overall budget (`budgetMs`, 0 = none) across attempts,
 * retrying per retryDelay when `retry` is set. Returns the last response
 * (it may be a 503 the caller turns into a "busy" message); throws
 * RequestTimeoutError when the budget runs out mid-request. */
export async function fetchWithPolicy(
  url: string,
  init: RequestInit,
  opts: {
    budgetMs: number;
    retry: boolean;
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    random?: () => number;
  },
): Promise<{ res: Response; text: string }> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const deadline = opts.budgetMs > 0 ? now() + opts.budgetMs : 0;
  const remaining = () => (deadline ? deadline - now() : Number.POSITIVE_INFINITY);
  let retries = 0;
  let overloadRetries = 0;
  for (;;) {
    const left = remaining();
    if (left <= 0) throw new RequestTimeoutError();
    let result: { res: Response; text: string };
    try {
      result = await fetchText(url, init, deadline ? left : 0, opts.fetchImpl);
    } catch (err) {
      if (err instanceof RequestTimeoutError || init.signal?.aborted || !opts.retry) throw err;
      const delay = retryDelay({
        networkError: true, retries, overloadRetries, remainingMs: remaining(), random: opts.random,
      });
      if (delay === null) throw err;
      await sleep(delay);
      retries++;
      continue;
    }
    const { res } = result;
    if (opts.retry && (res.status === 502 || res.status === 503 || res.status === 504)) {
      const delay = retryDelay({
        status: res.status,
        retryAfter: res.headers.get("Retry-After"),
        retries,
        overloadRetries,
        remainingMs: remaining(),
        random: opts.random,
      });
      if (delay !== null) {
        await sleep(delay);
        if (res.status === 503) overloadRetries++;
        else retries++;
        continue;
      }
    }
    return result;
  }
}
