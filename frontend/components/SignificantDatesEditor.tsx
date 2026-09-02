"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useLocalization } from "@/lib/localization";
import { usePicklist } from "@/lib/picklists";
import type { Reminder, SignificantDate } from "@/lib/types";
import { useConfirm } from "@/lib/confirm";
import { DatePicker } from "./DatePicker";
import { PicklistSelect } from "./PicklistSelect";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

const inputClass =
  "w-full rounded-md border border-input px-3 py-2 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

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

  if (loading) return <p className="text-sm text-muted-foreground">{t("action.loading", "טוען…")}</p>;

  return (
    <div className="space-y-3">
      {dates.map((d) => (
        <div
          key={d.id}
          className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2"
        >
          <span className="font-medium" dir="ltr">
            {d.special_date ? new Date(d.special_date).toLocaleDateString("he-IL") : "—"}
          </span>
          <span className="text-sm text-muted-foreground">
            {types.labelFor(d.special_date_type)}
            {d.special_date_title ? ` · ${d.special_date_title}` : ""}
          </span>
          {d.hebrew_date && (
            <span className="text-sm text-muted-foreground">({d.hebrew_date})</span>
          )}
          {d.is_set_reminder && (
            <Badge variant="status-orange">
              {d.reminders.length} {t("sd.reminders_count", "תזכורות")}
            </Badge>
          )}
          <div className="flex items-center gap-2 ms-auto">
            <Button
              variant="ghost"
              size="icon"
              title={t("action.edit", "ערוך")}
              aria-label={t("action.edit", "ערוך")}
              className="h-8 w-8 text-primary hover:text-primary"
              onClick={() => setEditing({ id: d.id })}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title={t("action.delete", "מחק")}
              aria-label={t("action.delete", "מחק")}
              className="h-8 w-8 text-destructive hover:text-destructive"
              onClick={() => remove(d.id)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}
      {dates.length === 0 && !editing && (
        <p className="text-sm text-muted-foreground">{t("sd.none", "אין תאריכים חשובים.")}</p>
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
        <Button type="button" variant="outline" size="sm" onClick={() => setEditing({ id: null })}>
          <Plus className="h-4 w-4" /> {t("sd.add_date", "הוסף תאריך חשוב")}
        </Button>
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
    <div className="rounded-md border border-border p-3 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>{t("significant_dates.special_date", "תאריך חשוב")}</Label>
          <DatePicker
            value={draft.special_date}
            onChange={(v) => set("special_date", v)}
            withTime
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <Label>{t("significant_dates.hebrew_date", "תאריך עברי")}</Label>
          <Input value={draft.hebrew_date} onChange={(e) => set("hebrew_date", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>{t("significant_dates.special_date_type", "סוג תאריך")}</Label>
          <PicklistSelect
            fieldKey="significant_date.type"
            value={draft.special_date_type}
            onChange={(v) => set("special_date_type", v)}
          />
        </div>
        <div className="space-y-1">
          <Label>{t("significant_dates.special_date_title", "כותרת")}</Label>
          <Input
            value={draft.special_date_title ?? ""}
            onChange={(e) => set("special_date_title", e.target.value || null)}
          />
        </div>
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
                className="rounded-md border border-input px-2 py-1 text-sm"
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
                className="rounded-md border border-input px-2 py-1 text-sm"
                value={r.remind_at_time}
                onChange={(e) => setReminder(i, { remind_at_time: e.target.value })}
              />
              <span className="text-xs text-muted-foreground">{t("sd.email_channel", "אימייל")}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title={t("action.remove", "הסר")}
                aria-label={t("action.remove", "הסר")}
                className="h-7 w-7 text-destructive hover:text-destructive"
                onClick={() =>
                  set(
                    "reminders",
                    draft.reminders.filter((_, idx) => idx !== i),
                  )
                }
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="link"
            className="h-auto p-0"
            onClick={() =>
              set("reminders", [
                ...draft.reminders,
                { offset_minutes: 1440, remind_at_time: "09:00" },
              ])
            }
          >
            <Plus className="h-4 w-4" /> {t("sd.add_reminder", "הוסף תזכורת")}
          </Button>
        </div>
      )}

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
