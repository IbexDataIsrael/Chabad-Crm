/** Navigation helpers. */

/**
 * Restrict a ?return= style target to internal paths (open-redirect guard —
 * same rule as the login deep-link): must start with "/" and not "//".
 */
export function safeInternalPath(raw: string | null, fallback: string): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return fallback;
}
