"use client";

import Link from "next/link";
import { ArrowRight, Pencil, Plus } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { AreaPolygonView } from "@/components/AreaPolygonView";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  // Report numbers per building id (from the building's apartments).
  const [buildingReports, setBuildingReports] = useState<Record<string, string[]>>({});
  // fixes18 §4.2/§4.3: sources for the add-activist / add-building dropdowns.
  const [allShluchim, setAllShluchim] = useState<Contact[]>([]);
  const [eligibleBuildings, setEligibleBuildings] = useState<Building[]>([]);
  const [pickShliachOpen, setPickShliachOpen] = useState(false);
  const [pickBuildingOpen, setPickBuildingOpen] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  async function load() {
    const [a, b, s, r] = await Promise.all([
      apiFetch<Area>(`/api/areas/${areaId}`),
      apiFetch<Building[]>("/api/buildings").catch(() => [] as Building[]),
      apiFetch<Contact[]>(`/api/areas/${areaId}/shluchim`).catch(() => [] as Contact[]),
      apiFetch<Record<string, string[]>>(`/api/areas/${areaId}/building-report-numbers`).catch(
        () => ({}) as Record<string, string[]>,
      ),
    ]);
    setArea(a);
    setBuildings(b.filter((x) => x.area_id === areaId));
    setShluchim(s);
    setBuildingReports(r);
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

  if (loading || !loaded) return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;
  if (error || !area) {
    return (
      <div className="space-y-3">
        <Link href="/dashboard/areas" className="flex items-center gap-1 text-sm text-primary hover:underline">
          {t("page.back_to_areas", "חזרה לאזורים")} <ArrowRight className="h-4 w-4" />
        </Link>
        <p className="text-destructive">{error || t("page.area_not_found", "האזור לא נמצא.")}</p>
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
        <Link href="/dashboard/areas" className="flex items-center gap-1 text-sm text-primary hover:underline">
          {t("page.back_to_areas", "חזרה לאזורים")} <ArrowRight className="h-4 w-4" />
        </Link>
        {isAdmin && (
          <Button asChild variant="secondary">
            <Link href={`/dashboard/areas/${area.id}/edit`}>
              <Pencil className="h-4 w-4" /> {t("action.edit", "ערוך")}
            </Link>
          </Button>
        )}
      </div>

      {/* Area data — renders regardless of whether Google Maps works. */}
      <div className="glass-card p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-4xl">{area.area_name}</h1>
          {area.area_polygon ? (
            <Badge variant="success">{t("page.area_has_boundary", "תחום מוגדר")}</Badge>
          ) : (
            <Badge variant="secondary">{t("page.area_no_boundary", "ללא תחום")}</Badge>
          )}
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-foreground">{t("areas.area_notes", "הערות")}</dt>
            <dd className="font-medium">{area.area_notes || "—"}</dd>
          </div>
          <div>
            <dt className="text-foreground">{t("buildings", "בניינים")}</dt>
            <dd className="font-medium">{buildings.length}</dd>
          </div>
          <div>
            <dt className="text-foreground">{t("page.shluchim", "פעילים")}</dt>
            <dd className="font-medium">{shluchim.length}</dd>
          </div>
        </dl>
      </div>

      {/* Buildings in this area. */}
      <section className="glass-card p-5 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">{t("buildings", "בניינים")}</h2>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setPickBuildingOpen((v) => !v)}
              className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              <Plus className="h-3.5 w-3.5" /> {t("page.add_building", "הוסף בניין")}
            </button>
          )}
        </div>
        {/* fixes18 §4.3: only buildings inside the area's polygon are offered. */}
        {isAdmin && pickBuildingOpen && (
          <div className="space-y-2 rounded-md border border-border p-3">
            {!area.area_polygon ? (
              <p className="text-sm text-muted-foreground">
                {t(
                  "areas.no_polygon_for_buildings",
                  "לאזור אין תחום מוגדר — הגדר תחום כדי לבחור בניינים לפי מיקום.",
                )}
              </p>
            ) : eligibleBuildings.length === 0 ? (
              <p className="text-sm text-muted-foreground">
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
              className="block text-sm text-primary hover:underline"
            >
              {t("areas.create_new_building", "או צור בניין חדש »")}
            </Link>
          </div>
        )}
        {buildings.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("page.no_buildings", "אין בניינים להצגה.")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {buildings.map((b) => (
              <li
                key={b.id}
                className="py-2 flex flex-wrap items-start justify-between gap-x-4 gap-y-1"
              >
                <div className="min-w-0">
                  <Link
                    href={`/dashboard/buildings/${b.id}`}
                    className="font-medium text-primary hover:underline"
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
                          className="text-primary hover:underline"
                        >
                          📍 {b.building_address}
                        </a>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">{b.building_address}</div>
                    ))}
                </div>
                {/* Report numbers sit at the row's end side (left in RTL) instead of a new line. */}
                <div className="text-sm text-muted-foreground text-end">
                  {t("page.report_numbers", "מספרי דוח")}:{" "}
                  {/* <bdi> keeps each Hebrew report name (e.g. "359 א") intact in LTR/English. */}
                  {buildingReports[String(b.id)]?.length
                    ? buildingReports[String(b.id)].map((name, i) => (
                        <span key={name}>
                          {i > 0 && ", "}
                          <bdi>{name}</bdi>
                        </span>
                      ))
                    : "—"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Active members (שלוחים/פעילים) covering this area. */}
      <section className="glass-card p-5 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">{t("page.shluchim", "פעילים")}</h2>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setPickShliachOpen((v) => !v)}
              className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              <Plus className="h-3.5 w-3.5" /> {t("page.add_shliach", "הוסף פעיל")}
            </button>
          )}
        </div>
        {/* fixes18 §4.2: pick from the org's existing activists. */}
        {isAdmin && pickShliachOpen && (
          <div className="space-y-2 rounded-md border border-border p-3">
            <SearchableSelect
              value={null}
              onChange={addShliach}
              options={shliachOptions}
              placeholder={t("areas.add_activist_pick", "בחר פעיל להוספה…")}
              allowEmpty={false}
            />
            <Link
              href="/dashboard/contacts/new-shliach"
              className="block text-sm text-primary hover:underline"
            >
              {t("areas.create_new_shliach", "או צור פעיל חדש »")}
            </Link>
          </div>
        )}
        {shluchim.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("page.no_shluchim_area", "אין פעילים המכסים אזור זה.")}
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {shluchim.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/dashboard/contacts/${c.id}`}
                  className="rounded-full bg-primary/10 text-primary px-3 py-1 text-sm hover:bg-primary/20"
                >
                  {contactFullName(c)}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* The map is last and optional — area data above is fully usable without it. */}
      <section className="glass-card p-5 space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{t("areas.area_polygon", "תחום פוליגון")}</h2>
        <AreaPolygonView polygon={area.area_polygon} />
      </section>
    </div>
  );
}
