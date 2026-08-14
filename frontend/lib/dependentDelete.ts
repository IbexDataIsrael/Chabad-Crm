import { apiFetch } from "@/lib/api";
import type { ConfirmOptions } from "@/lib/confirm";

/**
 * fixes48 §1: before a hard delete, check whether any dependent record would
 * be purged along with it, and pick the confirmation message accordingly —
 * the explicit data-loss warning when something's at stake, the plain "sure?"
 * text otherwise. The usage check failing (network hiccup) falls back to the
 * data-loss warning rather than silently skipping it.
 */
export async function confirmHardDelete(
  confirmDialog: (opts: ConfirmOptions) => Promise<boolean>,
  usageUrl: string,
  detail: string | undefined,
  messages: { withData: string; plain: string },
): Promise<boolean> {
  let hasData = true;
  try {
    hasData = (await apiFetch<{ count: number }>(usageUrl)).count > 0;
  } catch {
    // Fall back to the cautious (data-loss) message.
  }
  return confirmDialog({
    message: hasData ? messages.withData : messages.plain,
    detail,
  });
}
