"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useLocalization } from "@/lib/localization";
import { usePicklist } from "@/lib/picklists";
import type { Reminder, SignificantDate } from "@/lib/types";
import { useConfirm } from "@/lib/confirm";
import { DatePicker } from "./DatePicker";
import { PicklistSelect } from "./PicklistSelect";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

// Android-style "remind me …" presets (minutes before the date). Label via t().
const OFFSET_PRESETS: { value: number; key: string; he: string }[] = [
  { value: 0, key: "sd.offset_at", he: "בזמן האירוע" },
  { value: 60, key: "sd.offset_hour", he: "שעה לפני" },
  { value: 1440, key: "sd.offset_day", he: "יום לפני" },
  { value: 10080, key: "sd.offset_week", he: "שבוע לפני" },
];

interface DraftReminder {
  offset_minutes: number;
  remind_at_time: string; // "HH:MM"
}

interface Draft {
  special_date: string | null;
  hebrew_date: string;
  special_date_type: string | null;
  special_date_title: string | null;
  is_set_reminder: boolean;
  reminders: DraftReminder[];
}

function toDraft(sd?: SignificantDate): Draft {
  return {
    special_date: sd?.special_date ?? null,
    hebrew_date: sd?.hebrew_date ?? "",
    special_date_type: sd?.special_date_type ?? null,
    special_date_title: sd?.special_date_title ?? null,
    is_set_reminder: sd?.is_set_reminder ?? false,
    reminders: (sd?.reminders ?? []).map((r: Reminder) => ({
      offset_minutes: r.offset_minutes,
      remind_at_time: r.remind_at_time ?? "09:00",
    })),
  };
}

