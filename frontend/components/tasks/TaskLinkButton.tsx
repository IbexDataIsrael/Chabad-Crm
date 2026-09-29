"use client";

import { Copy, Link2, Link2Off } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useLocalization } from "@/lib/localization";
import { taskClaimUrl } from "@/lib/taskStatus";
import { useToast } from "@/lib/toast";
import type { Task } from "@/lib/types";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API blocked (http, old browser): the classic fallback.
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

function useCopyLink() {
  const { t } = useLocalization();
  const { success, error } = useToast();
  return async (url: string) => {
    if (await copyText(url)) success(t("task.link_copied", "הקישור הועתק"));
    else error(t("task.link_copy_failed", "ההעתקה נכשלה — סמנו את הקישור והעתיקו ידנית"));
  };
}

/** fixes74 §1: copy the task's assignment link — the exact URL the printed
 *  QR encodes (/tasks/claim/<token>). Switched off (§4) once the task was
 *  assigned manually. Compact icon button for the Tasks table. */
export function TaskLinkButton({ task }: { task: Pick<Task, "claim_token"> }) {
  const { t } = useLocalization();
  const copy = useCopyLink();
  const token = task.claim_token;
  const title = token
    ? `${t("task.copy_link", "העתקת קישור לשיוך המשימה")}\n${taskClaimUrl(token)}`
    : t("task.link_disabled", "הקישור בוטל — המשימה שויכה ידנית");
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={!token}
      title={title}
      aria-label={t("task.copy_link", "העתקת קישור לשיוך המשימה")}
      onClick={() => token && copy(taskClaimUrl(token))}
    >
      {token ? <Link2 className="h-3.5 w-3.5" /> : <Link2Off className="h-3.5 w-3.5" />}
    </Button>
  );
}

/** The same link spelled out, for the single-task page. */
export function TaskLinkField({ task }: { task: Pick<Task, "claim_token"> }) {
  const { t } = useLocalization();
  const copy = useCopyLink();
  if (!task.claim_token) {
    return (
      <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link2Off className="h-4 w-4" />
        {t("task.link_disabled", "הקישור בוטל — המשימה שויכה ידנית")}
      </p>
    );
  }
  const url = taskClaimUrl(task.claim_token);
  return (
    <div className="flex items-center gap-1.5">
      <input
        readOnly
        dir="ltr"
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="min-w-0 flex-1 rounded-md border border-input bg-muted/40 px-2 py-1.5 text-xs"
        aria-label={t("task.assignment_link", "קישור לשיוך המשימה")}
      />
      <Button size="sm" variant="outline" onClick={() => copy(url)}>
        <Copy className="h-3.5 w-3.5" /> {t("action.copy", "העתק")}
      </Button>
    </div>
  );
}
