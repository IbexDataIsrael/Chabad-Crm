"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { AreaPolygonView } from "@/components/AreaPolygonView";
import { SearchableSelect } from "@/components/SearchableSelect";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { mapsHref } from "@/lib/contactActions";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import {
  buildingDisplayName,
  contactFullName,
  type Area,
  type Building,
  type Contact,
} from "@/lib/types";

export default function AreaDetailPage() {
  const { isAdmin, isShliach, loading } = useAuth();
  const { t } = useLocalization();
  const { success, error: toastError } = useToast();
  const params = useParams<{ id: string }>();
  const areaId = Number(params.id);

  const [area, setArea] = useState<Area | null>(null);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [shluchim, setShluchim] = useState<Contact[]>([]);
  // fixes18 §4.2/§4.3: sources for the add-activist / add-building dropdowns.
  const [allShluchim, setAllShluchim] = useState<Contact[]>([]);
  const [eligibleBuildings, setEligibleBuildings] = useState<Building[]>([]);
  const [pickShliachOpen, setPickShliachOpen] = useState(false);
  const [pickBuildingOpen, setPickBuildingOpen] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  async function load() {
    const [a, b, s] = await Promise.all([
      apiFetch<Area>(`/api/areas/${areaId}`),
      apiFetch<Building[]>("/api/buildings").catch(() => [] as Building[]),
      apiFetch<Contact[]>(`/api/areas/${areaId}/shluchim`).catch(() => [] as Contact[]),
    ]);
    setArea(a);
    setBuildings(b.filter((x) => x.area_id === areaId));
    setShluchim(s);
    if (isAdmin) {
      apiFetch<Contact[]>("/api/contacts?contact_type=shliach")
        .then(setAllShluchim)
        .catch(() => {});
      apiFetch<Building[]>(`/api/areas/${areaId}/eligible-buildings`)
        .then(setEligibleBuildings)
        .catch(() => setEligibleBuildings([]));
    }
  }

  useEffect(() => {
    if (loading) return;
    load()
      .catch((err) =>
        setError(err instanceof Error ? err.message : t("msg.load_failed", "טעינה נכשלה")),
      )
      .finally(() => setLoaded(true));
  }, [areaId, loading, isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  // fixes18 §4.2: assign an existing activist to cover this area.
  async function addShliach(contactId: number | string | null) {
    if (contactId == null) return;
    try {
      const updated = await apiFetch<Contact[]>(`/api/areas/${areaId}/shluchim`, {
        method: "POST",
        body: JSON.stringify({ contact_id: Number(contactId) }),
      });
      setShluchim(updated);
      setPickShliachOpen(false);
      success(t("areas.activist_added", "הפעיל נוסף לאזור"));
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    }
  }

  // fixes18 §4.3: attach a building that sits inside the area's polygon.
  async function addBuilding(buildingId: number | string | null) {
    if (buildingId == null) return;
    try {
      await apiFetch(`/api/buildings/${buildingId}`, {
        method: "PUT",
        body: JSON.stringify({ area_id: areaId }),
      });
      setPickBuildingOpen(false);
      success(t("areas.building_added", "הבניין שויך לאזור"));
      await load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    }
  }

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

  // Only activists that don't already cover the area are offered.
  const shliachOptions = allShluchim
    .filter((c) => !shluchim.some((s) => s.id === c.id))
    .map((c) => ({ id: c.id, label: contactFullName(c) }));

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
            <button
              type="button"
              onClick={() => setPickBuildingOpen((v) => !v)}
              className="text-sm font-medium text-status-magenta hover:underline"
            >
              {t("page.add_building", "הוסף בניין")}
            </button>
          )}
        </div>
        {/* fixes18 §4.3: only buildings inside the area's polygon are offered. */}
        {isAdmin && pickBuildingOpen && (
          <div className="space-y-2 rounded-md border border-gray-100 p-3">
            {!area.area_polygon ? (
              <p className="text-sm text-gray-400">
                {t(
                  "areas.no_polygon_for_buildings",
                  "לאזור אין תחום מוגדר — הגדר תחום כדי לבחור בניינים לפי מיקום.",
                )}
              </p>
            ) : eligibleBuildings.length === 0 ? (
              <p className="text-sm text-gray-400">
                {t("areas.no_eligible_buildings", "אין בניינים בתוך תחום האזור.")}
              </p>
            ) : (
              <SearchableSelect
                value={null}
                onChange={addBuilding}
                options={eligibleBuildings.map((b) => ({
                  id: b.id,
                  label: buildingDisplayName(b),
                }))}
                placeholder={t("areas.add_building_pick", "בחר בניין להוספה…")}
                allowEmpty={false}
              />
            )}
            <Link
              href={`/dashboard/buildings/add?area=${area.id}`}
              className="block text-sm text-status-magenta hover:underline"
            >
              {t("areas.create_new_building", "או צור בניין חדש »")}
            </Link>
          </div>
        )}
        {buildings.length === 0 ? (
          <p className="text-sm text-gray-400">{t("page.no_buildings", "אין בניינים להצגה.")}</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {buildings.map((b) => (
              <li key={b.id} className="py-2">
                <Link
                  href={`/dashboard/buildings/${b.id}`}
                  className="font-medium text-status-magenta hover:underline"
                >
                  {buildingDisplayName(b)}
                </Link>
                {b.building_address &&
                  // fixes30 §4: the shluchim display navigates via Maps.
                  (isShliach ? (
                    <div className="text-sm">
                      <a
                        href={mapsHref(b.building_address)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={t("apt.navigate", "ניווט בגוגל מפות")}
                        className="text-status-magenta hover:underline"
                      >
                        📍 {b.building_address}
                      </a>
                    </div>
                  ) : (
                    <div className="text-sm text-gray-500">{b.building_address}</div>
                  ))}
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
            <button
              type="button"
              onClick={() => setPickShliachOpen((v) => !v)}
              className="text-sm font-medium text-status-magenta hover:underline"
            >
              {t("page.add_shliach", "הוסף פעיל")}
            </button>
          )}
        </div>
        {/* fixes18 §4.2: pick from the org's existing activists. */}
        {isAdmin && pickShliachOpen && (
          <div className="space-y-2 rounded-md border border-gray-100 p-3">
            <SearchableSelect
              value={null}
              onChange={addShliach}
              options={shliachOptions}
              placeholder={t("areas.add_activist_pick", "בחר פעיל להוספה…")}
              allowEmpty={false}
            />
            <Link
              href="/dashboard/contacts/new-shliach"
              className="block text-sm text-status-magenta hover:underline"
            >
              {t("areas.create_new_shliach", "או צור פעיל חדש »")}
            </Link>
          </div>
        )}
        {shluchim.length === 0 ? (
          <p className="text-sm text-gray-400">
            {t("page.no_shluchim_area", "אין פעילים המכסים אזור זה.")}
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
