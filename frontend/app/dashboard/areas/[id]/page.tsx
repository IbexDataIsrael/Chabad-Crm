"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { AreaPolygonView } from "@/components/AreaPolygonView";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { contactFullName, type Area, type Building, type Contact } from "@/lib/types";

export default function AreaDetailPage() {
  const { isAdmin, loading } = useAuth();
  const { t } = useLocalization();
  const params = useParams<{ id: string }>();
  const areaId = Number(params.id);

  const [area, setArea] = useState<Area | null>(null);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [shluchim, setShluchim] = useState<Contact[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (loading) return;
    Promise.all([
      apiFetch<Area>(`/api/areas/${areaId}`),
      apiFetch<Building[]>("/api/buildings").catch(() => [] as Building[]),
      apiFetch<Contact[]>(`/api/areas/${areaId}/shluchim`).catch(() => [] as Contact[]),
    ])
      .then(([a, b, s]) => {
        setArea(a);
        setBuildings(b.filter((x) => x.area_id === areaId));
        setShluchim(s);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : t("msg.load_failed", "טעינה נכשלה")),
      )
      .finally(() => setLoaded(true));
  }, [areaId, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || !loaded) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;
  if (error || !area) {
    return (
      <div className="space-y-3">
        <Link href="/dashboard/areas" className="text-sm text-status-magenta hover:underline">
          {t("page.back_to_areas", "← חזרה לאזורים")}
        </Link>
        <p className="text-status-darkred">{error || t("page.area_not_found", "האזור לא נמצא.")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <Link href="/dashboard/areas" className="text-sm text-status-magenta hover:underline">
          {t("page.back_to_areas", "← חזרה לאזורים")}
        </Link>
        {isAdmin && (
          <Link
            href={`/dashboard/areas/${area.id}/edit`}
            className="rounded-md bg-gray-800 text-white px-4 py-1.5 text-sm font-medium hover:opacity-90"
          >
            {t("action.edit", "ערוך")}
          </Link>
        )}
      </div>

      {/* Area data — renders regardless of whether Google Maps works. */}
      <div className="bg-white rounded-xl shadow-sm p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{area.area_name}</h1>
          {area.area_polygon ? (
            <span className="rounded bg-status-green/10 text-status-green text-xs px-2 py-0.5">
              {t("page.area_has_boundary", "תחום מוגדר")}
            </span>
          ) : (
            <span className="rounded bg-gray-100 text-gray-500 text-xs px-2 py-0.5">
              {t("page.area_no_boundary", "ללא תחום")}
            </span>
          )}
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-gray-500">{t("areas.area_notes", "הערות")}</dt>
            <dd className="font-medium">{area.area_notes || "—"}</dd>
          </div>
          <div>
            <dt className="text-gray-500">{t("buildings", "בניינים")}</dt>
            <dd className="font-medium">{buildings.length}</dd>
          </div>
          <div>
            <dt className="text-gray-500">{t("page.shluchim", "פעילים")}</dt>
            <dd className="font-medium">{shluchim.length}</dd>
          </div>
        </dl>
      </div>

      {/* Buildings in this area. */}
      <section className="bg-white rounded-xl shadow-sm p-5 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-500">{t("buildings", "בניינים")}</h2>
          {isAdmin && (
            <Link
              href={`/dashboard/buildings/add?area=${area.id}`}
              className="text-sm font-medium text-status-magenta hover:underline"
            >
              {t("page.add_building", "הוסף בניין")}
            </Link>
          )}
        </div>
        {buildings.length === 0 ? (
          <p className="text-sm text-gray-400">
            {t("page.no_buildings", "אין בניינים להצגה.")}{" "}
            {isAdmin && (
              <Link
                href={`/dashboard/buildings/add?area=${area.id}`}
                className="font-medium text-status-magenta hover:underline"
              >
                {t("page.add_building", "הוסף בניין")}
              </Link>
            )}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {buildings.map((b) => (
              <li key={b.id} className="py-2">
                <div className="font-medium">{b.building_name}</div>
                {b.building_address && (
                  <div className="text-sm text-gray-500">{b.building_address}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Active members (שלוחים/פעילים) covering this area. */}
      <section className="bg-white rounded-xl shadow-sm p-5 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-500">{t("page.shluchim", "פעילים")}</h2>
          {isAdmin && (
            <Link
              href="/dashboard/contacts/new-shliach"
              className="text-sm font-medium text-status-magenta hover:underline"
            >
              {t("page.add_shliach", "הוסף פעיל")}
            </Link>
          )}
        </div>
        {shluchim.length === 0 ? (
          <p className="text-sm text-gray-400">
            {t("page.no_shluchim_area", "אין פעילים המכסים אזור זה.")}{" "}
            {isAdmin && (
              <Link
                href="/dashboard/contacts/new-shliach"
                className="font-medium text-status-magenta hover:underline"
              >
                {t("page.add_shliach", "הוסף פעיל")}
              </Link>
            )}
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {shluchim.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/dashboard/contacts/${c.id}`}
                  className="rounded-full bg-status-magenta/10 text-status-magenta px-3 py-1 text-sm hover:bg-status-magenta/20"
                >
                  {contactFullName(c)}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* The map is last and optional — area data above is fully usable without it. */}
      <section className="bg-white rounded-xl shadow-sm p-5 space-y-2">
        <h2 className="text-sm font-semibold text-gray-500">{t("areas.area_polygon", "תחום פוליגון")}</h2>
        <AreaPolygonView polygon={area.area_polygon} />
      </section>
    </div>
  );
}
