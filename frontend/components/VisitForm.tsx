"use client";

import { useState } from "react";

import { useLocalization } from "@/lib/localization";
import { contactFullName, type Contact, type Visit } from "@/lib/types";
import { DatePicker } from "./DatePicker";
import { PicklistSelect } from "./PicklistSelect";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

export interface VisitPayload {
  contact_id: number | null;
  visit_date: string;
  visit_type: string | null;
  location: string | null;
  notes: string | null;
}

/**
 * Shared visit form (add page + inline edit on the visits list). Contact is
 * optional; pass `lockedContactId` to hide the picker and pin the contact.
 */
export function VisitForm({
  initial,
  contacts,
  lockedContactId,
  onSave,
  onCancel,
}: {
  initial?: Visit;
  contacts: Contact[];
  lockedContactId?: number;
  onSave: (payload: VisitPayload) => Promise<void>;
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setError("");
    if (!date) {
      setError(t("visit.pick_date", "יש לבחור תאריך"));
      return;
    }
    setBusy(true);
    try {
      await onSave({
        contact_id: lockedContactId ?? (contactSel === "" ? null : Number(contactSel)),
        visit_date: date,
        visit_type: type,
        location: location || null,
        notes: notes || null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-gray-200 p-3 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {lockedContactId === undefined && (
          <label className="block space-y-1">
            <span className="block text-sm font-medium">{t("visit.contact", "איש קשר")}</span>
            <select
              className={inputClass}
              value={contactSel}
              onChange={(e) => setContactSel(e.target.value === "" ? "" : Number(e.target.value))}
            >
              <option value="">{t("visit.no_contact", "ללא איש קשר")}</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {contactFullName(c)}
                </option>
              ))}
            </select>
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
