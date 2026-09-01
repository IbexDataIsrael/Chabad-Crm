"use client";

import { usePicklist } from "@/lib/picklists";

const baseClass =
  "w-full rounded-md border border-input px-3 py-2 focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

export function PicklistSelect({
  fieldKey,
  value,
  onChange,
  includeEmpty = true,
  emptyLabel = "—",
  id,
}: {
  fieldKey: string;
  value: string | null;
  onChange: (value: string | null) => void;
  includeEmpty?: boolean;
  emptyLabel?: string;
  id?: string;
}) {
  const { options, display } = usePicklist(fieldKey);

  return (
    <select
      id={id}
      className={baseClass}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
    >
      {includeEmpty && <option value="">{emptyLabel}</option>}
      {options.map((o) => (
        <option key={o.id} value={o.value}>
          {display(o)}
        </option>
      ))}
    </select>
  );
}
