"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "./api";
import type { PicklistValue } from "./types";

// Simple module-level cache so multiple selects don't refetch the same field.
const cache: Record<string, PicklistValue[]> = {};

export function usePicklist(fieldKey: string) {
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

  const labelFor = (value: string | null | undefined): string =>
    options.find((o) => o.value === value)?.hebrew_label ?? value ?? "";

  return { options, labelFor };
}
