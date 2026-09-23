"use client";

import Link from "next/link";
import { UserPlus, X } from "lucide-react";
import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";

interface NewSignups {
  count: number;
  since: string | null;
}

/** fixes65 §7: "N new activists signed up" — self-registrations (public
 *  page or QR) since this admin last dismissed the card. Links to the Users
 *  list filtered to exactly those registrations. */
export function NewSignupsCard() {
  const { isAdmin } = useAuth();
  const { t } = useLocalization();
  const [data, setData] = useState<NewSignups | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    apiFetch<NewSignups>("/api/dashboard/new-signups").then(setData).catch(() => setData(null));
  }, [isAdmin]);

  if (!isAdmin || !data || data.count === 0) return null;

  async function dismiss() {
    setData(null);
    await apiFetch("/api/dashboard/new-signups/dismiss", { method: "POST" }).catch(() => {});
  }

  const href = `/dashboard/users?new_signups_since=${encodeURIComponent(data.since ?? "all")}`;
  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <UserPlus className="h-5 w-5" />
      </span>
      <Link href={href} className="flex-1 font-medium text-foreground hover:underline">
        {data.count === 1
          ? t("dashboard.new_signups_one", "פעיל חדש אחד נרשם")
          : t("dashboard.new_signups", "{n} פעילים חדשים נרשמו").replace("{n}", String(data.count))}
        <span className="block text-sm font-normal text-muted-foreground">
          {t("dashboard.new_signups_hint", "לצפייה ברשימת הנרשמים החדשים")}
        </span>
      </Link>
      <button
        type="button"
        onClick={dismiss}
        className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={t("dashboard.dismiss", "סגירה")}
        title={t("dashboard.dismiss", "סגירה")}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
