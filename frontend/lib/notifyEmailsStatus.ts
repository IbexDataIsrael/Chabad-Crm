// fixes101 §1/§3: whether the superadmin's two notification lists are set,
// and where mail actually goes right now (env fallback while empty).

import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";

export type NotifyListName = "pending_signup" | "errors";
export type NotifyEmailsStatus = Record<NotifyListName, { configured: boolean; effective: string[] }>;

/** Fired after a list is saved, so the banner and the cards refresh. */
export const NOTIFY_EMAILS_CHANGED = "crm:notify-emails-changed";

export function useNotifyEmailsStatus(enabled = true): NotifyEmailsStatus | null {
  const [status, setStatus] = useState<NotifyEmailsStatus | null>(null);
  const load = useCallback(() => {
    apiFetch<NotifyEmailsStatus>("/api/admin/notify-emails-status")
      .then(setStatus)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    load();
    window.addEventListener(NOTIFY_EMAILS_CHANGED, load);
    return () => window.removeEventListener(NOTIFY_EMAILS_CHANGED, load);
  }, [enabled, load]);
  return status;
}
