"use client";

import Link from "next/link";
import { ArrowRight, Plus, X } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { ConfirmModal } from "@/components/ConfirmModal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useFieldSettings } from "@/lib/fieldSettings";
import { pointInPolygon } from "@/lib/geo";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import { useConfirm } from "@/lib/confirm";
import {
  apartmentTitle,
  buildingDisplayName,
  roundCoord,
  type Apartment,
  type Area,
  type Building,
  type Floor,
} from "@/lib/types";

const inputClass =
  "w-full rounded-md border border-input px-3 py-2 focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

/** Dedicated building-edit page (fixes12 §3.4): full building fields + floors
 *  + the building's apartments (add/edit route to the standalone apartment
 *  views with a return path back here; delete via the localized modal). */
export default function EditBuildingPage() {
  const { isAdmin, loading } = useAuth();
  const { t } = useLocalization();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const buildingId = Number(params.id);

  const [building, setBuilding] = useState<Building | null>(null);
  const [areas, setAreas] = useState<Area[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  // Non-admins can't edit buildings.
  useEffect(() => {
    if (!loading && !isAdmin) router.replace("/dashboard/buildings");
  }, [loading, isAdmin, router]);

  useEffect(() => {
    if (loading) return;
    Promise.all([
      apiFetch<Building>(`/api/buildings/${buildingId}`),
      apiFetch<Area[]>("/api/areas"),
    ])
      .then(([b, a]) => {
        setBuilding(b);
        setAreas(a);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : t("msg.load_failed", "טעינה נכשלה")),
      )
      .finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildingId, loading]);

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

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          {t("page.edit_building_full", "עריכת בניין ודירות")} — {buildingDisplayName(building)}
        </h1>
        <Link
          href={`/dashboard/buildings/${building.id}`}
          className="flex items-center gap-1 text-sm text-primary hover:underline"
        >
          {t("page.back_to_building", "חזרה לבניין")} <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <BuildingEditForm
        building={building}
        areas={areas}
        onSaved={() => router.push("/dashboard/buildings")}
        onCancel={() => router.push("/dashboard/buildings")}
      />

      <BuildingApartmentsSection building={building} />
    </div>
  );
}

/** The building fields form (moved from the buildings list's inline editor). */
function BuildingEditForm({
  building,
  areas,
  onSaved,
  onCancel,
}: {
  building: Building;
  areas: Area[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t } = useLocalization();
  const { isFieldVisible } = useFieldSettings();
  const { success } = useToast();
  const [areaId, setAreaId] = useState<number | "">(building.area_id ?? "");
  const [name, setName] = useState(building.building_name ?? "");
  const [address, setAddress] = useState(building.building_address ?? "");
  const [lat, setLat] = useState<number | null>(roundCoord(building.latitude));
  const [lng, setLng] = useState<number | null>(roundCoord(building.longitude));
  // fixes11 §2.4: one "longitude,latitude" text box instead of two inputs.
  const [coords, setCoords] = useState(() =>
    building.longitude != null && building.latitude != null
      ? `${roundCoord(building.longitude)},${roundCoord(building.latitude)}`
      : "",
  );
  const [error, setError] = useState("");
  // Geofence interceptor (fixes7 §7B): outside-the-zone saves need an explicit
  // second confirmation.
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
      success(t("msg.saved", "נשמר בהצלחה"));
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setBusy(false);
    }
  }

  return (
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
              // Manual typing clears coords until a place is picked.
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
      </div>

      <FloorsEditor buildingId={building.id} />

      {geoWarning && (
        <div className="rounded-md border-2 border-destructive bg-destructive/10 p-3 space-y-2">
          <p className="text-sm font-bold text-destructive">
            ⚠ {t("geo.outside_area_warning", "אזהרה: הכתובת שנבחרה נמצאת מחוץ לתחום האזור שנבחר!")}
          </p>
          <p className="text-xs text-destructive">{t("geo.check_hint", "בדוק את הכתובת או בחר אזור אחר.")}</p>
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
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("action.cancel", "ביטול")}
        </Button>
      </div>
    </form>
    </Card>
  );
}

