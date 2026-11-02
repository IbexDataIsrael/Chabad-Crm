"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useLocalization } from "@/lib/localization";

/** fixes118 decision 8: a link by the apartment's stable lineage id (the chat
 *  helper sends these). An apartment's id changes on every save, so this page
 *  asks the API for the current version and opens it — links sent earlier keep
 *  working. */
export default function ApartmentLineagePage() {
  const router = useRouter();
  const { t } = useLocalization();
  const { lineageId } = useParams<{ lineageId: string }>();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let active = true;
    apiFetch<{ id: number }>(`/api/apartments/lineage/${encodeURIComponent(lineageId)}`)
      .then(({ id }) => {
        if (active) router.replace(`/dashboard/apartments/${id}`);
      })
      .catch(() => {
        if (active) setMissing(true);
      });
    return () => {
      active = false;
    };
  }, [lineageId, router]);

  return (
    <p className="text-muted-foreground">
      {missing
        ? t("apt.lineage_not_found", "הדירה לא נמצאה")
        : t("action.loading", "טוען…")}
    </p>
  );
}
