"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useCustomFieldDefs } from "@/lib/customFields";
import { useFieldSettings } from "@/lib/fieldSettings";
import { useLocalization } from "@/lib/localization";
import { usePicklist } from "@/lib/picklists";
import {
  contactFullName,
  type Contact,
  type ContactCustomField,
  type CustomFieldDefinition,
  type CustomFieldValueMap,
  type Visit,
  type VisitInteraction,
} from "@/lib/types";
import { CustomFieldsEditor } from "./CustomFieldsEditor";
import { CustomFieldValueInput } from "./CustomFieldValueInput";
import { DatePicker } from "./DatePicker";
import { PicklistSelect } from "./PicklistSelect";
import { SearchableSelect } from "./SearchableSelect";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

const inputClass =
  "w-full rounded-md border border-input px-3 py-2 text-sm focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

export interface VisitPayload {
  contact_id: number | null;
  visit_date: string;
  visit_type: string | null;
  location: string | null;
  notes: string | null;
  // fixes25: visit-level engagement data.
  interactions: VisitInteraction[];
  torah_thought: string | null;
  // fixes39: this is also where connection_to_rebbe (field_type="text")
  // travels — the 5 boolean Mivtzoim flags go through the separate
  // /custom-fields sub-resource instead (see `customFields` state below).
  custom_field_values: CustomFieldValueMap;
  picklist_values: Record<string, string | null>;
}

/**
 * Shared visit form (add page + inline edit on the visits list + the contact
 * page's visit history). Contact is optional; pass `lockedContactId` to hide
 * the picker and pin the contact.
 *
 * fixes25: the form is the visit-logging workflow — it carries the Mivtzoim
 * flags, the torah thought, the connection-to-the-Rebbe note, an interactions
 * log and the org's custom fields (values stored per visit). `onSave` must
 * return the saved visit so the custom-field values can be written against
 * its id; `onDone` fires after everything (including those values) is saved.
 */
