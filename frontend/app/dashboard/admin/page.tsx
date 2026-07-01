"use client";

import { useEffect, useState } from "react";

import {
  adminActivateOrg,
  adminActivateUser,
  adminDeactivateOrg,
  adminDeactivateUser,
  adminDeleteOrg,
  adminDeleteUser,
  adminImpersonateOrg,
  adminListOrgUsers,
  adminListOrganizations,
  adminVerifyUser,
  setToken,
  type AdminOrganization,
  type AdminUser,
} from "@/lib/api";
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

  async function loadOrgs() {
    try {
      setOrgs(await adminListOrganizations());
    } catch (e) {
      error(e instanceof Error ? e.message : "Failed to load organizations");
      setOrgs([]);
    }
  }

  useEffect(() => {
    if (!loading && isSuperadmin) loadOrgs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, isSuperadmin]);

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

  async function onDeleteOrg(org: AdminOrganization) {
    if (
      !confirm(
        t(
          "admin.confirm_delete_org",
          `למחוק את הארגון "${org.name}" ואת כל הנתונים שלו? פעולה זו אינה הפיכה.`,
        ),
      )
    )
      return;
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
      <div>
        <h1 className="text-2xl font-bold">{t("admin.title", "ניהול מערכת")}</h1>
        <p className="text-sm text-gray-500">
          {t("admin.subtitle", "כל הארגונים והמשתמשים במערכת.")}
        </p>
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
                    {org.is_active ? (
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
                    onClick={() => onDeleteOrg(org)}
                    className="rounded-md border border-status-darkred/30 text-status-darkred px-3 py-1 hover:bg-red-50 disabled:opacity-50"
                  >
                    {t("action.delete", "מחק")}
                  </button>
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
    </div>
  );
}
