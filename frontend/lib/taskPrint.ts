import { apiFetch, ApiError } from "@/lib/api";
import type { Lang } from "@/lib/localization";
import { generateTaskPdf } from "@/lib/taskPdf";
import type { TaskSheetColumn, TaskSheetFieldsConfig } from "@/lib/taskSheetFields";
import type { TaskPrintData } from "@/lib/types";

type Translate = (key: string, fallback: string) => string;

/** fixes65 §3 / fixes67: fetch a task's print data and download its sheet —
 *  shared by the Tasks list and the single-task page. Resolves to an error
 *  message for the caller's toast, or null on success. */
export async function printTaskSheet(opts: {
  taskId: number;
  orgName: string;
  orgLogoUrl: string | null | undefined;
  t: Translate;
  lang: Lang;
  fields?: TaskSheetFieldsConfig;
  catalog: TaskSheetColumn[];
}): Promise<string | null> {
  const { taskId, orgName, orgLogoUrl, t, lang, fields, catalog } = opts;
  try {
    const data = await apiFetch<TaskPrintData>(`/api/tasks/${taskId}/print-data`);
    await generateTaskPdf({
      data,
      orgName,
      orgLogoUrl,
      claimBaseUrl: window.location.origin,
      t,
      lang,
      fields,
      catalog,
    });
    return null;
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      return t("task.print_no_apartments", "אין דירות במשימה — אין מה להדפיס.");
    }
    return err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה");
  }
}
