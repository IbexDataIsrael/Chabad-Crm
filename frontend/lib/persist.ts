"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

function read<T>(key: string, initial: T): T {
  if (typeof window === "undefined") return initial;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return initial;
    return JSON.parse(raw) as T;
  } catch {
    return initial;
  }
}

/**
 * useState that survives navigation (fixes15 §1.2): hydrates from
 * localStorage (lazy init) and writes back on every change, so a list page's
 * filters / sorting / paging are restored when the user returns to it.
 * Keys are namespaced by the caller, e.g. "crm.contacts.sort".
 */
export function usePersistentState<T>(
  key: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => read(key, initial));
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable (privacy mode) — the state just won't persist */
    }
  }, [key, value]);
  return [value, setValue];
}
