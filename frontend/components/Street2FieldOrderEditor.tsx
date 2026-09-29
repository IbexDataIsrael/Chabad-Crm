"use client";

import { ChevronDown, ChevronUp, EyeOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useActiveCampaignFieldVisibility } from "@/lib/campaignFieldVisibility";
import { useCustomFieldDefs } from "@/lib/customFields";
import { useLocalization } from "@/lib/localization";
import { FIXED_APARTMENT_PICKLIST_KEYS } from "@/lib/picklists";
import type { PicklistField } from "@/lib/types";

/** street2's built-in apartment-card fields, in their default order — the
 *  same visibility keys street2's own FIELD_KEY map uses. */
const BUILTIN_FIELDS: [string, string, string][] = [
  ["apartments.name", "apartments.name", "שם דייר"],
  ["apartments.phone", "apartments.phone", "טלפון"],
  ["apartments.email", "apartments.email", "אימייל"],
  ["apartment.Jewish_status", "picklist.apartment.Jewish_status", "יהדות"],
  ["apartment.campaign_status", "picklist.apartment.campaign_status", "סטטוס קמפיין"],
  ["apartment.mezuzah_status", "picklist.apartment.mezuzah_status", "מזוזה"],
  ["apartment.language", "picklist.apartment.language", "שפה"],
  ["apartments.report_number_id", "apartments.report_number_id", "מספר דוח"],
  ["apartments.apartment_notes", "apartments.apartment_notes", "הערות"],
];

/** fixes74 §13: the admin orders every field of the activist's street2
 *  apartment card — built-in and additional fields alike. Order only:
 *  a field the active campaign hides is marked and stays hidden. ▲/▼ rather
 *  than drag (drag is unreliable on trackpads and phones). */
export function Street2FieldOrderEditor({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const { t, lang } = useLocalization();
  const { isVisible } = useActiveCampaignFieldVisibility();
  const customFieldDefs = useCustomFieldDefs("apartment");
  const [picklistDefs, setPicklistDefs] = useState<PicklistField[]>([]);

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

  const catalog = useMemo(() => {
    const out: { key: string; label: string }[] = BUILTIN_FIELDS.map(([key, labelKey, fallback]) => ({
      key,
      label: t(labelKey, fallback),
    }));
    for (const d of picklistDefs) {
      out.push({
        key: d.field_key,
        label: (lang === "en" ? d.english_label || d.label : d.label) || d.field_key,
      });
    }
    for (const d of customFieldDefs) {
      if (!d.is_active || d.field_type === "select" || d.field_key === "to_knock") continue;
      out.push({
        key: `customfield.apartment.${d.field_key}`,
        label: (lang === "en" ? d.english_label || d.hebrew_label : d.hebrew_label) || d.field_key,
      });
    }
    return out;
  }, [t, lang, picklistDefs, customFieldDefs]);

  // Saved order first, then any field it doesn't mention (new fields) in
  // the default order — exactly how street2 applies it.
  const ordered = useMemo(() => {
    const byKey = new Map(catalog.map((c) => [c.key, c]));
    const seen = new Set<string>();
    const out: { key: string; label: string }[] = [];
    for (const k of value) {
      const c = byKey.get(k);
      if (c && !seen.has(k)) {
        out.push(c);
        seen.add(k);
      }
    }
    for (const c of catalog) if (!seen.has(c.key)) out.push(c);
    return out;
  }, [catalog, value]);

  function move(index: number, dir: -1 | 1) {
    const keys = ordered.map((c) => c.key);
    const j = index + dir;
    if (j < 0 || j >= keys.length) return;
    [keys[index], keys[j]] = [keys[j], keys[index]];
    onChange(keys);
  }

  return (
    <ol className="divide-y divide-border rounded-md border border-border">
      {ordered.map((c, i) => {
        const hidden = !isVisible(c.key);
        return (
          <li key={c.key} className="flex items-center gap-2 px-3 py-1.5 text-sm">
            <span className="w-6 text-muted-foreground tabular-nums">{i + 1}.</span>
            <span className={`flex-1 ${hidden ? "text-muted-foreground" : ""}`}>{c.label}</span>
            {hidden && (
              <span
                className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                title={t("shliach_config.field_hidden_hint", "מוסתר בקמפיין הפעיל — לא יוצג לפעילים")}
              >
                <EyeOff className="h-3.5 w-3.5" /> {t("shliach_config.field_hidden", "מוסתר")}
              </span>
            )}
            <button
              type="button"
              disabled={i === 0}
              onClick={() => move(i, -1)}
              aria-label={t("action.move_up", "העלה")}
              title={t("action.move_up", "העלה")}
              className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-primary disabled:opacity-20"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={i === ordered.length - 1}
              onClick={() => move(i, 1)}
              aria-label={t("action.move_down", "הורד")}
              title={t("action.move_down", "הורד")}
              className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-primary disabled:opacity-20"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </li>
        );
      })}
    </ol>
  );
}
