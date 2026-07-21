"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { InlineEdit } from "@/components/ui/InlineEdit";
import { SearchableSelect } from "@/components/SearchableSelect";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useFieldSettings } from "@/lib/fieldSettings";
import { useLocalization } from "@/lib/localization";
import {
  apartmentTitle,
  buildingDisplayName,
  formatCoords,
  type Apartment,
  type Area,
  type Building,
} from "@/lib/types";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

export default function BuildingDetailPage() {
  const { isAdmin, loading } = useAuth();
  const { t } = useLocalization();
  const { isFieldVisible } = useFieldSettings();
  const params = useParams<{ id: string }>();
  const buildingId = Number(params.id);

  const [building, setBuilding] = useState<Building | null>(null);
  const [area, setArea] = useState<Area | null>(null);
  const [apartments, setApartments] = useState<Apartment[]>([]);
  // fixes30 §3: option source for the inline area select (admins only).
  const [areas, setAreas] = useState<Area[]>([]);
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
        // fixes33 §2.2: an unassigned building (area deleted via "unassign") has
        // no area_id to fetch.
        setArea(
          b.area_id == null
            ? null
            : await apiFetch<Area>(`/api/areas/${b.area_id}`).catch(() => null),
        );
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : t("msg.load_failed", "טעינה נכשלה")),
      )
      .finally(() => setLoaded(true));
  }, [buildingId, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (loading || !isAdmin) return;
    apiFetch<Area[]>("/api/areas").then(setAreas).catch(() => {});
  }, [loading, isAdmin]);

  // fixes30 §3: one-field partial save. Building updates are in-place (stable
  // id, admin-only server-side) — just swap in the returned row.
  async function patch(partial: Record<string, unknown>) {
    const updated = await apiFetch<Building>(`/api/buildings/${buildingId}`, {
      method: "PUT",
      body: JSON.stringify(partial),
    });
    setBuilding(updated);
    if (partial.area_id !== undefined) {
      setArea(areas.find((a) => a.id === partial.area_id) ?? null);
    }
  }

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

  const display = buildingDisplayName(building);

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <Link href="/dashboard/buildings" className="text-sm text-status-magenta hover:underline">
          {t("page.back_to_buildings", "← חזרה לבניינים")}
        </Link>
        {/* fixes12 §3.2: prominent edit entry point (admins manage buildings). */}
        {isAdmin && (
          <Link
            href={`/dashboard/buildings/edit/${building.id}`}
            className="rounded-md bg-status-magenta text-white px-4 py-1.5 text-sm font-medium hover:opacity-90"
          >
            {t("page.edit_building", "עריכת בניין")}
          </Link>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm p-5 space-y-3">
        <h1 className="text-2xl font-bold">{display}</h1>
        {/* fixes30 §3: name / address / area edit in place for admins (the
            backend PUT is admin-only); everyone else sees the plain values.
            Floors, coordinates and the map stay on the edit page. */}
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-gray-500">{t("buildings.area_id", "אזור")}</dt>
            <dd className="font-medium flex items-baseline gap-2">
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
              {/* The name stays a nav link — a separate small trigger opens
                  the move-area select. */}
              {isAdmin && (
                <InlineEdit<number | null>
                  value={building.area_id}
                  display={
                    <span className="text-xs text-gray-400">
                      {t("action.edit", "ערוך")}
                    </span>
                  }
                  commitOnBlur={false}
                  onSave={(v) => (v == null ? Promise.resolve() : patch({ area_id: v }))}
                  editor={(draft, _setDraft, commit) => (
                    <SearchableSelect
                      value={draft}
                      onChange={(id) => commit(id ?? null)}
                      options={areas.map((a) => ({ id: a.id, label: a.area_name }))}
                      placeholder={t("filter.all_areas", "כל האזורים")}
                    />
                  )}
                />
              )}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">{t("apartments", "דירות")}</dt>
            <dd className="font-medium">{apartments.length}</dd>
          </div>
          {isFieldVisible("buildings.building_name") &&
            (building.building_name || isAdmin) && (
              <div>
                <dt className="text-gray-500">{t("buildings.building_name", "שם בניין")}</dt>
                <dd className="font-medium">
                  <InlineEdit<string>
                    value={building.building_name ?? ""}
                    display={building.building_name || "—"}
                    disabled={!isAdmin}
                    onSave={(v) =>
                      patch({ building_name: v.trim() === "" ? null : v.trim() })
                    }
                    editor={(draft, setDraft) => (
                      <input
                        className={inputClass}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                      />
                    )}
                  />
                </dd>
              </div>
            )}
          <div className="sm:col-span-2">
            <dt className="text-gray-500">{t("buildings.building_address", "כתובת בניין")}</dt>
            <dd className="font-medium">
              <InlineEdit<string>
                value={building.building_address ?? ""}
                display={building.building_address || "—"}
                disabled={!isAdmin}
                // The backend rejects an explicit empty address.
                validate={(v) =>
                  v.trim() === ""
                    ? t("buildings.address_required", "יש להזין כתובת")
                    : null
                }
                onSave={(v) => patch({ building_address: v.trim() })}
                editor={(draft, setDraft) => (
                  <input
                    className={inputClass}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                )}
              />
            </dd>
          </div>
          {(building.floors?.length ?? 0) > 0 && (
            <div className="sm:col-span-2">
              <dt className="text-gray-500">{t("buildings.floors", "קומות")}</dt>
              <dd className="font-medium">
                {building.floors!.map((f) => f.name).join(", ")}
              </dd>
            </div>
          )}
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

      {/* Apartments in this building — each title links to its detail page. */}
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
                  {apartmentTitle(a)}
                </Link>
                {a.name && <span className="text-sm text-gray-600"> · {a.name}</span>}
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
