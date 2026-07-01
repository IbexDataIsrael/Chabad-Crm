"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";

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
  const { user, isAdmin, isSuperadmin, signOut } = useAuth();
  const { t } = useLocalization();
  const orgName = user?.organization?.name ?? t("auth.app_title", "מיני CRM");
  const logoUrl = user?.organization?.logo_url ?? null;

  // Organization name as the browser tab title.
  useEffect(() => {
    document.title = orgName;
  }, [orgName]);

  // Drop admin-only entries for staff users; a menu with no items hides itself.
  const adminOnly = (items: (NavMenuItem & { admin?: boolean })[]): NavMenuItem[] =>
    items.filter((it) => isAdmin || !it.admin).map(({ href, label }) => ({ href, label }));

  const peopleItems = adminOnly([
    { href: "/dashboard/contacts", label: t("nav.contacts", "אנשי קשר") },
    { href: "/dashboard/shluchim", label: t("nav.shluchim", "פעילים"), admin: true },
    { href: "/dashboard/visits", label: t("nav.visits", "ביקורים"), admin: true },
  ]);
  const placeItems = adminOnly([
    { href: "/dashboard/areas", label: t("nav.areas", "אזורים") },
    { href: "/dashboard/buildings", label: t("nav.buildings", "בניינים"), admin: true },
    { href: "/dashboard/apartments", label: t("nav.apartments", "דירות") },
  ]);
  const moreItems = adminOnly([
    { href: "/dashboard", label: t("nav.home", "בית") },
    { href: "/dashboard/picklists", label: t("nav.picklists", "רשימות בחירה"), admin: true },
    { href: "/dashboard/custom-fields", label: t("nav.custom_fields", "שדות מותאמים"), admin: true },
    { href: "/dashboard/fields", label: t("page.fields_title", "ניהול שדות"), admin: true },
    { href: "/dashboard/localization", label: t("nav.localization", "תרגומים"), admin: true },
    { href: "/dashboard/settings", label: t("nav.settings", "הגדרות"), admin: true },
  ]);

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-y-2">
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
              <span className="text-lg font-bold">{orgName}</span>
            </Link>
            <nav className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm">
              <NavMenu label={t("nav.group.people", "אנשים")} items={peopleItems} />
              <NavMenu label={t("nav.group.places", "מקומות")} items={placeItems} />
              {isAdmin && (
                <Link
                  href="/dashboard/donations"
                  className="rounded-md px-2.5 py-1.5 text-gray-700 transition-colors hover:bg-gray-100"
                >
                  {t("nav.donations", "תרומות")}
                </Link>
              )}
              <NavMenu label={t("nav.group.more", "עוד")} items={moreItems} />
              {isSuperadmin && (
                <Link
                  href="/dashboard/admin"
                  className="rounded-md px-2.5 py-1.5 font-medium text-status-magenta transition-colors hover:bg-status-magenta/10"
                >
                  {t("nav.system_admin", "מנהל מערכת")}
                </Link>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-600">
              {user?.full_name}
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
      <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
