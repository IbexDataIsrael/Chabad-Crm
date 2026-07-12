"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { apiFetch, getToken } from "./api";

function readLocal<T>(key: string, initial: T): T {
  if (typeof window === "undefined") return initial;
  try {
    const raw = window.localStorage.getItem(`crm.pref.${key}`);
    return raw === null ? initial : (JSON.parse(raw) as T);
  } catch {
    return initial;
  }
}

function writeLocal(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(`crm.pref.${key}`, JSON.stringify(value));
  } catch {
    /* storage unavailable — the server copy still persists */
  }
}

/**
 * A user preference stored in the DATABASE (fixes17 §1.1) so it follows the
 * account across browsers/devices. localStorage doubles as an instant boot
 * cache: the cached value renders immediately, the server value replaces it
 * once loaded (unless the user already changed it this session), and every
 * change writes through to both (server PUT debounced).
 */
export function useDbPreference<T>(
  key: string,
  initial: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => readLocal(key, initial));
  const dirtyRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!getToken()) return;
    let active = true;
    apiFetch<Record<string, unknown>>("/api/preferences")
      .then((prefs) => {
        if (!active || dirtyRef.current) return;
        const stored = prefs[key];
        if (stored !== undefined && stored !== null) {
          setValue(stored as T);
          writeLocal(key, stored);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [key]);

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      dirtyRef.current = true;
      setValue((prev) => {
        const resolved =
          typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        writeLocal(key, resolved);
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          if (!getToken()) return;
          apiFetch("/api/preferences", {
            method: "PUT",
            body: JSON.stringify({ key, value: resolved }),
          }).catch(() => {});
        }, 400);
        return resolved;
      });
    },
    [key],
  );

  return [value, update];
}
