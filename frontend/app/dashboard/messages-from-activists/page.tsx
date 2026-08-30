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

// fixes54 §4: both lists are fetched in full (small/moderate admin-log
// volume, not a customer-facing dataset) — search + pagination are purely
// client-side, no backend/query-param changes needed.
const PAGE_SIZE = 20;

export default function MessagesFromActivistsPage() {
  const { isAdmin, loading } = useAuth();
  const { t } = useLocalization();
  const [completions, setCompletions] = useState<ReportCompletion[]>([]);
  const [comments, setComments] = useState<SystemComment[]>([]);
  const [busy, setBusy] = useState(true);
  // fixes54 §4: one search box queries both lists at once; each keeps its
  // own page number since they're independent datasets.
  const [query, setQuery] = useState("");
  const [completionsPage, setCompletionsPage] = useState(1);
  const [commentsPage, setCommentsPage] = useState(1);

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

  // fixes54 §4: one query filters both lists — activist name always,
  // plus (per list) whatever free text it carries.
  const q = query.trim().toLowerCase();
  const filteredCompletions = completions.filter(
    (c) =>
      !q ||
      contactFullName(c.activist).toLowerCase().includes(q) ||
      (c.comments ?? "").toLowerCase().includes(q) ||
      t(`shliach_msg.status_${c.status}`, c.status).toLowerCase().includes(q),
  );
  const filteredComments = comments.filter(
    (c) =>
      !q ||
      contactFullName(c.activist).toLowerCase().includes(q) ||
      c.comment.toLowerCase().includes(q),
  );
  const completionsLastPage = Math.max(1, Math.ceil(filteredCompletions.length / PAGE_SIZE));
  const commentsLastPage = Math.max(1, Math.ceil(filteredComments.length / PAGE_SIZE));
  const pagedCompletions = filteredCompletions.slice(
    (completionsPage - 1) * PAGE_SIZE, completionsPage * PAGE_SIZE,
  );
  const pagedComments = filteredComments.slice(
    (commentsPage - 1) * PAGE_SIZE, commentsPage * PAGE_SIZE,
  );

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

      {/* fixes54 §4: a single search bar queries both lists at once. */}
      <input
        className="w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta"
        placeholder={t("messages_from_activists.search_ph", "חיפוש לפי שם פעיל, סטטוס או תוכן…")}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setCompletionsPage(1);
          setCommentsPage(1);
        }}
      />

      <section className="space-y-3">
        <h2 className="font-semibold">
          {t("shliach_msg.report_completed_btn", "דיווח על השלמת הדוח")}
        </h2>
        <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
          {busy ? (
            <p className="px-4 py-6 text-center text-gray-400">{t("action.loading", "טוען…")}</p>
          ) : filteredCompletions.length === 0 ? (
            <p className="px-4 py-6 text-center text-gray-400">
              {completions.length === 0
                ? t("messages_from_activists.no_completions", "אין דיווחי השלמה עדיין.")
                : t("messages_from_activists.no_results", "לא נמצאו תוצאות התואמות לחיפוש.")}
            </p>
          ) : (
            pagedCompletions.map((c) => (
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
        {!busy && filteredCompletions.length > PAGE_SIZE && (
          <Pager page={completionsPage} lastPage={completionsLastPage} onChange={setCompletionsPage} />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">
          {t("shliach_msg.system_comment_btn", "הערות על המערכת")}
        </h2>
        <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
          {busy ? (
            <p className="px-4 py-6 text-center text-gray-400">{t("action.loading", "טוען…")}</p>
          ) : filteredComments.length === 0 ? (
            <p className="px-4 py-6 text-center text-gray-400">
              {comments.length === 0
                ? t("messages_from_activists.no_comments", "אין הערות על המערכת עדיין.")
                : t("messages_from_activists.no_results", "לא נמצאו תוצאות התואמות לחיפוש.")}
            </p>
          ) : (
            pagedComments.map((c) => (
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
        {!busy && filteredComments.length > PAGE_SIZE && (
          <Pager page={commentsPage} lastPage={commentsLastPage} onChange={setCommentsPage} />
        )}
      </section>
    </div>
  );
}

/** fixes54 §4: a small prev/next pager, mirroring the app's other
 *  server-paginated grids (Contacts/Apartments) — here purely client-side
 *  over an already-filtered array. */
function Pager({
  page,
  lastPage,
  onChange,
}: {
  page: number;
  lastPage: number;
  onChange: (page: number) => void;
}) {
  const { t } = useLocalization();
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {t("pager.prev", "→ הקודם")}
      </button>
      <span className="text-gray-500">
        {t("pager.page_of", "עמוד {page} מתוך {total}")
          .replace("{page}", String(page))
          .replace("{total}", String(lastPage))}
      </span>
      <button
        type="button"
        disabled={page >= lastPage}
        onClick={() => onChange(page + 1)}
        className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {t("pager.next", "הבא ←")}
      </button>
    </div>
  );
}
