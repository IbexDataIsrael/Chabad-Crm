"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import type { ApartmentListItem, Building } from "@/lib/types";

export default function ApartmentDetailPage() {
  const { loading } = useAuth();
  const { t } = useLocalization();
  const params = useParams<{ id: string }>();
  const apartmentId = Number(params.id);

  const [apt, setApt] = useState<ApartmentListItem | null>(null);
  const [building, setBuilding] = useState<Building | null>(null);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (loading) return;
    apiFetch<ApartmentListItem[]>("/api/apartments/list")
      .then(async (items) => {
        const found = items.find((a) => a.id === apartmentId) ?? null;
        setApt(found);
        if (found) {
          const buildings = await apiFetch<Building[]>("/api/buildings").catch(
            () => [] as Building[],
          );
          setBuilding(buildings.find((b) => b.id === found.building_id) ?? null);
        }
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : t("msg.load_failed", "טעינה נכשלה")),
      )
      .finally(() => setLoaded(true));
  }, [apartmentId, loading]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <Link href="/dashboard/apartments" className="text-sm text-status-magenta hover:underline">
        {t("page.back_to_apartments", "← חזרה לדירות")}
      </Link>

      <div className="bg-white rounded-xl shadow-sm p-5 space-y-3">
        <h1 className="text-2xl font-bold">{apt.apartment_name}</h1>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-gray-500">{t("apartments.building_id", "בניין")}</dt>
            <dd className="font-medium">{apt.building_name || "—"}</dd>
          </div>
          <div>
            <dt className="text-gray-500">{t("buildings.area_id", "אזור")}</dt>
            <dd className="font-medium">{apt.area_name || "—"}</dd>
          </div>
          {building?.building_address && (
            <div className="sm:col-span-2">
              <dt className="text-gray-500">{t("buildings.building_address", "כתובת בניין")}</dt>
              <dd className="font-medium">{building.building_address}</dd>
            </div>
          )}
          <div className="sm:col-span-2">
            <dt className="text-gray-500">{t("apartments.apartment_notes", "הערות")}</dt>
            <dd className="font-medium">{apt.apartment_notes || "—"}</dd>
          </div>
        </dl>
      </div>

      {/* Linked contact (mekurav) — name links to their contact page. */}
      <section className="bg-white rounded-xl shadow-sm p-5 space-y-2">
        <h2 className="text-sm font-semibold text-gray-500">{t("apt.contact", "איש קשר")}</h2>
        {apt.contact_id ? (
          <Link
            href={`/dashboard/contacts/${apt.contact_id}`}
            className="inline-block rounded-full bg-status-magenta/10 text-status-magenta px-3 py-1 text-sm hover:bg-status-magenta/20"
          >
            {apt.contact_name}
          </Link>
        ) : (
          <p className="text-sm text-gray-400">{t("apt.no_contact", "ללא איש קשר")}</p>
        )}
      </section>
    </div>
  );
}
