"use client";

import type { CustomFieldType } from "@/lib/types";
import { DatePicker } from "./DatePicker";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

/** fixes35: the raw editor for one non-select custom field value — branches
 *  on `field_type` (select-type fields never reach here; they use
 *  PicklistSelect like every other picklist). Shared by every entity's CRUD
 *  form and the apartments/contacts list's inline-edit cells. */
export function CustomFieldValueInput({
  fieldType,
  value,
  onChange,
  className,
}: {
  fieldType: CustomFieldType;
  value: string | number | boolean | null;
  onChange: (value: string | number | boolean | null) => void;
  className?: string;
}) {
  const cls = className ?? inputClass;
  if (fieldType === "boolean") {
    return (
      <input
        type="checkbox"
        className="h-4 w-4 accent-status-magenta"
        checked={!!value}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  }
  if (fieldType === "number") {
    return (
      <input
        type="number"
        className={cls}
        value={value == null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      />
    );
  }
  if (fieldType === "date") {
    return (
      <DatePicker
        value={(value as string) ?? null}
        onChange={(v) => onChange(v)}
        className={cls}
      />
    );
  }
  // text
  return (
    <input
      className={cls}
      value={(value as string) ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
    />
  );
}

/** A read-only display of one custom field value, matching the editor's
 *  formatting per type (checkbox → ✓/—, everything else → the raw value). */
export function CustomFieldValueDisplay({
  fieldType,
  value,
}: {
  fieldType: CustomFieldType;
  value: string | number | boolean | null;
}) {
  if (fieldType === "boolean") return <>{value ? "✓" : "—"}</>;
  if (value == null || value === "") return <>—</>;
  return <>{String(value)}</>;
}
