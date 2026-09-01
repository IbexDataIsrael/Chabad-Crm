"use client";

import { useEffect, useState } from "react";

import {
  adminActivateOrg,
  adminActivateUser,
  adminApproveOrg,
  adminCloneOrg,
  adminCreateOrg,
  adminDeactivateOrg,
  adminDeactivateUser,
  adminDeleteOrg,
  adminDeleteUser,
  adminImpersonateOrg,
  adminListOrgUsers,
  adminListOrganizations,
  adminListUsers,
  adminUserDependencies,
  adminVerifyUser,
  setToken,
  type AdminOrgCreate,
  type AdminOrganization,
  type AdminUser,
  type AdminUserDependencies,
} from "@/lib/api";
import { Plus } from "lucide-react";

import { EmailTemplatesCard } from "@/components/EmailTemplatesCard";
import { SystemSettingsCard } from "@/components/SystemSettingsCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import { useConfirm } from "@/lib/confirm";

export default function SystemAdminPage() {
  const { isSuperadmin, loading } = useAuth();
  const { t } = useLocalization();
  const confirmDialog = useConfirm();
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

  const [orgToClone, setOrgToClone] = useState<AdminOrganization | null>(null);

  async function onCloneOrgConfirmed(org: AdminOrganization, payload: AdminOrgCreate) {
    setOrgToClone(null);
    await run(async () => {
      await adminCloneOrg(org.id, payload);
      await loadOrgs();
      await loadAllUsers();
    }, t("admin.org_cloned", "הארגון שוכפל"));
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
      !(await confirmDialog({ message: t("admin.confirm_impersonate", `להתחבר כמנהל של "${org.name}"? תנותק מחשבון המנהל.`) }))
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

  // fixes15 §2.2: user deletion opens a modal that reports the data ties
  // (assigned contacts, shliach card, coverage) and asks "בטוח ?".
  const [userToDelete, setUserToDelete] = useState<{
    user: AdminUser;
    orgId: number | null;
  } | null>(null);

  async function onDeleteUserConfirmed() {
    if (!userToDelete) return;
    const { user, orgId } = userToDelete;
    setUserToDelete(null);
    await run(async () => {
      await adminDeleteUser(user.id);
      if (orgId !== null) await refreshUsers(orgId);
      await loadAllUsers();
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
      !(await confirmDialog({ message: t("admin.confirm_reject_org", `לדחות ולמחוק את בקשת הארגון "${org.name}"?`) }))
    )
      return;
    await run(async () => {
      await adminDeleteOrg(org.id);
      await loadOrgs();
    }, t("admin.org_rejected", "הבקשה נדחתה"));
  }


  if (loading) return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;
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
          <p className="text-sm text-muted-foreground">
            {t("admin.subtitle", "כל הארגונים והמשתמשים במערכת.")}
          </p>
        </div>
        <Button onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? (
            t("action.cancel", "ביטול")
          ) : (
            <>
              <Plus className="h-4 w-4" /> {t("admin.new_org", "ארגון חדש")}
            </>
          )}
        </Button>
      </div>

      {/* Create an org + admin directly — no email/Google, immediately active. */}
      {showCreate && (
        <form onSubmit={onCreateOrg} className="bg-card border border-border rounded-xl shadow-sm p-4 grid gap-3 sm:grid-cols-2">
          <Input
            required
            value={newOrg.organization_name}
            onChange={(e) => setNewOrg({ ...newOrg, organization_name: e.target.value })}
            placeholder={t("signup.org_name", "שם הארגון")}
          />
          <Input
            required
            value={newOrg.admin_full_name}
            onChange={(e) => setNewOrg({ ...newOrg, admin_full_name: e.target.value })}
            placeholder={t("admin.admin_name", "שם המנהל")}
          />
          <Input
            required
            dir="ltr"
            type="email"
            value={newOrg.admin_email}
            onChange={(e) => setNewOrg({ ...newOrg, admin_email: e.target.value })}
            placeholder={t("contacts.email", "אימייל")}
          />
          <Input
            required
            dir="ltr"
            value={newOrg.admin_username}
            onChange={(e) => setNewOrg({ ...newOrg, admin_username: e.target.value })}
            placeholder={t("auth.username", "שם משתמש")}
          />
          <Input
            required
            dir="ltr"
            type="text"
            value={newOrg.admin_password}
            onChange={(e) => setNewOrg({ ...newOrg, admin_password: e.target.value })}
            placeholder={t("auth.password", "סיסמה")}
          />
          <div className="sm:col-span-2">
            <Button type="submit" disabled={busy}>
              {t("admin.create_org", "צור ארגון")}
            </Button>
          </div>
        </form>
      )}

      {/* Find a user by email/name across every organization. */}
      <Card className="p-4 space-y-3">
        <Input
          dir="ltr"
          value={userQuery}
          onChange={(e) => setUserQuery(e.target.value)}
          placeholder={t("admin.find_user", "חיפוש משתמש לפי אימייל או שם…")}
        />
        {userQuery.trim() && (
          <div className="text-sm">
            {userMatches.length === 0 ? (
              <p className="text-muted-foreground">{t("admin.no_user_matches", "לא נמצאו משתמשים.")}</p>
            ) : (
              <table className="w-full">
                <tbody>
                  {userMatches.map((u) => (
                    <tr key={u.id} className="border-b border-border last:border-0">
                      <td className="py-2 pe-2">
                        <span className="font-medium">{u.full_name}</span>
                        <span className="text-muted-foreground ms-2" dir="ltr">
                          {u.email ?? u.username}
                        </span>
                        <span className="text-muted-foreground ms-2 text-xs">
                          {u.role} · {orgNameById(u.organization_id)}
                        </span>
                      </td>
                      <td className="py-2 text-end whitespace-nowrap">
                        <button
                          disabled={busy}
                          onClick={() => setUserToDelete({ user: u, orgId: null })}
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
      </Card>

      {orgs === null ? (
        <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>
      ) : orgs.length === 0 ? (
        <p className="text-muted-foreground">{t("admin.no_orgs", "אין ארגונים.")}</p>
      ) : (
        <div className="space-y-3">
          {orgs.map((org) => (
            <div key={org.id} className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{org.name}</span>
                    {org.approval_status === "pending" ? (
                      <Badge variant="warning">
                        {t("admin.pending", "ממתין לאישור")}
                      </Badge>
                    ) : org.is_active ? (
                      <Badge variant="success">
                        {t("admin.active", "פעיל")}
                      </Badge>
                    ) : (
                      <Badge variant="destructive">
                        {t("admin.disabled", "מושבת")}
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5" dir="ltr">
                    {org.admin_email ?? "—"} · {org.user_count} {t("admin.users", "משתמשים")}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <button
                    onClick={() => toggleUsers(org.id)}
                    className="rounded-md border border-input px-3 py-1 hover:bg-accent"
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
                        className="rounded-md border border-status-darkred/30 text-status-darkred px-3 py-1 hover:bg-status-darkred/10 disabled:opacity-50"
                      >
                        {t("admin.reject", "דחה")}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        disabled={busy}
                        onClick={() => onImpersonate(org)}
                        className="rounded-md border border-input px-3 py-1 hover:bg-accent disabled:opacity-50"
                      >
                        {t("admin.impersonate", "התחבר כארגון")}
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => setOrgToClone(org)}
                        className="rounded-md border border-input px-3 py-1 hover:bg-accent disabled:opacity-50"
                      >
                        {t("admin.clone", "שכפל")}
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
                          className="rounded-md border border-input px-3 py-1 hover:bg-accent disabled:opacity-50"
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
                          className="rounded-md border border-input px-3 py-1 hover:bg-accent disabled:opacity-50"
                        >
                          {t("admin.activate", "הפעל")}
                        </button>
                      )}
                      <button
                        disabled={busy}
                        onClick={() => setOrgToDelete(org)}
                        className="rounded-md border border-status-darkred/30 text-status-darkred px-3 py-1 hover:bg-status-darkred/10 disabled:opacity-50"
                      >
                        {t("action.delete", "מחק")}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {expanded === org.id && (
                <div className="border-t border-border bg-background/60 p-4">
                  {!orgUsers[org.id] ? (
                    <p className="text-sm text-muted-foreground">{t("action.loading", "טוען…")}</p>
                  ) : orgUsers[org.id].length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("admin.no_users", "אין משתמשים.")}</p>
                  ) : (
                    <table className="w-full text-sm">
                      <tbody>
                        {orgUsers[org.id].map((u) => (
                          <tr key={u.id} className="border-b border-border last:border-0">
                            <td className="py-2 pe-2">
                              <span className="font-medium">{u.full_name}</span>
                              <span className="text-muted-foreground ms-2" dir="ltr">
                                {u.email ?? u.username}
                              </span>
                              <span className="text-muted-foreground ms-2 text-xs">{u.role}</span>
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
                                  className="text-muted-foreground hover:underline me-3 disabled:opacity-50"
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
                                  className="text-muted-foreground hover:underline me-3 disabled:opacity-50"
                                >
                                  {t("admin.activate", "הפעל")}
                                </button>
                              )}
                              <button
                                disabled={busy}
                                onClick={() => setUserToDelete({ user: u, orgId: org.id })}
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

      {orgToClone && (
        <CloneOrgModal
          org={orgToClone}
          busy={busy}
          onCancel={() => setOrgToClone(null)}
          onConfirm={(payload) => onCloneOrgConfirmed(orgToClone, payload)}
        />
      )}

      {orgToDelete && (
        <DeleteOrgModal
          org={orgToDelete}
          onCancel={() => setOrgToDelete(null)}
          onConfirm={() => onDeleteOrgConfirmed(orgToDelete)}
        />
      )}

      {userToDelete && (
        <DeleteUserModal
          user={userToDelete.user}
          onCancel={() => setUserToDelete(null)}
          onConfirm={onDeleteUserConfirmed}
        />
      )}
    </div>
  );
}

/** fixes15 §2.2: before deleting a user (e.g. a shliach), show what's still
 *  tied to them and require an explicit "בטוח ?" confirmation. All copy is
 *  localization-table-mapped. */
function DeleteUserModal({
  user,
  onCancel,
  onConfirm,
}: {
  user: AdminUser;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useLocalization();
  const [deps, setDeps] = useState<AdminUserDependencies | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    adminUserDependencies(user.id)
      .then(setDeps)
      .catch(() => setFailed(true));
  }, [user.id]);

  const n = (tpl: string, count: number) => tpl.replace("{n}", String(count));
  const ties: string[] = deps
    ? [
        ...(deps.shliach_contact_id
          ? [
              t("admin.deps_shliach_contact", "מקושר לכרטיס פעיל: {name}").replace(
                "{name}",
                deps.shliach_contact_name ?? `#${deps.shliach_contact_id}`,
              ),
            ]
          : []),
        ...(deps.assigned_contacts > 0
          ? [n(t("admin.deps_assigned_contacts", "אנשי קשר משויכים: {n}"), deps.assigned_contacts)]
          : []),
        ...(deps.covered_report_numbers > 0
          ? [
              n(
                t("admin.deps_report_numbers", "מספרי דוח באחריות: {n}"),
                deps.covered_report_numbers,
              ),
            ]
          : []),
        ...(deps.covered_areas > 0
          ? [n(t("admin.deps_areas", "אזורים באחריות: {n}"), deps.covered_areas)]
          : []),
        // fixes25: interaction rows are gone (they live inside visit JSON).
      ]
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md bg-card rounded-xl shadow-xl p-5 space-y-4">
        <h2 className="text-lg font-bold text-status-darkred">
          {t("admin.delete_user_title", "מחיקת משתמש")}
        </h2>
        <p className="text-sm font-medium" dir="ltr">
          {user.full_name} · {user.email ?? user.username}
        </p>

        {/* fixes15 §2.2: the connected-data report. */}
        {deps === null && !failed ? (
          <p className="text-sm text-muted-foreground">{t("action.loading", "טוען…")}</p>
        ) : deps?.has_dependencies ? (
          <div className="space-y-1.5">
            <p className="text-sm text-foreground">
              {t("admin.deps_intro", "למשתמש זה קיימים נתונים מקושרים במערכת:")}
            </p>
            <ul className="list-disc ps-5 text-sm text-foreground space-y-0.5">
              {ties.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              {t(
                "admin.deps_note",
                "בעת המחיקה השיוכים יוסרו והנתונים יישארו ללא משתמש מקושר.",
              )}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("admin.deps_none", "אין נתונים מקושרים למשתמש זה.")}
          </p>
        )}

        <p className="text-sm font-semibold">{t("admin.confirm_sure", "בטוח ?")}</p>
        <div className="flex items-center gap-2 pt-1">
          <Button type="button" className="bg-status-darkred hover:bg-status-darkred/90" onClick={onConfirm}>
            {t("action.delete", "מחק")}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("action.cancel", "ביטול")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Copies an org's entire CRM data set into a brand-new org with a fresh
 * admin login the caller sets here. The source org is never modified. */
function CloneOrgModal({
  org,
  busy,
  onCancel,
  onConfirm,
}: {
  org: AdminOrganization;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (payload: AdminOrgCreate) => void;
}) {
  const { t } = useLocalization();
  const [form, setForm] = useState<AdminOrgCreate>({
    organization_name: `${org.name} - Sample`,
    admin_full_name: "",
    admin_email: "",
    admin_username: "sample_admin",
    admin_password: "",
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md bg-card rounded-xl shadow-xl p-5 space-y-4">
        <h2 className="text-lg font-bold">{t("admin.clone_org_title", "שכפול ארגון")}</h2>
        <p className="text-sm text-muted-foreground">
          {t(
            "admin.clone_org_intro",
            "יוצר ארגון חדש עם עותק מלא של כל הנתונים — אנשי קשר, ביקורים, דירות, בניינים, רשימות בחירה ועוד. הארגון המקורי לא ישתנה.",
          )}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm(form);
          }}
          className="space-y-3"
        >
          <Input
            required
            value={form.organization_name}
            onChange={(e) => setForm({ ...form, organization_name: e.target.value })}
            placeholder={t("signup.org_name", "שם הארגון")}
          />
          <Input
            required
            value={form.admin_full_name}
            onChange={(e) => setForm({ ...form, admin_full_name: e.target.value })}
            placeholder={t("admin.admin_name", "שם המנהל")}
          />
          <Input
            required
            dir="ltr"
            type="email"
            value={form.admin_email}
            onChange={(e) => setForm({ ...form, admin_email: e.target.value })}
            placeholder={t("contacts.email", "אימייל")}
          />
          <Input
            required
            dir="ltr"
            value={form.admin_username}
            onChange={(e) => setForm({ ...form, admin_username: e.target.value })}
            placeholder={t("auth.username", "שם משתמש")}
          />
          <Input
            required
            dir="ltr"
            type="text"
            value={form.admin_password}
            onChange={(e) => setForm({ ...form, admin_password: e.target.value })}
            placeholder={t("auth.password", "סיסמה")}
          />
          <div className="flex items-center gap-2 pt-1">
            <Button type="submit" disabled={busy}>
              {t("admin.clone_org_confirm", "שכפל ארגון")}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              {t("action.cancel", "ביטול")}
            </Button>
          </div>
        </form>
      </div>
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
      <div className="w-full max-w-md bg-card rounded-xl shadow-xl p-5 space-y-4">
        <h2 className="text-lg font-bold text-status-darkred">
          {t("admin.delete_org_title", "מחיקת ארגון")}
        </h2>
        <p className="text-sm text-foreground">
          {t(
            "admin.delete_org_warning",
            "האם אתה בטוח שברצונך למחוק את הארגון וכל הנתונים שלו? פעולה זו אינה הפיכה.",
          )}
        </p>
        <p className="text-sm font-medium">{org.name}</p>
        <label className="block space-y-1">
          <span className="block text-xs text-muted-foreground">
            {t(
              "admin.delete_org_type_to_confirm",
              "לאישור, הקלד את שם הארגון במדויק (או DELETE):",
            )}
          </span>
          <Input
            className="focus-visible:ring-status-darkred"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
          />
        </label>
        <div className="flex items-center gap-2 pt-1">
          <Button
            type="button"
            disabled={!armed}
            className="bg-status-darkred hover:bg-status-darkred/90"
            onClick={onConfirm}
          >
            {t("admin.delete_org_confirm", "מחק לצמיתות")}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("action.cancel", "ביטול")}
          </Button>
        </div>
      </div>
    </div>
  );
}
