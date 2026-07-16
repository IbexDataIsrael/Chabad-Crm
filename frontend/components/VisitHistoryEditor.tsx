"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useLocalization } from "@/lib/localization";
import { usePicklist } from "@/lib/picklists";
import type { Visit } from "@/lib/types";
import { useConfirm } from "@/lib/confirm";
import { VisitDetails } from "./VisitDetails";
import { VisitForm } from "./VisitForm";

/** Per-contact visit history (date, type, location, notes), newest first.
 *  fixes28 §1: clicking a visit's title row expands it in place with
 *  Google-style inline per-field autosave (the separate "הצג"/"ערוך" links
 *  are gone — only "מחק" remains); creation still uses the visit form. */
export function VisitHistoryEditor({ contactId }: { contactId: number }) {
  const { t } = useLocalization();
  const confirmDialog = useConfirm();
  const { labelFor } = usePicklist("visit.type");
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

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
    if (!(await confirmDialog({ message: t("visit.delete_confirm", "למחוק ביקור זה?") }))) return;
    await apiFetch(`/api/contacts/${contactId}/visits/${id}`, { method: "DELETE" });
    await reload();
  }

  if (loading) return <p className="text-sm text-gray-400">{t("action.loading", "טוען…")}</p>;

  return (
    <div className="space-y-3">
      {visits.map((v) =>
        expandedId === v.id ? (
          <VisitDetails
            key={v.id}
            visit={v}
            onPatch={async (partial) => {
              await apiFetch<Visit>(`/api/contacts/${contactId}/visits/${v.id}`, {
                method: "PATCH",
                body: JSON.stringify(partial),
              });
              await reload();
            }}
            onClose={() => setExpandedId(null)}
          />
        ) : (
          <div
            key={v.id}
            onClick={() => setExpandedId(v.id)}
            className="flex flex-wrap items-center gap-2 rounded-md border border-gray-100 px-3 py-2 cursor-pointer hover:bg-gray-50/80"
            title={t("visit.click_to_edit", "לחצו לפתיחה ולעריכה")}
          >
            <span className="font-medium text-status-magenta" dir="ltr">
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
                onClick={(e) => {
                  e.stopPropagation();
                  void remove(v.id);
                }}
                className="text-sm text-status-darkred hover:underline"
              >
                {t("action.delete", "מחק")}
              </button>
            </div>
          </div>
        ),
      )}
      {visits.length === 0 && !adding && (
        <p className="text-sm text-gray-400">{t("visit.none", "אין ביקורים עדיין.")}</p>
      )}

      {adding ? (
        <VisitForm
          contacts={[]}
          lockedContactId={contactId}
          onCancel={() => setAdding(false)}
          onSave={(payload) =>
            apiFetch<Visit>(`/api/contacts/${contactId}/visits`, {
              method: "POST",
              body: JSON.stringify(payload),
            })
          }
          onDone={async () => {
            setAdding(false);
            await reload();
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-sm text-status-magenta hover:underline"
        >
          + {t("visit.add", "הוסף ביקור")}
        </button>
      )}
    </div>
  );
}
