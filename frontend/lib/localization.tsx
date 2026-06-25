"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { apiFetch } from "./api";

// { entity_type: { technical_name: hebrew_label } }
type LocalizationMap = Record<string, Record<string, string>>;

interface LocalizationContextValue {
  loading: boolean;
  /** Resolve a technical_name to its Hebrew label (searches all groups). */
  t: (technicalName: string, fallback?: string) => string;
  /** Resolve within a specific entity_type group ('table' | 'column' | 'interaction_category'). */
  label: (entityType: string, technicalName: string, fallback?: string) => string;
}

const LocalizationContext = createContext<LocalizationContextValue | undefined>(
  undefined,
);

export function LocalizationProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<LocalizationMap>({});
  const [loading, setLoading] = useState(true);

  // Public endpoint — fetched at boot, before login.
  useEffect(() => {
    apiFetch<LocalizationMap>("/api/metadata/localization")
      .then(setData)
      .catch(() => setData({}))
      .finally(() => setLoading(false));
  }, []);

  const flat = useMemo(() => {
    const merged: Record<string, string> = {};
    for (const group of Object.values(data)) Object.assign(merged, group);
    return merged;
  }, [data]);

  const value = useMemo<LocalizationContextValue>(
    () => ({
      loading,
      t: (name, fallback) => flat[name] ?? fallback ?? name,
      label: (entityType, name, fallback) =>
        data[entityType]?.[name] ?? fallback ?? name,
    }),
    [loading, flat, data],
  );

  return (
    <LocalizationContext.Provider value={value}>
      {children}
    </LocalizationContext.Provider>
  );
}

export function useLocalization(): LocalizationContextValue {
  const ctx = useContext(LocalizationContext);
  if (!ctx) {
    throw new Error("useLocalization must be used within a LocalizationProvider");
  }
  return ctx;
}
