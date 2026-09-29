"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { apiFetch } from "@/lib/api";
import { useActiveCampaignFieldVisibility } from "@/lib/campaignFieldVisibility";
import { useCustomFieldDefs } from "@/lib/customFields";
import { useFieldSettings } from "@/lib/fieldSettings";
import { useLocalization } from "@/lib/localization";
import { FIXED_APARTMENT_PICKLIST_KEYS } from "@/lib/picklists";
import type { PicklistField } from "@/lib/types";

/** fixes69 §Admin3c/3d/3e: which task-sheet PDF columns print, in what order,
 *  and how wide each one is — a task-sheet-only config, persisted per device
 *  like every other list/report layout choice in the app.
 *
 *  fixes74 §9: no longer a fixed set of 7. Built-in apartment/report columns
 *  plus the org's custom apartment picklists (`picklist:<field_key>`) and
 *  custom fields (`custom:<field_key>`). A column the org hides (field
 *  settings) or the active campaign hides from activists never appears in
 *  the picker or on the sheet. */
export const BUILTIN_TASK_SHEET_KEYS = [
  "report_number",
  "building",
  "area",
  "floor",
  "apartment_name",
  "name",
  "phone",
  "email",
  "jewish_status",
  "mezuzah_status",
  "campaign_status",
  "language",
  "notes",
] as const;

export type BuiltinTaskSheetKey = (typeof BUILTIN_TASK_SHEET_KEYS)[number];
/** A built-in key, `picklist:<field_key>` or `custom:<field_key>`. */
export type TaskSheetFieldKey = string;

export interface TaskSheetFieldsConfig {
  columns: TaskSheetFieldKey[];
  widths: Record<string, number>;
}

export interface TaskSheetColumn {
  key: TaskSheetFieldKey;
  label: string;
}

/** The field-visibility key (field settings + campaign visibility) behind
 *  each built-in column. Building/area have no visibility switch. */
const VISIBILITY_KEY: Record<BuiltinTaskSheetKey, string | null> = {
  report_number: "apartments.report_number_id",
  building: null,
  area: null,
  floor: "apartments.floor",
  apartment_name: "apartments.apartment_name",
  name: "apartments.name",
  phone: "apartments.phone",
  email: "apartments.email",
  jewish_status: "apartment.Jewish_status",
  mezuzah_status: "apartment.mezuzah_status",
  campaign_status: "apartment.campaign_status",
  language: "apartment.language",
  notes: "apartments.apartment_notes",
};

export const DEFAULT_TASK_SHEET_FIELDS: TaskSheetFieldsConfig = {
  columns: ["floor", "apartment_name", "name", "jewish_status", "mezuzah_status", "language", "notes"],
  widths: {
    report_number: 8,
    building: 16,
    area: 10,
    floor: 8,
    apartment_name: 10,
    name: 16,
    phone: 12,
    email: 16,
    jewish_status: 14,
    mezuzah_status: 10,
    campaign_status: 12,
    language: 10,
    notes: 32,
  },
};

export const DEFAULT_COLUMN_WIDTH = 12;

type Translate = (key: string, fallback: string) => string;

/** Same translation keys the PDF's column head and reports/create's own
 *  columns already use — one label per field, kept in sync across both. */
function builtinLabel(key: BuiltinTaskSheetKey, t: Translate): string {
  switch (key) {
    case "report_number":
      return t("apartments.report_number_id", "מספר דוח");
    case "building":
      return t("reports.building", "בניין");
    case "area":
      return t("sort.area", "אזור");
    case "floor":
      return t("reports.floor", "קומה");
    case "apartment_name":
      return t("reports.apartment_name", "מספר דירה");
    case "name":
      return t("apartments.name", "שם דייר");
    case "phone":
      return t("apartments.phone", "טלפון");
    case "email":
      return t("apartments.email", "אימייל");
    case "jewish_status":
      return t("reports.jewish_status", "מצב יהדות");
    case "mezuzah_status":
      return t("reports.mezuzah_status", "מזוזה");
    case "campaign_status":
      return t("picklist.apartment.campaign_status", "סטטוס קמפיין");
    case "language":
      return t("reports.language", "שפה");
    case "notes":
      return t("reports.apartment_notes", "הערות");
  }
}

const BUILTIN_SET = new Set<string>(BUILTIN_TASK_SHEET_KEYS);

export function isBuiltinTaskSheetKey(key: string): key is BuiltinTaskSheetKey {
  return BUILTIN_SET.has(key);
}

function isKnownKeyShape(key: unknown): key is string {
  return (
    typeof key === "string" &&
    (BUILTIN_SET.has(key) || /^picklist:.+/.test(key) || /^custom:.+/.test(key))
  );
}

/** Every column this org may print, in catalog order, minus hidden ones —
 *  the picker's list and the PDF's allow-list. */
