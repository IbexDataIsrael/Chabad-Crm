"use client";

import { useEffect, useRef, useState } from "react";

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
  adminResetUserPassword,
  adminGetOrgPrefs,
  adminImpersonateOrg,
  adminListOrgUsers,
  adminListOrganizations,
  adminListUsers,
  adminUpdateOrgPrefs,
  adminUserDependencies,
  adminVerifyUser,
  setToken,
  type AdminOrgCreate,
  type AdminOrganization,
  type AdminUser,
  type AdminUserDependencies,
  type OrgPrefs,
  type OrgPrefsUpdate,
} from "@/lib/api";
import { Plus } from "lucide-react";

import { EmailTemplatesCard } from "@/components/EmailTemplatesCard";
import { PendingSignupEmailsCard } from "@/components/PendingSignupEmailsCard";
import { SystemSettingsCard } from "@/components/SystemSettingsCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import { useConfirm } from "@/lib/confirm";
import { isMediumPassword, PASSWORD_HINT } from "@/lib/validation";

/** fixes81 §1: the superadmin area is split into sidebar pages — each route
 *  (dashboard/admin, /users, /email-templates, /settings) renders one section
 *  of this component. Kept as one component so the org/user state, actions
 *  and modals stay shared instead of being duplicated per page. */
export type AdminSection = "orgs" | "users" | "email-templates" | "settings";

