"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { EmailInput } from "@/components/EmailInput";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { usePersistentState } from "@/lib/persist";
import { useToast } from "@/lib/toast";

interface OrgUser {
  id: number;
  username: string;
  full_name: string;
  email: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
}

type SortKey = "name" | "created";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";
// Compact variant for the sort/paging toolbar controls.
const toolbarSelectClass =
  "rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none";

export default function UsersPage() {
  const router = useRouter();
  const { user: me, isAdmin, loading } = useAuth();
  const { t } = useLocalization();
  const { success, error: toastError } = useToast();
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<OrgUser | null>(null);
  const [busy, setBusy] = useState(true);
  // fixes15 §3.2: sorting (A-Z / date created) + paging, persisted (§1.2).
  const [sort, setSort] = usePersistentState<SortKey>("crm.users.sort", "name");
  const [dir, setDir] = usePersistentState<"asc" | "desc">("crm.users.dir", "asc");
  const [page, setPage] = usePersistentState("crm.users.page", 1);
  const [pageSize, setPageSize] = usePersistentState("crm.users.pageSize", 20);

  useEffect(() => {
    if (!loading && !isAdmin) router.replace("/dashboard");
  }, [loading, isAdmin, router]);

  async function reload() {
    setUsers(await apiFetch<OrgUser[]>("/api/users"));
  }

  useEffect(() => {
    if (loading || !isAdmin) return;
    reload()
      .catch(() => setUsers([]))
      .finally(() => setBusy(false));
  }, [loading, isAdmin]);

  async function remove(u: OrgUser) {
    if (!confirm(`${t("users.delete_confirm", "למחוק את המשתמש?")} '${u.full_name}'`)) return;
    try {
      await apiFetch(`/api/users/${u.id}`, { method: "DELETE" });
      await reload();
      success(t("users.deleted", "המשתמש נמחק"));
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    }
  }

  if (loading || !isAdmin) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;

  const roleLabel = (role: string) =>
    role === "admin"
      ? t("users.role_admin", "מנהל")
      : role === "shliach"
        ? t("users.role_shliach", "פעיל")
        : t("users.role_staff", "משתמש מוגבל");

  // Client-side sort + page — the org's user directory is one small list.
  const sorted = [...users].sort((a, b) => {
    const cmp =
      sort === "created"
        ? a.created_at.localeCompare(b.created_at)
        : a.full_name.localeCompare(b.full_name, "he");
    return dir === "desc" ? -cmp : cmp;
  });
  const lastPage = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, lastPage);
  const visible = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);
  const rangeText = t("pager.range", "{from}–{to} מתוך {total}")
    .replace("{from}", String(sorted.length === 0 ? 0 : (safePage - 1) * pageSize + 1))
    .replace("{to}", String(Math.min(safePage * pageSize, sorted.length)))
    .replace("{total}", String(sorted.length));

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{t("users.title", "ניהול משתמשים")}</h1>
          <p className="text-sm text-gray-500">
            {t(
              "users.intro",
              "הוסף וערוך משתמשים בארגון. מנהל מקבל הרשאות מלאות; משתמש מוגבל רואה אנשי קשר בלבד.",
            )}
          </p>
        </div>
        {!adding && (
          <button
            onClick={() => {
              setAdding(true);
              setEditing(null);
            }}
            className="rounded-md bg-status-magenta text-white px-4 py-2 text-sm font-medium hover:opacity-90"
          >
            + {t("users.add_user", "משתמש חדש")}
          </button>
        )}
      </div>

      {adding && (
        <UserForm
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            await reload();
            success(t("users.created", "המשתמש נוצר ונשלח אליו מייל קבלת פנים"));
          }}
        />
      )}

      {editing && (
        <UserForm
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
            success(t("users.updated", "המשתמש עודכן"));
          }}
        />
      )}

      {/* fixes15 §3.2: sorting + paging toolbar. */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="flex items-center gap-2 text-gray-500">
          {t("sort.label", "מיון:")}
          <select
            className={toolbarSelectClass}
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as SortKey);
              setPage(1);
            }}
          >
            <option value="name">{t("sort.by_name", "שם")}</option>
            <option value="created">{t("sort.created", "תאריך יצירה")}</option>
          </select>
          <button
            type="button"
            onClick={() => {
              setDir(dir === "asc" ? "desc" : "asc");
              setPage(1);
            }}
            className="rounded-md border border-gray-300 px-3 py-2 hover:bg-gray-50"
            title={dir === "asc" ? t("sort.asc", "עולה") : t("sort.desc", "יורד")}
          >
            {dir === "asc" ? "↑" : "↓"}
          </button>
        </span>
        <span className="ms-auto flex items-center gap-2 text-gray-500">
          {t("pager.page_size", "בעמוד:")}
          <select
            className={toolbarSelectClass}
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
          >
            {[20, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </span>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-start">
            <tr>
              <th className="px-4 py-2 text-start font-medium">{t("common.name", "שם")}</th>
              <th className="px-4 py-2 text-start font-medium">{t("contacts.email", "אימייל")}</th>
              <th className="px-4 py-2 text-start font-medium">{t("users.role_label", "תפקיד")}</th>
              <th className="px-4 py-2 text-start font-medium">
                {t("contacts.created_at", "נוצר בתאריך")}
              </th>
              <th className="px-4 py-2 text-start font-medium"></th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {busy ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                  {t("action.loading", "טוען…")}
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                  {t("users.none", "אין משתמשים.")}
                </td>
              </tr>
            ) : (
              visible.map((u) => (
                <tr key={u.id} className="border-t border-gray-100">
                  <td className="px-4 py-2 font-medium">
                    {u.full_name}
                    {me?.id === u.id && (
                      <span className="ms-2 text-xs text-gray-400">({t("users.you", "אני")})</span>
                    )}
                  </td>
                  <td className="px-4 py-2" dir="ltr">
                    {u.email ?? u.username}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        u.role === "admin"
                          ? "bg-status-magenta/10 text-status-magenta"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {roleLabel(u.role)}
                    </span>
                  </td>
                  <td className="px-4 py-2" dir="ltr">
                    {new Date(u.created_at).toLocaleDateString("he-IL")}
                  </td>
                  <td className="px-4 py-2">
                    {!u.is_active && (
                      <span className="rounded bg-gray-200 text-gray-600 text-xs px-2 py-0.5">
                        {t("users.status_disabled", "מושבת")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-end whitespace-nowrap">
                    <button
                      onClick={() => {
                        setEditing(u);
                        setAdding(false);
                      }}
                      className="text-sm text-status-magenta hover:underline me-3"
                    >
                      {t("action.edit", "ערוך")}
                    </button>
                    {me?.id !== u.id && (
                      <button
                        onClick={() => remove(u)}
                        className="text-sm text-status-darkred hover:underline"
                      >
                        {t("action.delete", "מחק")}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Client-side pager (fixes15 §3.2). */}
      {!busy && sorted.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => setPage(safePage - 1)}
            className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("pager.prev", "→ הקודם")}
          </button>
          <span className="text-gray-500">{rangeText}</span>
          <button
            type="button"
            disabled={safePage >= lastPage}
            onClick={() => setPage(safePage + 1)}
            className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("pager.next", "הבא ←")}
          </button>
        </div>
      )}
    </div>
  );
}

/** Create (no `user`) or edit (with `user`) an org user, role included. */
function UserForm({
  user,
  onClose,
  onSaved,
}: {
  user?: OrgUser;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { user: me } = useAuth();
  const { t } = useLocalization();
  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [role, setRole] = useState(user?.role === "admin" ? "admin" : "staff");
  const [password, setPassword] = useState("");
  const [emailValid, setEmailValid] = useState(!!user);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const isSelf = user != null && me?.id === user.id;
  // fixes14: a shliach's role is managed by its contact link — never send a
  // role for them (it silently demoted the account to staff).
  const isShliachAccount = user?.role === "shliach";

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!emailValid) {
      setError(t("msg.invalid_email", "כתובת אימייל לא תקינה"));
      return;
    }
    setBusy(true);
    try {
      if (user) {
        await apiFetch(`/api/users/${user.id}`, {
          method: "PUT",
          body: JSON.stringify({
            full_name: fullName,
            // fixes14: email is editable and syncs to a linked shliach contact.
            ...(email && email !== (user.email ?? "") ? { email } : {}),
            ...(isSelf || isShliachAccount ? {} : { role }),
            ...(password ? { password } : {}),
          }),
        });
      } else {
        await apiFetch("/api/users", {
          method: "POST",
          body: JSON.stringify({
            full_name: fullName,
            email,
            role,
            password: password || null,
          }),
        });
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="bg-white rounded-xl shadow-sm p-4 space-y-3">
      <h3 className="font-medium">
        {user ? `${t("action.edit", "ערוך")} — ${user.full_name}` : t("users.add_user", "משתמש חדש")}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="block text-sm font-medium">{t("users.full_name", "שם מלא")}</span>
          <input
            className={inputClass}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
        </label>
        <label className="block space-y-1">
          <span className="block text-sm font-medium">{t("contacts.email", "אימייל")}</span>
          <EmailInput value={email} onChange={setEmail} onValidityChange={setEmailValid} required />
        </label>
        <label className="block space-y-1">
          <span className="block text-sm font-medium">{t("users.role_label", "תפקיד")}</span>
          {isShliachAccount ? (
            // fixes14: the shliach role is fixed (managed by the contact link).
            <input
              className={inputClass}
              value={t("users.role_shliach", "פעיל")}
              disabled
            />
          ) : (
            <select
              className={inputClass}
              value={role}
              onChange={(e) => setRole(e.target.value)}
              disabled={isSelf}
            >
              <option value="staff">{t("users.role_staff", "משתמש מוגבל")}</option>
              <option value="admin">{t("users.role_admin", "מנהל")}</option>
            </select>
          )}
          {isSelf && (
            <span className="block text-xs text-gray-400">
              {t("users.self_guard", "לא ניתן לשנות או למחוק את עצמך")}
            </span>
          )}
        </label>
        <label className="block space-y-1">
          <span className="block text-sm font-medium">
            {t("users.password_optional", "סיסמה (לא חובה)")}
          </span>
          <input
            type="password"
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
          <span className="block text-xs text-gray-400">
            {t(
              "users.google_only_hint",
              "ללא סיסמה — המשתמש יתחבר עם Google לפי כתובת האימייל המאומתת.",
            )}
          </span>
        </label>
      </div>
      {error && <p className="text-sm text-status-darkred">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-status-magenta text-white px-5 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {busy ? t("action.saving", "שומר…") : t("action.save", "שמור")}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
        >
          {t("action.cancel", "ביטול")}
        </button>
      </div>
    </form>
  );
}
