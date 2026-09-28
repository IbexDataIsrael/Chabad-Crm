// Server-only fetch helper for generateMetadata() calls (fixes69 Bug 2):
// a WhatsApp/social preview crawler never sends the browser's JWT, so these
// must only ever hit the public, unauthenticated /api/public/* endpoints.
//
// NEXT_PUBLIC_API_URL is host-relative ("http://localhost:8001" in local
// docker-compose) — correct for the browser, but unreachable from inside the
// frontend container itself. INTERNAL_API_URL overrides it for server-side
// calls only; in production (Vercel -> Render over the public internet)
// there's no separate internal address, so it falls back to the same public
// API URL the browser already uses.
const SERVER_API_URL =
  process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

/** Fetches a public API path server-side; null on any failure (404, network,
 *  backend down) so a broken/slow preview lookup never blocks page render —
 *  callers fall back to the app's generic metadata. */
export async function serverFetchPublic<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${SERVER_API_URL}${path}`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
