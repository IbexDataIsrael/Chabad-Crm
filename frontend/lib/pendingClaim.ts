/** fixes65 §4: the QR claim token survives an auth detour (e.g. the user
 *  leaves the claim page for the regular login screen): the claim page
 *  stores it, login sends the user back to it, and the claim page clears it
 *  once the claim reaches a final state. Not under the "crm." prefix —
 *  clearToken() sweeps those on sign-out, and a claim must outlive that. */
const KEY = "pendingClaimToken";

export function rememberClaimToken(token: string): void {
  try {
    window.localStorage.setItem(KEY, token);
  } catch {
    /* storage unavailable — the URL still carries the token */
  }
}

export function pendingClaimToken(): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function forgetClaimToken(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