/** Append / rename / drop a building's floors (fixes7 §3). Saves immediately. */
function FloorsEditor({ buildingId }: { buildingId: number }) {
  const { t } = useLocalization();
  const confirmDialog = useConfirm();
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
    if (!(await confirmDialog({ message: t("floors.delete_confirm", "למחוק קומה זו?"), detail: floor.name }))) return;
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
    "inline-flex items-center gap-1 rounded-full bg-muted text-foreground px-3 py-1 text-sm";

  return (
    <div className="border-t border-border pt-3 space-y-2">
      <span className="block text-sm font-medium">{t("buildings.floors", "קומות")}</span>
      {floors.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("floors.none", "אין קומות בבניין זה.")}</p>
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
                className="text-muted-foreground hover:text-destructive"
                aria-label={t("action.delete", "מחק")}
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <input
          className="rounded-md border border-input px-3 py-1.5 text-sm w-36 focus:border-status-magenta focus:outline-none"
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
        <Button type="button" size="sm" variant="outline" onClick={add}>
          <Plus className="h-4 w-4" /> {t("floors.add", "הוסף קומה")}
        </Button>
      </div>
    </div>
  );
}

/** The building's apartments: edit/add route to the standalone apartment
 *  views (returning here after save); delete uses the localized modal. */
function BuildingApartmentsSection({ building }: { building: Building }) {
  const { t } = useLocalization();
  const { success } = useToast();
  const [apts, setApts] = useState<Apartment[] | null>(null);
  const [deleting, setDeleting] = useState<Apartment | null>(null);

  const returnTo = encodeURIComponent(`/dashboard/buildings/edit/${building.id}`);

  async function reload() {
    setApts(await apiFetch<Apartment[]>(`/api/apartments?building_id=${building.id}`));
  }

  useEffect(() => {
    reload().catch(() => setApts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [building.id]);

  async function remove(apt: Apartment) {
    setDeleting(null);
    await apiFetch(`/api/apartments/${apt.id}`, { method: "DELETE" });
    await reload();
    success(t("msg.deleted", "נמחק בהצלחה"));
  }

  return (
    <section className="bg-card border border-border rounded-xl shadow-sm p-5 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">{t("apartments", "דירות")}</h2>
        <Link
          href={`/dashboard/apartments/add?building=${building.id}&return=${returnTo}`}
          className="flex items-center gap-1 text-sm text-primary hover:underline"
        >
          <Plus className="h-3.5 w-3.5" /> {t("apt.add_apartment", "הוסף דירה")}
        </Link>
      </div>

      {deleting && (
        <ConfirmModal
          message={t("apt.delete_confirm", "למחוק את הדירה?")}
          detail={apartmentTitle(deleting)}
          onCancel={() => setDeleting(null)}
          onConfirm={() => remove(deleting)}
        />
      )}

      {apts === null ? (
        <p className="text-sm text-muted-foreground">{t("action.loading", "טוען…")}</p>
      ) : apts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("apt.no_apartments_building", "אין דירות בבניין זה.")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {apts.map((a) => (
            <li key={a.id} className="py-2 flex items-center gap-2">
              <Link
                href={`/dashboard/apartments/${a.id}`}
                className="font-medium text-status-magenta hover:underline"
              >
                {apartmentTitle(a)}
              </Link>
              {a.name && <span className="text-sm text-muted-foreground">{a.name}</span>}
              {a.apartment_notes && (
                <span className="text-sm text-muted-foreground">— {a.apartment_notes}</span>
              )}
              <span className="ms-auto flex items-center gap-2">
                <Link
                  href={`/dashboard/apartments/edit/${a.id}?return=${returnTo}`}
                  className="text-xs text-muted-foreground hover:underline"
                >
                  {t("action.edit", "ערוך")}
                </Link>
                <button
                  onClick={() => setDeleting(a)}
                  className="text-xs text-destructive hover:underline"
                >
                  {t("action.delete", "מחק")}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
