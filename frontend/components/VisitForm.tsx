"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useLocalization } from "@/lib/localization";
import { usePicklist } from "@/lib/picklists";
import {
  contactFullName,
  MIVTZOIM_FLAGS,
  type Contact,
  type ContactCustomField,
  type CustomFieldDefinition,
  type MivtzoimFlag,
  type Visit,
  type VisitInteraction,
} from "@/lib/types";
import { CustomFieldsEditor } from "./CustomFieldsEditor";
import { DatePicker } from "./DatePicker";
import { PicklistSelect } from "./PicklistSelect";
import { SearchableSelect } from "./SearchableSelect";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

export interface VisitPayload {
  contact_id: number | null;
  visit_date: string;
  visit_type: string | null;
  location: string | null;
  notes: string | null;
  // fixes25: visit-level engagement data.
  interactions: VisitInteraction[];
  tefillin: boolean;
  tzedakah: boolean;
  shabbat_candles: boolean;
  torah_pamphlet: boolean;
  letter_in_torah: boolean;
  torah_thought: string | null;
  connection_to_rebbe: string | null;
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
  const [contactSel, setContactSel] = useState<number | "">(
    lockedContactId ?? initial?.contact_id ?? "",
  );
  const [date, setDate] = useState<string | null>(initial?.visit_date ?? null);
  const [type, setType] = useState<string | null>(initial?.visit_type ?? null);
  const [location, setLocation] = useState(initial?.location ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  // fixes25: visit-level engagement data.
  const [flags, setFlags] = useState<Record<MivtzoimFlag, boolean>>({
    tefillin: initial?.tefillin ?? false,
    tzedakah: initial?.tzedakah ?? false,
    shabbat_candles: initial?.shabbat_candles ?? false,
    torah_pamphlet: initial?.torah_pamphlet ?? false,
    letter_in_torah: initial?.letter_in_torah ?? false,
  });
  const [torahThought, setTorahThought] = useState<string | null>(
    initial?.torah_thought ?? null,
  );
  const [rebbe, setRebbe] = useState(initial?.connection_to_rebbe ?? "");
  const [interactions, setInteractions] = useState<VisitInteraction[]>(
    initial?.interactions ?? [],
  );
  const [customFields, setCustomFields] = useState<ContactCustomField[]>([]);
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
        const defs = await apiFetch<CustomFieldDefinition[]>("/api/custom-fields");
        if (active) {
          setCustomFields(
            defs.map((d) => ({
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
        ...flags,
        torah_thought: torahThought,
        connection_to_rebbe: rebbe || null,
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
    <div className="rounded-md border border-gray-200 p-3 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {lockedContactId === undefined && (
          <label className="block space-y-1">
            <span className="block text-sm font-medium">{t("visit.contact", "איש קשר")}</span>
            <SearchableSelect
              value={contactSel === "" ? null : contactSel}
              onChange={(id) => setContactSel(id ?? "")}
              options={contacts.map((c) => ({ id: c.id, label: contactFullName(c) }))}
              placeholder={t("visit.no_contact", "ללא איש קשר")}
            />
          </label>
        )}
        <label className="block space-y-1">
          <span className="block text-sm font-medium">{t("visit.date", "תאריך")}</span>
          <DatePicker value={date} onChange={setDate} className={inputClass} />
        </label>
        <label className="block space-y-1">
          <span className="block text-sm font-medium">{t("visit.type", "סוג ביקור")}</span>
          <PicklistSelect fieldKey="visit.type" value={type} onChange={setType} />
        </label>
        <label className="block space-y-1">
          <span className="block text-sm font-medium">{t("visit.location", "מיקום")}</span>
          <input className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>
        <label className="block space-y-1 sm:col-span-2">
          <span className="block text-sm font-medium">{t("visit.notes", "הערות")}</span>
          <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>

      {/* fixes25 §4: Mivtzoim flags logged on the visit. */}
      <section className="space-y-2 border-t border-gray-100 pt-3">
        <h4 className="text-sm font-semibold">{t("visits.mivtzoim", "מבצעים")}</h4>
        <div className="flex flex-wrap gap-2">
          {MIVTZOIM_FLAGS.map((flag) => (
            <button
              key={flag}
              type="button"
              onClick={() => setFlags((prev) => ({ ...prev, [flag]: !prev[flag] }))}
              className={`flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm ${
                flags[flag]
                  ? "border-status-green bg-status-green/10 text-status-green"
                  : "border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              <span>{t(`visits.${flag}`)}</span>
              <span>{flags[flag] ? "✓" : ""}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="block text-sm font-medium">
              {t("visits.torah_thought", "דבר תורה")}
            </span>
            <PicklistSelect
              fieldKey="checklist.torah_thought"
              value={torahThought}
              onChange={setTorahThought}
            />
          </label>
          <label className="block space-y-1">
            <span className="block text-sm font-medium">
              {t("visits.connection_to_rebbe", "קשר לרבי")}
            </span>
            <textarea
              className={inputClass}
              rows={2}
              value={rebbe}
              onChange={(e) => setRebbe(e.target.value)}
            />
          </label>
        </div>
      </section>

      {/* fixes25 §4: the interaction log lives on the visit. */}
      <InteractionsFields value={interactions} onChange={setInteractions} />

      {customFields.length > 0 && (
        <section className="space-y-2 border-t border-gray-100 pt-3">
          <h4 className="text-sm font-semibold">{t("visits.extra_fields", "שדות נוספים")}</h4>
          <CustomFieldsEditor items={customFields} onChange={setCustomFields} />
        </section>
      )}

      {error && <p className="text-sm text-status-darkred">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-md bg-status-magenta text-white px-4 py-1.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {busy ? t("action.saving", "שומר…") : t("action.save", "שמור")}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-gray-500 hover:underline">
          {t("action.cancel", "ביטול")}
        </button>
      </div>
    </div>
  );
}

/** Controlled editor for the visit's interaction log (fixes25 — the standalone
 *  contact timeline is gone; entries ride on the visit payload). */
function InteractionsFields({
  value,
  onChange,
}: {
  value: VisitInteraction[];
  onChange: (items: VisitInteraction[]) => void;
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
    <section className="space-y-2 border-t border-gray-100 pt-3">
      <h4 className="text-sm font-semibold">{t("visits.interactions", "אינטראקציות")}</h4>
      {value.length === 0 ? (
        <p className="text-sm text-gray-400">
          {t("visits.no_interactions", "אין אינטראקציות עדיין.")}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {value.map((it, i) => (
            <li
              key={`${it.category}-${i}`}
              className="flex items-start justify-between gap-3 rounded-md border border-gray-100 px-3 py-2"
            >
              <div>
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600 me-2">
                  {labelFor(it.category)}
                </span>
                <span className="text-sm whitespace-pre-wrap">{it.note}</span>
                {it.author_name && (
                  <span className="ms-2 text-xs text-gray-400">— {it.author_name}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                className="text-xs text-status-darkred hover:underline shrink-0"
              >
                {t("action.delete", "מחק")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="sm:w-48">
          <PicklistSelect
            fieldKey="interaction.category"
            value={category}
            onChange={setCategory}
            emptyLabel={t("visits.interaction_category_ph", "קטגוריה…")}
          />
        </div>
        <input
          className={`${inputClass} flex-1`}
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
        <button
          type="button"
          onClick={add}
          disabled={!category || !note.trim()}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-40"
        >
          + {t("visits.add_interaction", "הוסף")}
        </button>
      </div>
    </section>
  );
}
