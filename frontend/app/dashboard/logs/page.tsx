"use client";

import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import { isValidEmail } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/** fixes75 §6: the admin's Logs section — every login attempt (entry log)
 *  and every server error (error log) of this organization, plus the
 *  "Errors Admin Emails" list that gets each error by email (§9). */

const PAGE_SIZE = 50;

interface AccessRow {
  id: number;
  date: string | null;
  time: string | null;
  username: string;
  user_id: number | null;
  user_name: string | null;
  status: string;
  ip_address: string | null;
}

interface ErrorRow {
  id: number;
  created_at: string | null;
  user_name: string | null;
  method: string | null;
  path: string | null;
  error_type: string;
  message: string | null;
  traceback: string | null;
  ip_address: string | null;
}

interface Page<T> {
  total: number;
  items: T[];
}

/** Stored times are UTC without a zone marker — show them in local time. */
function localTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("he-IL");
}

type Tab = "access" | "errors";

export default function LogsPage() {
  const { isAdmin, loading } = useAuth();
  const { t } = useLocalization();
  const [tab, setTab] = useState<Tab>("access");

  if (loading || !isAdmin) {
    return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;
  }

  const tabClass = (active: boolean) =>
    `min-h-[44px] rounded-md px-4 text-sm font-medium transition-colors ${
      active ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/70"
    }`;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t("logs.title", "לוגים")}</h1>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={tabClass(tab === "access")} onClick={() => setTab("access")}>
          {t("logs.tab_access", "יומן כניסות")}
        </button>
        <button type="button" className={tabClass(tab === "errors")} onClick={() => setTab("errors")}>
          {t("logs.tab_errors", "יומן שגיאות")}
        </button>
      </div>
      {tab === "access" ? <AccessLog /> : (
        <>
          <ErrorEmailsCard />
          <ErrorLog />
        </>
      )}
    </div>
  );
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const { t } = useLocalization();
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground">
        {t("logs.total", "סה״כ: {n}").replace("{n}", String(total))}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          {t("pager.prev", "→ הקודם")}
        </Button>
        <span dir="ltr">
          {page} / {pages}
        </span>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          {t("pager.next", "הבא ←")}
        </Button>
      </div>
    </div>
  );
}

