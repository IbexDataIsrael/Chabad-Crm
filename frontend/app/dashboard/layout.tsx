"use client";

import Link from "next/link";
import { type ReactNode } from "react";

import { GlobalSearch } from "@/components/GlobalSearch";
import { LabelStyleInjector } from "@/components/LabelStyleInjector";
import { LanguageToggle } from "@/components/LanguageToggle";
import { NavMenu, type NavMenuItem } from "@/components/NavMenu";
import { RequireAuth } from "@/components/RequireAuth";
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
  const { user, isAdmin, isShliach, isSuperadmin, signOut } = useAuth();
  const { t } = useLocalization();
  const orgName = user?.organization?.name ?? t("auth.app_title", "מיני CRM");
  const logoUrl = user?.organization?.logo_url ?? null;
  // The browser-tab title comes from TitleManager (fixes9 §1) — not set here.

  // Drop admin-only entries for staff users; a menu with no items hides itself.
  const adminOnly = (items: (NavMenuItem & { admin?: boolean })[]): NavMenuItem[] =>
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
    { href: "/dashboard/shluchim", label: t("nav.shluchim", "פעילים"), admin: true },
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
      ]);
  const moreItems = adminOnly([
    { href: "/dashboard", label: t("nav.home", "בית") },
    { href: "/dashboard/ai/query", label: t("nav.ai_query", "שאילתת AI") },
    { href: "/dashboard/picklists", label: t("nav.picklists", "רשימות בחירה"), admin: true },
    { href: "/dashboard/custom-fields", label: t("nav.custom_fields", "שדות מותאמים"), admin: true },
    { href: "/dashboard/fields", label: t("page.fields_title", "ניהול שדות"), admin: true },
    { href: "/dashboard/localization", label: t("nav.localization", "תרגומים"), admin: true },
    { href: "/dashboard/settings", label: t("nav.settings", "הגדרות") },
  ]);

  return (
    <div className="min-h-screen">
      <LabelStyleInjector />
      <header className="bg-white border-b border-gray-200">
        <div className="w-full px-4 md:px-6 py-3 flex flex-wrap items-center justify-between gap-y-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link href="/dashboard" className="flex items-center gap-2.5">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl}
                  alt={t("logo.alt", "לוגו הארגון")}
                  className="h-9 w-9 rounded-md object-contain border border-gray-200 bg-white"
                />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 bg-gray-50 text-lg">
                  🏢
                </span>
              )}
              <span className="text-lg font-bold">
                {orgName}
                {/* fixes11 §1.1: shliach sessions carry a localized suffix. */}
                {isShliach && (
                  <span className="ms-2 text-base font-medium text-gray-500">
                    {t("header.shliach_display_suffix", "תצוגת פעילים")}
                  </span>
                )}
              </span>
            </Link>
            <nav className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm">
              {isSuperadmin ? (
                // Platform superadmin: no tenant data of its own, so the whole
                // CRM nav is irrelevant — show only the System admin dashboard.
                <Link
                  href="/dashboard/admin"
                  className="rounded-md px-3 py-1.5 font-medium text-status-magenta transition-colors hover:bg-status-magenta/10"
                >
                  {t("nav.system_admin", "מנהל מערכת")}
                </Link>
              ) : (
                <>
                  <NavMenu label={t("nav.group.people", "אנשים")} items={peopleItems} />
                  <NavMenu label={t("nav.group.places", "מקומות")} items={placeItems} />
                  <NavMenu label={t("reports.menu_title", "דוחות")} items={reportItems} />
                  <NavMenu label={t("nav.group.more", "עוד")} items={moreItems} />
                </>
              )}
            </nav>
          </div>
          {!isSuperadmin && (
            <div className="order-last w-full md:order-none md:w-auto md:flex-1 md:px-4">
              <GlobalSearch />
            </div>
          )}
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-600">
              {/* fixes14 §2: the name comes from the linked contacts row. */}
              {user?.display_name || user?.full_name}
              {isAdmin && (
                <span className="ms-2 rounded bg-status-magenta/10 text-status-magenta px-2 py-0.5 text-xs">
                  {t("common.admin", "מנהל")}
                </span>
              )}
            </span>
            <LanguageToggle />
            <button
              onClick={signOut}
              className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-50"
            >
              {t("action.logout", "התנתק")}
            </button>
          </div>
        </div>
      </header>
      {/* Full-viewport width (fixes7 §8B); individual pages set their own max-w
          where a narrower reading width helps (forms, settings). */}
      <main className="w-full px-4 md:px-6 py-6">{children}</main>
    </div>
  );
}
