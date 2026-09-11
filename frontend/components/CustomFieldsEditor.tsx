"use client";

import { COLOR_HEX } from "@/lib/colors";
import { useLocalization } from "@/lib/localization";
import type { ContactCustomField } from "@/lib/types";
import { Input } from "@/components/ui/input";

// fixes44 §3: Mivtzoim items cycle through the app's 5 status colors (no
// per-item color is stored anywhere — these are CustomFieldDefinition rows,
// not picklist values) so each label reads as its own colored tag/badge.
const BADGE_COLOR_KEYS = ["magenta", "green", "yellow", "darkred", "orange"] as const;
// fixes61 §1: a checked item drops its own badge color in favor of one
// consistent, vibrant accent — the point is to make "what was done on this
// visit" jump out, which matters more once checked than which category it
// originally was.
const CHECKED_HEX = "#e6007a";

/** Controlled editor for the org's custom checklist fields (boolean + note each). */
export function CustomFieldsEditor({
  items,
  onChange,
}: {
  items: ContactCustomField[];
  onChange: (items: ContactCustomField[]) => void;
}) {
  const { t } = useLocalization();
  function update(definitionId: number, patch: Partial<ContactCustomField>) {
    onChange(
      items.map((it) => (it.definition_id === definitionId ? { ...it, ...patch } : it)),
    );
  }

  if (items.length === 0) return null;

  // fixes61 §1: checked items float to the top so what was actually
  // accomplished on the visit reads at a glance; unchecked items keep their
  // original (definition) order below. Index is captured before sorting so
  // each item keeps the same badge color it had in the unsorted list.
  const ordered = items
    .map((it, i) => ({ it, colorIndex: i }))
    .sort((a, b) => Number(b.it.checked) - Number(a.it.checked));

  return (
    <div className="space-y-3">
      {ordered.map(({ it, colorIndex }) => {
        const hex = it.checked
          ? CHECKED_HEX
          : COLOR_HEX[BADGE_COLOR_KEYS[colorIndex % BADGE_COLOR_KEYS.length]];
        return (
          <div
            key={it.definition_id}
            className="flex flex-col sm:flex-row sm:items-center gap-2"
          >
            {/* fixes44 §3: an explicit checkbox (was a whole-button name
                click) with the label styled as a colored tag/badge.
                fixes61 §1: checked = bolder, larger, vibrant-pink fill. */}
            <label
              className={`flex items-center gap-2 rounded-full border cursor-pointer sm:w-48 ${
                it.checked ? "px-3.5 py-2 text-base" : "px-3 py-1.5 text-sm"
              }`}
              style={{
                borderColor: hex,
                borderWidth: it.checked ? 2 : 1,
                backgroundColor: it.checked ? `${hex}33` : `${hex}0d`,
                color: hex,
              }}
            >
              <input
                type="checkbox"
                checked={it.checked}
                onChange={(e) => update(it.definition_id, { checked: e.target.checked })}
                style={{ accentColor: hex }}
              />
              <span className={`truncate ${it.checked ? "font-bold" : "font-medium"}`}>
                {it.hebrew_label}
              </span>
            </label>
            <Input
              className="flex-1"
              placeholder={t("field.note_placeholder", "הערה…")}
              value={it.note ?? ""}
              onChange={(e) => update(it.definition_id, { note: e.target.value || null })}
            />
          </div>
        );
      })}
    </div>
  );
}
