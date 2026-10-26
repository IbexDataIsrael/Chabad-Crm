"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { DonationsEditor } from "@/components/DonationsEditor";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";

export default function DonationsPage() {
  const router = useRouter();
  const { isAdmin, loading } = useAuth();
  const { t } = useLocalization();

  useEffect(() => {
    if (!loading && !isAdmin) router.replace("/dashboard");
  }, [loading, isAdmin, router]);

  if (loading || !isAdmin) return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-wide">{t("nav.donations", "תרומות")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("page.donations_intro", "היסטורית תרומות. ניתן לשייך תרומה לאיש קשר או להשאיר ללא שיוך.")}
        </p>
      </div>
      <DonationsEditor />
    </div>
  );
}
