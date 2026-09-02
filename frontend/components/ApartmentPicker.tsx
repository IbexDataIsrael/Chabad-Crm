"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Plus } from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Button } from "@/components/ui/button";
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
  "w-full rounded-md border border-input px-3 py-2 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

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
  const [buildingId, setBuildingId] = useState<number | "">("");
  // fixes54 §2: only the currently-selected building's own label is loaded
  // eagerly — the full list used to be fetched unpaginated (see the
  // `remoteSearch` prop below for the "why" — an org with thousands of
  // buildings made that unusable).
  const [buildingLabel, setBuildingLabel] = useState<string | null>(null);
  // null = not checked yet (render nothing rather than flash the empty state).
  const [hasAnyBuilding, setHasAnyBuilding] = useState<boolean | null>(null);
  const [apartments, setApartments] = useState<Apartment[]>([]);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [error, setError] = useState("");

  // Resolve the current apartment's building when editing an existing value.
  useEffect(() => {
    if (isShliach) {
      // Server scopes the plain list to the shliach's covered apartments.
      apiFetch<Apartment[]>("/api/apartments")
        .then(setApartments)
        .catch(() => setApartments([]));
      return;
    }
    let active = true;
    // fixes54 §2: a cheap one-page existence check (not the old full-list
    // fetch) — just enough to tell "no buildings yet" apart from "still
    // loading" without pulling every building into the browser.
    apiFetch<{ total: number }>("/api/buildings/list?page=1&page_size=20")
      .then((res) => {
        if (active) setHasAnyBuilding(res.total > 0);
      })
      .catch(() => {
        if (active) setHasAnyBuilding(true); // fail open — let the picker try
      });
    if (value != null) {
      (async () => {
        try {
          const ap = await apiFetch<Apartment>(`/api/apartments/${value}`);
          if (!active) return;
          setBuildingId(ap.building_id);
          const b = await apiFetch<Building>(`/api/buildings/${ap.building_id}`);
          if (active) setBuildingLabel(buildingDisplayName(b));
        } catch {
          /* ignore */
        }
      })();
    }
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isShliach]);

  // fixes54 §2: server-side building search backing the picker below —
  // replaces the old "fetch every building in the org, filter client-side"
  // approach, which flashed "no buildings yet" while a multi-MB payload was
  // still loading and then rendered a several-thousand-row dropdown too
  // sluggish to actually pick from once it landed.
  async function searchBuildings(query: string): Promise<{ id: number; label: string }[]> {
    const params = new URLSearchParams({ q: query, page: "1", page_size: "20" });
    const res = await apiFetch<{ items: Building[] }>(`/api/buildings/list?${params}`);
    return res.items.map((b) => ({ id: b.id, label: buildingDisplayName(b) }));
  }

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
        <p className="text-sm text-muted-foreground">
          {t("apt.none_covered", "אין דירות משויכות אליך.")}
        </p>
      );
    }
    return (
      <SearchableSelect
        value={value}
        onChange={onChange}
        options={apartments.map((a) => ({ id: a.id, label: apartmentTitle(a) }))}
        placeholder={t("apt.choose_apartment", "בחר דירה…")}
      />
    );
  }

  if (hasAnyBuilding === false) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("apt.no_buildings", "אין בניינים עדיין.")}{" "}
        <Link href="/dashboard/buildings" className="text-primary hover:underline">
          {t("page.add_building", "הוסף בניין")}
        </Link>{" "}
        {t("apt.to_link_apartment", "כדי לשייך דירה.")}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <SearchableSelect<number>
          value={buildingId === "" ? null : buildingId}
          onChange={(id, label) => {
            setBuildingId(id ?? "");
            setBuildingLabel(label ?? null);
            onChange(null); // building changed → clear apartment
            setAdding(false);
          }}
          options={[]}
          remoteSearch={searchBuildings}
          selectedLabel={buildingLabel}
          placeholder={t("apt.choose_building", "בחר בניין…")}
        />

        <SearchableSelect
          value={value}
          onChange={onChange}
          disabled={buildingId === ""}
          options={apartments.map((a) => ({ id: a.id, label: apartmentTitle(a) }))}
          placeholder={t("apt.choose_apartment", "בחר דירה…")}
        />
      </div>

      {buildingId !== "" &&
        (adding ? (
          <div className="rounded-md border border-border p-3 space-y-2">
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
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" onClick={createApartment}>
                {t("apt.save_apartment", "שמור דירה")}
              </Button>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="text-sm text-muted-foreground hover:underline"
              >
                {t("action.cancel", "ביטול")}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 text-sm text-primary hover:underline"
          >
            <Plus className="h-3.5 w-3.5" /> {t("apt.add_apartment", "הוסף דירה")}
          </button>
        ))}
    </div>
  );
}
