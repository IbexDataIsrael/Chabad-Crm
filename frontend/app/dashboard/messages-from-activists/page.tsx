"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { ReportStatusBadge as StatusBadge } from "@/components/ReportStatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { contactFullName, type ReportCompletion, type SystemComment } from "@/lib/types";

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

  if (loading) return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;
  if (!isAdmin) {
    return (
      <p className="text-destructive">
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
        <h1 className="font-display text-4xl font-bold">
          {t("nav.messages_from_activists", "הודעות מהפעילים")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "messages_from_activists.intro",
            "דיווחי השלמת דוחות והערות על המערכת שנשלחו על ידי פעילים.",
          )}
        </p>
      </div>

      {/* fixes54 §4: a single search bar queries both lists at once. */}
      <Input
        className="max-w-sm"
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
        <div className="glass-card divide-y divide-border">
          {busy ? (
            <p className="px-4 py-6 text-center text-muted-foreground">{t("action.loading", "טוען…")}</p>
          ) : filteredCompletions.length === 0 ? (
            <p className="px-4 py-6 text-center text-muted-foreground">
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
                    className="font-medium text-primary hover:underline"
                  >
                    {contactFullName(c.activist)}
                  </Link>
                  <StatusBadge status={c.status} />
                  {/* fixes74 §11: the task the report is about, when linked. */}
                  {c.task_id != null && (
                    <Link
                      href={`/dashboard/tasks/${c.task_id}`}
                      className="text-xs text-primary hover:underline"
                    >
                      {t("task.title", "משימה")} #{c.task_id}
                    </Link>
                  )}
                  <span className="ms-auto text-xs text-muted-foreground" dir="ltr">
                    {new Date(c.created_at).toLocaleString()}
                  </span>
                </div>
                {c.comments && <p className="text-sm text-muted-foreground">{c.comments}</p>}
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
        <div className="glass-card divide-y divide-border">
          {busy ? (
            <p className="px-4 py-6 text-center text-muted-foreground">{t("action.loading", "טוען…")}</p>
          ) : filteredComments.length === 0 ? (
            <p className="px-4 py-6 text-center text-muted-foreground">
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
                    className="font-medium text-primary hover:underline"
                  >
                    {contactFullName(c.activist)}
                  </Link>
                  <span className="ms-auto text-xs text-muted-foreground" dir="ltr">
                    {new Date(c.created_at).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{c.comment}</p>
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
      <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        {t("pager.prev", "→ הקודם")}
      </Button>
      <span className="text-muted-foreground">
        {t("pager.page_of", "עמוד {page} מתוך {total}")
          .replace("{page}", String(page))
          .replace("{total}", String(lastPage))}
      </span>
      <Button type="button" variant="outline" size="sm" disabled={page >= lastPage} onClick={() => onChange(page + 1)}>
        {t("pager.next", "הבא ←")}
      </Button>
    </div>
  );
}
