"use client";

import { useSyncExternalStore } from "react";

/** fixes69 §Admin3c/3d/3e: which task-sheet PDF columns print, in what order,
 *  and how wide each one is — a fresh, task-sheet-only config (not shared
 *  with /dashboard/reports/create's own, larger column panel), persisted per
 *  device like every other list/report layout choice in the app. */
export const TASK_SHEET_FIELD_KEYS = [
  "floor",
  "apartment_name",
  "name",
  "jewish_status",
  "mezuzah_status",
  "language",
  "notes",
] as const;

export type TaskSheetFieldKey = (typeof TASK_SHEET_FIELD_KEYS)[number];

export interface TaskSheetFieldsConfig {
  columns: TaskSheetFieldKey[];
  widths: Record<string, number>;
}

export const DEFAULT_TASK_SHEET_FIELDS: TaskSheetFieldsConfig = {
  columns: [...TASK_SHEET_FIELD_KEYS],
  widths: {
    floor: 8,
    apartment_name: 10,
    name: 16,
    jewish_status: 14,
    mezuzah_status: 10,
    language: 10,
    notes: 32,
  },
};

type Translate = (key: string, fallback: string) => string;

/** Same translation keys the PDF's column head and reports/create's own
 *  columns already use — one label per field, kept in sync across both. */
export function taskSheetFieldLabel(key: TaskSheetFieldKey, t: Translate): string {
  switch (key) {
    case "floor":
      return t("reports.floor", "קומה");
    case "apartment_name":
      return t("reports.apartment_name", "מספר דירה");
    case "name":
      return t("apartments.name", "שם דייר");
    case "jewish_status":
      return t("reports.jewish_status", "מצב יהדות");
    case "mezuzah_status":
      return t("reports.mezuzah_status", "מזוזה");
    case "language":
      return t("reports.language", "שפה");
    case "notes":
      return t("reports.apartment_notes", "הערות");
  }
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

const VALID_KEYS = new Set<string>(TASK_SHEET_FIELD_KEYS);

function readStore(): TaskSheetFieldsConfig {
  if (cached) return cached;
  if (typeof window === "undefined") return DEFAULT_TASK_SHEET_FIELDS;
  let resolved = DEFAULT_TASK_SHEET_FIELDS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = { ...DEFAULT_TASK_SHEET_FIELDS, ...JSON.parse(raw) };
      // Defense in depth: a column key that isn't one of the 7 known ones
      // (leftover from a future rename, or corrupted storage) would fall
      // through generateTaskPdf's switch with no matching case, pushing
      // `undefined` into the PDF's table body and crashing autotable's
      // layout ("Cannot read properties of undefined") instead of just
      // skipping that one column.
      const columns = Array.isArray(parsed.columns)
        ? parsed.columns.filter((k: unknown): k is TaskSheetFieldKey => VALID_KEYS.has(k as string))
        : DEFAULT_TASK_SHEET_FIELDS.columns;
      resolved = { ...parsed, columns: columns.length > 0 ? columns : DEFAULT_TASK_SHEET_FIELDS.columns };
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

export function useTaskSheetFields(): [
  TaskSheetFieldsConfig,
  (updater: TaskSheetFieldsConfig | ((prev: TaskSheetFieldsConfig) => TaskSheetFieldsConfig)) => void,
] {
  const value = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    readStore,
    () => DEFAULT_TASK_SHEET_FIELDS,
  );
  const setValue = (
    updater: TaskSheetFieldsConfig | ((prev: TaskSheetFieldsConfig) => TaskSheetFieldsConfig),
  ) => {
    const next = typeof updater === "function" ? updater(readStore()) : updater;
    writeStore(next);
  };
  return [value, setValue];
}
