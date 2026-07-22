"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "./api";
import { useLocalization, type Lang } from "./localization";
import type { PicklistValue } from "./types";

// Simple module-level cache so multiple selects don't refetch the same field.
const cache: Record<string, PicklistValue[]> = {};

// fixes32 §6/§stillnotdone: the 4 apartment picklists with dedicated fields
// everywhere (list grid, CRUD form) — any other "apartment.*" definition is
// dynamic (custom), auto-wired wherever this constant is used to filter it in.
export const FIXED_APARTMENT_PICKLIST_KEYS = [
  "apartment.Jewish_status",
  "apartment.campaign_status",
  "apartment.mezuzah_status",
  "apartment.language",
];

// fixes34 §1.1: the contact-side equivalent — every picklist with a
// dedicated field somewhere in the contact UI already (pipeline/color/
// next-step, plus the 3 bare-named mekurav ones); anything else is a custom,
// admin-added contact picklist, auto-wired wherever this constant filters it in.
export const FIXED_CONTACT_PICKLIST_KEYS = [
  "contact.pipeline_status",
  "contact.color_tag",
  "contact.potential_next_step",
  "Jewish_status",
  "affiliation",
  "language",
];

/** Render a picklist option in the given language (English value falls back
 *  to Hebrew). Shared by the hook and non-hook callers (fixes24: the PDF
 *  generator fetches its picklists imperatively). */
export function displayPicklistValue(o: PicklistValue, lang: Lang): string {
  return (
    (lang === "en" ? o.english_value || o.hebrew_label : o.hebrew_label) ||
    o.english_value ||
    o.value
  );
}

export function usePicklist(fieldKey: string) {
  const { lang } = useLocalization();
  const [options, setOptions] = useState<PicklistValue[]>(cache[fieldKey] ?? []);

  useEffect(() => {
    let active = true;
    apiFetch<PicklistValue[]>(`/api/picklists/${fieldKey}`)
      .then((opts) => {
        cache[fieldKey] = opts;
        if (active) setOptions(opts);
      })
      .catch(() => {
        /* leave whatever we had */
      });
    return () => {
      active = false;
    };
  }, [fieldKey]);

  const display = (o: PicklistValue): string => displayPicklistValue(o, lang);

  const labelFor = (value: string | null | undefined): string => {
    const o = options.find((opt) => opt.value === value);
    return o ? display(o) : value ?? "";
  };

  return { options, labelFor, display };
}

/** fixes32 §6: `usePicklist` for a *dynamic* set of field_keys (e.g. every
 *  admin-added apartment.* picklist beyond the fixed 4) — one hook call
 *  covering an arbitrary, runtime-determined list, which a loop of
 *  `usePicklist` calls can't do (hook count must stay stable across renders). */
export function usePicklistsMap(fieldKeys: string[]) {
  const { lang } = useLocalization();
  const [map, setMap] = useState<Record<string, PicklistValue[]>>({});
  const key = [...fieldKeys].sort().join(",");

  useEffect(() => {
    let active = true;
    if (fieldKeys.length === 0) {
      setMap({});
      return;
    }
    Promise.all(
      fieldKeys.map((fk) =>
        apiFetch<PicklistValue[]>(`/api/picklists/${fk}`)
          .then((opts): [string, PicklistValue[]] => [fk, opts])
          .catch((): [string, PicklistValue[]] => [fk, cache[fk] ?? []]),
      ),
    ).then((entries) => {
      entries.forEach(([fk, opts]) => {
        cache[fk] = opts;
      });
      if (active) setMap(Object.fromEntries(entries));
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const display = (o: PicklistValue): string => displayPicklistValue(o, lang);

  const labelFor = (fieldKey: string, value: string | null | undefined): string => {
    const o = (map[fieldKey] ?? []).find((opt) => opt.value === value);
    return o ? display(o) : value ?? "";
  };

  return { map, labelFor, display };
}
