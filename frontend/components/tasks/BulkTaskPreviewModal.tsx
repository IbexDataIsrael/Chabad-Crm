"use client";

import { Button } from "@/components/ui/button";
import { useLocalization } from "@/lib/localization";
import type { TaskBulkPreview } from "@/lib/types";

function NumberList({ title, tone, items }: { title: string; tone: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className={`text-sm font-semibold ${tone}`}>
        {title} ({items.length})
      </p>
      <p className="max-h-28 overflow-y-auto rounded-md border border-border bg-muted/30 px-2 py-1.5 text-sm leading-relaxed">
        {items.join(", ")}
      </p>
    </div>
  );
}

/** fixes74 §3: what "one task per report number" is about to create — shown
 *  before anything is saved. With conflicts (numbers already in a task of
 *  this campaign) the choice is: cancel everything, or skip the taken
 *  numbers and create the rest. */
export function BulkTaskPreviewModal({
  preview,
  noActivist,
  busy,
  onCreate,
  onCancel,
}: {
  preview: TaskBulkPreview;
  noActivist: boolean;
  busy: boolean;
  onCreate: (skipConflicts: boolean) => void;
  onCancel: () => void;
}) {
  const { t } = useLocalization();
  const { eligible, conflicts, missing } = preview;
  const hasConflicts = conflicts.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        className="glass-card w-full max-w-md space-y-4 p-5 max-h-[90vh] overflow-y-auto"
      >
        <h2 className="text-lg font-bold">
          {hasConflicts
            ? t("task.bulk_conflict_title", "חלק מהמספרים כבר שייכים למשימה")
            : t("task.bulk_confirm_title", "יצירת משימה נפרדת לכל מספר דוח")}
        </h2>

        <NumberList
          title={t("task.bulk_eligible", "ייווצרו משימות עבור")}
          tone="text-status-green"
          items={eligible.map((n) => n.name)}
        />
        <NumberList
          title={t("task.bulk_conflicts", "כבר שייכים למשימה בקמפיין הזה")}
          tone="text-destructive"
          items={conflicts.map((n) => `${n.name} (#${n.task_ids.join(", #")})`)}
        />
        <NumberList
          title={t("task.bulk_missing", "לא קיימים במערכת — ידולגו")}
          tone="text-muted-foreground"
          items={missing}
        />

        {eligible.length === 0 ? (
          <p className="text-sm text-destructive">
            {t("task.bulk_nothing_to_create", "אין מספרים פנויים — לא תיווצר אף משימה.")}
          </p>
        ) : (
          noActivist && (
            <p className="text-xs text-muted-foreground">
              {t("task.bulk_no_activist_hint", "המשימות ייווצרו ללא פעיל ויחכו במאגר המשימות הפנויות.")}
            </p>
          )
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {eligible.length > 0 && (
            <Button type="button" disabled={busy} onClick={() => onCreate(hasConflicts)}>
              {(hasConflicts
                ? t("task.bulk_skip_and_create", "דלג על התפוסים וצור {n} משימות")
                : t("task.bulk_create_n", "צור {n} משימות")
              ).replace("{n}", String(eligible.length))}
            </Button>
          )}
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
            {hasConflicts ? t("task.bulk_cancel_all", "ביטול הכל") : t("action.cancel", "ביטול")}
          </Button>
        </div>
      </div>
    </div>
  );
}
