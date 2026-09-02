"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { AdminDashboardHome } from "@/components/AdminDashboardHome";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";

// The CRM's home page. The platform superadmin has no tenant data of its own
// and belongs on the System admin page; a shliach user lands on their own
// dedicated landing page (fixes54 §6.1: /dashboard/activist) when a contact
// is linked, falling back to apartments (or the blocked-from-contacts
// fallback, fixes18 §6) only when no contact is linked at all. Everyone else
// (admin/staff) gets the real dashboard rendered right here — this route is
// also the sidebar's first ("Home") entry for every role, so it must resolve
// sensibly regardless of who's looking at it.
export default function DashboardHome() {
  const router = useRouter();
  const { t } = useLocalization();
  const { user, isShliach, isSuperadmin, loading } = useAuth();

  const shliachBlocked = isShliach && !user?.organization?.shliach_can_view_contacts;
  // Every shliach case keeps its exact pre-existing destination (the backend
  // dashboard endpoint is admin/staff-only — a shliach must never fall
  // through to it). Only admin/staff render the dashboard here instead of
  // redirecting away.
  const redirectTarget = isSuperadmin
    ? "/dashboard/admin"
    : isShliach
      ? user?.shliach?.contact_id
        ? "/dashboard/activist"
        : shliachBlocked
          ? "/dashboard/apartments"
          : "/dashboard/contacts"
      : null; // admin/staff: no redirect, render the dashboard below

  useEffect(() => {
    if (loading || !redirectTarget) return;
    router.replace(redirectTarget);
  }, [router, redirectTarget, loading]);

  if (loading || redirectTarget) {
    return <p className="p-8 text-center text-muted-foreground">{t("action.loading", "טוען…")}</p>;
  }

  return <AdminDashboardHome />;
}
