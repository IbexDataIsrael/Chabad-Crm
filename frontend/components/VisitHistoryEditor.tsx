"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useLocalization } from "@/lib/localization";
import { usePicklist } from "@/lib/picklists";
import type { Visit } from "@/lib/types";
import { VisitForm } from "./VisitForm";

/** Per-contact visit history (date, type, location, notes), newest first. */
export function VisitHistoryEditor({ contactId }: { contactId: number }) {
  const { t } = useLocalization();
  const { labelFor } = usePicklist("visit.type");
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ id: number | null } | null>(null);

  async function reload() {
    setVisits(await apiFetch<Visit[]>(`/api/contacts/${contactId}/visits`));
  }

  useEffect(() => {
    reload()
      .catch(() => setVisits([]))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  async function remove(id: number) {
    if (!confirm(t("visit.delete_confirm", "למחוק ביקור זה?"))) return;
    await apiFetch(`/api/contacts/${contactId}/visits/${id}`, { method: "DELETE" });
    await reload();
  }

  const editingVisit =
    editing && editing.id != null ? visits.find((v) => v.id === editing.id) : undefined;

  if (loading) return <p className="text-sm text-gray-400">{t("action.loading", "טוען…")}</p>;

  return (
    <div className="space-y-3">
      {visits.map((v) => (
        <div
          key={v.id}
          className="flex flex-wrap items-center gap-2 rounded-md border border-gray-100 px-3 py-2"
        >
          <span className="font-medium" dir="ltr">
            {new Date(v.visit_date).toLocaleDateString("he-IL")}
          </span>
          {v.visit_type && (
            <span className="rounded bg-gray-100 text-gray-600 text-xs px-2 py-0.5">
              {labelFor(v.visit_type)}
            </span>
          )}
          {v.location && <span className="text-sm text-gray-500">📍 {v.location}</span>}
          {v.notes && <span className="text-sm text-gray-600">— {v.notes}</span>}
          <div className="flex items-center gap-2 ms-auto">
            <button
              onClick={() => setEditing({ id: v.id })}
              className="text-sm text-status-magenta hover:underline"
            >
              {t("action.edit", "ערוך")}
            </button>
            <button
              onClick={() => remove(v.id)}
              className="text-sm text-status-darkred hover:underline"
            >
              {t("action.delete", "מחק")}
            </button>
          </div>
        </div>
      ))}
      {visits.length === 0 && !editing && (
        <p className="text-sm text-gray-400">{t("visit.none", "אין ביקורים עדיין.")}</p>
      )}

      {editing ? (
        <VisitForm
          key={editing.id ?? "new"}
          initial={editingVisit}
          contacts={[]}
          lockedContactId={contactId}
          onCancel={() => setEditing(null)}
          onSave={async (payload) => {
            if (editing.id != null) {
              await apiFetch(`/api/contacts/${contactId}/visits/${editing.id}`, {
                method: "PUT",
                body: JSON.stringify(payload),
              });
            } else {
              await apiFetch(`/api/contacts/${contactId}/visits`, {
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
          + {t("visit.add", "הוסף ביקור")}
        </button>
      )}
    </div>
  );
}
