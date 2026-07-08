"use client";

import { useEffect, useState } from "react";

import {
  adminActivateOrg,
  adminActivateUser,
  adminApproveOrg,
  adminCreateOrg,
  adminDeactivateOrg,
  adminDeactivateUser,
  adminDeleteOrg,
  adminDeleteUser,
  adminImpersonateOrg,
  adminListOrgUsers,
  adminListOrganizations,
  adminListUsers,
  adminVerifyUser,
  setToken,
  type AdminOrganization,
  type AdminUser,
} from "@/lib/api";
import { EmailTemplatesCard } from "@/components/EmailTemplatesCard";
import { SystemSettingsCard } from "@/components/SystemSettingsCard";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";

export default function SystemAdminPage() {
  const { isSuperadmin, loading } = useAuth();
  const { t } = useLocalization();
  const { success, error } = useToast();

  const [orgs, setOrgs] = useState<AdminOrganization[] | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [orgUsers, setOrgUsers] = useState<Record<number, AdminUser[]>>({});
  const [busy, setBusy] = useState(false);
  const [allUsers, setAllUsers] = useState<AdminUser[]>([]);
  const [userQuery, setUserQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const emptyNewOrg = {
    organization_name: "",
    admin_full_name: "",
    admin_email: "",
    admin_username: "admin",
    admin_password: "",
  };
  const [newOrg, setNewOrg] = useState(emptyNewOrg);

  async function loadOrgs() {
    try {
      setOrgs(await adminListOrganizations());
    } catch (e) {
      error(e instanceof Error ? e.message : "Failed to load organizations");
      setOrgs([]);
    }
  }

  async function loadAllUsers() {
    try {
      setAllUsers(await adminListUsers());
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (!loading && isSuperadmin) {
      loadOrgs();
      loadAllUsers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, isSuperadmin]);

  const orgNameById = (id: number) => orgs?.find((o) => o.id === id)?.name ?? `#${id}`;
  const userMatches =
    userQuery.trim().length === 0
      ? []
      : allUsers.filter((u) => {
          const q = userQuery.trim().toLowerCase();
          return (
            (u.email ?? "").toLowerCase().includes(q) ||
            u.full_name.toLowerCase().includes(q) ||
            u.username.toLowerCase().includes(q)
          );
        });

  async function toggleUsers(orgId: number) {
    if (expanded === orgId) {
      setExpanded(null);
      return;
    }
    setExpanded(orgId);
    if (!orgUsers[orgId]) {
      try {
        const users = await adminListOrgUsers(orgId);
        setOrgUsers((prev) => ({ ...prev, [orgId]: users }));
      } catch (e) {
        error(e instanceof Error ? e.message : "Failed to load users");
      }
    }
  }

  async function refreshUsers(orgId: number) {
    try {
      const users = await adminListOrgUsers(orgId);
      setOrgUsers((prev) => ({ ...prev, [orgId]: users }));
    } catch {
      /* ignore */
    }
  }

  async function run(fn: () => Promise<unknown>, okMsg: string) {
    setBusy(true);
    try {
      await fn();
      success(okMsg);
    } catch (e) {
      error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  // fixes10 §1.2: deletion goes through the two-step modal, not confirm().
  const [orgToDelete, setOrgToDelete] = useState<AdminOrganization | null>(null);

  async function onDeleteOrgConfirmed(org: AdminOrganization) {
    setOrgToDelete(null);
    await run(async () => {
      await adminDeleteOrg(org.id);
      await loadOrgs();
    }, t("admin.org_deleted", "הארגון נמחק"));
  }

  async function onImpersonate(org: AdminOrganization) {
    if (
      !confirm(
        t("admin.confirm_impersonate", `להתחבר כמנהל של "${org.name}"? תנותק מחשבון המנהל.`),
      )
    )
      return;
    try {
      const { access_token } = await adminImpersonateOrg(org.id);
      setToken(access_token);
      window.location.href = "/dashboard";
    } catch (e) {
      error(e instanceof Error ? e.message : "Impersonation failed");
    }
  }

  async function onDeleteUser(orgId: number, user: AdminUser) {
    if (
      !confirm(
        t("admin.confirm_delete_user", `למחוק את המשתמש ${user.email ?? user.username}?`),
      )
    )
      return;
    await run(async () => {
      await adminDeleteUser(user.id);
      await refreshUsers(orgId);
      await loadOrgs();
    }, t("admin.user_deleted", "המשתמש נמחק"));
  }

  async function onCreateOrg(e: React.FormEvent) {
    e.preventDefault();
    await run(async () => {
      await adminCreateOrg(newOrg);
      setNewOrg(emptyNewOrg);
      setShowCreate(false);
      await loadOrgs();
      await loadAllUsers();
    }, t("admin.org_created", "הארגון נוצר"));
  }

  async function onApprove(org: AdminOrganization) {
    await run(async () => {
      await adminApproveOrg(org.id);
      await loadOrgs();
    }, t("admin.org_approved", "הארגון אושר"));
  }

  async function onRejectOrg(org: AdminOrganization) {
    if (
      !confirm(
        t("admin.confirm_reject_org", `לדחות ולמחוק את בקשת הארגון "${org.name}"?`),
      )
    )
      return;
    await run(async () => {
      await adminDeleteOrg(org.id);
      await loadOrgs();
    }, t("admin.org_rejected", "הבקשה נדחתה"));
  }

  async function onDeleteUserGlobal(user: AdminUser) {
    if (
      !confirm(
        t("admin.confirm_delete_user", `למחוק את המשתמש ${user.email ?? user.username}?`),
      )
    )
      return;
    await run(async () => {
      await adminDeleteUser(user.id);
      await loadAllUsers();
      await loadOrgs();
    }, t("admin.user_deleted", "המשתמש נמחק"));
  }

  if (loading) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;
  if (!isSuperadmin) {
    return (
      <p className="text-status-darkred">
        {t("admin.superadmin_only", "עמוד זה מיועד למנהל המערכת בלבד.")}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{t("admin.title", "ניהול מערכת")}</h1>
          <p className="text-sm text-gray-500">
            {t("admin.subtitle", "כל הארגונים והמשתמשים במערכת.")}
          </p>
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="rounded-md bg-status-magenta text-white px-4 py-2 text-sm font-medium hover:opacity-90"
        >
          {showCreate ? t("action.cancel", "ביטול") : t("admin.new_org", "+ ארגון חדש")}
        </button>
      </div>

      {/* Create an org + admin directly — no email/Google, immediately active. */}
      {showCreate && (
        <form onSubmit={onCreateOrg} className="bg-white rounded-xl shadow-sm p-4 grid gap-3 sm:grid-cols-2">
          <input
            required
            value={newOrg.organization_name}
            onChange={(e) => setNewOrg({ ...newOrg, organization_name: e.target.value })}
            placeholder={t("signup.org_name", "שם הארגון")}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none"
          />
          <input
            required
            value={newOrg.admin_full_name}
            onChange={(e) => setNewOrg({ ...newOrg, admin_full_name: e.target.value })}
            placeholder={t("admin.admin_name", "שם המנהל")}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none"
          />
          <input
            required
            dir="ltr"
            type="email"
            value={newOrg.admin_email}
            onChange={(e) => setNewOrg({ ...newOrg, admin_email: e.target.value })}
            placeholder={t("contacts.email", "אימייל")}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none"
          />
          <input
            required
            dir="ltr"
            value={newOrg.admin_username}
            onChange={(e) => setNewOrg({ ...newOrg, admin_username: e.target.value })}
            placeholder={t("auth.username", "שם משתמש")}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none"
          />
          <input
            required
            dir="ltr"
            type="text"
            value={newOrg.admin_password}
            onChange={(e) => setNewOrg({ ...newOrg, admin_password: e.target.value })}
            placeholder={t("auth.password", "סיסמה")}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none"
          />
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-status-magenta text-white px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {t("admin.create_org", "צור ארגון")}
            </button>
          </div>
        </form>
      )}

      {/* Find a user by email/name across every organization. */}
      <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
        <input
          dir="ltr"
          value={userQuery}
          onChange={(e) => setUserQuery(e.target.value)}
          placeholder={t("admin.find_user", "חיפוש משתמש לפי אימייל או שם…")}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none"
        />
        {userQuery.trim() && (
          <div className="text-sm">
            {userMatches.length === 0 ? (
              <p className="text-gray-400">{t("admin.no_user_matches", "לא נמצאו משתמשים.")}</p>
            ) : (
              <table className="w-full">
                <tbody>
                  {userMatches.map((u) => (
                    <tr key={u.id} className="border-b border-gray-100 last:border-0">
                      <td className="py-2 pe-2">
                        <span className="font-medium">{u.full_name}</span>
                        <span className="text-gray-500 ms-2" dir="ltr">
                          {u.email ?? u.username}
                        </span>
                        <span className="text-gray-400 ms-2 text-xs">
                          {u.role} · {orgNameById(u.organization_id)}
                        </span>
                      </td>
                      <td className="py-2 text-end whitespace-nowrap">
                        <button
                          disabled={busy}
                          onClick={() => onDeleteUserGlobal(u)}
                          className="text-status-darkred hover:underline disabled:opacity-50"
                        >
                          {t("action.delete", "מחק")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {orgs === null ? (
        <p className="text-gray-400">{t("action.loading", "טוען…")}</p>
      ) : orgs.length === 0 ? (
        <p className="text-gray-400">{t("admin.no_orgs", "אין ארגונים.")}</p>
      ) : (
        <div className="space-y-3">
          {orgs.map((org) => (
            <div key={org.id} className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{org.name}</span>
                    {org.approval_status === "pending" ? (
                      <span className="rounded bg-status-orange/10 text-status-orange px-2 py-0.5 text-xs">
                        {t("admin.pending", "ממתין לאישור")}
                      </span>
                    ) : org.is_active ? (
                      <span className="rounded bg-status-green/10 text-status-green px-2 py-0.5 text-xs">
                        {t("admin.active", "פעיל")}
                      </span>
                    ) : (
                      <span className="rounded bg-status-darkred/10 text-status-darkred px-2 py-0.5 text-xs">
                        {t("admin.disabled", "מושבת")}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5" dir="ltr">
                    {org.admin_email ?? "—"} · {org.user_count} {t("admin.users", "משתמשים")}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <button
                    onClick={() => toggleUsers(org.id)}
                    className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-50"
                  >
                    {expanded === org.id
                      ? t("admin.hide_users", "הסתר משתמשים")
                      : t("admin.manage_users", "משתמשים")}
                  </button>
                  {org.approval_status === "pending" ? (
                    <>
                      <button
                        disabled={busy}
                        onClick={() => onApprove(org)}
                        className="rounded-md bg-status-green text-white px-4 py-1 font-medium hover:opacity-90 disabled:opacity-50"
                      >
                        {t("admin.approve", "אשר")}
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => onRejectOrg(org)}
                        className="rounded-md border border-status-darkred/30 text-status-darkred px-3 py-1 hover:bg-red-50 disabled:opacity-50"
                      >
                        {t("admin.reject", "דחה")}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        disabled={busy}
                        onClick={() => onImpersonate(org)}
                        className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-50 disabled:opacity-50"
                      >
                        {t("admin.impersonate", "התחבר כארגון")}
                      </button>
                      {org.is_active ? (
                        <button
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              await adminDeactivateOrg(org.id);
                              await loadOrgs();
                            }, t("admin.org_disabled", "הארגון הושבת"))
                          }
                          className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-50 disabled:opacity-50"
                        >
                          {t("admin.deactivate", "השבת")}
                        </button>
                      ) : (
                        <button
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              await adminActivateOrg(org.id);
                              await loadOrgs();
                            }, t("admin.org_enabled", "הארגון הופעל"))
                          }
                          className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-50 disabled:opacity-50"
                        >
                          {t("admin.activate", "הפעל")}
                        </button>
                      )}
                      <button
                        disabled={busy}
                        onClick={() => setOrgToDelete(org)}
                        className="rounded-md border border-status-darkred/30 text-status-darkred px-3 py-1 hover:bg-red-50 disabled:opacity-50"
                      >
                        {t("action.delete", "מחק")}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {expanded === org.id && (
                <div className="border-t border-gray-100 bg-gray-50/60 p-4">
                  {!orgUsers[org.id] ? (
                    <p className="text-sm text-gray-400">{t("action.loading", "טוען…")}</p>
                  ) : orgUsers[org.id].length === 0 ? (
                    <p className="text-sm text-gray-400">{t("admin.no_users", "אין משתמשים.")}</p>
                  ) : (
                    <table className="w-full text-sm">
                      <tbody>
                        {orgUsers[org.id].map((u) => (
                          <tr key={u.id} className="border-b border-gray-100 last:border-0">
                            <td className="py-2 pe-2">
                              <span className="font-medium">{u.full_name}</span>
                              <span className="text-gray-500 ms-2" dir="ltr">
                                {u.email ?? u.username}
                              </span>
                              <span className="text-gray-400 ms-2 text-xs">{u.role}</span>
                              {!u.email_verified && (
                                <span className="ms-2 rounded bg-status-orange/10 text-status-orange px-1.5 py-0.5 text-xs">
                                  {t("admin.unverified", "לא מאומת")}
                                </span>
                              )}
                              {!u.is_active && (
                                <span className="ms-2 rounded bg-status-darkred/10 text-status-darkred px-1.5 py-0.5 text-xs">
                                  {t("admin.disabled", "מושבת")}
                                </span>
                              )}
                            </td>
                            <td className="py-2 text-end whitespace-nowrap">
                              {!u.email_verified && (
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    run(async () => {
                                      await adminVerifyUser(u.id);
                                      await refreshUsers(org.id);
                                    }, t("admin.user_verified", "המשתמש אומת"))
                                  }
                                  className="text-status-green hover:underline me-3 disabled:opacity-50"
                                >
                                  {t("admin.verify", "אמת")}
                                </button>
                              )}
                              {u.is_active ? (
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    run(async () => {
                                      await adminDeactivateUser(u.id);
                                      await refreshUsers(org.id);
                                    }, t("admin.user_disabled", "המשתמש הושבת"))
                                  }
                                  className="text-gray-600 hover:underline me-3 disabled:opacity-50"
                                >
                                  {t("admin.deactivate", "השבת")}
                                </button>
                              ) : (
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    run(async () => {
                                      await adminActivateUser(u.id);
                                      await refreshUsers(org.id);
                                    }, t("admin.user_enabled", "המשתמש הופעל"))
                                  }
                                  className="text-gray-600 hover:underline me-3 disabled:opacity-50"
                                >
                                  {t("admin.activate", "הפעל")}
                                </button>
                              )}
                              <button
                                disabled={busy}
                                onClick={() => onDeleteUser(org.id, u)}
                                className="text-status-darkred hover:underline disabled:opacity-50"
                              >
                                {t("action.delete", "מחק")}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <EmailTemplatesCard />
      <SystemSettingsCard />

      {orgToDelete && (
        <DeleteOrgModal
          org={orgToDelete}
          onCancel={() => setOrgToDelete(null)}
          onConfirm={() => onDeleteOrgConfirmed(orgToDelete)}
        />
      )}
    </div>
  );
}

/** Two-step deletion safeguard (fixes10 §1.2): a warning plus an explicit
 *  text-match — the superadmin must type the org's exact name (or DELETE)
 *  before the final button enables. */
function DeleteOrgModal({
  org,
  onCancel,
  onConfirm,
}: {
  org: AdminOrganization;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useLocalization();
  const [typed, setTyped] = useState("");
  const armed = typed.trim() === org.name || typed.trim() === "DELETE";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-xl p-5 space-y-4">
        <h2 className="text-lg font-bold text-status-darkred">
          {t("admin.delete_org_title", "מחיקת ארגון")}
        </h2>
        <p className="text-sm text-gray-700">
          {t(
            "admin.delete_org_warning",
            "האם אתה בטוח שברצונך למחוק את הארגון וכל הנתונים שלו? פעולה זו אינה הפיכה.",
          )}
        </p>
        <p className="text-sm font-medium">{org.name}</p>
        <label className="block space-y-1">
          <span className="block text-xs text-gray-500">
            {t(
              "admin.delete_org_type_to_confirm",
              "לאישור, הקלד את שם הארגון במדויק (או DELETE):",
            )}
          </span>
          <input
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-darkred focus:outline-none focus:ring-1 focus:ring-status-darkred"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
          />
        </label>
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            disabled={!armed}
            onClick={onConfirm}
            className="rounded-md bg-status-darkred text-white px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("admin.delete_org_confirm", "מחק לצמיתות")}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
          >
            {t("action.cancel", "ביטול")}
          </button>
        </div>
      </div>
    </div>
  );
}
