"use client";

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useLocalization } from "@/lib/localization";
import {
  taskSheetFieldLabel,
  TASK_SHEET_FIELD_KEYS,
  useTaskSheetFields,
  type TaskSheetFieldKey,
} from "@/lib/taskSheetFields";
import { useSortableList } from "@/lib/useSortableList";

/** fixes69 §Admin3c/3d/3e: which task-sheet PDF columns print, their order
 *  and their width — same chip + drag/▲▼-reorder pattern the Apartments
 *  page's "Customize Fields" panel and the reports/create column panel both
 *  already use, but its own fresh, task-sheet-only config (see
 *  lib/taskSheetFields.ts) rather than sharing either of theirs. */
export function TaskSheetFieldsModal({ onClose }: { onClose: () => void }) {
  const { t } = useLocalization();
  const [fields, setFields] = useTaskSheetFields();

  function toggle(key: TaskSheetFieldKey) {
    setFields((prev) => {
      const active = prev.columns.includes(key);
      const columns = active
        ? prev.columns.filter((k) => k !== key)
        : [...prev.columns, key];
      return { ...prev, columns };
    });
  }

  function reorder(orderedKeys: string[]) {
    setFields((prev) => {
      const activeSet = new Set(prev.columns);
      const reordered = orderedKeys.filter((k): k is TaskSheetFieldKey =>
        activeSet.has(k as TaskSheetFieldKey),
      );
      return reordered.length > 0 ? { ...prev, columns: reordered } : prev;
    });
  }

  function move(key: TaskSheetFieldKey, dir: -1 | 1) {
    setFields((prev) => {
      const idx = prev.columns.indexOf(key);
      const swapWith = idx + dir;
      if (idx < 0 || swapWith < 0 || swapWith >= prev.columns.length) return prev;
      const columns = [...prev.columns];
      [columns[idx], columns[swapWith]] = [columns[swapWith], columns[idx]];
      return { ...prev, columns };
    });
  }

  function setWidth(key: TaskSheetFieldKey, value: number) {
    setFields((prev) => ({ ...prev, widths: { ...prev.widths, [key]: value } }));
  }

  const { containerRef, withClickGuard } = useSortableList<HTMLDivElement>(reorder);
  const inactiveKeys = TASK_SHEET_FIELD_KEYS.filter((k) => !fields.columns.includes(k));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg bg-card rounded-xl shadow-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">
            {t("task_pdf.fields_settings_title", "עיצוב דף ההדפסה")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          {t("columns.reorder_hint", "גרור עמודה פעילה כדי לשנות את סדר ההצגה.")}
        </p>

        <div ref={containerRef} className="flex flex-wrap gap-2">
          {fields.columns.map((k) => {
            const idx = fields.columns.indexOf(k);
            return (
              <span key={k} data-sort-key={k} className="inline-flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={withClickGuard(() => toggle(k))}
                  className="rounded-md border px-3 py-1.5 text-sm border-primary bg-primary/10 text-primary cursor-grab active:cursor-grabbing"
                >
                  ⠿ {taskSheetFieldLabel(k, t)}
                </button>
                <span className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => move(k, -1)}
                    title={t("action.move_up", "העלה")}
                    className="flex items-center justify-center w-7 h-7 rounded text-sm leading-none text-muted-foreground hover:text-primary hover:bg-accent active:bg-muted disabled:opacity-20"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    disabled={idx === fields.columns.length - 1}
                    onClick={() => move(k, 1)}
                    title={t("action.move_down", "הורד")}
                    className="flex items-center justify-center w-7 h-7 rounded text-sm leading-none text-muted-foreground hover:text-primary hover:bg-accent active:bg-muted disabled:opacity-20"
                  >
                    ▼
                  </button>
                </span>
              </span>
            );
          })}
          {inactiveKeys.map((k) => (
            <button
              key={k}
              type="button"
              data-sort-key={k}
              data-sortable-disabled=""
              onClick={() => toggle(k)}
              className="rounded-md border px-3 py-1.5 text-sm border-border text-muted-foreground hover:bg-accent"
            >
              {taskSheetFieldLabel(k, t)}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto pt-2">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-start">
              <tr>
                <th className="py-1 pe-3 font-medium">{t("columns.title", "עמודות מוצגות")}</th>
                <th className="py-1 font-medium">{t("reports.column_width", "רוחב (%)")}</th>
              </tr>
            </thead>
            <tbody>
              {fields.columns.map((k) => (
                <tr key={k} className="border-t border-border">
                  <td className="py-1.5 pe-3">{taskSheetFieldLabel(k, t)}</td>
                  <td className="py-1.5">
                    <input
                      type="number"
                      dir="ltr"
                      min={0}
                      max={100}
                      className="w-20 rounded-md border border-input px-2 py-1 text-sm"
                      value={fields.widths[k] ?? 0}
                      onChange={(e) => setWidth(k, Number(e.target.value))}
                    />
                  </td>
                </tr>
              ))}
              {fields.columns.length === 0 && (
                <tr>
                  <td colSpan={2} className="py-4 text-center text-muted-foreground">
                    {t("reports.no_columns_selected", "לא נבחרו עמודות")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          {t(
            "task_pdf.widths_autoscale_hint",
            "הרוחבים מתחלקים יחסית לרוחב הדף — אין צורך שיסתכמו ל-100.",
          )}
        </p>

        <div className="flex justify-end">
          <Button type="button" onClick={onClose}>
            {t("action.close", "סגור")}
          </Button>
        </div>
      </div>
    </div>
  );
}
