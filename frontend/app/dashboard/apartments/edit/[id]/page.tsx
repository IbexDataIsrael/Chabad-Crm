"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { ApartmentEditor } from "@/components/ApartmentEditor";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { safeInternalPath } from "@/lib/nav";
import { apartmentTitle, type Apartment } from "@/lib/types";

/** Standalone apartment-edit view (fixes12 §2.3). ?return=<path> sends the
 *  user back to the caller (apartment detail, building edit …) after save. */
export default function EditApartmentPage() {
  return (
    <Suspense fallback={<p className="text-gray-400">…</p>}>
      <EditApartmentInner />
    </Suspense>
  );
}

function EditApartmentInner() {
  const { loading } = useAuth();
  const { t } = useLocalization();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const apartmentId = Number(params.id);

  const [apt, setApt] = useState<Apartment | null>(null);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const returnTo = safeInternalPath(
    searchParams.get("return"),
    `/dashboard/apartments/${apartmentId}`,
  );

  useEffect(() => {
    if (loading) return;
    apiFetch<Apartment>(`/api/apartments/${apartmentId}`)
      .then(setApt)
      .catch((err) =>
        setError(err instanceof Error ? err.message : t("msg.load_failed", "טעינה נכשלה")),
      )
      .finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apartmentId, loading]);

  if (loading || !loaded) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;
  if (error || !apt) {
    return (
      <div className="space-y-3">
        <Link href="/dashboard/apartments" className="text-sm text-status-magenta hover:underline">
          {t("page.back_to_apartments", "← חזרה לדירות")}
        </Link>
        <p className="text-status-darkred">
          {error || t("page.apartment_not_found", "הדירה לא נמצאה.")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          {t("apt.edit_apartment", "עריכת דירה")} — {apartmentTitle(apt)}
        </h1>
        <Link href={returnTo} className="text-sm text-status-magenta hover:underline">
          {t("action.cancel", "ביטול")}
        </Link>
      </div>
      <div className="bg-white rounded-xl shadow-sm p-4">
        <ApartmentEditor
          apt={apt}
          onClose={() => router.push(returnTo)}
          onSaved={async () => router.push(returnTo)}
        />
      </div>
    </div>
  );
}
