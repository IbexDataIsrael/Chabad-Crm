"use client";

import { useLocalization } from "@/lib/localization";
import type { ContactCustomField } from "@/lib/types";

/** Controlled editor for the org's custom checklist fields (boolean + note each). */
export function CustomFieldsEditor({
  items,
  onChange,
}: {
  items: ContactCustomField[];
  onChange: (items: ContactCustomField[]) => void;
}) {
  const { t } = useLocalization();
  function update(index: number, patch: Partial<ContactCustomField>) {
    onChange(items.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  if (items.length === 0) return null;

  return (
    <div className="space-y-3">
      {items.map((it, i) => (
        <div
          key={it.definition_id}
          className="flex flex-col sm:flex-row sm:items-center gap-2"
        >
          <button
            type="button"
            onClick={() => update(i, { checked: !it.checked })}
            className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm sm:w-48 ${
              it.checked
                ? "border-status-green bg-status-green/10 text-status-green"
                : "border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            <span>{it.hebrew_label}</span>
            <span>{it.checked ? "✓" : ""}</span>
          </button>
          <input
            className="flex-1 rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none"
            placeholder={t("field.note_placeholder", "הערה…")}
            value={it.note ?? ""}
            onChange={(e) => update(i, { note: e.target.value || null })}
          />
        </div>
      ))}
    </div>
  );
}
