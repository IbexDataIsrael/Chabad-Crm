"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  Building2,
  FileText,
  Hash,
  Home,
  LayoutDashboard,
  LayoutGrid,
  Languages,
  ListChecks,
  MapPin,
  MessageSquare,
  Receipt,
  Settings,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  UserCog,
  Users,
  Users2,
  type LucideIcon,
  X,
} from "lucide-react";

import { useLocalization } from "@/lib/localization";
import { cn } from "@/lib/utils";

export interface SidebarNavItem {
  href: string;
  label: string;
}

export interface SidebarGroup {
  label: string;
  items: SidebarNavItem[];
}

// Icons keyed by href — assigned once here rather than threaded through the
// (translated, dynamic) label so DashboardChrome doesn't need to know about
// lucide-react at all.
const ICONS: Record<string, LucideIcon> = {
  "/dashboard": LayoutDashboard,
  "/dashboard/contacts": Users,
  "/dashboard/contacts/visit-summary": ListChecks,
  "/dashboard/admin-areas": ShieldCheck,
  "/dashboard/users": Users2,
  "/dashboard/donations": Receipt,
  "/dashboard/areas": MapPin,
  "/dashboard/buildings": Building2,
  "/dashboard/street": Home,
  "/dashboard/apartments": LayoutGrid,
  "/dashboard/reports/create": FileText,
  "/dashboard/report-numbers": Hash,
  "/dashboard/messages-from-activists": MessageSquare,
  "/dashboard/ai/query": Bot,
  "/dashboard/picklists": ListChecks,
  "/dashboard/custom-fields": SlidersHorizontal,
  "/dashboard/fields": Settings2,
  "/dashboard/localization": Languages,
  "/dashboard/shliach-config": UserCog,
  "/dashboard/settings": Settings,
};

// Longest-prefix match, same rule NavMenu used (fixes50 §3.3): a shorter
// href like "/dashboard/contacts" must not light up for its own more-specific
// sibling "/dashboard/contacts/visit-summary".
function matchLength(pathname: string, href: string): number {
  if (pathname === href) return href.length;
  if (pathname.startsWith(href + "/")) return href.length;
  return -1;
}

export function Sidebar({
  groups,
  orgName,
  logoUrl,
  shliachSuffix,
  open,
  onClose,
  desktopCollapsed = false,
}: {
  groups: SidebarGroup[];
  orgName: string;
  logoUrl: string | null;
  shliachSuffix?: string;
  open: boolean;
  onClose: () => void;
  /** fixes57 §4: desktop-only collapse (mobile keeps its own open/close via
   *  `open`/`onClose`, untouched) — mirrors the mobile drawer's hide/show but
   *  toggled from the header's desktop-only button, not swipe/overlay. */
  desktopCollapsed?: boolean;
}) {
  const pathname = usePathname();
  const { dir } = useLocalization();
  const allHrefs = groups.flatMap((g) => g.items.map((it) => it.href));
  const bestMatch = Math.max(-1, ...allHrefs.map((href) => matchLength(pathname, href)));
  const isRtl = dir === "rtl";

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={onClose} />
      )}
      <aside
        dir={dir}
        className={cn(
          "fixed top-0 z-50 flex h-full w-64 flex-col bg-sidebar transition-transform duration-300",
          isRtl ? "right-0 border-l border-sidebar-border" : "left-0 border-r border-sidebar-border",
          open
            ? "translate-x-0"
            : isRtl
              ? "translate-x-full"
              : "-translate-x-full",
          desktopCollapsed
            ? isRtl
              ? "lg:translate-x-full"
              : "lg:-translate-x-full"
            : "lg:translate-x-0",
        )}
      >
        <div className="flex select-none items-center justify-between border-b border-sidebar-border p-4">
          <Link href="/dashboard" className="flex min-w-0 flex-1 items-center gap-2.5" onClick={onClose}>
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt=""
                className="h-9 w-9 shrink-0 rounded-lg border border-sidebar-border bg-card object-contain"
              />
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-lg">
                🏢
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-sm font-bold leading-tight text-sidebar-foreground">
              {orgName}
              {shliachSuffix && (
                <span className="block truncate text-xs font-medium text-muted-foreground">
                  {shliachSuffix}
                </span>
              )}
            </span>
          </Link>
          <button
            onClick={onClose}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center text-muted-foreground hover:text-foreground lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto p-3">
          {groups.map((group) => {
            if (group.items.length === 0) return null;
            return (
              <div key={group.label || group.items[0].href}>
                {/* An empty label marks an ungrouped item (e.g. Home) that sits
                    above the labeled sections without its own heading. */}
                {group.label && (
                  <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </p>
                )}
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const Icon = ICONS[item.href] ?? LayoutDashboard;
                    const active = bestMatch >= 0 && matchLength(pathname, item.href) === bestMatch;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={onClose}
                        className={cn(
                          "flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
                          active
                            ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md"
                            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                        )}
                      >
                        <Icon className="h-5 w-5 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
