"use client";

import Link from "next/link";
import { LogOut, Menu } from "lucide-react";
import { useState, type ReactNode } from "react";

import { GlobalSearch } from "@/components/GlobalSearch";
import { LabelStyleInjector } from "@/components/LabelStyleInjector";
import { LanguageToggle } from "@/components/LanguageToggle";
import { RequireAuth } from "@/components/RequireAuth";
import { Sidebar, type SidebarGroup, type SidebarNavItem } from "@/components/layout/Sidebar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <DashboardChrome>{children}</DashboardChrome>
    </RequireAuth>
  );
}

function DashboardChrome({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, isAdmin, isShliach, isSuperadmin, signOut } = useAuth();
  const { t } = useLocalization();
  const orgName = user?.organization?.name ?? t("auth.app_title", "מיני CRM");
  const logoUrl = user?.organization?.logo_url ?? null;
  // The browser-tab title comes from TitleManager (fixes9 §1) — not set here.

  // Drop admin-only entries for staff users; a menu with no items hides itself.
  const adminOnly = (items: (SidebarNavItem & { admin?: boolean })[]): SidebarNavItem[] =>
    items.filter((it) => isAdmin || !it.admin).map(({ href, label }) => ({ href, label }));

  // fixes18 §6: a shliach only gets the contacts entry when the org opted in.
  const shliachContactsBlocked =
    isShliach && !user?.organization?.shliach_can_view_contacts;
  const peopleItems = adminOnly([
    ...(shliachContactsBlocked
      ? []
      : [{ href: "/dashboard/contacts", label: t("nav.contacts", "אנשי קשר") }]),
    // fixes38 §1.1: Manage Areas relocated here from Places — hidden from
    // shliach users (fixes10 §3.7 — the whole section is blocked for them).
    ...(isShliach
      ? []
      : [{ href: "/dashboard/admin-areas", label: t("nav.admin_areas", "אזור מנהל") }]),
    // fixes42 §4A: the Shluchim nav entry merged into Users.
    { href: "/dashboard/users", label: t("nav.users", "משתמשים"), admin: true },
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
  const placeItems = adminOnly([
    { href: "/dashboard/areas", label: t("nav.areas", "אזורים") },
    { href: "/dashboard/buildings", label: t("nav.buildings", "בניינים"), admin: true },
    { href: "/dashboard/apartments", label: t("nav.apartments", "דירות") },
  ]);
  // fixes24 §2: dedicated Reports group — PDF generation plus the
  // report-number management page (moved out of Places; still admin-only).
  // fixes30 §1: the whole group is hidden for shliach users (an empty menu
  // renders nothing).
  const reportItems = isShliach
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
    { href: "/dashboard", label: t("nav.home", "בית") },
    { href: "/dashboard/ai/query", label: t("nav.ai_query", "שאילתת AI") },
    { href: "/dashboard/picklists", label: t("nav.picklists", "רשימות בחירה"), admin: true },
    { href: "/dashboard/custom-fields", label: t("nav.custom_fields", "שדות מותאמים"), admin: true },
    { href: "/dashboard/fields", label: t("page.fields_title", "ניהול שדות"), admin: true },
    { href: "/dashboard/localization", label: t("nav.localization", "תרגומים"), admin: true },
    // fixes51 §4: admin-only config panel for the Shliach role's Apartments view.
    {
      href: "/dashboard/shliach-config",
      label: t("nav.shliach_config", "הגדרות לתצוגת פעילים"),
      admin: true,
    },
    { href: "/dashboard/settings", label: t("nav.settings", "הגדרות") },
  ]);

  const groups: SidebarGroup[] = [
    { label: t("nav.group.people", "אנשים"), items: peopleItems },
    { label: t("nav.group.places", "מקומות"), items: placeItems },
    { label: t("reports.menu_title", "דוחות"), items: reportItems },
    { label: t("nav.group.more", "עוד"), items: moreItems },
  ];

  return (
    <div className="min-h-screen bg-background">
      <LabelStyleInjector />
      {!isSuperadmin && (
        <Sidebar
          groups={groups}
          orgName={orgName}
          logoUrl={logoUrl}
          shliachSuffix={isShliach ? t("header.shliach_display_suffix", "תצוגת פעילים") : undefined}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
      )}

      <div className={!isSuperadmin ? "flex min-h-screen flex-col lg:mr-64" : "flex min-h-screen flex-col"}>
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur-lg md:px-6">
          <div className="flex items-center gap-2">
            {!isSuperadmin && (
              <Button
                variant="ghost"
                size="icon"
                className="min-h-[44px] min-w-[44px] lg:hidden"
                onClick={() => setSidebarOpen(true)}
              >
                <Menu className="h-5 w-5" />
              </Button>
            )}
            {isSuperadmin && (
              <Link
                href="/dashboard/admin"
                className="rounded-md px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
              >
                {t("nav.system_admin", "מנהל מערכת")}
              </Link>
            )}
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
