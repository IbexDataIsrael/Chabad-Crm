"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { EmailInput } from "@/components/EmailInput";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";

interface OrgUser {
  id: number;
  username: string;
  full_name: string;
  email: string | null;
  role: string;
  is_active: boolean;
}

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

export default function UsersPage() {
  const router = useRouter();
  const { user: me, isAdmin, loading } = useAuth();
  const { t } = useLocalization();
  const { success, error: toastError } = useToast();
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<OrgUser | null>(null);
  const [busy, setBusy] = useState(true);

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

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-start">
            <tr>
              <th className="px-4 py-2 text-start font-medium">{t("common.name", "שם")}</th>
              <th className="px-4 py-2 text-start font-medium">{t("contacts.email", "אימייל")}</th>
              <th className="px-4 py-2 text-start font-medium">{t("users.role_label", "תפקיד")}</th>
              <th className="px-4 py-2 text-start font-medium"></th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {busy ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  {t("action.loading", "טוען…")}
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  {t("users.none", "אין משתמשים.")}
                </td>
              </tr>
            ) : (
              users.map((u) => (
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

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!user && !emailValid) {
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
            ...(isSelf ? {} : { role }),
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
        {!user && (
          <label className="block space-y-1">
            <span className="block text-sm font-medium">{t("contacts.email", "אימייל")}</span>
            <EmailInput value={email} onChange={setEmail} onValidityChange={setEmailValid} required />
          </label>
        )}
        <label className="block space-y-1">
          <span className="block text-sm font-medium">{t("users.role_label", "תפקיד")}</span>
          <select
            className={inputClass}
            value={role}
            onChange={(e) => setRole(e.target.value)}
            disabled={isSelf}
          >
            <option value="staff">{t("users.role_staff", "משתמש מוגבל")}</option>
            <option value="admin">{t("users.role_admin", "מנהל")}</option>
          </select>
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
