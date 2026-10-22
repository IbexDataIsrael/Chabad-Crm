"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowRight, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { AreaMultiSelect } from "@/components/AreaMultiSelect";
import { EmailInput } from "@/components/EmailInput";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineEdit } from "@/components/ui/InlineEdit";
import { MultiSelectEditor } from "@/components/ui/MultiSelectEditor";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useConfirm } from "@/lib/confirm";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import type { Area, ReportNumber, ShliachVersion } from "@/lib/types";
import {
  EMAIL_HINT,
  PASSWORD_HINT,
  PHONE_HINT,
  isMediumPassword,
  isValidEmail,
  isValidPhone,
} from "@/lib/validation";
import type { OrgUser } from "../page";

const inputClass =
  "w-full rounded-md border border-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

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
  const [passwordError, setPasswordError] = useState("");

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
    if (!isMediumPassword(password)) {
      setPasswordError(t("validation.password_hint", PASSWORD_HINT));
      return;
    }
    setPasswordError("");
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

  if (loading || !isAdmin) return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;
  if (notFound) return <p className="text-muted-foreground">{t("users.not_found", "המשתמש לא נמצא.")}</p>;
  if (!user) return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;

  const isSelf = me?.id === user.id;
  const isShliachAccount = user.role === "shliach";
  const roleLabel =
    user.role === "admin"
      ? t("users.role_admin", "מנהל מערכת")
      : user.role === "shliach"
        ? t("users.role_shliach", "פעיל")
        : user.role === "campaign_manager"
          ? t("users.role_campaign_manager", "מנהל קמפיינים")
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
        <Link
          href="/dashboard/users"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ArrowRight className="h-4 w-4" /> {t("page.back_to_shluchim", "חזרה לפעילים")}
        </Link>
        {!isSelf && (
          <Button
            variant="outline"
            size="sm"
            className="border-status-darkred/30 text-status-darkred hover:bg-status-darkred/10"
            onClick={remove}
          >
            <Trash2 className="h-4 w-4" /> {t("action.delete", "מחק")}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{user.full_name}</h1>
        <Badge variant="secondary">{roleLabel}</Badge>
        {isSelf && (
          <span className="text-xs text-muted-foreground">({t("users.you", "אני")})</span>
        )}
      </div>

      {!user.is_active && (
        <div className="rounded-md border border-status-darkred/40 bg-status-darkred/10 px-4 py-3 text-sm font-medium text-status-darkred">
          {t("users.login_suspended", "הכניסה למערכת הושעתה")}
        </div>
      )}

      <section className="bg-card border border-border rounded-xl shadow-sm p-6 space-y-4">
        <h2 className="font-semibold">{t("page.shliach_details", "פרטי פעיל")}</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          <div className="flex flex-col">
            <dt className="text-xs text-muted-foreground">{t("users.full_name", "שם מלא")}</dt>
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
          {/* fixes105: the login username — editable (org-unique, the API
              rejects a taken one with "שם המשתמש כבר תפוס"). */}
          <div className="flex flex-col">
            <dt className="text-xs text-muted-foreground">{t("auth.username", "שם משתמש")}</dt>
            <dd className="text-sm">
              <InlineEdit<string>
                value={user.username}
                display={<span dir="ltr">{user.username}</span>}
                validate={(v) => (v.trim() ? null : t("users.username_required", "יש להזין שם משתמש"))}
                onSave={(v) => patchUser({ username: v.trim() })}
                editor={(draft, setDraft) => (
                  <input
                    className={inputClass}
                    dir="ltr"
                    maxLength={50}
                    autoComplete="off"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                )}
              />
            </dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-muted-foreground">{t("contacts.email", "אימייל")}</dt>
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
            <dt className="text-xs text-muted-foreground">{t("contacts.phone", "טלפון")}</dt>
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
            <dt className="text-xs text-muted-foreground">{t("users.role_label", "תפקיד")}</dt>
            <dd className="text-sm">
              {isShliachAccount ? (
                roleLabel
              ) : (
                <select
                  className="rounded-md border border-input px-2 py-1 text-xs focus:border-primary focus:outline-none disabled:bg-background disabled:text-muted-foreground"
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
                  <option value="campaign_manager">
                    {t("users.role_campaign_manager", "מנהל קמפיינים")}
                  </option>
                </select>
              )}
            </dd>
          </div>
          {/* fixes54 §1: is_active was already a settable OrgUserUpdate field
              (the list page's "login suspended" badge only ever showed the
              read-only banner above) — no way to actually flip it back from
              this page without the separate shliach-only "recreate" flow. */}
          <div className="flex flex-col">
            <dt className="text-xs text-muted-foreground">{t("users.login_status", "סטטוס כניסה")}</dt>
            <dd className="text-sm">
              {/* inline-flex, not flex: a block-level label made the whole
                  column width an invisible "suspend login" click target right
                  under the name field — clicking away from a name edit
                  silently suspended the user (and hid them from the grid). */}
              <label className="inline-flex w-fit items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  disabled={isSelf}
                  checked={user.is_active}
                  onChange={async (e) => {
                    const active = e.target.checked;
                    if (
                      !active &&
                      !(await confirmDialog({
                        message: t("users.suspend_confirm", "להשעות את הכניסה למערכת של המשתמש?"),
                        detail: user.full_name,
                      }))
                    )
                      return;
                    patchUser({ is_active: active }).catch((err) =>
                      toastError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה")),
                    );
                  }}
                />
                {user.is_active
                  ? t("admin.active", "פעיל")
                  : t("users.login_suspended", "הכניסה למערכת הושעתה")}
              </label>
            </dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-muted-foreground">
              {t("users.password_optional", "סיסמה (לא חובה)")}
            </dt>
            <dd className="text-sm space-y-1">
              <div className="flex items-center gap-2">
                <PasswordInput
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setPasswordError("");
                  }}
                  autoComplete="new-password"
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={setNewPassword}
                  disabled={passwordBusy || !password.trim()}
                  className="whitespace-nowrap"
                >
                  {passwordBusy ? t("action.saving", "שומר…") : t("action.save", "שמור")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t("validation.password_hint", PASSWORD_HINT)}</p>
              {passwordError && <p className="text-xs text-status-darkred">{passwordError}</p>}
            </dd>
          </div>
        </dl>

        {user.shliach && (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 border-t border-border pt-4">
            <div className="flex flex-col sm:col-span-2">
              <dt className="text-xs text-muted-foreground">
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
            {/* fixes58 §Phase 4: read-only — apartment access now comes from
                a Task (Users list's "Add task" quick action), not this
                direct assignment. */}
            <div className="flex flex-col sm:col-span-2">
              <dt className="text-xs text-muted-foreground">
                {t("contact_shliach.report_numbers", "מספרי דוח באחריות הפעיל")}
              </dt>
              <dd className="text-sm space-y-1">
                <div>{reportNumberNamesText(user.shliach.report_number_ids)}</div>
                <p className="text-xs text-muted-foreground">
                  {t(
                    "contact_shliach.report_numbers_moved_to_tasks",
                    "שיוך מספרי דוח מנוהל כעת דרך עמוד המשימות.",
                  )}
                </p>
              </dd>
            </div>
            <div className="flex flex-col sm:col-span-2">
              <dt className="text-xs text-muted-foreground">{t("contact_shliach.notes", "הערות")}</dt>
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
          </dl>
        )}
      </section>

      {/* fixes47: audit/edit history — reachable from a real page now,
          instead of only from the contact's own page (fixes45's original
          gap). fixes48 §4: aligned with the Apartments module's own history
          section — pick a previous version to preview a read-only snapshot,
          then restore individual fields back to it, instead of just a flat
          read-only list. */}
      <section className="bg-card border border-border rounded-xl shadow-sm p-6 space-y-3">
        <h2 className="font-semibold">{t("contact_shliach.history", "היסטוריית שינויים")}</h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("apt.history_none", "אין גרסאות קודמות.")}</p>
        ) : (
          <>
            <select
              className="w-full sm:w-auto rounded-md border border-input px-3 py-2 text-sm focus:border-primary focus:outline-none"
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
              <div className="rounded-lg border border-dashed border-input bg-background p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t("apt.history_snapshot", "תצוגת גרסה היסטורית (לקריאה בלבד)")}
                  </p>
                  <button
                    onClick={() => setSnapshot(null)}
                    className="text-xs text-primary hover:underline"
                  >
                    {t("apt.history_back_current", "חזרה לגרסה הנוכחית")}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
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
      <dt className="text-muted-foreground flex items-center justify-between gap-2">
        <span>{label}</span>
        <button
          type="button"
          onClick={restore}
          disabled={busy}
          className="text-[11px] text-primary hover:underline disabled:opacity-50"
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
