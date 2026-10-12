// fixes101 §2c: send a crash in the browser to the backend error log
// (POST /api/logs/client-error → error_logs + the error alert emails).
// Never throws, never loops: the same error is reported once per page load.

import { API_URL, ApiError, getToken } from "@/lib/api";

const reported = new Set<string>();
const MAX_PER_LOAD = 10;

export type ClientErrorKind = "error" | "unhandledrejection" | "react";

/** Not bugs in our code: an API error (a 5xx is already logged by the server,
 *  a 4xx is an expected answer) or the phone dropping its connection. */
function isNoise(err: unknown): boolean {
  if (err instanceof ApiError) return true;
  const msg = err instanceof Error ? err.message : "";
  return /^(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?)$/.test(msg);
}

export function reportClientError(err: unknown, kind: ClientErrorKind): void {
  if (typeof window === "undefined") return;
  try {
    if (isNoise(err)) return;
    const e = err instanceof Error ? err : null;
    const errorType = (e?.name || (kind === "unhandledrejection" ? "UnhandledRejection" : "Error")).slice(0, 200);
    const message = (e?.message ?? String(err ?? "")).slice(0, 4000);
    const key = `${errorType}|${message}`;
    if (reported.has(key) || reported.size >= MAX_PER_LOAD) return;
    reported.add(key);

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    void fetch(`${API_URL}/api/logs/client-error`, {
      method: "POST",
      headers,
      keepalive: true,
      body: JSON.stringify({
        error_type: errorType,
        message,
        stack: `[${kind}] ${e?.stack ?? ""}`.slice(0, 20000),
        page: (window.location.pathname + window.location.search).slice(0, 500),
        user_agent: navigator.userAgent.slice(0, 500),
      }),
    }).catch(() => undefined);
  } catch {
    /* reporting must never break the page */
  }
}