export function useTaskSheetCatalog(): { columns: TaskSheetColumn[]; ready: boolean } {
  const { t, lang } = useLocalization();
  const { isFieldVisible, loading: settingsLoading } = useFieldSettings();
  const { isVisible: campaignVisible, loading: campaignLoading } = useActiveCampaignFieldVisibility();
  const customFieldDefs = useCustomFieldDefs("apartment");
  const [picklistDefs, setPicklistDefs] = useState<PicklistField[] | null>(null);

  useEffect(() => {
    apiFetch<PicklistField[]>("/api/picklists")
      .then((defs) =>
        setPicklistDefs(
          defs.filter(
            (d) => d.entity_type === "apartment" && !FIXED_APARTMENT_PICKLIST_KEYS.includes(d.field_key),
          ),
        ),
      )
      .catch(() => setPicklistDefs([]));
  }, []);

  const columns = useMemo(() => {
    const shown = (visKey: string | null) =>
      visKey == null || (isFieldVisible(visKey) && campaignVisible(visKey));
    const out: TaskSheetColumn[] = BUILTIN_TASK_SHEET_KEYS.filter((k) => shown(VISIBILITY_KEY[k])).map(
      (k) => ({ key: k, label: builtinLabel(k, t) }),
    );
    for (const d of picklistDefs ?? []) {
      if (!shown(d.field_key)) continue;
      out.push({
        key: `picklist:${d.field_key}`,
        label: (lang === "en" ? d.english_label || d.label : d.label) || d.field_key,
      });
    }
    for (const d of customFieldDefs) {
      // to_knock is internal (fixes71 §C.3); select-type fields ride picklists.
      if (!d.is_active || d.field_type === "select" || d.field_key === "to_knock") continue;
      if (!shown(`customfield.apartment.${d.field_key}`)) continue;
      out.push({
        key: `custom:${d.field_key}`,
        label: (lang === "en" ? d.english_label || d.hebrew_label : d.hebrew_label) || d.field_key,
      });
    }
    return out;
    // campaignVisible/isFieldVisible are recreated per render; their inputs are the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, lang, picklistDefs, customFieldDefs, settingsLoading, campaignLoading]);

  return { columns, ready: picklistDefs !== null && !settingsLoading && !campaignLoading };
}

/** The columns that actually print: the saved selection, in its order,
 *  restricted to the catalog (a since-hidden field silently drops out). */
export function printableColumns(
  config: TaskSheetFieldsConfig,
  catalog: TaskSheetColumn[],
): TaskSheetColumn[] {
  const byKey = new Map(catalog.map((c) => [c.key, c]));
  const pick = (keys: string[]) => keys.map((k) => byKey.get(k)).filter((c): c is TaskSheetColumn => !!c);
  const chosen = pick(config.columns);
  return chosen.length > 0 ? chosen : pick(DEFAULT_TASK_SHEET_FIELDS.columns);
}

// A plain usePersistentState here would give the settings modal and every
// page that prints its own independent React state, each hydrated once from
// localStorage — the modal's edits would land in storage but never reach an
// already-mounted print button on the same page (only a full reload would
// pick them up, confirmed live: toggling a column off and printing without
// reloading still printed it). A module-level store + useSyncExternalStore
// (same pattern as lib/pageOrg.ts) makes every call site re-render on any
// other call site's change, in the same tab, without a reload.
const STORAGE_KEY = "crm.taskSheet.fields";
let cached: TaskSheetFieldsConfig | null = null;
const listeners = new Set<() => void>();

function readStore(): TaskSheetFieldsConfig {
  if (cached) return cached;
  if (typeof window === "undefined") return DEFAULT_TASK_SHEET_FIELDS;
  let resolved = DEFAULT_TASK_SHEET_FIELDS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Defense in depth: drop keys of an unknown shape (corrupted storage)
      // instead of letting them reach the PDF.
      const columns = Array.isArray(parsed.columns)
        ? parsed.columns.filter(isKnownKeyShape)
        : DEFAULT_TASK_SHEET_FIELDS.columns;
      resolved = {
        columns: columns.length > 0 ? columns : DEFAULT_TASK_SHEET_FIELDS.columns,
        widths: { ...DEFAULT_TASK_SHEET_FIELDS.widths, ...(parsed.widths ?? {}) },
      };
    }
  } catch {
    /* fall back to the default */
  }
  cached = resolved;
  return resolved;
}

function writeStore(next: TaskSheetFieldsConfig): void {
  cached = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable (privacy mode) — the state just won't persist */
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useTaskSheetFields(): [
  TaskSheetFieldsConfig,
  (updater: TaskSheetFieldsConfig | ((prev: TaskSheetFieldsConfig) => TaskSheetFieldsConfig)) => void,
] {
  const value = useSyncExternalStore(subscribe, readStore, () => DEFAULT_TASK_SHEET_FIELDS);
  const setValue = (
    updater: TaskSheetFieldsConfig | ((prev: TaskSheetFieldsConfig) => TaskSheetFieldsConfig),
  ) => {
    const next = typeof updater === "function" ? updater(readStore()) : updater;
    writeStore(next);
  };
  return [value, setValue];
}
