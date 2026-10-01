"use client";

import { LogOut, Menu, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useState, type ReactNode } from "react";

import { GlobalSearch } from "@/components/GlobalSearch";
import { LabelStyleInjector } from "@/components/LabelStyleInjector";
import { LanguageToggle } from "@/components/LanguageToggle";
import { RequireAuth } from "@/components/RequireAuth";
import { Sidebar, type SidebarGroup, type SidebarNavItem } from "@/components/layout/Sidebar";
import { Button } from "@/components/ui/button";
import { isFeatureEnabled, useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { usePersistentState } from "@/lib/persist";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <DashboardChrome>{children}</DashboardChrome>
    </RequireAuth>
  );
}

function DashboardChrome({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // fixes57 §4: desktop-only sidebar collapse, independent of the mobile
  // drawer's open/close above — same idea (hide the sidebar, reclaim the
  // width) but reachable at desktop widths too, toggled from its own header
  // button (the mobile hamburger stays lg:hidden, this stays hidden below lg).
  const [desktopCollapsed, setDesktopCollapsed] = usePersistentState(
    "crm.sidebarCollapsed", false,
  );
  const { user, isAdmin, isShliach, isSuperadmin, isCampaignManager, signOut } = useAuth();
  const { t, dir } = useLocalization();
  const isRtl = dir === "rtl";
  // fixes85: the English title when the UI is in English (if one is set).
  const orgName =
    (dir === "ltr" && user?.organization?.name_en) ||
    user?.organization?.name ||
    t("auth.app_title", "מיני CRM");
  const logoUrl = user?.organization?.logo_url ?? null;
  // The browser-tab title comes from TitleManager (fixes9 §1) — not set here.

  // Drop admin-only entries for non-admins; a menu with no items hides
  // itself. fixes58 §3.7 (plan Phase 3): an item can also carry a `roles`
  // allow-list instead of the bare `admin` flag, for "admin or
  // campaign_manager"-style entries (Users, shliach-config, Campaigns/Tasks)
  // — `roles` takes priority over `admin` when both would apply.
  const currentRole = user?.role;
  const adminOnly = (
    items: (SidebarNavItem & { admin?: boolean; roles?: string[] })[],
  ): SidebarNavItem[] =>
    items
      .filter((it) => {
        if (it.roles) return !!currentRole && it.roles.includes(currentRole);
        return isAdmin || !it.admin;
      })
      .map(({ href, label }) => ({ href, label }));

  // fixes18 §6: a shliach only gets the contacts entry when the org opted in.
  // fixes58 §3.7: Campaign Manager never gets Contacts, regardless of that toggle.
  const shliachContactsBlocked =
    (isShliach && !user?.organization?.shliach_can_view_contacts) || isCampaignManager;
  const peopleItems = adminOnly([
    ...(shliachContactsBlocked
      ? []
      : [{ href: "/dashboard/contacts", label: t("nav.contacts", "אנשי קשר") }]),
    // fixes38 §1.1: Manage Areas relocated here from Places — hidden from
    // shliach users (fixes10 §3.7 — the whole section is blocked for them)
    // and from Campaign Manager (fixes58 §3.7 — not in their allowed list).
    ...(isShliach || isCampaignManager
      ? []
      : [{ href: "/dashboard/admin-areas", label: t("nav.admin_areas", "אזור מותאם אישית") }]),
    // fixes42 §4A: the Shluchim nav entry merged into Users. fixes58 §3.7:
    // Campaign Manager gets "Volunteers" management here too.
    {
      href: "/dashboard/users", label: t("nav.users", "משתמשים"),
      roles: ["admin", "campaign_manager"],
    },
    // fixes25 §4: the Visits menu entry is retired (visit logging happens from
    // the contact page); /dashboard/visits still serves by direct URL.
    // fixes24 §2: donations moved from a standalone header link into People.
    { href: "/dashboard/donations", label: t("nav.donations", "תרומות"), admin: true },
    // fixes38 §1.2: Summary of Visits report.
    ...(shliachContactsBlocked
      ? []
      : [
          {
            href: "/dashboard/contacts/visit-summary",
            label: t("nav.visit_summary", "סיכום ביקורים"),
          },
        ]),
  ]);
  // fixes58 §3.1/§3.4: Campaign + Task management — admin and campaign_manager.
  const campaignItems = adminOnly([
    {
      href: "/dashboard/campaigns", label: t("nav.campaigns", "קמפיינים"),
      roles: ["admin", "campaign_manager"],
    },
    {
      href: "/dashboard/tasks", label: t("nav.tasks", "משימות"),
      roles: ["admin", "campaign_manager"],
    },
  ]);
  // fixes54 §8: superadmin cascading module toggles (Area -> Building ->
  // Apartment -> Activist) — each nav entry is gated on its own module's
  // *effective* (already-cascaded) flag from useAuth's session.
  const org = user?.organization;
  const placeItems = adminOnly([
    ...(isFeatureEnabled(org, "area_display_enabled")
      ? [{ href: "/dashboard/areas", label: t("nav.areas", "אזורים") }]
      : []),
    ...(isFeatureEnabled(org, "building_display_enabled")
      ? [{ href: "/dashboard/buildings", label: t("nav.buildings", "בניינים"), admin: true }]
      : []),
    // docs/fixes68_b.md: /dashboard/street (the mobile door/street reskin) is
    // now the default "Apartments" landing page; the classic grid moves to
    // its own "Apartment management" entry at its same /dashboard/apartments
    // URL — untouched, still the fallback for filters/bulk-edit/admin work.
    ...(isFeatureEnabled(org, "apartment_display_enabled")
      ? [
          // fixes69 §Admin2: an admin manages apartments from the classic
          // grid below, not the mobile door-by-door flow — the mobile view
          // stays the default landing page for everyone else (staff/
          // shliach/campaign manager) per fixes68_b.md. fixes71 follow-up:
          // this now points at street2 (card-based v2), not the retired-
          // from-nav street v1 — street2 is the only mobile-view menu entry;
          // /dashboard/street itself still works, just unlinked from any menu.
          {
            href: "/dashboard/street2",
            label: t("nav.apartments", "דירות"),
            // fixes89: activists only — hidden from campaign_manager and the
            // restricted (staff) user. The admin/campaign-manager activist-view
            // link from the Users page (?activist=<id>) still opens it.
            roles: ["shliach"],
          },
          // fixes92: the game-path road map — activists only, beside street2.
          {
            href: "/dashboard/route",
            label: t("nav.route", "מסלול השליחות"),
            roles: ["shliach"],
          },
          {
            href: "/dashboard/apartments",
            label: t("nav.apartments_grid", "ניהול דירות"),
          },
        ]
      : []),
  ]);
  // fixes24 §2: dedicated Reports group — PDF generation plus the
  // report-number management page (moved out of Places; still admin-only).
  // fixes30 §1: the whole group is hidden for shliach users (an empty menu
  // renders nothing). fixes58 §3.7: also hidden for Campaign Manager
  // (Report Numbers moved into Tasks; the report-creation flow isn't in
  // their allowed list either).
  const reportItems = isShliach || isCampaignManager
    ? []
    : adminOnly([
        { href: "/dashboard/reports/create", label: t("reports.create_reports", "יצירת דוחות") },
        {
          href: "/dashboard/report-numbers",
          label: t("nav.report_numbers", "מספרי דוח"),
          admin: true,
        },
        // fixes53 §9: the activist report-completion/comment log.
        {
          href: "/dashboard/messages-from-activists",
          label: t("nav.messages_from_activists", "הודעות מהפעילים"),
          admin: true,
        },
      ]);
  const moreItems = adminOnly([
    // fixes54 §7: the Activist role never gets AI query — was missing an
    // `isShliach` guard entirely (only `admin` items were ever stripped for
    // non-admins, so a shliach user still saw and could open this). fixes54
    // §8: also gated on the superadmin-managed org-wide ai_query_enabled toggle.
    ...(isShliach || !isFeatureEnabled(org, "ai_query_enabled")
      ? []
      : [{ href: "/dashboard/ai/query", label: t("nav.ai_query", "שאילתת AI") }]),
    { href: "/dashboard/picklists", label: t("nav.picklists", "רשימות בחירה"), admin: true },
    { href: "/dashboard/custom-fields", label: t("nav.custom_fields", "שדות מותאמים"), admin: true },
    { href: "/dashboard/fields", label: t("page.fields_title", "ניהול שדות"), admin: true },
    { href: "/dashboard/localization", label: t("nav.localization", "תרגומים"), admin: true },
    // fixes75 §6: entry log + error log.
    { href: "/dashboard/logs", label: t("nav.logs", "לוגים"), admin: true },
    // fixes51 §4: config panel for the Shliach role's Apartments view.
    // fixes58 §3.7: this is the "Volunteer View Settings" page Campaign
    // Manager is explicitly granted.
    {
      href: "/dashboard/shliach-config",
      label: t("nav.shliach_config", "הגדרות לתצוגת פעילים"),
      roles: ["admin", "campaign_manager"],
    },
    { href: "/dashboard/settings", label: t("nav.settings", "הגדרות") },
  ]);

  const orgGroups: SidebarGroup[] = [
    // Ungrouped (no section heading) so the Home icon sits first, above every
    // labeled group — same URL for every role; /dashboard itself renders the
    // right thing per role (admin/staff dashboard, shliach's activist landing
    // page, or a redirect for superadmin).
    { label: "", items: [{ href: "/dashboard", label: t("nav.home", "בית") }] },
    { label: t("nav.group.people", "אנשים"), items: peopleItems },
    { label: t("nav.group.places", "מקומות"), items: placeItems },
    { label: t("reports.menu_title", "דוחות"), items: reportItems },
    // fixes58 §3.1/§3.4: own group so it reads as a distinct module, not
    // buried inside an existing one.
    { label: t("nav.group.campaigns", "קמפיינים ומשימות"), items: campaignItems },
    { label: t("nav.group.more", "עוד"), items: moreItems },
  ];
  // fixes81 §1: the superadmin gets the same sidebar as everyone else, with
  // the platform-admin pages instead of the org's modules (the superadmin
  // has no org data of their own).
  const superadminGroups: SidebarGroup[] = [
    {
      label: "",
      items: [
        { href: "/dashboard/admin", label: t("admin.nav_orgs", "ארגונים") },
        { href: "/dashboard/admin/users", label: t("admin.nav_users", "חיפוש משתמשים") },
        { href: "/dashboard/admin/email-templates", label: t("admin.nav_email_templates", "תבניות מייל") },
        { href: "/dashboard/admin/settings", label: t("admin.system_settings_title", "הגדרות מערכת") },
        { href: "/dashboard/admin/logs", label: t("logs.title", "לוגים") },
      ],
    },
  ];
  const groups = isSuperadmin ? superadminGroups : orgGroups;

  return (
    <div className="min-h-screen bg-background">
      <LabelStyleInjector />
      <Sidebar
        groups={groups}
        orgName={isSuperadmin ? t("admin.title", "ניהול מערכת") : orgName}
        logoUrl={isSuperadmin ? null : logoUrl}
        shliachSuffix={isShliach ? t("header.shliach_display_suffix", "תצוגת פעילים") : undefined}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        desktopCollapsed={desktopCollapsed}
      />

      <div
        className={`flex min-h-screen flex-col ${
          desktopCollapsed
            ? isRtl
              ? "lg:mr-0"
              : "lg:ml-0"
            : isRtl
              ? "lg:mr-64"
              : "lg:ml-64"
        }`}
      >
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur-lg md:px-6">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="min-h-[44px] min-w-[44px] lg:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            {/* fixes57 §4: desktop-only collapse toggle — the mirror of the
                mobile hamburger above (lg:hidden), shown only from lg up. */}
            <Button
              variant="ghost"
              size="icon"
              className="hidden min-h-[44px] min-w-[44px] lg:flex"
              onClick={() => setDesktopCollapsed((v) => !v)}
              title={
                desktopCollapsed
                  ? t("nav.expand_sidebar", "הצג תפריט")
                  : t("nav.collapse_sidebar", "צמצם תפריט")
              }
            >
              {desktopCollapsed ? (
                <PanelRightOpen className="h-5 w-5" />
              ) : (
                <PanelRightClose className="h-5 w-5" />
              )}
            </Button>
          </div>

          {!isSuperadmin && (
            <div className="hidden flex-1 justify-center px-4 md:flex">
              <GlobalSearch />
            </div>
          )}

          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-muted-foreground sm:inline">
              {/* fixes14 §2: the name comes from the linked contacts row. */}
              {user?.display_name || user?.full_name}
              {isAdmin && (
                <span className="ms-2 rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">
                  {t("common.admin", "מנהל")}
                </span>
              )}
            </span>
            <LanguageToggle />
            <Button variant="outline" size="sm" onClick={signOut} className="min-h-[44px]">
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">{t("action.logout", "התנתק")}</span>
            </Button>
          </div>
        </header>

        {!isSuperadmin && (
          <div className="border-b border-border px-4 py-2 md:hidden">
            <GlobalSearch />
          </div>
        )}

        {/* Full-viewport width (fixes7 §8B); individual pages set their own max-w
            where a narrower reading width helps (forms, settings). */}
        <main className="w-full flex-1 px-4 py-6 md:px-6">{children}</main>
      </div>
    </div>
  );
}
