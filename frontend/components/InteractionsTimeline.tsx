"use client";

import { useEffect, useState, type FormEvent } from "react";

import { apiFetch } from "@/lib/api";
import { useLocalization } from "@/lib/localization";
import { usePicklist } from "@/lib/picklists";
import type { Interaction } from "@/lib/types";
import { PicklistSelect } from "./PicklistSelect";

export function InteractionsTimeline({ contactId }: { contactId: number }) {
  const { t } = useLocalization();
  const [items, setItems] = useState<Interaction[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const { labelFor } = usePicklist("interaction.category");

  async function load() {
    try {
      setItems(await apiFetch<Interaction[]>(`/api/interactions?contact_id=${contactId}`));
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!category || !note.trim()) return;
    setBusy(true);
    try {
      await apiFetch<Interaction>("/api/interactions", {
        method: "POST",
        body: JSON.stringify({ contact_id: contactId, category, note }),
      });
      setNote("");
      setCategory(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    await apiFetch(`/api/interactions/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="flex flex-col sm:flex-row gap-2">
        <div className="sm:w-48">
          <PicklistSelect
            fieldKey="interaction.category"
            value={category}
            onChange={setCategory}
            emptyLabel={t("int.category_placeholder", "קטגוריה…")}
          />
        </div>
        <input
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta"
          placeholder={t("int.add_note_placeholder", "הוסף הערה…")}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button
          type="submit"
          disabled={busy || !category || !note.trim()}
          className="rounded-md bg-status-magenta text-white px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {t("action.add", "הוסף")}
        </button>
      </form>

      {items.length === 0 ? (
        <p className="text-sm text-gray-400">{t("int.none", "אין אינטראקציות עדיין.")}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((it) =>
            editingId === it.id ? (
              <EditRow
                key={it.id}
                item={it}
                onDone={async () => {
                  setEditingId(null);
                  await load();
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <li
                key={it.id}
                className="rounded-md border border-gray-100 px-3 py-2 flex items-start justify-between gap-3"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                      {labelFor(it.category)}
                    </span>
                    <time className="text-xs text-gray-400">
                      {new Date(it.created_at).toLocaleString("he-IL")}
                    </time>
                  </div>
                  <p className="mt-1 text-sm whitespace-pre-wrap">{it.note}</p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <button
                    onClick={() => setEditingId(it.id)}
                    className="text-xs text-gray-500 hover:underline"
                  >
                    {t("action.edit", "עריכה")}
                  </button>
                  <button
                    onClick={() => remove(it.id)}
                    className="text-xs text-status-darkred hover:underline"
                  >
                    {t("action.delete", "מחק")}
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

function EditRow({
  item,
  onDone,
  onCancel,
}: {
  item: Interaction;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useLocalization();
  const [category, setCategory] = useState<string | null>(item.category);
  const [note, setNote] = useState(item.note);

  async function save() {
    await apiFetch(`/api/interactions/${item.id}`, {
      method: "PUT",
      body: JSON.stringify({ category, note }),
    });
    await onDone();
  }

  return (
    <li className="rounded-md border border-status-magenta/30 px-3 py-2 space-y-2">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="sm:w-48">
          <PicklistSelect
            fieldKey="interaction.category"
            value={category}
            onChange={setCategory}
            includeEmpty={false}
          />
        </div>
        <input
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={save}
          className="rounded-md bg-status-magenta text-white px-3 py-1 text-xs"
        >
          {t("action.save", "שמור")}
        </button>
        <button onClick={onCancel} className="text-xs text-gray-500 hover:underline">
          {t("action.cancel", "ביטול")}
        </button>
      </div>
    </li>
  );
}
