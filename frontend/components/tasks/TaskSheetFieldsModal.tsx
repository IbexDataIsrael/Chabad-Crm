"use client";

import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { useLocalization } from "@/lib/localization";
import { useTaskCustomFields } from "@/lib/taskCustomFields";
import {
  DEFAULT_COLUMN_WIDTH,
  DEFAULT_TASK_SHEET_FIELDS,
  useTaskSheetCatalog,
  useTaskSheetFields,
  type TaskSheetColumn,
} from "@/lib/taskSheetFields";

/** fixes69 §Admin3c/3d/3e + fixes74 §9/§10: which task-sheet PDF columns
 *  print, their order and their width.
 *
 *  fixes74 §10 — the "freeze": the old modal was a fixed, non-scrolling
 *  overlay with no backdrop/Escape close. On a short screen (a phone, or a
 *  laptop window) the dialog grew taller than the viewport, both its ✕ and
 *  its Close button landed off-screen, and the overlay blocked the page —
 *  the user was stuck until a refresh (measured on a 568px-tall phone: ✕ at
 *  y=-94, Close at y=650). Its chips were also SortableJS drag handles, so a
 *  slightly jittery click read as a drag and the toggle silently didn't
 *  happen. Now: one scrollable list (sticky header/footer, always
 *  reachable), Escape/backdrop close, plain checkbox + ▲/▼ + width per row —
 *  no drag library, nothing heavy per render. */
export function TaskSheetFieldsModal({ onClose }: { onClose: () => void }) {
  const { t } = useLocalization();
  const [fields, setFields] = useTaskSheetFields();
  const { columns: catalog, ready } = useTaskSheetCatalog();
  // fixes104 §2: the task's own add-on fields, printed under the title.
  const { fields: taskFields } = useTaskCustomFields();
  const taskFieldOn = (key: string) => fields.taskFields == null || fields.taskFields.includes(key);
  function toggleTaskField(key: string) {
    setFields((prev) => {
      const current = prev.taskFields ?? taskFields.map((f) => f.key);
      return {
        ...prev,
        taskFields: current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
      };
    });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Selected columns first (in print order), then the rest in catalog order.
  const byKey = new Map(catalog.map((c) => [c.key, c]));
  const selected = fields.columns.map((k) => byKey.get(k)).filter((c): c is TaskSheetColumn => !!c);
  const selectedKeys = new Set(selected.map((c) => c.key));
  const unselected = catalog.filter((c) => !selectedKeys.has(c.key));

  function toggle(key: string) {
    setFields((prev) => {
      const visible = prev.columns.filter((k) => byKey.has(k));
      const columns = visible.includes(key) ? visible.filter((k) => k !== key) : [...visible, key];
      return { ...prev, columns };
    });
  }

  function move(key: string, dir: -1 | 1) {
    setFields((prev) => {
      const columns = prev.columns.filter((k) => byKey.has(k));
      const idx = columns.indexOf(key);
      const swapWith = idx + dir;
      if (idx < 0 || swapWith < 0 || swapWith >= columns.length) return prev;
      [columns[idx], columns[swapWith]] = [columns[swapWith], columns[idx]];
      return { ...prev, columns };
    });
  }

  function setWidth(key: string, value: number) {
    setFields((prev) => ({ ...prev, widths: { ...prev.widths, [key]: value } }));
  }

  const widthOf = (key: string) => fields.widths[key] ?? DEFAULT_COLUMN_WIDTH;

  function row(c: TaskSheetColumn, index: number | null) {
    const on = index != null;
    return (
      <li key={c.key} className="flex items-center gap-2 px-3 py-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 shrink-0" checked={on} onChange={() => toggle(c.key)} />
          <span className="min-w-0 break-words">{c.label}</span>
        </label>
        {on && (
          <>
            <input
              type="number"
              dir="ltr"
              min={1}
              max={100}
              inputMode="numeric"
              aria-label={`${t("reports.column_width", "רוחב (%)")} — ${c.label}`}
              className="w-16 rounded-md border border-input px-2 py-1 text-sm"
              value={widthOf(c.key)}
              onChange={(e) => setWidth(c.key, Number(e.target.value))}
            />
            <button
              type="button"
              disabled={index === 0}
              onClick={() => move(c.key, -1)}
              title={t("action.move_up", "העלה")}
              aria-label={t("action.move_up", "העלה")}
              className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-primary disabled:opacity-20"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={index === selected.length - 1}
              onClick={() => move(c.key, 1)}
              title={t("action.move_down", "הורד")}
              aria-label={t("action.move_down", "הורד")}
              className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-primary disabled:opacity-20"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </>
        )}
      </li>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-sheet-fields-title"
        className="glass-card flex max-h-[calc(100dvh-1.5rem)] w-full max-w-lg flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <h2 id="task-sheet-fields-title" className="text-lg font-bold">
            {t("task_pdf.fields_settings_title", "עיצוב דף ההדפסה")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("action.close", "סגור")}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 py-3">
          <p className="text-xs text-muted-foreground">
            {t(
              "task_pdf.fields_hint",
              "סמנו את העמודות שיודפסו, קבעו את הסדר בחיצים ואת הרוחב באחוזים. שדות מוסתרים אינם מוצגים.",
            )}
          </p>
          {!ready ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t("action.loading", "טוען…")}</p>
          ) : (
            <>
              <ul className="divide-y divide-border rounded-md border border-border">
                {selected.map((c, i) => row(c, i))}
                {selected.length === 0 && (
                  <li className="px-3 py-3 text-center text-sm text-muted-foreground">
                    {t("reports.no_columns_selected", "לא נבחרו עמודות")}
                  </li>
                )}
              </ul>
              {unselected.length > 0 && (
                <ul className="divide-y divide-border rounded-md border border-dashed border-border">
                  {unselected.map((c) => row(c, null))}
                </ul>
              )}
              {taskFields.length > 0 && (
                <div className="space-y-2 pt-2">
                  <h3 className="text-sm font-semibold">
                    {t("task_pdf.task_fields_title", "שדות המשימה (בראש הדף)")}
                  </h3>
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {taskFields.map((f) => (
                      <li key={f.key} className="px-3 py-2">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="h-4 w-4 shrink-0"
                            checked={taskFieldOn(f.key)}
                            onChange={() => toggleTaskField(f.key)}
                          />
                          <span className="min-w-0 break-words">{f.label}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          <p className="text-xs text-muted-foreground">
            {t(
              "task_pdf.widths_autoscale_hint",
              "הרוחבים מתחלקים יחסית לרוחב הדף — אין צורך שיסתכמו ל-100.",
            )}
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
          <Button type="button" variant="outline" size="sm" onClick={() => setFields(DEFAULT_TASK_SHEET_FIELDS)}>
            {t("task_pdf.reset_columns", "איפוס לברירת המחדל")}
          </Button>
          <Button type="button" onClick={onClose}>
            {t("action.close", "סגור")}
          </Button>
        </div>
      </div>
    </div>
  );
}