/** Naive-UTC API timestamp → local date + time. */
function formatUtc(iso: string): string {
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`);
  return d.toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
}

export function SystemAdmin({ section }: { section: AdminSection }) {
  const { isSuperadmin, loading } = useAuth();
  const { t } = useLocalization();
  const confirmDialog = useConfirm();
  const { success, error } = useToast();

  const [orgs, setOrgs] = useState<AdminOrganization[] | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [orgUsers, setOrgUsers] = useState<Record<number, AdminUser[]>>({});
  // fixes54 §8: per-org feature toggles — loaded lazily, same "expand ->
  // fetch once" pattern as orgUsers above.
  const [featuresExpanded, setFeaturesExpanded] = useState<number | null>(null);
  const [orgPrefs, setOrgPrefs] = useState<Record<number, OrgPrefs>>({});
  const [prefsBusy, setPrefsBusy] = useState(false);
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

  // The new-org notification email links to ?approve=<org id>: once the list
  // is loaded, spotlight that org and offer to approve it right away. The
  // param is dropped from the URL so a reload doesn't prompt again.
  const [highlightOrg, setHighlightOrg] = useState<number | null>(null);
  const approveLinkHandled = useRef(false);
  useEffect(() => {
    if (section !== "orgs" || orgs === null || approveLinkHandled.current) return;
    const param = new URLSearchParams(window.location.search).get("approve");
    if (!param) return;
    approveLinkHandled.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete("approve");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    const org = orgs.find((o) => o.id === Number(param));
    if (!org) {
      error(t("admin.approve_link_missing", "הארגון מהקישור לא נמצא (ייתכן שנדחה או נמחק)."));
      return;
    }
    setHighlightOrg(org.id);
    requestAnimationFrame(() =>
      document.getElementById(`org-${org.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
    if (org.approval_status !== "pending") {
      success(t("admin.approve_link_already", 'הארגון "{name}" כבר אושר.').replace("{name}", org.name));
      return;
    }
    (async () => {
      if (
        await confirmDialog({
          message: t("admin.confirm_approve_org", 'לאשר את הארגון "{name}" ({email})?')
            .replace("{name}", org.name)
            .replace("{email}", org.admin_email ?? "—"),
        })
      )
        await onApprove(org);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgs]);

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

  // fixes54 §8: expand/collapse the feature-toggles panel, loading its
  // current state once per org (same lazy-load pattern as toggleUsers).
  async function toggleFeatures(orgId: number) {
    if (featuresExpanded === orgId) {
      setFeaturesExpanded(null);
      return;
    }
    setFeaturesExpanded(orgId);
    if (!orgPrefs[orgId]) {
      try {
        const prefs = await adminGetOrgPrefs(orgId);
        setOrgPrefs((prev) => ({ ...prev, [orgId]: prefs }));
      } catch (e) {
        error(e instanceof Error ? e.message : "Failed to load feature toggles");
      }
    }
  }

  async function updateOrgPref(orgId: number, updates: OrgPrefsUpdate) {
    setPrefsBusy(true);
    try {
      const prefs = await adminUpdateOrgPrefs(orgId, updates);
      setOrgPrefs((prev) => ({ ...prev, [orgId]: prefs }));
      success(t("msg.saved", "נשמר בהצלחה"));
    } catch (e) {
      error(e instanceof Error ? e.message : "Failed to update feature toggles");
    } finally {
      setPrefsBusy(false);
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
  // fixes75 §3: the user whose password the superadmin is resetting.
  const [userToReset, setUserToReset] = useState<AdminUser | null>(null);
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

  const sectionTitle = {
    orgs: t("admin.nav_orgs", "ארגונים"),
    users: t("admin.nav_users", "חיפוש משתמשים"),
    "email-templates": t("admin.nav_email_templates", "תבניות מייל"),
    settings: t("admin.system_settings_title", "הגדרות מערכת"),
  }[section];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{sectionTitle}</h1>
          {section === "orgs" && (
            <p className="text-sm text-muted-foreground">
              {t("admin.subtitle", "כל הארגונים והמשתמשים במערכת.")}
            </p>
          )}
        </div>
        {section === "orgs" && (
        <Button onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? (
            t("action.cancel", "ביטול")
          ) : (
            <>
              <Plus className="h-4 w-4" /> {t("admin.new_org", "ארגון חדש")}
            </>
          )}
        </Button>
        )}
      </div>

      {/* Create an org + admin directly — no email/Google, immediately active. */}
      {section === "orgs" && showCreate && (
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
      {section === "users" && (
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
                          onClick={() => setUserToReset(u)}
                          className="text-primary hover:underline me-3 disabled:opacity-50"
                        >
                          {t("admin.reset_password", "איפוס סיסמה")}
                        </button>
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
      )}

      {section !== "orgs" ? null : orgs === null ? (
        <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>
      ) : orgs.length === 0 ? (
        <p className="text-muted-foreground">{t("admin.no_orgs", "אין ארגונים.")}</p>
      ) : (
        <div className="space-y-3">
          {orgs.map((org) => (
            <div
              key={org.id}
              id={`org-${org.id}`}
              className={`bg-card border rounded-xl shadow-sm overflow-hidden ${
                highlightOrg === org.id ? "border-status-green ring-2 ring-status-green/40" : "border-border"
              }`}
            >
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
                  {/* fixes81 §2: when the org signed up (created_at). */}
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {t("admin.signed_up_at", "נרשם:")}{" "}
                    <span dir="ltr" style={{ unicodeBidi: "isolate" }}>
                      {formatUtc(org.created_at)}
                    </span>
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
                  {/* fixes54 §8: per-org feature toggles. */}
                  <button
                    onClick={() => toggleFeatures(org.id)}
                    className="rounded-md border border-input px-3 py-1 hover:bg-accent"
                  >
                    {featuresExpanded === org.id
                      ? t("admin.hide_features", "הסתר תכונות")
                      : t("admin.manage_features", "תכונות")}
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
                                onClick={() => setUserToReset(u)}
                                className="text-primary hover:underline me-3 disabled:opacity-50"
                              >
                                {t("admin.reset_password", "איפוס סיסמה")}
                              </button>
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

              {/* fixes54 §8: cascading module toggles (Area -> Building ->
                  Apartment -> Activist) + the standalone AI query toggle. */}
              {featuresExpanded === org.id && (
                <div className="border-t border-border bg-background/60 p-4">
                  {!orgPrefs[org.id] ? (
                    <p className="text-sm text-muted-foreground">{t("action.loading", "טוען…")}</p>
                  ) : (
                    <OrgFeatureToggles
                      prefs={orgPrefs[org.id]}
                      busy={prefsBusy}
                      onChange={(updates) => updateOrgPref(org.id, updates)}
                    />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {section === "email-templates" && <EmailTemplatesCard defaultOpen />}
      {section === "settings" && (
        <>
          <PendingSignupEmailsCard />
          <SystemSettingsCard defaultOpen />
        </>
      )}

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

      {userToReset && (
        <ResetPasswordModal user={userToReset} onClose={() => setUserToReset(null)} />
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
/** fixes75 §3: the superadmin types a new password for one user. */
function ResetPasswordModal({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const { t } = useLocalization();
  const { success } = useToast();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setError("");
    if (!isMediumPassword(password)) {
      setError(t("validation.password_hint", PASSWORD_HINT));
      return;
    }
    setBusy(true);
    try {
      await adminResetUserPassword(user.id, password);
      success(t("admin.password_reset_done", "הסיסמה אופסה"));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md bg-card rounded-xl shadow-xl p-5 space-y-4">
        <h2 className="text-lg font-bold">{t("admin.reset_password", "איפוס סיסמה")}</h2>
        <p className="text-sm font-medium" dir="ltr">
          {user.full_name} · {user.email ?? user.username}
        </p>
        <Input
          type="text"
          dir="ltr"
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("auth.new_password", "סיסמה חדשה")}
        />
        <p className="text-xs text-muted-foreground">{t("validation.password_hint", PASSWORD_HINT)}</p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex items-center gap-2 pt-1">
          <Button type="button" disabled={busy} onClick={save}>
            {t("action.save", "שמור")}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("action.cancel", "ביטול")}
          </Button>
        </div>
      </div>
    </div>
  );
}

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
        ...((deps.assigned_tasks ?? 0) > 0
          ? [
              n(
                t("admin.deps_tasks", "משימות משויכות (יחזרו להיות פנויות): {n}"),
                deps.assigned_tasks ?? 0,
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
// fixes61: tables worth capping on a clone — the ones that actually grow
// large in practice (see [[unpaginated-buildings-at-scale-gotcha]]). Value
// is the raw text input; blank = clone every row in that table (unchanged
// default behavior).
const CLONE_LIMIT_TABLES: { table: string; labelKey: string; fallback: string }[] = [
  { table: "apartments", labelKey: "nav.apartments", fallback: "דירות" },
  { table: "buildings", labelKey: "nav.buildings", fallback: "בניינים" },
  { table: "contacts", labelKey: "nav.contacts", fallback: "אנשי קשר" },
  { table: "visit_history", labelKey: "admin.clone_org_limit_visits", fallback: "ביקורים" },
  { table: "donations", labelKey: "nav.donations", fallback: "תרומות" },
];

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
  const [limitInputs, setLimitInputs] = useState<Record<string, string>>({});

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
            const table_row_limits: Record<string, number> = {};
            for (const { table } of CLONE_LIMIT_TABLES) {
              const raw = limitInputs[table]?.trim();
              if (!raw) continue;
              const n = Number(raw);
              if (Number.isFinite(n) && n >= 0) table_row_limits[table] = Math.floor(n);
            }
            onConfirm(
              Object.keys(table_row_limits).length > 0
                ? { ...form, table_row_limits }
                : form,
            );
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
          <div className="space-y-2 rounded-md border border-border p-3">
            <p className="text-sm font-medium">
              {t("admin.clone_org_limits_title", "הגבלת מספר רשומות (אופציונלי)")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t(
                "admin.clone_org_limits_hint",
                "השאירו ריק כדי לשכפל את כל הרשומות בטבלה. רשומה שמתייחסת לרשומה שלא שוכפלה (כי הוגבלה בטבלה אחרת) תושמט.",
              )}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {CLONE_LIMIT_TABLES.map(({ table, labelKey, fallback }) => (
                <label key={table} className="flex items-center gap-2 text-sm">
                  <span className="w-20 shrink-0 text-muted-foreground">{t(labelKey, fallback)}</span>
                  <Input
                    type="number"
                    min={0}
                    dir="ltr"
                    value={limitInputs[table] ?? ""}
                    onChange={(e) =>
                      setLimitInputs({ ...limitInputs, [table]: e.target.value })
                    }
                    placeholder="∞"
                  />
                </label>
              ))}
            </div>
          </div>
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

/** fixes54 §8: one org's feature toggles — Area/Building/Apartment/Activist
 *  cascade (each forced off when its parent is off, regardless of its own
 *  stored value) plus the standalone AI query switch. Each checkbox reflects
 *  the *raw* stored value (so a superadmin can pre-configure a child while
 *  its parent is off, ready for when the parent turns back on) — a small
 *  note explains when `effective` disagrees with `raw` because of a
 *  disabled ancestor. */
function OrgFeatureToggles({
  prefs,
  busy,
  onChange,
}: {
  prefs: OrgPrefs;
  busy: boolean;
  onChange: (updates: OrgPrefsUpdate) => void;
}) {
  const { t } = useLocalization();

  const cascadeRows: { key: keyof OrgPrefsUpdate; label: string }[] = [
    { key: "area_display_enabled", label: t("admin.feature_area_display", "תצוגת אזורים") },
    { key: "building_display_enabled", label: t("admin.feature_building_display", "תצוגת בניינים") },
    { key: "apartment_display_enabled", label: t("admin.feature_apartment_display", "תצוגת דירות") },
    { key: "activist_system_enabled", label: t("admin.feature_activist_system", "מערכת פעילים") },
  ];

  return (
    <div className="space-y-3 max-w-md">
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-1.5">
          {t("admin.feature_cascade_hint", "כיבוי תכונה מכבה אוטומטית את כל התכונות שתחתיה.")}
        </p>
        <div className="space-y-1.5">
          {cascadeRows.map((row, i) => {
            const raw = prefs.raw[row.key] ?? true;
            const effective = prefs.effective[row.key] ?? true;
            const overridden = raw && !effective;
            return (
              <div key={row.key} style={{ paddingInlineStart: `${i * 1.25}rem` }}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={raw}
                    onChange={(e) => onChange({ [row.key]: e.target.checked })}
                  />
                  {row.label}
                </label>
                {overridden && (
                  <p className="text-xs text-status-darkred ms-6">
                    {t("admin.feature_overridden", "כבוי בפועל — תכונת אב כבויה")}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="border-t border-border pt-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            disabled={busy}
            checked={prefs.raw.ai_query_enabled ?? true}
            onChange={(e) => onChange({ ai_query_enabled: e.target.checked })}
          />
          {t("admin.feature_ai_query", "שאילתת AI")}
        </label>
      </div>
    </div>
  );
}
