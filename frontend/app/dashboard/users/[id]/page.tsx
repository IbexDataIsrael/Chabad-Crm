"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AreaMultiSelect } from "@/components/AreaMultiSelect";
import { EmailInput } from "@/components/EmailInput";
import { ReportNumberMultiSelect } from "@/components/ReportNumberMultiSelect";
import { InlineEdit } from "@/components/ui/InlineEdit";
import { MultiSelectEditor } from "@/components/ui/MultiSelectEditor";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useConfirm } from "@/lib/confirm";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import type { Area, ReportNumber, ShliachVersion } from "@/lib/types";
import { EMAIL_HINT, PHONE_HINT, isValidEmail, isValidPhone } from "@/lib/validation";
import type { OrgUser } from "../page";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

/** fixes47: a dedicated per-user page — mirrors dashboard/contacts/{id}'s
 *  role (single-record view, per-field autosave, audit history) for the
 *  Users directory, which previously only offered an inline "open/edit"
 *  popup on the list page with no addressable URL and no history view. */
export default function UserDetailPage() {
  const params = useParams<{ id: string }>();
  const userId = Number(params.id);
  const router = useRouter();
  const { t } = useLocalization();
  const confirmDialog = useConfirm();
  const { user: me, isAdmin, loading } = useAuth();
  const { success, error: toastError } = useToast();

  const [user, setUser] = useState<OrgUser | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [areas, setAreas] = useState<Area[]>([]);
  const [reportNumbers, setReportNumbers] = useState<ReportNumber[]>([]);
  const [history, setHistory] = useState<ShliachVersion[]>([]);
  const [password, setPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);

  useEffect(() => {
    if (!loading && !isAdmin) router.replace("/dashboard");
  }, [loading, isAdmin, router]);

  useEffect(() => {
    if (loading || !isAdmin) return;
    apiFetch<OrgUser>(`/api/users/${userId}`).then(setUser).catch(() => setNotFound(true));
    apiFetch<Area[]>("/api/areas").then(setAreas).catch(() => {});
    apiFetch<ReportNumber[]>("/api/report-numbers").then(setReportNumbers).catch(() => {});
  }, [loading, isAdmin, userId]);

  const contactId = user?.shliach?.contact_id ?? null;

  useEffect(() => {
    if (!isAdmin || contactId == null) {
      setHistory([]);
      return;
    }
    apiFetch<ShliachVersion[]>(`/api/contacts/${contactId}/shliach-history`)
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [isAdmin, contactId]);

  async function patchUser(body: Record<string, unknown>) {
    const saved = await apiFetch<OrgUser>(`/api/users/${userId}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    setUser(saved);
  }

  async function remove() {
    if (!user) return;
    if (
      !(await confirmDialog({
        message: t("users.delete_confirm", "למחוק את המשתמש?"),
        detail: user.full_name,
      }))
    )
      return;
    try {
      await apiFetch(`/api/users/${userId}`, { method: "DELETE" });
      success(t("users.deleted", "המשתמש נמחק"));
      router.push("/dashboard/users");
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    }
  }

  async function setNewPassword() {
    if (!password.trim()) return;
    setPasswordBusy(true);
    try {
      await patchUser({ password });
      setPassword("");
      success(t("users.password_updated", "הסיסמה עודכנה"));
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setPasswordBusy(false);
    }
  }

  if (loading || !isAdmin) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;
  if (notFound) return <p className="text-gray-500">{t("users.not_found", "המשתמש לא נמצא.")}</p>;
  if (!user) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;

  const isSelf = me?.id === user.id;
  const isShliachAccount = user.role === "shliach";
  const roleLabel =
    user.role === "admin"
      ? t("users.role_admin", "מנהל מערכת")
      : user.role === "shliach"
        ? t("users.role_shliach", "פעיל")
        : t("users.role_staff", "משתמש מוגבל");

  function areaNamesText(ids: number[]): string {
    if (ids.length === 0) return "—";
    const byId = new Map(areas.map((a) => [a.id, a.area_name]));
    return ids.map((id) => byId.get(id) ?? `#${id}`).join(", ");
  }
  function reportNumberNamesText(ids: number[]): string {
    if (ids.length === 0) return "—";
    const byId = new Map(reportNumbers.map((rn) => [rn.id, rn.name]));
    return ids.map((id) => byId.get(id) ?? `#${id}`).join(", ");
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/dashboard/users" className="text-sm text-gray-500 hover:underline">
          {t("page.back_to_shluchim", "← חזרה לפעילים")}
        </Link>
        {!isSelf && (
          <button
            onClick={remove}
            className="text-sm text-status-darkred border border-status-darkred/30 rounded-md px-3 py-1 hover:bg-red-50"
          >
            {t("action.delete", "מחק")}
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{user.full_name}</h1>
        <span className="rounded px-2 py-0.5 text-xs bg-gray-100 text-gray-600">{roleLabel}</span>
        {isSelf && (
          <span className="text-xs text-gray-400">({t("users.you", "אני")})</span>
        )}
      </div>

      {!user.is_active && (
        <div className="rounded-md border border-status-darkred/40 bg-red-50 px-4 py-3 text-sm font-medium text-status-darkred">
          {t("users.login_suspended", "הכניסה למערכת הושעתה")}
        </div>
      )}

      <section className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <h2 className="font-semibold">{t("page.shliach_details", "פרטי פעיל")}</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          <div className="flex flex-col">
            <dt className="text-xs text-gray-500">{t("users.full_name", "שם מלא")}</dt>
            <dd className="text-sm">
              <InlineEdit<string>
                value={user.full_name}
                display={<span>{user.full_name}</span>}
                validate={(v) => (v.trim() ? null : t("validation.name_required", "יש להזין שם פרטי"))}
                onSave={(v) => patchUser({ full_name: v.trim() })}
                editor={(draft, setDraft) => (
                  <input className={inputClass} value={draft} onChange={(e) => setDraft(e.target.value)} />
                )}
              />
            </dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-gray-500">{t("contacts.email", "אימייל")}</dt>
            <dd className="text-sm">
              <InlineEdit<string>
                value={user.email ?? ""}
                display={user.email ? <span dir="ltr">{user.email}</span> : "—"}
                validate={(v) => (isValidEmail(v.trim()) ? null : t("validation.email_hint", EMAIL_HINT))}
                onSave={(v) => patchUser({ email: v.trim() })}
                editor={(draft, setDraft) => (
                  <input className={inputClass} dir="ltr" value={draft} onChange={(e) => setDraft(e.target.value)} />
                )}
              />
            </dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-gray-500">{t("contacts.phone", "טלפון")}</dt>
            <dd className="text-sm">
              <InlineEdit<string>
                value={user.phone ?? ""}
                display={user.phone ? <span dir="ltr">{user.phone}</span> : "—"}
                validate={(v) =>
                  v.trim() === "" || isValidPhone(v.trim()) ? null : t("validation.phone_hint", PHONE_HINT)
                }
                onSave={(v) => patchUser({ phone: v.trim() || null })}
                editor={(draft, setDraft) => (
                  <input className={inputClass} dir="ltr" value={draft} onChange={(e) => setDraft(e.target.value)} />
                )}
              />
            </dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-gray-500">{t("users.role_label", "תפקיד")}</dt>
            <dd className="text-sm">
              {isShliachAccount ? (
                roleLabel
              ) : (
                <select
                  className="rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-status-magenta focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
                  value={user.role}
                  disabled={isSelf}
                  onChange={(e) =>
                    patchUser({ role: e.target.value }).catch((err) =>
                      toastError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה")),
                    )
                  }
                >
                  <option value="staff">{t("users.role_staff", "משתמש מוגבל")}</option>
                  <option value="admin">{t("users.role_admin", "מנהל מערכת")}</option>
                </select>
              )}
            </dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-gray-500">
              {t("users.password_optional", "סיסמה (לא חובה)")}
            </dt>
            <dd className="text-sm flex items-center gap-2">
              <input
                type="password"
                className={inputClass}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={setNewPassword}
                disabled={passwordBusy || !password.trim()}
                className="rounded-md bg-status-magenta text-white px-3 py-2 text-xs font-medium hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
              >
                {passwordBusy ? t("action.saving", "שומר…") : t("action.save", "שמור")}
              </button>
            </dd>
          </div>
        </dl>

        {user.shliach && (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 border-t border-gray-100 pt-4">
            <div className="flex flex-col sm:col-span-2">
              <dt className="text-xs text-gray-500">
                {t("contact_shliach.areas", "אזורים באחריות הפעיל")}
              </dt>
              <dd className="text-sm">
                <InlineEdit<number[]>
                  value={user.shliach.area_ids}
                  display={areaNamesText(user.shliach.area_ids)}
                  commitOnBlur={false}
                  onSave={async (ids) => {
                    await patchUser({ shliach: { area_ids: ids } });
                    success(t("contact_shliach.areas_saved", "האזורים נשמרו"));
                  }}
                  editor={(draft, setDraft, commit) => (
                    <MultiSelectEditor onApply={() => commit(draft)}>
                      <AreaMultiSelect value={draft} onChange={setDraft} excludeContactId={contactId ?? undefined} />
                    </MultiSelectEditor>
                  )}
                />
              </dd>
            </div>
            <div className="flex flex-col sm:col-span-2">
              <dt className="text-xs text-gray-500">
                {t("contact_shliach.report_numbers", "מספרי דוח באחריות הפעיל")}
              </dt>
              <dd className="text-sm">
                <InlineEdit<number[]>
                  value={user.shliach.report_number_ids}
                  display={reportNumberNamesText(user.shliach.report_number_ids)}
                  commitOnBlur={false}
                  onSave={async (ids) => {
                    await patchUser({ shliach: { report_number_ids: ids } });
                    success(t("contact_shliach.report_numbers_saved", "מספרי הדוח נשמרו"));
                  }}
                  editor={(draft, setDraft, commit) => (
                    <MultiSelectEditor onApply={() => commit(draft)}>
                      <ReportNumberMultiSelect
                        value={draft}
                        onChange={setDraft}
                        excludeContactId={contactId ?? undefined}
                      />
                    </MultiSelectEditor>
                  )}
                />
              </dd>
            </div>
            <div className="flex flex-col sm:col-span-2">
              <dt className="text-xs text-gray-500">{t("contact_shliach.notes", "הערות")}</dt>
              <dd className="text-sm">
                <InlineEdit<string>
                  value={user.shliach.notes ?? ""}
                  display={
                    user.shliach.notes ? (
                      <span className="whitespace-pre-wrap">{user.shliach.notes}</span>
                    ) : (
                      "—"
                    )
                  }
                  enterCommits={false}
                  onSave={(v) => patchUser({ shliach: { notes: v.trim() || null } })}
                  editor={(draft, setDraft) => (
                    <textarea
                      className={inputClass}
                      rows={2}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                  )}
                />
              </dd>
            </div>
            {contactId != null && (
              <div className="sm:col-span-2">
                <Link
                  href={`/dashboard/contacts/${contactId}`}
                  className="text-sm text-status-magenta hover:underline"
                >
                  {t("users.view_contact", "צפייה באיש הקשר ›")}
                </Link>
              </div>
            )}
          </dl>
        )}
      </section>

      {/* fixes47: audit/edit history — reachable from a real page now,
          instead of only from the contact's own page (fixes45's original
          gap). Same full-row-snapshot view as ContactView.tsx's. */}
      {history.length > 0 && (
        <section className="bg-white rounded-xl shadow-sm p-6 space-y-2">
          <h2 className="font-semibold">{t("contact_shliach.history", "היסטוריית שינויים")}</h2>
          <ul className="text-sm space-y-1.5">
            {history.map((v) => (
              <li key={v.id} className="text-gray-600">
                <span className="text-xs text-gray-400">
                  {(v.editor_name || t("apt.history_unknown_editor", "עורך לא ידוע")) +
                    " — " +
                    (v.last_edit ? new Date(v.last_edit).toLocaleString("he-IL") : "")}
                </span>
                <br />
                {v.full_name || "—"}
                {v.email && <span dir="ltr"> · {v.email}</span>}
                {v.phone && <span dir="ltr"> · {v.phone}</span>}
                <br />
                <span className="text-xs">
                  {t("contact_shliach.report_numbers", "מספרי דוח באחריות הפעיל")}:{" "}
                  {reportNumberNamesText(v.report_number_ids)}
                  {" · "}
                  {t("contact_shliach.areas", "אזורים באחריות הפעיל")}: {areaNamesText(v.area_ids)}
                  {v.notes && (
                    <>
                      {" · "}
                      {t("contact_shliach.notes", "הערות")}: {v.notes}
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
