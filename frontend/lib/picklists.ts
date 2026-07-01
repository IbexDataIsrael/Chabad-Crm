"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "./api";
import { useLocalization } from "./localization";
import type { PicklistValue } from "./types";

// Simple module-level cache so multiple selects don't refetch the same field.
const cache: Record<string, PicklistValue[]> = {};

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

  // Render an option in the current language (English value falls back to Hebrew).
  const display = (o: PicklistValue): string =>
    (lang === "en" ? o.english_value || o.hebrew_label : o.hebrew_label) ||
    o.english_value ||
    o.value;

  const labelFor = (value: string | null | undefined): string => {
    const o = options.find((opt) => opt.value === value);
    return o ? display(o) : value ?? "";
  };

  return { options, labelFor, display };
}