/** Live editor for a mekurav contact's significant dates + reminders. */
export function SignificantDatesEditor({ contactId }: { contactId: number }) {
  const { t } = useLocalization();
  const confirmDialog = useConfirm();
  const [dates, setDates] = useState<SignificantDate[]>([]);
  const [editing, setEditing] = useState<{ id: number | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const types = usePicklist("significant_date.type");

  async function reload() {
    setDates(
      await apiFetch<SignificantDate[]>(`/api/contacts/${contactId}/special-dates`),
    );
  }

  useEffect(() => {
    reload()
      .catch(() => setDates([]))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  async function remove(id: number) {
    if (!(await confirmDialog({ message: t("msg.delete_date_confirm", "למחוק תאריך זה?") }))) return;
    await apiFetch(`/api/contacts/${contactId}/special-dates/${id}`, {
      method: "DELETE",
    });
    await reload();
  }

  const editingDate =
    editing && editing.id != null ? dates.find((d) => d.id === editing.id) : undefined;

  if (loading) return <p className="text-sm text-gray-400">{t("action.loading", "טוען…")}</p>;

  return (
    <div className="space-y-3">
      {dates.map((d) => (
        <div
          key={d.id}
          className="flex flex-wrap items-center gap-2 rounded-md border border-gray-100 px-3 py-2"
        >
          <span className="font-medium" dir="ltr">
            {d.special_date ? new Date(d.special_date).toLocaleDateString("he-IL") : "—"}
          </span>
          <span className="text-sm text-gray-600">
            {types.labelFor(d.special_date_type)}
            {d.special_date_title ? ` · ${d.special_date_title}` : ""}
          </span>
          {d.hebrew_date && (
            <span className="text-sm text-gray-400">({d.hebrew_date})</span>
          )}
          {d.is_set_reminder && (
            <span className="rounded bg-status-orange/10 text-status-orange text-xs px-2 py-0.5">
              {d.reminders.length} {t("sd.reminders_count", "תזכורות")}
            </span>
          )}
          <div className="flex items-center gap-2 ms-auto">
            <button
              onClick={() => setEditing({ id: d.id })}
              className="text-sm text-status-magenta hover:underline"
            >
              {t("action.edit", "ערוך")}
            </button>
            <button
              onClick={() => remove(d.id)}
              className="text-sm text-status-darkred hover:underline"
            >
              {t("action.delete", "מחק")}
            </button>
          </div>
        </div>
      ))}
      {dates.length === 0 && !editing && (
        <p className="text-sm text-gray-400">{t("sd.none", "אין תאריכים חשובים.")}</p>
      )}

      {editing ? (
        <DateForm
          key={editing.id ?? "new"}
          initial={toDraft(editingDate)}
          onCancel={() => setEditing(null)}
          onSave={async (payload) => {
            if (editing.id != null) {
              await apiFetch(
                `/api/contacts/${contactId}/special-dates/${editing.id}`,
                { method: "PUT", body: JSON.stringify(payload) },
              );
            } else {
              await apiFetch(`/api/contacts/${contactId}/special-dates`, {
                method: "POST",
                body: JSON.stringify(payload),
              });
            }
            setEditing(null);
            await reload();
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing({ id: null })}
          className="text-sm text-status-magenta hover:underline"
        >
          + {t("sd.add_date", "הוסף תאריך חשוב")}
        </button>
      )}
    </div>
  );
}

function DateForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: Draft;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useLocalization();
  const [draft, setDraft] = useState<Draft>(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function set<K extends keyof Draft>(key: K, v: Draft[K]) {
    setDraft((prev) => ({ ...prev, [key]: v }));
  }

  function toggleReminder(on: boolean) {
    if (on && draft.reminders.length === 0) {
      set("reminders", [{ offset_minutes: 1440, remind_at_time: "09:00" }]);
    }
    set("is_set_reminder", on);
  }

  function setReminder(i: number, patch: Partial<DraftReminder>) {
    set(
      "reminders",
      draft.reminders.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    );
  }

  async function save() {
    setError("");
    if (!draft.special_date) {
      setError(t("sd.pick_date", "יש לבחור תאריך"));
      return;
    }
    setBusy(true);
    try {
      await onSave({
        special_date: draft.special_date,
        hebrew_date: draft.hebrew_date || null,
        special_date_type: draft.special_date_type,
        special_date_title: draft.special_date_title,
        is_set_reminder: draft.is_set_reminder,
        reminders: draft.is_set_reminder
          ? draft.reminders.map((r) => ({
              offset_minutes: r.offset_minutes,
              remind_at_time: r.remind_at_time || null,
              channel: "email",
            }))
          : [],
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
        <label className="block space-y-1">
          <span className="block text-sm font-medium">{t("significant_dates.special_date", "תאריך חשוב")}</span>
          <DatePicker
            value={draft.special_date}
            onChange={(v) => set("special_date", v)}
            withTime
            className={inputClass}
          />
        </label>
        <label className="block space-y-1">
          <span className="block text-sm font-medium">{t("significant_dates.hebrew_date", "תאריך עברי")}</span>
          <input
            className={inputClass}
            value={draft.hebrew_date}
            onChange={(e) => set("hebrew_date", e.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span className="block text-sm font-medium">{t("significant_dates.special_date_type", "סוג תאריך")}</span>
          <PicklistSelect
            fieldKey="significant_date.type"
            value={draft.special_date_type}
            onChange={(v) => set("special_date_type", v)}
          />
        </label>
        <label className="block space-y-1">
          <span className="block text-sm font-medium">{t("significant_dates.special_date_title", "כותרת")}</span>
          <input
            className={inputClass}
            value={draft.special_date_title ?? ""}
            onChange={(e) => set("special_date_title", e.target.value || null)}
          />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.is_set_reminder}
          onChange={(e) => toggleReminder(e.target.checked)}
        />
        {t("sd.send_reminder", "שלח תזכורת")}
      </label>

      {draft.is_set_reminder && (
        <div className="space-y-2 ps-1">
          {draft.reminders.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select
                className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                value={r.offset_minutes}
                onChange={(e) => setReminder(i, { offset_minutes: Number(e.target.value) })}
              >
                {OFFSET_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {t(p.key, p.he)}
                  </option>
                ))}
              </select>
              <input
                type="time"
                dir="ltr"
                className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                value={r.remind_at_time}
                onChange={(e) => setReminder(i, { remind_at_time: e.target.value })}
              />
              <span className="text-xs text-gray-400">{t("sd.email_channel", "אימייל")}</span>
              <button
                type="button"
                onClick={() =>
                  set(
                    "reminders",
                    draft.reminders.filter((_, idx) => idx !== i),
                  )
                }
                className="text-sm text-status-darkred hover:underline"
              >
                {t("action.remove", "הסר")}
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              set("reminders", [
                ...draft.reminders,
                { offset_minutes: 1440, remind_at_time: "09:00" },
              ])
            }
            className="text-sm text-status-magenta hover:underline"
          >
            + {t("sd.add_reminder", "הוסף תזכורת")}
          </button>
        </div>
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
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-gray-500 hover:underline"
        >
          {t("action.cancel", "ביטול")}
        </button>
      </div>
    </div>
  );
}