function AccessLog() {
  const { t } = useLocalization();
  const [status, setStatus] = useState<"" | "success" | "failed">("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<AccessRow> | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String((page - 1) * PAGE_SIZE),
    });
    if (status) params.set("status", status);
    if (query.trim()) params.set("q", query.trim());
    apiFetch<Page<AccessRow>>(`/api/logs/access?${params}`)
      .then(setData)
      .catch(() => setData({ total: 0, items: [] }));
  }, [page, status, query]);

  useEffect(() => {
    const id = setTimeout(load, 250);
    return () => clearTimeout(id);
  }, [load]);

  const statusLabel = (s: string) => {
    const labels: Record<string, string> = {
      SUCCESS: t("logs.status_success", "הצליח"),
      FAILED_INVALID_PASSWORD: t("logs.status_bad_password", "סיסמה שגויה"),
      FAILED_NO_USER: t("logs.status_no_user", "משתמש לא קיים"),
      FAILED_NOT_VERIFIED: t("logs.status_not_verified", "חשבון לא מאומת"),
      FAILED_ORG_DISABLED: t("logs.status_org_disabled", "הארגון מושבת"),
      ORG_SELECTION_REQUIRED: t("logs.status_org_selection", "בחירת ארגון"),
      BACKUP_CREATED: t("logs.status_backup_created", "נוצר גיבוי"),
      BACKUP_RESTORED: t("logs.status_backup_restored", "שוחזר גיבוי"),
    };
    return labels[s] ?? s;
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="max-w-xs"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          placeholder={t("logs.search_user", "חיפוש לפי שם משתמש / אימייל…")}
        />
        <select
          className="h-10 rounded-md border border-input bg-background px-2 text-sm"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as typeof status);
            setPage(1);
          }}
        >
          <option value="">{t("logs.filter_all", "כל הניסיונות")}</option>
          <option value="success">{t("logs.filter_success", "הצליחו")}</option>
          <option value="failed">{t("logs.filter_failed", "נכשלו")}</option>
        </select>
      </div>
      {data === null ? (
        <p className="text-sm text-muted-foreground">{t("action.loading", "טוען…")}</p>
      ) : data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("logs.empty", "אין רשומות.")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-start text-muted-foreground">
                <th className="py-2 pe-3 text-start font-medium">{t("logs.col_time", "זמן")}</th>
                <th className="py-2 pe-3 text-start font-medium">{t("logs.col_login_as", "שם משתמש שהוקלד")}</th>
                <th className="py-2 pe-3 text-start font-medium">{t("logs.col_user", "משתמש")}</th>
                <th className="py-2 pe-3 text-start font-medium">{t("logs.col_ip", "כתובת IP")}</th>
                <th className="py-2 text-start font-medium">{t("logs.col_result", "תוצאה")}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 even:bg-muted/40">
                  <td className="py-2 pe-3 whitespace-nowrap">
                    {r.date && r.time ? localTime(`${r.date}T${r.time}`) : "—"}
                  </td>
                  <td className="py-2 pe-3" dir="ltr">{r.username}</td>
                  <td className="py-2 pe-3">{r.user_name ?? "—"}</td>
                  <td className="py-2 pe-3" dir="ltr">{r.ip_address ?? "—"}</td>
                  <td className="py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        r.status === "SUCCESS"
                          ? "bg-status-green/15 text-status-green"
                          : r.status.startsWith("FAILED")
                            ? "bg-status-darkred/10 text-status-darkred"
                            : "bg-muted text-foreground"
                      }`}
                    >
                      {statusLabel(r.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={page} total={data.total} onPage={setPage} />}
    </Card>
  );
}

function ErrorLog() {
  const { t } = useLocalization();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<ErrorRow> | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    apiFetch<Page<ErrorRow>>(
      `/api/logs/errors?limit=${PAGE_SIZE}&offset=${(page - 1) * PAGE_SIZE}`,
    )
      .then(setData)
      .catch(() => setData({ total: 0, items: [] }));
  }, [page]);

  return (
    <Card className="p-4 space-y-3">
      <h2 className="font-semibold">{t("logs.tab_errors", "יומן שגיאות")}</h2>
      {data === null ? (
        <p className="text-sm text-muted-foreground">{t("action.loading", "טוען…")}</p>
      ) : data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("logs.empty", "אין רשומות.")}</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {data.items.map((r) => (
            <li key={r.id} className="py-2 space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="whitespace-nowrap text-muted-foreground">{localTime(r.created_at)}</span>
                <span className="font-medium text-status-darkred" dir="ltr">{r.error_type}</span>
                <span dir="ltr" className="text-muted-foreground">
                  {r.method} {r.path}
                </span>
                <span>{r.user_name ?? "—"}</span>
                <span dir="ltr" className="text-muted-foreground">{r.ip_address ?? ""}</span>
              </div>
              {r.message && (
                <p dir="ltr" className="text-start break-words">{r.message}</p>
              )}
              {r.traceback && (
                <button
                  type="button"
                  className="text-primary hover:underline text-xs"
                  onClick={() => setOpen(open === r.id ? null : r.id)}
                >
                  {open === r.id
                    ? t("logs.hide_details", "הסתר פרטים")
                    : t("logs.show_details", "הצג פרטים טכניים")}
                </button>
              )}
              {open === r.id && r.traceback && (
                <pre dir="ltr" className="max-h-80 overflow-auto rounded bg-muted p-2 text-xs text-start whitespace-pre-wrap break-words">
                  {r.traceback}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
      {data && <Pager page={page} total={data.total} onPage={setPage} />}
    </Card>
  );
}

/** fixes75 §9: the addresses that get an email for every server error. */
function ErrorEmailsCard() {
  const { t } = useLocalization();
  const { success, error: toastError } = useToast();
  const [emails, setEmails] = useState<string[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<{ errors_admin_emails: string[] }>("/api/logs/settings")
      .then((r) => setEmails(r.errors_admin_emails))
      .catch(() => setEmails([]));
  }, []);

  async function save(next: string[]) {
    setBusy(true);
    try {
      const r = await apiFetch<{ errors_admin_emails: string[] }>("/api/logs/settings", {
        method: "PUT",
        body: JSON.stringify({ errors_admin_emails: next }),
      });
      setEmails(r.errors_admin_emails);
      success(t("msg.saved", "נשמר"));
      return true;
    } catch {
      toastError(t("msg.save_failed", "שמירה נכשלה"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const email = draft.trim().toLowerCase();
    if (!isValidEmail(email)) {
      toastError(t("msg.invalid_email", "כתובת אימייל לא תקינה"));
      return;
    }
    if (emails?.includes(email)) {
      setDraft("");
      return;
    }
    if (await save([...(emails ?? []), email])) setDraft("");
  }

  return (
    <Card className="p-4 space-y-3">
      <div>
        <h2 className="font-semibold">{t("logs.error_emails_title", "מיילים לדיווח שגיאות")}</h2>
        <p className="text-sm text-muted-foreground">
          {t(
            "logs.error_emails_hint",
            "כל שגיאת מערכת נרשמת ביומן השגיאות ונשלחת במייל לכל הכתובות ברשימה (אותה שגיאה לכל היותר פעם ב-10 דקות).",
          )}
        </p>
      </div>
      {emails === null ? (
        <p className="text-sm text-muted-foreground">{t("action.loading", "טוען…")}</p>
      ) : (
        <>
          {emails.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("logs.error_emails_empty", "אין כתובות — שגיאות נרשמות ביומן בלבד.")}
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {emails.map((e) => (
                <li
                  key={e}
                  className="flex items-center gap-2 rounded-full border border-border px-3 py-1 text-sm"
                >
                  <span dir="ltr">{e}</span>
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={t("action.remove", "הסר")}
                    className="min-h-[32px] min-w-[32px] text-muted-foreground hover:text-status-darkred"
                    onClick={() => save(emails.filter((x) => x !== e))}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Input
              dir="ltr"
              type="email"
              className="max-w-xs"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              placeholder="name@example.com"
            />
            <Button type="button" disabled={busy || !draft.trim()} onClick={add}>
              {t("action.add", "הוסף")}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
