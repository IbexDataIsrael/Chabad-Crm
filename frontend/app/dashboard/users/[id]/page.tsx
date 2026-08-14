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
  // fixes48 §4: pick a previous version to preview a read-only snapshot,
  // Apartments-style (dashboard/apartments/{id}'s own history section).
  const [snapshot, setSnapshot] = useState<ShliachVersion | null>(null);
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

  function reloadHistory() {
    if (contactId == null) {
      setHistory([]);
      return;
    }
    apiFetch<ShliachVersion[]>(`/api/contacts/${contactId}/shliach-history`)
      .then(setHistory)
      .catch(() => setHistory([]));
  }

  useEffect(() => {
    if (!isAdmin) return;
    reloadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, contactId]);

  async function patchUser(body: Record<string, unknown>) {
    const saved = await apiFetch<OrgUser>(`/api/users/${userId}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    setUser(saved);
  }

  // fixes48 §4: roll one field of the linked shliach back to the value it
  // held in `snapshot` — mirrors apartments' restoreField (dashboard/
  // apartments/{id}/page.tsx): the restore is itself a new active version,
  // so refresh the history list too.
  async function restoreField(field: string) {
    if (!snapshot) return;
    const saved = await apiFetch<OrgUser>(
      `/api/users/${userId}/shliach/restore-field`,
      { method: "POST", body: JSON.stringify({ version_id: snapshot.id, field }) },
    );
    setUser(saved);
    setSnapshot(null);
    reloadHistory();
    success(t("contact_shliach.field_restored", "השדה שוחזר"));
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
          gap). fixes48 §4: aligned with the Apartments module's own history
          section — pick a previous version to preview a read-only snapshot,
          then restore individual fields back to it, instead of just a flat
          read-only list. */}
      <section className="bg-white rounded-xl shadow-sm p-6 space-y-3">
        <h2 className="font-semibold">{t("contact_shliach.history", "היסטוריית שינויים")}</h2>
        {history.length === 0 ? (
          <p className="text-sm text-gray-400">{t("apt.history_none", "אין גרסאות קודמות.")}</p>
        ) : (
          <>
            <select
              className="w-full sm:w-auto rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none"
              value={snapshot?.id ?? ""}
              onChange={(e) => {
                const id = Number(e.target.value);
                setSnapshot(history.find((h) => h.id === id) ?? null);
              }}
            >
              <option value="">{t("apt.history_pick", "בחר גרסה קודמת…")}</option>
              {history.map((h) => (
                <option key={h.id} value={h.id}>
                  {(h.editor_name || t("apt.history_unknown_editor", "עורך לא ידוע")) +
                    " — " +
                    (h.last_edit ? new Date(h.last_edit).toLocaleString("he-IL") : "")}
                </option>
              ))}
            </select>
            {snapshot && (
              <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-gray-500">
                    {t("apt.history_snapshot", "תצוגת גרסה היסטורית (לקריאה בלבד)")}
                  </p>
                  <button
                    onClick={() => setSnapshot(null)}
                    className="text-xs text-status-magenta hover:underline"
                  >
                    {t("apt.history_back_current", "חזרה לגרסה הנוכחית")}
                  </button>
                </div>
                <p className="text-xs text-gray-400">
                  {t("apt.restore_hint", "לחץ \"שחזר\" ליד שדה כדי להחזיר את ערכו לגרסה זו.")}
                </p>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <SnapRow
                    label={t("users.full_name", "שם מלא")}
                    value={snapshot.full_name}
                    field="full_name"
                    onRestore={restoreField}
                    t={t}
                  />
                  <SnapRow
                    label={t("contacts.email", "אימייל")}
                    value={snapshot.email}
                    dir="ltr"
                    field="email"
                    onRestore={restoreField}
                    t={t}
                  />
                  <SnapRow
                    label={t("contacts.phone", "טלפון")}
                    value={snapshot.phone}
                    dir="ltr"
                    field="phone"
                    onRestore={restoreField}
                    t={t}
                  />
                  <SnapRow
                    label={t("contact_shliach.areas", "אזורים באחריות הפעיל")}
                    value={areaNamesText(snapshot.area_ids)}
                    field="areas"
                    onRestore={restoreField}
                    t={t}
                  />
                  <SnapRow
                    label={t("contact_shliach.report_numbers", "מספרי דוח באחריות הפעיל")}
                    value={reportNumberNamesText(snapshot.report_number_ids)}
                    field="report_numbers"
                    onRestore={restoreField}
                    t={t}
                  />
                  <div className="sm:col-span-2">
                    <SnapRow
                      label={t("contact_shliach.notes", "הערות")}
                      value={snapshot.notes}
                      field="notes"
                      onRestore={restoreField}
                      t={t}
                    />
                  </div>
                </dl>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/** One label/value row of a read-only historical snapshot, with a per-field
 *  Restore action — same shape as the Apartments detail page's own SnapRow
 *  (dashboard/apartments/[id]/page.tsx). */
function SnapRow({
  label,
  value,
  dir,
  field,
  onRestore,
  t,
}: {
  label: string;
  value: string | null | undefined;
  dir?: "ltr";
  field: string;
  onRestore: (field: string) => Promise<void>;
  t: (key: string, fallback?: string) => string;
}) {
  const [busy, setBusy] = useState(false);
  async function restore() {
    setBusy(true);
    try {
      await onRestore(field);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <dt className="text-gray-500 flex items-center justify-between gap-2">
        <span>{label}</span>
        <button
          type="button"
          onClick={restore}
          disabled={busy}
          className="text-[11px] text-status-magenta hover:underline disabled:opacity-50"
        >
          {busy ? "…" : t("apt.restore", "שחזר")}
        </button>
      </dt>
      <dd className="font-medium" dir={dir}>
        {value || "—"}
      </dd>
    </div>
  );
}
