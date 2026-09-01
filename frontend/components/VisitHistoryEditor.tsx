"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useFieldSettings } from "@/lib/fieldSettings";
import { useLocalization } from "@/lib/localization";
import { usePicklist } from "@/lib/picklists";
import type { Visit } from "@/lib/types";
import { useConfirm } from "@/lib/confirm";
import { VisitDetails } from "./VisitDetails";
import { VisitForm } from "./VisitForm";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

/** Per-contact visit history (date, type, location, notes), newest first.
 *  fixes28 §1: clicking a visit's title row expands it in place with
 *  Google-style inline per-field autosave (the separate "הצג"/"ערוך" links
 *  are gone — only "מחק" remains); creation still uses the visit form. */
export function VisitHistoryEditor({ contactId }: { contactId: number }) {
  const { t } = useLocalization();
  const confirmDialog = useConfirm();
  const { isFieldVisible: vis } = useFieldSettings();
  const { labelFor } = usePicklist("visit.type");
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  // fixes50 §2.2: only the 7 most recent visits render by default (the API
  // already returns them newest-first) — "show more" reveals the rest in
  // the same 7-at-a-time batches, no extra endpoint/pagination needed.
  const [visibleCount, setVisibleCount] = useState(7);

  async function reload() {
    setVisits(await apiFetch<Visit[]>(`/api/contacts/${contactId}/visits`));
  }

  useEffect(() => {
    setVisibleCount(7);
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

  if (loading) return <p className="text-sm text-muted-foreground">{t("action.loading", "טוען…")}</p>;

  const visibleVisits = visits.slice(0, visibleCount);

  return (
    <div className="space-y-3">
      {visibleVisits.map((v) =>
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
            className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 cursor-pointer hover:bg-accent/80"
            title={t("visit.click_to_edit", "לחצו לפתיחה ולעריכה")}
          >
            <span className="font-medium text-primary" dir="ltr">
              {new Date(v.visit_date).toLocaleDateString("he-IL")}
            </span>
            {v.visit_type && vis("visits.visit_type") && (
              <Badge variant="secondary">{labelFor(v.visit_type)}</Badge>
            )}
            {v.location && vis("visits.location") && (
              <span className="text-sm text-muted-foreground">📍 {v.location}</span>
            )}
            {v.notes && <span className="text-sm text-muted-foreground">— {v.notes}</span>}
            <div className="flex items-center gap-2 ms-auto">
              <Button
                variant="ghost"
                size="icon"
                title={t("action.delete", "מחק")}
                aria-label={t("action.delete", "מחק")}
                className="h-8 w-8 text-destructive hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  void remove(v.id);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ),
      )}
      {visits.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">{t("visit.none", "אין ביקורים עדיין.")}</p>
      )}
      {visits.length > visibleVisits.length && (
        <Button type="button" variant="link" className="h-auto p-0" onClick={() => setVisibleCount((n) => n + 7)}>
          {t("visit.show_more", "הצג עוד ביקורים")}
        </Button>
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
        <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" /> {t("visit.add", "הוסף ביקור")}
        </Button>
      )}
    </div>
  );
}
