"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";

import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useFieldSettings } from "@/lib/fieldSettings";
import { pointInPolygon } from "@/lib/geo";
import { useLocalization } from "@/lib/localization";
import { roundCoord, type Area } from "@/lib/types";

const inputClass =
  "w-full rounded-md border border-input px-3 py-2 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

/** Standalone add-building page (mirrors /dashboard/areas/add). Accepts
 *  ?area=<id> to preselect the area (used by the "add building" links). */
export default function AddBuildingPage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground">…</p>}>
      <AddBuildingInner />
    </Suspense>
  );
}

function AddBuildingInner() {
  const { isAdmin, loading } = useAuth();
  const { t } = useLocalization();
  const { isFieldVisible } = useFieldSettings();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [areas, setAreas] = useState<Area[]>([]);
  const [areaId, setAreaId] = useState<number | "">("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  // fixes11 §2.4: one "longitude,latitude" text box instead of two inputs.
  const [coords, setCoords] = useState("");
  // fixes8 §1A: new buildings start with 8 floors unless the user overrides.
  const [numFloors, setNumFloors] = useState("8");
  // fixes57: optionally prepend a lobby floor ("L") ahead of floor 1 — the
  // backend already sorts an "L" floor ahead of every numbered one when
  // added via the floors editor (fixes52 §3); this just offers the same
  // floor at creation time instead of requiring a separate edit-page step.
  const [includeLobby, setIncludeLobby] = useState(false);
  // fixes19 §4: a town house (בית פרטי) skips floor generation entirely — the
  // server spawns a single apartment instead.
  const [isTownHouse, setIsTownHouse] = useState(false);
  const [error, setError] = useState("");
  // Geofence interceptor (fixes7 §7B).
  const [geoWarning, setGeoWarning] = useState(false);
  const [busy, setBusy] = useState(false);

  function onCoordsChange(v: string) {
    setCoords(v);
    setGeoWarning(false);
    const parts = v.split(",").map((s) => s.trim());
    const parsedLng = Number(parts[0]);
    const parsedLat = Number(parts[1]);
    const ok =
      parts.length === 2 &&
      parts[0] !== "" &&
      parts[1] !== "" &&
      Number.isFinite(parsedLng) &&
      Number.isFinite(parsedLat);
    setLng(ok ? parsedLng : null);
    setLat(ok ? parsedLat : null);
  }

  // Non-admins can't create buildings — bounce them back to the list.
  useEffect(() => {
    if (!loading && !isAdmin) router.replace("/dashboard/buildings");
  }, [loading, isAdmin, router]);

  // Load areas for the select; preselect the one from ?area=<id> if valid.
  useEffect(() => {
    apiFetch<Area[]>("/api/areas")
      .then((a) => {
        setAreas(a);
        const pre = Number(searchParams.get("area"));
        if (Number.isFinite(pre) && a.some((x) => x.id === pre)) setAreaId(pre);
      })
      .catch(() => {});
  }, [searchParams]);

  async function save(e: FormEvent, force = false) {
    e.preventDefault();
    setError("");
    if (areaId === "") {
      setError(t("msg.select_area", "יש לבחור אזור"));
      return;
    }
    // Geofence guardrail: warn when the geocoded point is outside the zone.
    if (!force) {
      const area = areas.find((a) => a.id === Number(areaId));
      if (pointInPolygon(lat, lng, area?.area_polygon) === false) {
        setGeoWarning(true);
        return;
      }
    }
    setGeoWarning(false);
    setBusy(true);
    const n = Number(numFloors);
    const numberedFloors =
      !isTownHouse && Number.isFinite(n) && n > 0
        ? Array.from({ length: Math.min(n, 200) }, (_, i) => String(i + 1))
        : [];
    // "L" first in the array = sort_order 0 at creation time, ahead of every
    // numbered floor — same end result as the floors editor's own "L always
    // sorts first" rule (fixes52 §3), just set up in one step here.
    const floors = !isTownHouse && includeLobby ? ["L", ...numberedFloors] : numberedFloors;
    try {
      await apiFetch("/api/buildings", {
        method: "POST",
        body: JSON.stringify({
          area_id: Number(areaId),
          building_name: name || null,
          building_address: address,
          latitude: lat,
          longitude: lng,
          is_town_house: isTownHouse,
          floors,
        }),
      });
      router.push("/dashboard/buildings");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-4xl">{t("page.new_building", "בניין חדש")}</h1>
        <Link href="/dashboard/buildings" className="flex items-center gap-1 text-sm text-primary hover:underline">
          {t("page.back_to_buildings", "חזרה לבניינים")} <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      {areas.length === 0 ? (
        <p className="text-sm text-destructive">
          {t("page.need_area_first", "יש להגדיר אזור אחד לפחות לפני הוספת בניין.")}{" "}
          <Link href="/dashboard/areas/add" className="font-medium underline hover:text-primary">
            {t("page.add_area", "אזור חדש")}
          </Link>
        </p>
      ) : (
        <Card className="p-4">
        <form onSubmit={save} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="block text-sm font-medium">{t("buildings.area_id", "אזור")}</span>
              <select
                className={inputClass}
                value={areaId}
                onChange={(e) => {
                  setAreaId(e.target.value === "" ? "" : Number(e.target.value));
                  setGeoWarning(false);
                }}
                required
              >
                <option value="">—</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.area_name}
                  </option>
                ))}
              </select>
            </label>
            {isFieldVisible("buildings.building_name") && (
              <label className="block space-y-1">
                <span className="block text-sm font-medium">{t("buildings.building_name", "שם בניין")}</span>
                <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
              </label>
            )}
            <div className="sm:col-span-2 space-y-1">
              <span className="block text-sm font-medium">{t("buildings.building_address", "כתובת בניין")}</span>
              <AddressAutocomplete
                className={inputClass}
                value={address}
                required
                onChange={(a) => {
                  setAddress(a);
                  setLat(null);
                  setLng(null);
                  setCoords("");
                  setGeoWarning(false);
                }}
                onPlace={(p) => {
                  setAddress(p.address);
                  setLat(roundCoord(p.lat));
                  setLng(roundCoord(p.lng));
                  setCoords(`${roundCoord(p.lng)},${roundCoord(p.lat)}`);
                  setGeoWarning(false);
                }}
              />
            </div>
            {/* fixes11 §2.4: one combined longitude,latitude input. */}
            <label className="block space-y-1 sm:col-span-2">
              <span className="block text-sm font-medium">{t("buildings.coords", "קואורדינטות")}</span>
              <input
                dir="ltr"
                className={inputClass}
                placeholder="longitude,latitude"
                value={coords}
                onChange={(e) => onCoordsChange(e.target.value)}
              />
              <span className="block text-xs text-muted-foreground">
                {t("buildings.coords_hint", "פורמט: longitude,latitude — לדוגמה 35.2137,31.7683")}
              </span>
            </label>
            {/* fixes19 §4: town house — no floors, one auto apartment. */}
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={isTownHouse}
                onChange={(e) => setIsTownHouse(e.target.checked)}
              />
              {t("buildings.is_town_house", "בית פרטי")}
            </label>
            {isTownHouse ? (
              <p className="text-xs text-muted-foreground sm:col-span-2">
                {t(
                  "buildings.town_house_hint",
                  "בבית פרטי לא נוצרות קומות — נוצרת דירה אחת אוטומטית.",
                )}
              </p>
            ) : (
              <>
                <label className="block space-y-1">
                  <span className="block text-sm font-medium">{t("buildings.num_floors", "מספר קומות")}</span>
                  <input
                    type="number"
                    min="0"
                    dir="ltr"
                    className={inputClass}
                    value={numFloors}
                    onChange={(e) => setNumFloors(e.target.value)}
                  />
                  <span className="block text-xs text-muted-foreground">
                    {t(
                      "buildings.num_floors_hint",
                      "בעת יצירת הבניין ייווצרו קומות 1 עד המספר שנבחר.",
                    )}
                  </span>
                </label>
                <label className="flex items-center gap-2 text-sm self-end pb-1">
                  <input
                    type="checkbox"
                    checked={includeLobby}
                    onChange={(e) => setIncludeLobby(e.target.checked)}
                  />
                  {t("buildings.include_lobby", "כלול קומת לובי (L) לפני קומה 1")}
                </label>
              </>
            )}
          </div>

          {geoWarning && (
            <div className="rounded-md border-2 border-destructive bg-destructive/10 p-3 space-y-2">
              <p className="text-sm font-bold text-destructive">
                ⚠ {t("geo.outside_area_warning", "אזהרה: הכתובת שנבחרה נמצאת מחוץ לתחום האזור שנבחר!")}
              </p>
              <p className="text-xs text-destructive">
                {t("geo.check_hint", "בדוק את הכתובת או בחר אזור אחר.")}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-destructive text-destructive hover:bg-destructive/10"
                onClick={(e) => save(e as unknown as FormEvent, true)}
              >
                {t("geo.save_anyway", "שמור בכל זאת")}
              </Button>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? t("action.saving", "שומר…") : t("action.save", "שמור")}
            </Button>
            <Button asChild variant="outline">
              <Link href="/dashboard/buildings">{t("action.cancel", "ביטול")}</Link>
            </Button>
          </div>
        </form>
        </Card>
      )}
    </div>
  );
}
