"use client";

import Link from "next/link";
import { ArrowRight, Pencil } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { InlineEdit } from "@/components/ui/InlineEdit";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Button } from "@/components/ui/button";
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
  type BuildingType,
} from "@/lib/types";

const inputClass =
  "w-full rounded-md border border-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

/** Render a building_type row in the given language (mirrors the buildings
 *  list page's own displayBuildingType / lib/picklists.ts's displayPicklistValue). */
function displayBuildingType(bt: BuildingType, lang: string): string {
  return (lang === "en" ? bt.name_en : bt.name_he) || bt.name_en || bt.id;
}

export default function BuildingDetailPage() {
  const { isAdmin, loading } = useAuth();
  const { t, lang } = useLocalization();
  const { isFieldVisible } = useFieldSettings();
  const params = useParams<{ id: string }>();
  const buildingId = Number(params.id);

  const [building, setBuilding] = useState<Building | null>(null);
  const [area, setArea] = useState<Area | null>(null);
  const [apartments, setApartments] = useState<Apartment[]>([]);
  // fixes30 §3: option source for the inline area select (admins only).
  const [areas, setAreas] = useState<Area[]>([]);
  // fixes64 §1: building-type registry, for the type row below.
  const [buildingTypes, setBuildingTypes] = useState<BuildingType[]>([]);
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
    if (loading) return;
    apiFetch<BuildingType[]>("/api/buildings/types").then(setBuildingTypes).catch(() => {});
  }, [loading]);

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

  if (loading || !loaded) return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;
  if (error || !building) {
    return (
      <div className="space-y-3">
        <Link href="/dashboard/buildings" className="flex items-center gap-1 text-sm text-primary hover:underline">
          {t("page.back_to_buildings", "חזרה לבניינים")} <ArrowRight className="h-4 w-4" />
        </Link>
        <p className="text-destructive">
          {error || t("page.building_not_found", "הבניין לא נמצא.")}
        </p>
      </div>
    );
  }

  const display = buildingDisplayName(building);

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <Link href="/dashboard/buildings" className="flex items-center gap-1 text-sm text-primary hover:underline">
          {t("page.back_to_buildings", "חזרה לבניינים")} <ArrowRight className="h-4 w-4" />
        </Link>
        {/* fixes12 §3.2: prominent edit entry point (admins manage buildings). */}
        {isAdmin && (
          <Button asChild>
            <Link href={`/dashboard/buildings/edit/${building.id}`}>
              <Pencil className="h-4 w-4" /> {t("page.edit_building", "עריכת בניין")}
            </Link>
          </Button>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl shadow-sm p-5 space-y-3">
        <h1 className="text-2xl font-bold">{display}</h1>
        {/* fixes30 §3: name / address / area edit in place for admins (the
            backend PUT is admin-only); everyone else sees the plain values.
            Floors, coordinates and the map stay on the edit page. */}
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-muted-foreground">{t("buildings.area_id", "אזור")}</dt>
            <dd className="font-medium flex items-baseline gap-2">
              {area ? (
                <Link
                  href={`/dashboard/areas/${area.id}`}
                  className="text-primary hover:underline"
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
                    <span className="text-xs text-muted-foreground">
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
            <dt className="text-muted-foreground">{t("apartments", "דירות")}</dt>
            <dd className="font-medium">{apartments.length}</dd>
          </div>
          {/* fixes64 §1: the building's type (building / town_house /
              divided_town_house) — the list page already shows it as a badge,
              but the single-building view had no equivalent. */}
          {building.building_type_id && (
            <div>
              <dt className="text-muted-foreground">{t("buildings.building_type", "סוג בניין")}</dt>
              <dd className="font-medium">
                {(() => {
                  const bt = buildingTypes.find((x) => x.id === building.building_type_id);
                  return bt ? displayBuildingType(bt, lang) : building.building_type_id;
                })()}
              </dd>
            </div>
          )}
          {isFieldVisible("buildings.building_name") &&
            (building.building_name || isAdmin) && (
              <div>
                <dt className="text-muted-foreground">{t("buildings.building_name", "שם בניין")}</dt>
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
            <dt className="text-muted-foreground">{t("buildings.building_address", "כתובת בניין")}</dt>
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
              <dt className="text-muted-foreground">{t("buildings.floors", "קומות")}</dt>
              <dd className="font-medium">
                {building.floors!.map((f) => f.name).join(", ")}
              </dd>
            </div>
          )}
          {building.latitude != null && building.longitude != null && (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">{t("buildings.coords", "קואורדינטות")}</dt>
              <dd className="font-medium" dir="ltr">
                {formatCoords(building.latitude, building.longitude)}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {/* Apartments in this building — each title links to its detail page. */}
      <section className="bg-card border border-border rounded-xl shadow-sm p-5 space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{t("apartments", "דירות")}</h2>
        {apartments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("apt.no_apartments_building", "אין דירות בבניין זה.")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {apartments.map((a) => (
              <li key={a.id} className="py-2">
                <Link
                  href={`/dashboard/apartments/${a.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {apartmentTitle(a)}
                </Link>
                {a.name && <span className="text-sm text-muted-foreground"> · {a.name}</span>}
                {a.apartment_notes && (
                  <span className="text-sm text-muted-foreground"> — {a.apartment_notes}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
