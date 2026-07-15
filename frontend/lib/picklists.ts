"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "./api";
import { useLocalization, type Lang } from "./localization";
import type { PicklistValue } from "./types";

// Simple module-level cache so multiple selects don't refetch the same field.
const cache: Record<string, PicklistValue[]> = {};

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
