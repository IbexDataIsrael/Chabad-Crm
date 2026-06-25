"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";

import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/lib/auth";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <DashboardChrome>{children}</DashboardChrome>
    </RequireAuth>
  );
}

function DashboardChrome({ children }: { children: ReactNode }) {
  const { user, isAdmin, signOut } = useAuth();
  const orgName = user?.organization?.name ?? "מיני CRM";

  // Organization name as the browser tab title.
  useEffect(() => {
    document.title = orgName;
  }, [orgName]);

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-y-2">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <span className="text-lg font-bold">{orgName}</span>
            <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <Link href="/dashboard" className="hover:text-status-magenta">
                בית
              </Link>
              <Link href="/dashboard/contacts" className="hover:text-status-magenta">
                אנשי קשר
              </Link>
              <Link href="/dashboard/areas" className="hover:text-status-magenta">
                אזורים
              </Link>
              <Link href="/dashboard/buildings" className="hover:text-status-magenta">
                בניינים
              </Link>
              {isAdmin && (
                <Link
                  href="/dashboard/picklists"
                  className="hover:text-status-magenta"
                >
                  רשימות בחירה
                </Link>
              )}
              {isAdmin && (
                <Link
                  href="/dashboard/custom-fields"
                  className="hover:text-status-magenta"
                >
                  שדות מותאמים
                </Link>
              )}
              {isAdmin && (
                <Link
                  href="/dashboard/settings"
                  className="hover:text-status-magenta"
                >
                  הגדרות
                </Link>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-600">
              {user?.full_name}
              {isAdmin && (
                <span className="ms-2 rounded bg-status-magenta/10 text-status-magenta px-2 py-0.5 text-xs">
                  מנהל
                </span>
              )}
            </span>
            <button
              onClick={signOut}
              className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-50"
            >
              התנתק
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