export function VisitForm({
  initial,
  contacts,
  lockedContactId,
  onSave,
  onDone,
  onCancel,
}: {
  initial?: Visit;
  contacts: Contact[];
  lockedContactId?: number;
  onSave: (payload: VisitPayload) => Promise<Visit>;
  onDone?: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useLocalization();
  // fixes27 §4: admins can hide individual visit fields (visits.* toggles).
  const { isFieldVisible: vis } = useFieldSettings();
  const [contactSel, setContactSel] = useState<number | "">(
    lockedContactId ?? initial?.contact_id ?? "",
  );
  const [date, setDate] = useState<string | null>(initial?.visit_date ?? null);
  const [type, setType] = useState<string | null>(initial?.visit_type ?? null);
  const [location, setLocation] = useState(initial?.location ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [torahThought, setTorahThought] = useState<string | null>(
    initial?.torah_thought ?? null,
  );
  const [interactions, setInteractions] = useState<VisitInteraction[]>(
    initial?.interactions ?? [],
  );
  const [customFields, setCustomFields] = useState<ContactCustomField[]>([]);
  // fixes35: any non-boolean, non-select visit custom field — boolean stays
  // exclusively on the legacy CustomFieldsEditor checkbox+note path above.
  const visitCustomFieldDefs = useCustomFieldDefs("visit").filter(
    (d) => d.field_type !== "select" && d.field_type !== "boolean",
  );
  const [customFieldValues, setCustomFieldValues] = useState<CustomFieldValueMap>(
    initial?.custom_field_values ?? {},
  );
  // fixes35 §5: any admin-added visit-scoped select custom field — its
  // options/value ride the existing checklist.* picklist convention, exactly
  // like visit.type/checklist.torah_thought (no generic loop existed for
  // visits before this round — see Visit.picklist_values).
  const visitPicklistDefs = useCustomFieldDefs("visit").filter((d) => d.field_type === "select");
  const [picklistValues, setPicklistValues] = useState<Record<string, string | null>>(
    initial?.picklist_values ?? {},
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Custom fields: an existing visit loads its stored values; a new one loads
  // the org's definitions with empty values.
  useEffect(() => {
    let active = true;
    async function load() {
      if (initial?.id) {
        const values = await apiFetch<ContactCustomField[]>(
          `/api/visits/${initial.id}/custom-fields`,
        );
        if (active) setCustomFields(values);
      } else {
        // fixes35: /api/custom-fields now spans every entity_type — this is
        // the legacy boolean+note contract specifically, so scope it exactly
        // like the backend's own /api/visits/{id}/custom-fields does.
        const defs = await apiFetch<CustomFieldDefinition[]>(
          "/api/custom-fields?entity_type=visit",
        );
        if (active) {
          setCustomFields(
            defs
              .filter((d) => d.field_type === "boolean")
              .map((d) => ({
                definition_id: d.id,
                field_key: d.field_key,
                hebrew_label: d.hebrew_label,
                checked: false,
                note: null,
              })),
          );
        }
      }
    }
    load().catch(() => {});
    return () => {
      active = false;
    };
  }, [initial?.id]);

  async function save() {
    setError("");
    if (!date) {
      setError(t("visit.pick_date", "יש לבחור תאריך"));
      return;
    }
    setBusy(true);
    try {
      const visit = await onSave({
        contact_id: lockedContactId ?? (contactSel === "" ? null : Number(contactSel)),
        visit_date: date,
        visit_type: type,
        location: location || null,
        notes: notes || null,
        interactions,
        torah_thought: torahThought,
        custom_field_values: customFieldValues,
        picklist_values: picklistValues,
      });
      if (customFields.length > 0 && visit?.id) {
        await apiFetch(`/api/visits/${visit.id}/custom-fields`, {
          method: "PUT",
          body: JSON.stringify(
            customFields.map((c) => ({
              definition_id: c.definition_id,
              checked: c.checked,
              note: c.note,
            })),
          ),
        });
      }
      await onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-border p-3 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {lockedContactId === undefined && (
          <div className="space-y-1">
            <Label>{t("visit.contact", "איש קשר")}</Label>
            <SearchableSelect
              value={contactSel === "" ? null : contactSel}
              onChange={(id) => setContactSel(id ?? "")}
              options={contacts.map((c) => ({ id: c.id, label: contactFullName(c) }))}
              placeholder={t("visit.no_contact", "ללא איש קשר")}
            />
          </div>
        )}
        <div className="space-y-1">
          <Label>{t("visit.date", "תאריך")}</Label>
          <DatePicker value={date} onChange={setDate} className={inputClass} />
        </div>
        {vis("visits.visit_type") && (
          <div className="space-y-1">
            <Label>{t("visit.type", "סוג ביקור")}</Label>
            <PicklistSelect fieldKey="visit.type" value={type} onChange={setType} />
          </div>
        )}
        {vis("visits.location") && (
          <div className="space-y-1">
            <Label>{t("visit.location", "מיקום")}</Label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
        )}
        <div className="space-y-1 sm:col-span-2">
          <Label>{t("visit.notes", "הערות")}</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      {/* fixes25 §4: Mivtzoim flags logged on the visit. fixes27 §2/§4: the
          custom fields live inside this section (no separate heading), and
          every field honors its admin visibility toggle. */}
      {(() => {
        // fixes39: the Mivtzoim boolean flags render via `customFields`
        // below (the legacy checkbox+note sub-resource — they're ordinary
        // entity_type="visit" boolean custom fields now) and
        // connection_to_rebbe renders via `visitCustomFieldDefs` below (a
        // field_type="text" custom field) — neither has dedicated markup
        // here anymore.
        const showTorah = vis("visits.torah_thought");
        if (
          !showTorah &&
          customFields.length === 0 &&
          visitCustomFieldDefs.length === 0 &&
          visitPicklistDefs.length === 0
        ) {
          return null;
        }
        return (
          <section className="space-y-2 border-t border-border pt-3">
            <h4 className="text-sm font-semibold">{t("visits.mivtzoim", "מבצעים")}</h4>
            {showTorah && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>{t("visits.torah_thought", "דבר תורה")}</Label>
                  <PicklistSelect
                    fieldKey="checklist.torah_thought"
                    value={torahThought}
                    onChange={setTorahThought}
                  />
                </div>
              </div>
            )}
            {customFields.length > 0 && (
              <CustomFieldsEditor items={customFields} onChange={setCustomFields} />
            )}
            {/* fixes35 §5: any admin-added visit-scoped select custom field. */}
            {visitPicklistDefs.map((d) => (
              <div key={d.field_key} className="space-y-1">
                <Label>{d.hebrew_label}</Label>
                <PicklistSelect
                  fieldKey={`checklist.${d.field_key}`}
                  value={picklistValues[`checklist.${d.field_key}`] ?? null}
                  onChange={(v) =>
                    setPicklistValues((prev) => ({
                      ...prev,
                      [`checklist.${d.field_key}`]: v,
                    }))
                  }
                />
              </div>
            ))}
            {/* fixes35: any non-boolean, non-select visit custom field. */}
            {visitCustomFieldDefs.map((d) => (
              <div key={d.field_key} className="space-y-1">
                <Label>{d.hebrew_label}</Label>
                <CustomFieldValueInput
                  fieldType={d.field_type}
                  value={customFieldValues[d.field_key] ?? null}
                  onChange={(v) =>
                    setCustomFieldValues((prev) => ({ ...prev, [d.field_key]: v }))
                  }
                />
              </div>
            ))}
          </section>
        );
      })()}

      {/* fixes25 §4: the interaction log lives on the visit. */}
      <InteractionsFields value={interactions} onChange={setInteractions} />

      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="button" onClick={save} disabled={busy}>
          {busy ? t("action.saving", "שומר…") : t("action.save", "שמור")}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("action.cancel", "ביטול")}
        </Button>
      </div>
    </div>
  );
}

/** Controlled editor for the visit's interaction log (fixes25 — the standalone
 *  contact timeline is gone; entries ride on the visit payload). fixes26:
 *  exported for the visit details card; `readOnly` renders the list only. */
export function InteractionsFields({
  value,
  onChange,
  readOnly = false,
}: {
  value: VisitInteraction[];
  onChange: (items: VisitInteraction[]) => void;
  readOnly?: boolean;
}) {
  const { t } = useLocalization();
  const { labelFor } = usePicklist("interaction.category");
  const [category, setCategory] = useState<string | null>(null);
  const [note, setNote] = useState("");

  function add() {
    if (!category || !note.trim()) return;
    onChange([...value, { category, note: note.trim() }]);
    setCategory(null);
    setNote("");
  }

  return (
    <section className="space-y-2 border-t border-border pt-3">
      <h4 className="text-sm font-semibold">{t("visits.interactions", "אינטראקציות")}</h4>
      {value.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("visits.no_interactions", "אין אינטראקציות עדיין.")}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {value.map((it, i) => (
            <li
              key={`${it.category}-${i}`}
              className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2"
            >
              <div>
                <Badge variant="secondary" className="me-2">
                  {labelFor(it.category)}
                </Badge>
                <span className="text-sm whitespace-pre-wrap">{it.note}</span>
                {it.author_name && (
                  <span className="ms-2 text-xs text-muted-foreground">— {it.author_name}</span>
                )}
              </div>
              {!readOnly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  title={t("action.delete", "מחק")}
                  aria-label={t("action.delete", "מחק")}
                  className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                  onClick={() => onChange(value.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {readOnly ? null : (
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="sm:w-48">
          <PicklistSelect
            fieldKey="interaction.category"
            value={category}
            onChange={setCategory}
            emptyLabel={t("visits.interaction_category_ph", "קטגוריה…")}
          />
        </div>
        <Input
          className="flex-1"
          placeholder={t("visits.interaction_note_ph", "הוסף הערה…")}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={add} disabled={!category || !note.trim()}>
          <Plus className="h-4 w-4" /> {t("visits.add_interaction", "הוסף")}
        </Button>
      </div>
      )}
    </section>
  );
}
