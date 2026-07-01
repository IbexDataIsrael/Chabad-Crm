"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { BuildingsMap } from "@/components/BuildingsMap";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import { formatCoords, roundCoord, type Apartment, type Area, type Building } from "@/lib/types";

export default function BuildingsPage() {
  const { isAdmin, loading } = useAuth();
  const { t } = useLocalization();
  const [areas, setAreas] = useState<Area[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [filterArea, setFilterArea] = useState<string>("");
  // Inline editor is used only for *editing* an existing row; adding a building
  // goes to the dedicated /dashboard/buildings/add page.
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

  if (loading) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;

  const inputClass =
    "rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

  return (
    <div className="space-y-5 max-w-3xl">
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
            onChange={(e) => setFilterArea(e.target.value)}
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

      {shown.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-2">
          <BuildingsMap buildings={shown} />
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
        {shown.map((b) => (
          <BuildingRow
            key={b.id}
            building={b}
            areaName={areaName(b.area_id)}
            isAdmin={isAdmin}
            onEdit={() => setEditing(b)}
            onDeleted={reload}
          />
        ))}
        {shown.length === 0 && (
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
  const [open, setOpen] = useState(false);
  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[10rem]">
          <Link
            href={`/dashboard/buildings/${building.id}`}
            className="font-medium text-status-magenta hover:underline"
          >
            {building.building_name}
          </Link>
          {building.building_address && (
            <div className="text-sm text-gray-500">{building.building_address}</div>
          )}
          {building.latitude != null && building.longitude != null && (
            <div className="text-xs text-gray-400">
              <span>{t("buildings.coords", "קואורדינטות")}: </span>
              <span dir="ltr">{formatCoords(building.latitude, building.longitude)}</span>
            </div>
          )}
        </div>
        <span className="rounded bg-gray-100 text-gray-600 text-xs px-2 py-0.5">{areaName}</span>
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
              <DeleteButton id={building.id} name={building.building_name} onDone={onDeleted} />
            </>
          )}
        </div>
      </div>
      {open && <BuildingApartments buildingId={building.id} isAdmin={isAdmin} />}
    </div>
  );
}

// Apartment list + inline CRUD for a single building.
function BuildingApartments({ buildingId, isAdmin }: { buildingId: number; isAdmin: boolean }) {
  const { t } = useLocalization();
  const { success } = useToast();
  const [apts, setApts] = useState<Apartment[] | null>(null);
  const [adding, setAdding] = useState(false);

  async function reload() {
    setApts(await apiFetch<Apartment[]>(`/api/apartments?building_id=${buildingId}`));
  }

  useEffect(() => {
    reload().catch(() => setApts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildingId]);

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
          buildingId={buildingId}
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
            <ApartmentRow key={a.id} apt={a} isAdmin={isAdmin} onChanged={reload} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ApartmentRow({
  apt,
  isAdmin,
  onChanged,
}: {
  apt: Apartment;
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
          buildingId={apt.building_id}
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
    if (!confirm(`${t("apt.delete_confirm", "למחוק את הדירה?")} '${apt.apartment_name}'`)) return;
    await apiFetch(`/api/apartments/${apt.id}`, { method: "DELETE" });
    await onChanged();
    success(t("msg.deleted", "נמחק בהצלחה"));
  }

  return (
    <li className="flex items-center gap-2 text-sm">
      <span className="font-medium">{apt.apartment_name}</span>
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

function ApartmentInlineForm({
  buildingId,
  apt,
  onClose,
  onSaved,
}: {
  buildingId: number;
  apt?: Apartment;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useLocalization();
  const [name, setName] = useState(apt?.apartment_name ?? "");
  const [notes, setNotes] = useState(apt?.apartment_notes ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const inputClass =
    "w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (apt) {
        await apiFetch(`/api/apartments/${apt.id}`, {
          method: "PUT",
          body: JSON.stringify({ apartment_name: name, apartment_notes: notes || null }),
        });
      } else {
        await apiFetch("/api/apartments", {
          method: "POST",
          body: JSON.stringify({
            building_id: buildingId,
            apartment_name: name,
            apartment_notes: notes || null,
          }),
        });
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input
          className={inputClass}
          placeholder={t("apartments.apartment_name", "כותרת")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
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
  building: Partial<Building>;
  areas: Area[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useLocalization();
  const [areaId, setAreaId] = useState<number | "">(building.area_id ?? "");
  const [name, setName] = useState(building.building_name ?? "");
  const [address, setAddress] = useState(building.building_address ?? "");
  const [lat, setLat] = useState<number | null>(roundCoord(building.latitude));
  const [lng, setLng] = useState<number | null>(roundCoord(building.longitude));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const inputClass =
    "w-full rounded-md border border-gray-300 px-3 py-2 focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (areaId === "") {
      setError(t("msg.select_area", "יש לבחור אזור"));
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
      setError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="bg-white rounded-xl shadow-sm p-4 space-y-3">
      <h3 className="font-medium">
        {building.id ? t("page.edit_building", "עריכת בניין") : t("page.new_building", "בניין חדש")}
      </h3>
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
              // Manual typing clears coords until a place is picked.
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
