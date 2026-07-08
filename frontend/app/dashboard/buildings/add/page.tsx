"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";

import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useFieldSettings } from "@/lib/fieldSettings";
import { pointInPolygon } from "@/lib/geo";
import { useLocalization } from "@/lib/localization";
import { roundCoord, type Area } from "@/lib/types";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

/** Standalone add-building page (mirrors /dashboard/areas/add). Accepts
 *  ?area=<id> to preselect the area (used by the "add building" links). */
export default function AddBuildingPage() {
  return (
    <Suspense fallback={<p className="text-gray-400">…</p>}>
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
    const floors =
      Number.isFinite(n) && n > 0
        ? Array.from({ length: Math.min(n, 200) }, (_, i) => String(i + 1))
        : [];
    try {
      await apiFetch("/api/buildings", {
        method: "POST",
        body: JSON.stringify({
          area_id: Number(areaId),
          building_name: name || null,
          building_address: address,
          latitude: lat,
          longitude: lng,
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

  if (loading) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("page.new_building", "בניין חדש")}</h1>
        <Link href="/dashboard/buildings" className="text-sm text-status-magenta hover:underline">
          {t("page.back_to_buildings", "← חזרה לבניינים")}
        </Link>
      </div>

      {areas.length === 0 ? (
        <p className="text-sm text-status-darkred">
          {t("page.need_area_first", "יש להגדיר אזור אחד לפחות לפני הוספת בניין.")}{" "}
          <Link href="/dashboard/areas/add" className="font-medium underline hover:text-status-magenta">
            {t("page.add_area", "אזור חדש")}
          </Link>
        </p>
      ) : (
        <form onSubmit={save} className="bg-white rounded-xl shadow-sm p-4 space-y-3">
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
              <span className="block text-xs text-gray-400">
                {t("buildings.coords_hint", "פורמט: longitude,latitude — לדוגמה 35.2137,31.7683")}
              </span>
            </label>
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
              <span className="block text-xs text-gray-400">
                {t(
                  "buildings.num_floors_hint",
                  "בעת יצירת הבניין ייווצרו קומות 1 עד המספר שנבחר.",
                )}
              </span>
            </label>
          </div>

          {geoWarning && (
            <div className="rounded-md border-2 border-status-darkred bg-red-50 p-3 space-y-2">
              <p className="text-sm font-bold text-status-darkred">
                ⚠ {t("geo.outside_area_warning", "אזהרה: הכתובת שנבחרה נמצאת מחוץ לתחום האזור שנבחר!")}
              </p>
              <p className="text-xs text-status-darkred">
                {t("geo.check_hint", "בדוק את הכתובת או בחר אזור אחר.")}
              </p>
              <button
                type="button"
                onClick={(e) => save(e as unknown as FormEvent, true)}
                className="rounded-md border border-status-darkred text-status-darkred px-3 py-1 text-xs font-medium hover:bg-red-100"
              >
                {t("geo.save_anyway", "שמור בכל זאת")}
              </button>
            </div>
          )}
          {error && <p className="text-sm text-status-darkred">{error}</p>}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-status-magenta text-white px-5 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {busy ? t("action.saving", "שומר…") : t("action.save", "שמור")}
            </button>
            <Link
              href="/dashboard/buildings"
              className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
            >
              {t("action.cancel", "ביטול")}
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}
