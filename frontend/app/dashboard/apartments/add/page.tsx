"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { ApartmentEditor } from "@/components/ApartmentEditor";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { safeInternalPath } from "@/lib/nav";

/** Standalone apartment-creation view (fixes12 §2.2). Accepts
 *  ?building=<id> to preselect the building and ?return=<path> to go back to
 *  the caller (e.g. a building's edit page) after save/cancel. */
export default function AddApartmentPage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground">…</p>}>
      <AddApartmentInner />
    </Suspense>
  );
}

function AddApartmentInner() {
  const { loading } = useAuth();
  const { t } = useLocalization();
  const router = useRouter();
  const searchParams = useSearchParams();

  const returnTo = safeInternalPath(searchParams.get("return"), "/dashboard/apartments");
  const preselect = Number(searchParams.get("building"));
  const initialBuildingId = Number.isFinite(preselect) && preselect > 0 ? preselect : undefined;

  if (loading) return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-4xl">{t("apt.new_apartment_title", "דירה חדשה")}</h1>
        <Link href={returnTo} className="text-sm text-primary hover:underline">
          {t("action.cancel", "ביטול")}
        </Link>
      </div>
      <div className="glass-card p-4">
        <ApartmentEditor
          initialBuildingId={initialBuildingId}
          onClose={() => router.push(returnTo)}
          onSaved={async () => router.push(returnTo)}
        />
      </div>
    </div>
  );
}
