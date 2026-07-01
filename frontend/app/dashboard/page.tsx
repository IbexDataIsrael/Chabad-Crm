"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";

// The CRM's working landing page is the contacts list — except the platform
// superadmin, who has no tenant data and belongs on the System admin page.
export default function DashboardHome() {
  const router = useRouter();
  const { t } = useLocalization();
  const { isSuperadmin, loading } = useAuth();
  useEffect(() => {
    if (loading) return;
    router.replace(isSuperadmin ? "/dashboard/admin" : "/dashboard/contacts");
  }, [router, isSuperadmin, loading]);
  return <p className="p-8 text-center text-gray-400">{t("action.loading", "טוען…")}</p>;
}
