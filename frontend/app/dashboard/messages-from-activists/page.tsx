"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import {
  contactFullName,
  type ReportCompletion,
  type ReportCompletionStatus,
  type SystemComment,
} from "@/lib/types";

// fixes53 §9: exact hex values from spec — distinct from (and more saturated
// than) this app's own status-green/status-orange/status-darkred theme
// tokens, so they're inline styles rather than Tailwind classes.
const STATUS_COLORS: Record<ReportCompletionStatus, string> = {
  completed: "#2e7d32",
  not_completed: "#d32f2f",
  partial: "#ed6c02",
};

function StatusBadge({ status }: { status: ReportCompletionStatus }) {
  const { t } = useLocalization();
  const labels: Record<ReportCompletionStatus, string> = {
    completed: t("shliach_msg.status_completed", "דוח הושלם"),
    not_completed: t("shliach_msg.status_not_completed", "דוח לא הושלם"),
    partial: t("shliach_msg.status_partial", "דוח הושלם חלקית"),
  };
  return (
    <span
      className="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium text-white"
      style={{ backgroundColor: STATUS_COLORS[status] }}
    >
      {labels[status]}
    </span>
  );
}

export default function MessagesFromActivistsPage() {
  const { isAdmin, loading } = useAuth();
  const { t } = useLocalization();
  const [completions, setCompletions] = useState<ReportCompletion[]>([]);
  const [comments, setComments] = useState<SystemComment[]>([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    if (loading || !isAdmin) return;
    Promise.all([
      apiFetch<ReportCompletion[]>("/api/shliach-messages/report-completions"),
      apiFetch<SystemComment[]>("/api/shliach-messages/system-comments"),
    ])
      .then(([c, s]) => {
        setCompletions(c);
        setComments(s);
      })
      .catch(() => {
        setCompletions([]);
        setComments([]);
      })
      .finally(() => setBusy(false));
  }, [loading, isAdmin]);

  if (loading) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;
  if (!isAdmin) {
    return (
      <p className="text-status-darkred">
        {t("page.admins_only", "אין לך הרשאה לעמוד זה (מנהלים בלבד).")}
      </p>
    );
  }

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">
          {t("nav.messages_from_activists", "הודעות מהפעילים")}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {t(
            "messages_from_activists.intro",
            "דיווחי השלמת דוחות והערות על המערכת שנשלחו על ידי פעילים.",
          )}
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="font-semibold">
          {t("shliach_msg.report_completed_btn", "דיווח על השלמת הדוח")}
        </h2>
        <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
          {busy ? (
            <p className="px-4 py-6 text-center text-gray-400">{t("action.loading", "טוען…")}</p>
          ) : completions.length === 0 ? (
            <p className="px-4 py-6 text-center text-gray-400">
              {t("messages_from_activists.no_completions", "אין דיווחי השלמה עדיין.")}
            </p>
          ) : (
            completions.map((c) => (
              <div key={c.id} className="px-4 py-3 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/dashboard/contacts/${c.activist.id}`}
                    className="font-medium text-status-magenta hover:underline"
                  >
                    {contactFullName(c.activist)}
                  </Link>
                  <StatusBadge status={c.status} />
                  <span className="ms-auto text-xs text-gray-400" dir="ltr">
                    {new Date(c.created_at).toLocaleString()}
                  </span>
                </div>
                {c.comments && <p className="text-sm text-gray-600">{c.comments}</p>}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">
          {t("shliach_msg.system_comment_btn", "הערות על המערכת")}
        </h2>
        <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
          {busy ? (
            <p className="px-4 py-6 text-center text-gray-400">{t("action.loading", "טוען…")}</p>
          ) : comments.length === 0 ? (
            <p className="px-4 py-6 text-center text-gray-400">
              {t("messages_from_activists.no_comments", "אין הערות על המערכת עדיין.")}
            </p>
          ) : (
            comments.map((c) => (
              <div key={c.id} className="px-4 py-3 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/dashboard/contacts/${c.activist.id}`}
                    className="font-medium text-status-magenta hover:underline"
                  >
                    {contactFullName(c.activist)}
                  </Link>
                  <span className="ms-auto text-xs text-gray-400" dir="ltr">
                    {new Date(c.created_at).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm text-gray-600 whitespace-pre-wrap">{c.comment}</p>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
