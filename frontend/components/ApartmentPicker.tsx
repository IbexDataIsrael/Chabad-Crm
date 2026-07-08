"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import {
  apartmentTitle,
  buildingDisplayName,
  type Apartment,
  type Building,
} from "@/lib/types";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

/**
 * Picks a mekurav's apartment by first choosing a building, then an apartment
 * within it. New apartments can be created inline ("הוסף דירה"). Value is the
 * apartment id (or null).
 */
export function ApartmentPicker({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (apartmentId: number | null) => void;
}) {
  const { t } = useLocalization();
  // fixes11 §1.2: shliach users get a flat, server-scoped apartment list —
  // no building dropdown, no inline creation.
  const { isShliach } = useAuth();
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [buildingId, setBuildingId] = useState<number | "">("");
  const [apartments, setApartments] = useState<Apartment[]>([]);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [error, setError] = useState("");

  // Load buildings, and resolve the current apartment's building when editing.
  useEffect(() => {
    if (isShliach) {
      // Server scopes the plain list to the shliach's covered apartments.
      apiFetch<Apartment[]>("/api/apartments")
        .then(setApartments)
        .catch(() => setApartments([]));
      return;
    }
    let active = true;
    (async () => {
      try {
        const bs = await apiFetch<Building[]>("/api/buildings");
        if (!active) return;
        setBuildings(bs);
        if (value != null) {
          const ap = await apiFetch<Apartment>(`/api/apartments/${value}`);
          if (active) setBuildingId(ap.building_id);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isShliach]);

  // Load apartments whenever the selected building changes (admin/staff flow).
  useEffect(() => {
    if (isShliach) return;
    if (buildingId === "") {
      setApartments([]);
      return;
    }
    apiFetch<Apartment[]>(`/api/apartments?building_id=${buildingId}`)
      .then(setApartments)
      .catch(() => setApartments([]));
  }, [buildingId, isShliach]);

  async function createApartment() {
    setError("");
    if (buildingId === "" || !newName.trim()) return;
    try {
      const ap = await apiFetch<Apartment>("/api/apartments", {
        method: "POST",
        body: JSON.stringify({
          building_id: Number(buildingId),
          apartment_name: newName,
          apartment_notes: newNotes || null,
        }),
      });
      setApartments((prev) => [...prev, ap]);
      onChange(ap.id);
      setNewName("");
      setNewNotes("");
      setAdding(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("apt.add_failed", "הוספת דירה נכשלה"));
    }
  }

  if (isShliach) {
    // Flat, coverage-scoped select — no building navigation (fixes11 §1.2).
    if (apartments.length === 0) {
      return (
        <p className="text-sm text-gray-500">
          {t("apt.none_covered", "אין דירות משויכות אליך.")}
        </p>
      );
    }
    return (
      <select
        className={inputClass}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      >
        <option value="">{t("apt.choose_apartment", "בחר דירה…")}</option>
        {apartments.map((a) => (
          <option key={a.id} value={a.id}>
            {apartmentTitle(a)}
          </option>
        ))}
      </select>
    );
  }

  if (buildings.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        {t("apt.no_buildings", "אין בניינים עדיין.")}{" "}
        <Link href="/dashboard/buildings" className="text-status-magenta hover:underline">
          {t("page.add_building", "הוסף בניין")}
        </Link>{" "}
        {t("apt.to_link_apartment", "כדי לשייך דירה.")}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <select
          className={inputClass}
          value={buildingId}
          onChange={(e) => {
            setBuildingId(e.target.value === "" ? "" : Number(e.target.value));
            onChange(null); // building changed → clear apartment
            setAdding(false);
          }}
        >
          <option value="">{t("apt.choose_building", "בחר בניין…")}</option>
          {buildings.map((b) => (
            <option key={b.id} value={b.id}>
              {buildingDisplayName(b)}
            </option>
          ))}
        </select>

        <select
          className={inputClass}
          value={value ?? ""}
          disabled={buildingId === ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        >
          <option value="">{t("apt.choose_apartment", "בחר דירה…")}</option>
          {apartments.map((a) => (
            <option key={a.id} value={a.id}>
              {apartmentTitle(a)}
            </option>
          ))}
        </select>
      </div>

      {buildingId !== "" &&
        (adding ? (
          <div className="rounded-md border border-gray-200 p-3 space-y-2">
            <input
              className={inputClass}
              placeholder={t("apt.name", "שם דירה")}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <input
              className={inputClass}
              placeholder={t("apt.notes_optional", "הערות (לא חובה)")}
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
            />
            {error && <p className="text-sm text-status-darkred">{error}</p>}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={createApartment}
                className="rounded-md bg-status-magenta text-white px-4 py-1.5 text-sm font-medium hover:opacity-90"
              >
                {t("apt.save_apartment", "שמור דירה")}
              </button>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="text-sm text-gray-500 hover:underline"
              >
                {t("action.cancel", "ביטול")}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-sm text-status-magenta hover:underline"
          >
            + {t("apt.add_apartment", "הוסף דירה")}
          </button>
        ))}
    </div>
  );
}
