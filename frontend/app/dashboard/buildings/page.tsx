"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { BuildingsMap } from "@/components/BuildingsMap";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useFieldSettings } from "@/lib/fieldSettings";
import { pointInPolygon } from "@/lib/geo";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import {
  apartmentTitle,
  buildingDisplayName,
  formatCoords,
  roundCoord,
  type Apartment,
  type Area,
  type Building,
  type Floor,
} from "@/lib/types";

export default function BuildingsPage() {
  const { isAdmin, loading } = useAuth();
  const { t } = useLocalization();
  const [areas, setAreas] = useState<Area[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [filterArea, setFilterArea] = useState<string>("");
  // Inline editor is used only for *editing* an existing row; adding a building
  // goes to the dedicated /dashboard/buildings/add page.
  const [editing, setEditing] = useState<Building | null>(null);

  // Only the active filter's buildings are fetched (fixes8 §2 lazy loading).
  async function loadBuildings(areaId: string) {
    setBuildings(
      await apiFetch<Building[]>(`/api/buildings${areaId ? `?area_id=${areaId}` : ""}`),
    );
  }

  async function reload() {
    await loadBuildings(filterArea);
  }

  // Boot (fixes8 §2A): land pre-filtered on the first area, not the whole org.
  useEffect(() => {
    (async () => {
      const a = await apiFetch<Area[]>("/api/areas");
      setAreas(a);
      const areaId = a.length > 0 ? String(a[0].id) : "";
      setFilterArea(areaId);
      await loadBuildings(areaId);
    })().catch(() => {});
  }, []);

  function onFilterArea(v: string) {
    setFilterArea(v);
    loadBuildings(v).catch(() => {});
  }

  const areaName = useMemo(() => {
    const map = new Map<number, string>();
    areas.forEach((a) => map.set(a.id, a.area_name));
    return (id: number) => map.get(id) ?? "—";
  }, [areas]);

  if (loading) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;

  const inputClass =
    "rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("buildings", "בניינים")}</h1>
        {isAdmin && !editing && areas.length > 0 && (
          <Link
            href="/dashboard/buildings/add"
            className="rounded-md bg-status-magenta text-white px-4 py-1.5 text-sm font-medium hover:opacity-90"
          >
            {t("page.add_building", "הוסף בניין")}
          </Link>
        )}
      </div>
      {areas.length === 0 ? (
        <p className="text-sm text-status-darkred">
          {t("page.need_area_first", "יש להגדיר אזור אחד לפחות לפני הוספת בניין.")}{" "}
          <Link href="/dashboard/areas/add" className="font-medium underline hover:text-status-magenta">
            {t("page.add_area", "אזור חדש")}
          </Link>
        </p>
      ) : (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500">{t("filter.by_area", "סנן לפי אזור:")}</span>
          <select
            className={inputClass}
            value={filterArea}
            onChange={(e) => onFilterArea(e.target.value)}
          >
            <option value="">{t("filter.all", "הכל")}</option>
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

      {buildings.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-2">
          <BuildingsMap buildings={buildings} />
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
        {buildings.map((b) => (
          <BuildingRow
            key={b.id}
            building={b}
            areaName={areaName(b.area_id)}
            isAdmin={isAdmin}
            onEdit={() => setEditing(b)}
            onDeleted={reload}
          />
        ))}
        {buildings.length === 0 && (
          <p className="px-4 py-6 text-center text-gray-400">{t("page.no_buildings", "אין בניינים להצגה.")}</p>
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
  const { t } = useLocalization();
  const { success } = useToast();
  async function remove() {
    if (!confirm(`${t("msg.delete_building_confirm", "למחוק את הבניין?")} '${name}'`)) return;
    await apiFetch(`/api/buildings/${id}`, { method: "DELETE" });
    await onDone();
    success(t("msg.deleted", "נמחק בהצלחה"));
  }
  return (
    <button
      onClick={remove}
      className="rounded-md border border-status-darkred/40 text-status-darkred px-2 py-1 text-xs hover:bg-red-50"
    >
      {t("action.delete", "מחק")}
    </button>
  );
}

// One building row: summary line + an expandable panel to view/manage its apartments.
function BuildingRow({
  building,
  areaName,
  isAdmin,
  onEdit,
  onDeleted,
}: {
  building: Building;
  areaName: string;
  isAdmin: boolean;
  onEdit: () => void;
  onDeleted: () => Promise<void>;
}) {
  const { t } = useLocalization();
  const { isFieldVisible } = useFieldSettings();
  const [open, setOpen] = useState(false);
  const display = buildingDisplayName(building);
  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[10rem]">
          <Link
            href={`/dashboard/buildings/${building.id}`}
            className="font-medium text-status-magenta hover:underline"
          >
            {display}
          </Link>
          {isFieldVisible("buildings.building_name") &&
            building.building_name &&
            building.building_name !== display && (
              <div className="text-sm text-gray-500">{building.building_name}</div>
            )}
          {building.latitude != null && building.longitude != null && (
            <div className="text-xs text-gray-400">
              <span>{t("buildings.coords", "קואורדינטות")}: </span>
              <span dir="ltr">{formatCoords(building.latitude, building.longitude)}</span>
            </div>
          )}
        </div>
        <span className="rounded bg-gray-100 text-gray-600 text-xs px-2 py-0.5">{areaName}</span>
        {(building.floors?.length ?? 0) > 0 && (
          <span className="rounded bg-gray-100 text-gray-600 text-xs px-2 py-0.5">
            {building.floors!.length} {t("buildings.floors", "קומות")}
          </span>
        )}
        <div className="flex items-center gap-2 ms-auto">
          <button
            onClick={() => setOpen((o) => !o)}
            className="text-sm text-status-magenta hover:underline"
          >
            {open ? t("page.hide_apartments", "הסתר דירות") : t("page.show_apartments", "הצג דירות")}
          </button>
          {isAdmin && (
            <>
              <button
                onClick={onEdit}
                className="rounded-md bg-gray-800 text-white px-3 py-1 text-xs hover:opacity-90"
              >
                {t("action.edit", "ערוך")}
              </button>
              <DeleteButton id={building.id} name={display} onDone={onDeleted} />
            </>
          )}
        </div>
      </div>
      {open && <BuildingApartments building={building} isAdmin={isAdmin} />}
    </div>
  );
}

// Apartment list + inline CRUD for a single building.
function BuildingApartments({ building, isAdmin }: { building: Building; isAdmin: boolean }) {
  const { t } = useLocalization();
  const { success } = useToast();
  const [apts, setApts] = useState<Apartment[] | null>(null);
  const [adding, setAdding] = useState(false);

  async function reload() {
    setApts(await apiFetch<Apartment[]>(`/api/apartments?building_id=${building.id}`));
  }

  useEffect(() => {
    reload().catch(() => setApts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [building.id]);

  return (
    <div className="mt-3 border-t border-gray-100 pt-3 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-gray-500">{t("apartments", "דירות")}</h4>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="text-xs text-status-magenta hover:underline"
          >
            + {t("apt.add_apartment", "הוסף דירה")}
          </button>
        )}
      </div>

      {adding && (
        <ApartmentInlineForm
          building={building}
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            await reload();
            success(t("msg.added", "נוסף בהצלחה"));
          }}
        />
      )}

      {apts === null ? (
        <p className="text-sm text-gray-400">{t("action.loading", "טוען…")}</p>
      ) : apts.length === 0 ? (
        <p className="text-sm text-gray-400">{t("apt.no_apartments_building", "אין דירות בבניין זה.")}</p>
      ) : (
        <ul className="space-y-1">
          {apts.map((a) => (
            <ApartmentRow key={a.id} apt={a} building={building} isAdmin={isAdmin} onChanged={reload} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ApartmentRow({
  apt,
  building,
  isAdmin,
  onChanged,
}: {
  apt: Apartment;
  building: Building;
  isAdmin: boolean;
  onChanged: () => Promise<void>;
}) {
  const { t } = useLocalization();
  const { success } = useToast();
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li>
        <ApartmentInlineForm
          building={building}
          apt={apt}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await onChanged();
            success(t("msg.saved", "נשמר בהצלחה"));
          }}
        />
      </li>
    );
  }

  async function remove() {
    if (!confirm(`${t("apt.delete_confirm", "למחוק את הדירה?")} '${apartmentTitle(apt)}'`)) return;
    await apiFetch(`/api/apartments/${apt.id}`, { method: "DELETE" });
    await onChanged();
    success(t("msg.deleted", "נמחק בהצלחה"));
  }

  return (
    <li className="flex items-center gap-2 text-sm">
      <Link
        href={`/dashboard/apartments/${apt.id}`}
        className="font-medium text-status-magenta hover:underline"
      >
        {apartmentTitle(apt)}
      </Link>
      {apt.name && <span className="text-gray-600">{apt.name}</span>}
      {apt.apartment_notes && <span className="text-gray-500">— {apt.apartment_notes}</span>}
      <span className="ms-auto flex items-center gap-2">
        <button onClick={() => setEditing(true)} className="text-xs text-gray-600 hover:underline">
          {t("action.edit", "ערוך")}
        </button>
        {isAdmin && (
          <button onClick={remove} className="text-xs text-status-darkred hover:underline">
            {t("action.delete", "מחק")}
          </button>
        )}
      </span>
    </li>
  );
}

/** Compact inline apartment form (label, floor, resident, notes). The full
 *  editing flow (all fields, contact-card style) lives on the apartment page. */
function ApartmentInlineForm({
  building,
  apt,
  onClose,
  onSaved,
}: {
  building: Building;
  apt?: Apartment;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useLocalization();
  const { isFieldVisible } = useFieldSettings();
  const [label, setLabel] = useState(apt?.apartment_name ?? "");
  const [floor, setFloor] = useState(apt?.floor ?? "");
  const [resident, setResident] = useState(apt?.name ?? "");
  const [notes, setNotes] = useState(apt?.apartment_notes ?? "");
  const [floors, setFloors] = useState<Floor[]>(building.floors ?? []);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (building.floors) return; // already came with the building payload
    apiFetch<Floor[]>(`/api/buildings/${building.id}/floors`)
      .then(setFloors)
      .catch(() => setFloors([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [building.id]);

  const inputClass =
    "w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const body = JSON.stringify({
      ...(apt ? {} : { building_id: building.id }),
      apartment_name: label || null,
      floor: floor || null,
      name: resident || null,
      apartment_notes: notes || null,
    });
    try {
      if (apt) {
        await apiFetch(`/api/apartments/${apt.id}`, { method: "PUT", body });
      } else {
        await apiFetch("/api/apartments", { method: "POST", body });
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="rounded-md bg-gray-50 p-2 space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {isFieldVisible("apartments.apartment_name") && (
          <input
            className={inputClass}
            placeholder={t("apartments.apartment_name", "תווית")}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        )}
        <select className={inputClass} value={floor} onChange={(e) => setFloor(e.target.value)}>
          <option value="">{t("apartments.floor", "קומה")}…</option>
          {floors.map((f) => (
            <option key={f.id} value={f.name}>
              {f.name}
            </option>
          ))}
        </select>
        <input
          className={inputClass}
          placeholder={t("apartments.name", "שם דייר")}
          value={resident}
          onChange={(e) => setResident(e.target.value)}
        />
        <input
          className={inputClass}
          placeholder={t("apartments.apartment_notes", "הערות")}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      {error && <p className="text-xs text-status-darkred">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-status-magenta text-white px-3 py-1 text-xs font-medium hover:opacity-90 disabled:opacity-50"
        >
          {busy ? t("action.saving", "שומר…") : t("action.save", "שמור")}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50"
        >
          {t("action.cancel", "ביטול")}
        </button>
      </div>
    </form>
  );
}

function BuildingEditor({
  building,
  areas,
  onClose,
  onSaved,
}: {
  building: Building;
  areas: Area[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useLocalization();
  const { isFieldVisible } = useFieldSettings();
  const [areaId, setAreaId] = useState<number | "">(building.area_id ?? "");
  const [name, setName] = useState(building.building_name ?? "");
  const [address, setAddress] = useState(building.building_address ?? "");
  const [lat, setLat] = useState<number | null>(roundCoord(building.latitude));
  const [lng, setLng] = useState<number | null>(roundCoord(building.longitude));
  const [error, setError] = useState("");
  // Geofence interceptor (fixes7 §7B): outside-the-zone saves need an explicit
  // second confirmation.
  const [geoWarning, setGeoWarning] = useState(false);
  const [busy, setBusy] = useState(false);

  const inputClass =
    "w-full rounded-md border border-gray-300 px-3 py-2 focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

  async function save(e: FormEvent, force = false) {
    e.preventDefault();
    setError("");
    if (areaId === "") {
      setError(t("msg.select_area", "יש לבחור אזור"));
      return;
    }
    // Point-in-polygon guardrail against the selected area's boundary.
    if (!force) {
      const area = areas.find((a) => a.id === Number(areaId));
      if (pointInPolygon(lat, lng, area?.area_polygon) === false) {
        setGeoWarning(true);
        return;
      }
    }
    setGeoWarning(false);
    setBusy(true);
    const body = JSON.stringify({
      area_id: Number(areaId),
      building_name: name || null,
      building_address: address,
      latitude: lat,
      longitude: lng,
    });
    try {
      await apiFetch(`/api/buildings/${building.id}`, { method: "PUT", body });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="bg-white rounded-xl shadow-sm p-4 space-y-3">
      <h3 className="font-medium">{t("page.edit_building", "עריכת בניין")}</h3>
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
              // Manual typing clears coords until a place is picked.
              setAddress(a);
              setLat(null);
              setLng(null);
              setGeoWarning(false);
            }}
            onPlace={(p) => {
              setAddress(p.address);
              setLat(roundCoord(p.lat));
              setLng(roundCoord(p.lng));
              setGeoWarning(false);
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

      <FloorsEditor buildingId={building.id} />

      {geoWarning && (
        <div className="rounded-md border-2 border-status-darkred bg-red-50 p-3 space-y-2">
          <p className="text-sm font-bold text-status-darkred">
            ⚠ {t("geo.outside_area_warning", "אזהרה: הכתובת שנבחרה נמצאת מחוץ לתחום האזור שנבחר!")}
          </p>
          <p className="text-xs text-status-darkred">{t("geo.check_hint", "בדוק את הכתובת או בחר אזור אחר.")}</p>
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
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
        >
          {t("action.cancel", "ביטול")}
        </button>
      </div>
    </form>
  );
}

/** Append / rename / drop a building's floors (fixes7 §3). Saves immediately. */
function FloorsEditor({ buildingId }: { buildingId: number }) {
  const { t } = useLocalization();
  const { error: toastError } = useToast();
  const [floors, setFloors] = useState<Floor[]>([]);
  const [newName, setNewName] = useState("");

  async function reload() {
    setFloors(await apiFetch<Floor[]>(`/api/buildings/${buildingId}/floors`));
  }

  useEffect(() => {
    reload().catch(() => setFloors([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildingId]);

  async function add() {
    if (!newName.trim()) return;
    try {
      await apiFetch(`/api/buildings/${buildingId}/floors`, {
        method: "POST",
        body: JSON.stringify({ name: newName.trim() }),
      });
      setNewName("");
      await reload();
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    }
  }

  async function rename(floor: Floor) {
    const name = prompt(t("floors.name", "שם קומה"), floor.name);
    if (!name || name.trim() === floor.name) return;
    try {
      await apiFetch(`/api/buildings/${buildingId}/floors/${floor.id}`, {
        method: "PUT",
        body: JSON.stringify({ name: name.trim() }),
      });
      await reload();
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    }
  }

  async function remove(floor: Floor) {
    if (!confirm(`${t("floors.delete_confirm", "למחוק קומה זו?")} '${floor.name}'`)) return;
    try {
      await apiFetch(`/api/buildings/${buildingId}/floors/${floor.id}`, {
        method: "DELETE",
      });
      await reload();
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    }
  }

  const chip =
    "inline-flex items-center gap-1 rounded-full bg-gray-100 text-gray-700 px-3 py-1 text-sm";

  return (
    <div className="border-t border-gray-100 pt-3 space-y-2">
      <span className="block text-sm font-medium">{t("buildings.floors", "קומות")}</span>
      {floors.length === 0 ? (
        <p className="text-sm text-gray-400">{t("floors.none", "אין קומות בבניין זה.")}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {floors.map((f) => (
            <li key={f.id} className={chip}>
              <button
                type="button"
                onClick={() => rename(f)}
                className="hover:underline"
                title={t("action.edit", "ערוך")}
              >
                {f.name}
              </button>
              <button
                type="button"
                onClick={() => remove(f)}
                className="text-gray-400 hover:text-status-darkred"
                aria-label={t("action.delete", "מחק")}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <input
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm w-36 focus:border-status-magenta focus:outline-none"
          placeholder={t("floors.name", "שם קומה")}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button
          type="button"
          onClick={add}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          + {t("floors.add", "הוסף קומה")}
        </button>
      </div>
    </div>
  );
}
