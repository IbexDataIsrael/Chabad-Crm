"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";

// The CRM's working landing page is the contacts list — except the platform
// superadmin, who has no tenant data and belongs on the System admin page,
// and shliach users whose org hasn't opted them into contacts (fixes18 §6),
// who land on their apartments instead.
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
        : shliachBlocked
          ? "/dashboard/apartments"
          : "/dashboard/contacts",
    );
  }, [router, user, isShliach, isSuperadmin, loading]);
  return <p className="p-8 text-center text-gray-400">{t("action.loading", "טוען…")}</p>;
}
