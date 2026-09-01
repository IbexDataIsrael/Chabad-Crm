"use client";

import { COLOR_HEX } from "@/lib/colors";
import { useLocalization } from "@/lib/localization";
import type { ContactCustomField } from "@/lib/types";
import { Input } from "@/components/ui/input";

// fixes44 §3: Mivtzoim items cycle through the app's 5 status colors (no
// per-item color is stored anywhere — these are CustomFieldDefinition rows,
// not picklist values) so each label reads as its own colored tag/badge.
const BADGE_COLOR_KEYS = ["magenta", "green", "yellow", "darkred", "orange"] as const;

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
      {items.map((it, i) => {
        const hex = COLOR_HEX[BADGE_COLOR_KEYS[i % BADGE_COLOR_KEYS.length]];
        return (
          <div
            key={it.definition_id}
            className="flex flex-col sm:flex-row sm:items-center gap-2"
          >
            {/* fixes44 §3: an explicit checkbox (was a whole-button name
                click) with the label styled as a colored tag/badge. */}
            <label
              className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm sm:w-48 cursor-pointer"
              style={{
                borderColor: hex,
                backgroundColor: it.checked ? `${hex}26` : `${hex}0d`,
                color: hex,
              }}
            >
              <input
                type="checkbox"
                checked={it.checked}
                onChange={(e) => update(i, { checked: e.target.checked })}
                style={{ accentColor: hex }}
              />
              <span className="truncate font-medium">{it.hebrew_label}</span>
            </label>
            <Input
              className="flex-1"
              placeholder={t("field.note_placeholder", "הערה…")}
              value={it.note ?? ""}
              onChange={(e) => update(i, { note: e.target.value || null })}
            />
          </div>
        );
      })}
    </div>
  );
}
