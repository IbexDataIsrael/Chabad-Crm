"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";

// The CRM's working landing page is the contacts list — except the platform
// superadmin, who has no tenant data and belongs on the System admin page,
// and shliach users, who land on their own contact profile (fixes53 §7:
// the self-edit page is every activist's default screen on entry) when one
// is linked, falling back to apartments (or the blocked-from-contacts
// fallback, fixes18 §6) only when no contact is linked at all.
export default function DashboardHome() {
  const router = useRouter();
  const { t } = useLocalization();
  const { user, isShliach, isSuperadmin, loading } = useAuth();
  useEffect(() => {
    if (loading) return;
    const shliachBlocked =
      isShliach && !user?.organization?.shliach_can_view_contacts;
    router.replace(
      isSuperadmin
        ? "/dashboard/admin"
        : isShliach && user?.shliach?.contact_id
          ? `/dashboard/contacts/${user.shliach.contact_id}`
          : shliachBlocked
            ? "/dashboard/apartments"
            : "/dashboard/contacts",
    );
  }, [router, user, isShliach, isSuperadmin, loading]);
  return <p className="p-8 text-center text-gray-400">{t("action.loading", "טוען…")}</p>;
}
