"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import type { Area, Building } from "@/lib/types";

export default function BuildingsPage() {
  const { isAdmin, loading } = useAuth();
  const { t } = useLocalization();
  const [areas, setAreas] = useState<Area[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [filterArea, setFilterArea] = useState<string>("");
  const [editing, setEditing] = useState<Partial<Building> | null>(null);

  async function reload() {
    const [a, b] = await Promise.all([
      apiFetch<Area[]>("/api/areas"),
      apiFetch<Building[]>("/api/buildings"),
    ]);
    setAreas(a);
    setBuildings(b);
  }

  useEffect(() => {
    reload().catch(() => {});
  }, []);

  const areaName = useMemo(() => {
    const map = new Map<number, string>();
    areas.forEach((a) => map.set(a.id, a.area_name));
    return (id: number) => map.get(id) ?? "—";
  }, [areas]);

  const shown = filterArea
    ? buildings.filter((b) => b.area_id === Number(filterArea))
    : buildings;

  if (loading) return <p className="text-gray-400">טוען…</p>;

  const inputClass =
    "rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("buildings", "בניינים")}</h1>
        {isAdmin && !editing && (
          <button
            onClick={() => setEditing({})}
            disabled={areas.length === 0}
            className="rounded-md bg-status-magenta text-white px-4 py-1.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            הוסף בניין
          </button>
        )}
      </div>
      {areas.length === 0 ? (
        <p className="text-sm text-status-darkred">
          יש להגדיר אזור אחד לפחות לפני הוספת בניין.
        </p>
      ) : (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500">סנן לפי אזור:</span>
          <select
            className={inputClass}
            value={filterArea}
            onChange={(e) => setFilterArea(e.target.value)}
          >
            <option value="">הכל</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.area_name}
              </option>
            ))}
          </select>
        </div>
      )}

      {editing && (
        <BuildingEditor
          building={editing}
          areas={areas}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
          }}
        />
      )}

      <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
        {shown.map((b) => (
          <div key={b.id} className="px-4 py-3 flex flex-wrap items-center gap-2">
            <div className="min-w-[10rem]">
              <div className="font-medium">{b.building_name}</div>
              {b.building_address && (
                <div className="text-sm text-gray-500">{b.building_address}</div>
              )}
            </div>
            <span className="rounded bg-gray-100 text-gray-600 text-xs px-2 py-0.5">
              {areaName(b.area_id)}
            </span>
            {isAdmin && (
              <div className="flex items-center gap-2 ms-auto">
                <button
                  onClick={() => setEditing(b)}
                  className="rounded-md bg-gray-800 text-white px-3 py-1 text-xs hover:opacity-90"
                >
                  ערוך
                </button>
                <DeleteButton id={b.id} name={b.building_name} onDone={reload} />
              </div>
            )}
          </div>
        ))}
        {shown.length === 0 && (
          <p className="px-4 py-6 text-center text-gray-400">אין בניינים להצגה.</p>
        )}
      </div>
    </div>
  );
}

function DeleteButton({
  id,
  name,
  onDone,
}: {
  id: number;
  name: string;
  onDone: () => Promise<void>;
}) {
  async function remove() {
    if (!confirm(`למחוק את הבניין '${name}'?`)) return;
    await apiFetch(`/api/buildings/${id}`, { method: "DELETE" });
    await onDone();
  }
  return (
    <button
      onClick={remove}
      className="rounded-md border border-status-darkred/40 text-status-darkred px-2 py-1 text-xs hover:bg-red-50"
    >
      מחק
    </button>
  );
}

function BuildingEditor({
  building,
  areas,
  onClose,
  onSaved,
}: {
  building: Partial<Building>;
  areas: Area[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [areaId, setAreaId] = useState<number | "">(building.area_id ?? "");
  const [name, setName] = useState(building.building_name ?? "");
  const [address, setAddress] = useState(building.building_address ?? "");
  const [lat, setLat] = useState<number | null>(building.latitude ?? null);
  const [lng, setLng] = useState<number | null>(building.longitude ?? null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const inputClass =
    "w-full rounded-md border border-gray-300 px-3 py-2 focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (areaId === "") {
      setError("יש לבחור אזור");
      return;
    }
    setBusy(true);
    const body = JSON.stringify({
      area_id: Number(areaId),
      building_name: name,
      building_address: address || null,
      latitude: lat,
      longitude: lng,
    });
    try {
      if (building.id) {
        await apiFetch(`/api/buildings/${building.id}`, { method: "PUT", body });
      } else {
        await apiFetch("/api/buildings", { method: "POST", body });
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "שמירה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="bg-white rounded-xl shadow-sm p-4 space-y-3">
      <h3 className="font-medium">{building.id ? "עריכת בניין" : "בניין חדש"}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="block text-sm font-medium">אזור</span>
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
          <span className="block text-sm font-medium">שם בניין</span>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <div className="sm:col-span-2 space-y-1">
          <span className="block text-sm font-medium">כתובת בניין</span>
          <AddressAutocomplete
            className={inputClass}
            value={address}
            onChange={(a) => {
              // Manual typing clears coords until a place is picked.
              setAddress(a);
              setLat(null);
              setLng(null);
            }}
            onPlace={(p) => {
              setAddress(p.address);
              setLat(p.lat);
              setLng(p.lng);
            }}
          />
        </div>
        <label className="block space-y-1">
          <span className="block text-sm font-medium">קו רוחב</span>
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
          <span className="block text-sm font-medium">קו אורך</span>
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
          {busy ? "שומר…" : "שמור"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
        >
          ביטול
        </button>
      </div>
    </form>
  );
}
