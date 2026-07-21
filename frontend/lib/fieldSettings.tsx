"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { apiFetch } from "./api";
import { useAuth } from "./auth";

export interface FieldSetting {
  field_key: string;
  label_key: string;
  entity: string;
  is_visible: boolean;
  /** fixes33 §5.1: set only for a dynamic (admin-added custom picklist) row —
   * its own bilingual display name, since there's no field_localization row
   * for a per-org custom picklist's name. */
  label?: string | null;
  english_label?: string | null;
}

interface FieldSettingsContextValue {
  loading: boolean;
  settings: FieldSetting[];
  /** True unless the field has been explicitly hidden for this org. */
  isFieldVisible: (fieldKey: string) => boolean;
  refresh: () => Promise<void>;
}

const FieldSettingsContext = createContext<FieldSettingsContextValue | undefined>(
  undefined,
);

export function FieldSettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState<FieldSetting[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setSettings(await apiFetch<FieldSetting[]>("/api/field-settings"));
    } catch {
      setSettings([]); // on error, default everything visible
    } finally {
      setLoading(false);
    }
  }, []);

  // Field settings are per-org → load once a user is authenticated.
  useEffect(() => {
    if (!user) {
      setSettings([]);
      setLoading(false);
      return;
    }
    refresh();
  }, [user, refresh]);

  const value = useMemo<FieldSettingsContextValue>(() => {
    const hidden = new Set(
      settings.filter((s) => !s.is_visible).map((s) => s.field_key),
    );
    return {
      loading,
      settings,
      isFieldVisible: (key: string) => !hidden.has(key),
      refresh,
    };
  }, [settings, loading, refresh]);

  return (
    <FieldSettingsContext.Provider value={value}>
      {children}
    </FieldSettingsContext.Provider>
  );
}

export function useFieldSettings(): FieldSettingsContextValue {
  const ctx = useContext(FieldSettingsContext);
  if (!ctx) {
    throw new Error("useFieldSettings must be used within a FieldSettingsProvider");
  }
  return ctx;
}
