"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { formatCoords, type Apartment, type Area, type Building } from "@/lib/types";

export default function BuildingDetailPage() {
  const { loading } = useAuth();
  const { t } = useLocalization();
  const params = useParams<{ id: string }>();
  const buildingId = Number(params.id);

  const [building, setBuilding] = useState<Building | null>(null);
  const [area, setArea] = useState<Area | null>(null);
  const [apartments, setApartments] = useState<Apartment[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (loading) return;
    Promise.all([
      apiFetch<Building>(`/api/buildings/${buildingId}`),
      apiFetch<Apartment[]>(`/api/apartments?building_id=${buildingId}`).catch(
        () => [] as Apartment[],
      ),
    ])
      .then(async ([b, apts]) => {
        setBuilding(b);
        setApartments(apts);
        setArea(await apiFetch<Area>(`/api/areas/${b.area_id}`).catch(() => null));
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : t("msg.load_failed", "טעינה נכשלה")),
      )
      .finally(() => setLoaded(true));
  }, [buildingId, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || !loaded) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;
  if (error || !building) {
    return (
      <div className="space-y-3">
        <Link href="/dashboard/buildings" className="text-sm text-status-magenta hover:underline">
          {t("page.back_to_buildings", "← חזרה לבניינים")}
        </Link>
        <p className="text-status-darkred">
          {error || t("page.building_not_found", "הבניין לא נמצא.")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <Link href="/dashboard/buildings" className="text-sm text-status-magenta hover:underline">
        {t("page.back_to_buildings", "← חזרה לבניינים")}
      </Link>

      <div className="bg-white rounded-xl shadow-sm p-5 space-y-3">
        <h1 className="text-2xl font-bold">{building.building_name}</h1>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-gray-500">{t("buildings.area_id", "אזור")}</dt>
            <dd className="font-medium">
              {area ? (
                <Link
                  href={`/dashboard/areas/${area.id}`}
                  className="text-status-magenta hover:underline"
                >
                  {area.area_name}
                </Link>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">{t("apartments", "דירות")}</dt>
            <dd className="font-medium">{apartments.length}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-gray-500">{t("buildings.building_address", "כתובת בניין")}</dt>
            <dd className="font-medium">{building.building_address || "—"}</dd>
          </div>
          {building.latitude != null && building.longitude != null && (
            <div className="sm:col-span-2">
              <dt className="text-gray-500">{t("buildings.coords", "קואורדינטות")}</dt>
              <dd className="font-medium" dir="ltr">
                {formatCoords(building.latitude, building.longitude)}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {/* Apartments in this building — each name links to its detail page. */}
      <section className="bg-white rounded-xl shadow-sm p-5 space-y-2">
        <h2 className="text-sm font-semibold text-gray-500">{t("apartments", "דירות")}</h2>
        {apartments.length === 0 ? (
          <p className="text-sm text-gray-400">
            {t("apt.no_apartments_building", "אין דירות בבניין זה.")}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {apartments.map((a) => (
              <li key={a.id} className="py-2">
                <Link
                  href={`/dashboard/apartments/${a.id}`}
                  className="font-medium text-status-magenta hover:underline"
                >
                  {a.apartment_name}
                </Link>
                {a.apartment_notes && (
                  <span className="text-sm text-gray-500"> — {a.apartment_notes}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
