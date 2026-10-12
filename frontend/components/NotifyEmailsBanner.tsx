"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useLocalization } from "@/lib/localization";
import { useNotifyEmailsStatus } from "@/lib/notifyEmailsStatus";

/** fixes101 §3: shown to the superadmin on every page while the signup or
 *  error notification list is still empty. */
export function NotifyEmailsBanner() {
  const { t } = useLocalization();
  const pathname = usePathname();
  const status = useNotifyEmailsStatus();
  if (!status) return null;

  const missing: string[] = [];
  if (!status.pending_signup.configured)
    missing.push(t("admin.pending_signup_emails_title", "התראות על הרשמת ארגון חדש"));
  if (!status.errors.configured)
    missing.push(t("admin.error_notify_emails_title", "התראות על שגיאות מערכת"));
  if (missing.length === 0) return null;

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-status-orange/40 bg-status-orange/10 px-4 py-2 text-sm"
    >
      <AlertTriangle className="h-4 w-4 shrink-0 text-status-orange" />
      <span className="font-medium">
        {t("admin.notify_emails_missing", "לא הוגדרו כתובות מייל להתראות:")}
      </span>
      <span>{missing.join(" · ")}</span>
      {pathname !== "/dashboard/admin/settings" && (
        <Link href="/dashboard/admin/settings" className="font-medium text-primary underline">
          {t("admin.notify_emails_configure", "להגדרה")}
        </Link>
      )}
    </div>
  );
}
