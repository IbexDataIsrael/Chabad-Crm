import { apiFetch, ApiError } from "@/lib/api";
import type { Lang } from "@/lib/localization";
import { generateTaskPdf, generateTasksPdf } from "@/lib/taskPdf";
import type { TaskSheetColumn, TaskSheetFieldsConfig } from "@/lib/taskSheetFields";
import type { Task, TaskPrintData } from "@/lib/types";

type Translate = (key: string, fallback: string) => string;

interface PrintOptions {
  orgName: string;
  orgLogoUrl: string | null | undefined;
  t: Translate;
  lang: Lang;
  fields?: TaskSheetFieldsConfig;
  catalog: TaskSheetColumn[];
  /** fixes104 §2: the chosen task add-on fields, as [label, value] pairs. */
  taskFacts?: (task: Task) => [string, string][];
}

/** fixes65 §3 / fixes67: fetch a task's print data and download its sheet —
 *  shared by the Tasks list and the single-task page. Resolves to an error
 *  message for the caller's toast, or null on success. */
export async function printTaskSheet(opts: PrintOptions & { taskId: number }): Promise<string | null> {
  const { taskId, t } = opts;
  try {
    const data = await apiFetch<TaskPrintData>(`/api/tasks/${taskId}/print-data`);
    await generateTaskPdf({ ...opts, data, claimBaseUrl: window.location.origin });
    return null;
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      return t("task.print_no_apartments", "אין דירות במשימה — אין מה להדפיס.");
    }
    return err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה");
  }
}

/** fixes104 §4: every given task's sheet in one PDF, in the given order.
 *  Tasks with nothing to print (no apartments) are skipped; resolves to how
 *  many sheets were printed, or an error message. */
export async function printTaskSheets(
  opts: PrintOptions & { taskIds: number[] },
): Promise<{ printed: number; error: string | null }> {
  const { taskIds, t } = opts;
  try {
    const results = await Promise.all(
      taskIds.map((id) =>
        apiFetch<TaskPrintData>(`/api/tasks/${id}/print-data`).catch((err) => {
          if (err instanceof ApiError && err.status === 409) return null;
          throw err;
        }),
      ),
    );
    const items = results.filter((d): d is TaskPrintData => d !== null);
    if (items.length > 0) {
      await generateTasksPdf({ ...opts, items, claimBaseUrl: window.location.origin });
    }
    return { printed: items.length, error: null };
  } catch (err) {
    return {
      printed: 0,
      error: err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"),
    };
  }
}
