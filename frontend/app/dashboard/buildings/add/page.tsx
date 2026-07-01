"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";

import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
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
  const router = useRouter();
  const searchParams = useSearchParams();

  const [areas, setAreas] = useState<Area[]>([]);
  const [areaId, setAreaId] = useState<number | "">("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (areaId === "") {
      setError(t("msg.select_area", "יש לבחור אזור"));
      return;
    }
    setBusy(true);
    try {
      await apiFetch("/api/buildings", {
        method: "POST",
        body: JSON.stringify({
          area_id: Number(areaId),
          building_name: name,
          building_address: address || null,
          latitude: lat,
          longitude: lng,
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
                onChange={(e) => setAreaId(e.target.value === "" ? "" : Number(e.target.value))}
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
            <label className="block space-y-1">
              <span className="block text-sm font-medium">{t("buildings.building_name", "שם בניין")}</span>
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
            <div className="sm:col-span-2 space-y-1">
              <span className="block text-sm font-medium">{t("buildings.building_address", "כתובת בניין")}</span>
              <AddressAutocomplete
                className={inputClass}
                value={address}
                onChange={(a) => {
                  setAddress(a);
                  setLat(null);
                  setLng(null);
                }}
                onPlace={(p) => {
                  setAddress(p.address);
                  setLat(roundCoord(p.lat));
                  setLng(roundCoord(p.lng));
                }}
              />
            </div>
            <label className="block space-y-1">
              <span className="block text-sm font-medium">{t("buildings.latitude", "קו רוחב")}</span>
              <input
                type="number"
                step="any"
                dir="ltr"
                className={inputClass}
                value={lat ?? ""}
                onChange={(e) => setLat(e.target.value === "" ? null : Number(e.target.value))}
              />
            </label>
            <label className="block space-y-1">
              <span className="block text-sm font-medium">{t("buildings.longitude", "קו אורך")}</span>
              <input
                type="number"
                step="any"
                dir="ltr"
                className={inputClass}
                value={lng ?? ""}
                onChange={(e) => setLng(e.target.value === "" ? null : Number(e.target.value))}
              />
            </label>
          </div>
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
