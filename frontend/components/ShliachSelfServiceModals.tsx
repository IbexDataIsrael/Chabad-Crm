"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import type { MyTask, ReportCompletionStatus } from "@/lib/types";

/** fixes53 §7 / fixes54 §6.1: an activist's self-service submissions —
 *  "Report completed" (3-choice + comment) and "Comments about the system".
 *  Originally embedded in the contact self-edit page; now shared with the
 *  dedicated `/dashboard/activist` landing page too, so both surfaces open
 *  the exact same modals instead of duplicating them. */
export function ReportCompletionModal({
  onClose,
  onSubmitted,
}: {
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const { t } = useLocalization();
  const { error: toastError } = useToast();
  const [status, setStatus] = useState<ReportCompletionStatus | null>(null);
  const [comments, setComments] = useState("");
  const [busy, setBusy] = useState(false);
  // fixes74 §11: which of the activist's tasks this report is about — the
  // report is stored against it, so a newer report never shows up on an
  // older task. Pre-selected when there's just one.
  const [tasks, setTasks] = useState<MyTask[] | null>(null);
  const [taskId, setTaskId] = useState<number | "">("");
  useEffect(() => {
    apiFetch<MyTask[]>("/api/shliach-messages/my-tasks")
      .then((rows) => {
        setTasks(rows);
        if (rows.length === 1) setTaskId(rows[0].id);
      })
      .catch(() => setTasks([]));
  }, []);
  const needsTask = (tasks?.length ?? 0) > 0;

  const choices: { value: ReportCompletionStatus; label: string }[] = [
    { value: "completed", label: t("shliach_msg.status_completed", "דוח הושלם") },
    { value: "not_completed", label: t("shliach_msg.status_not_completed", "דוח לא הושלם") },
    { value: "partial", label: t("shliach_msg.status_partial", "דוח הושלם חלקית") },
  ];

  async function submit() {
    if (!status || (needsTask && taskId === "")) return;
    setBusy(true);
    try {
      await apiFetch("/api/shliach-messages/report-completions", {
        method: "POST",
        body: JSON.stringify({
          status,
          comments: comments.trim() || null,
          task_id: taskId === "" ? null : taskId,
        }),
      });
      onSubmitted();
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm bg-card rounded-xl shadow-xl p-5 space-y-4">
        <h2 className="text-lg font-bold">
          {t("shliach_msg.report_completed_btn", "דיווח על השלמת הדוח")}
        </h2>
        {needsTask && (
          <label className="block space-y-1">
            <span className="block text-sm font-medium">
              {t("shliach_msg.report_task", "על איזו משימה הדיווח?")}
            </span>
            <select
              className="w-full rounded-md border border-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              value={taskId}
              onChange={(e) => setTaskId(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">{t("shliach_msg.pick_task", "בחרו משימה")}</option>
              {tasks!.map((task) => (
                <option key={task.id} value={task.id}>
                  #{task.id} — {task.campaign_name}
                  {task.report_number_names.length > 0
                    ? ` (${t("task.report_numbers", "מספרי דוח")}: ${task.report_number_names.join(", ")})`
                    : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="space-y-2">
          {choices.map((c) => (
            <label
              key={c.value}
              className="flex items-center gap-2 text-sm rounded-md border border-border px-3 py-2 cursor-pointer hover:bg-accent"
            >
              <input
                type="radio"
                name="completion-status"
                checked={status === c.value}
                onChange={() => setStatus(c.value)}
              />
              {c.label}
            </label>
          ))}
        </div>
        <label className="block space-y-1">
          <span className="block text-sm font-medium">
            {t("shliach_msg.comments", "הערות")}
          </span>
          <textarea
            className="w-full rounded-md border border-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            rows={3}
            value={comments}
            onChange={(e) => setComments(e.target.value)}
          />
        </label>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            disabled={!status || busy || tasks === null || (needsTask && taskId === "")}
            onClick={submit}
          >
            {busy ? t("action.saving", "שומר…") : t("action.submit", "שלח")}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("action.cancel", "ביטול")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** fixes53 §7: "Comments about the system" — free-text feedback. */
export function SystemCommentModal({
  onClose,
  onSubmitted,
}: {
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const { t } = useLocalization();
  const { error: toastError } = useToast();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!comment.trim()) return;
    setBusy(true);
    try {
      await apiFetch("/api/shliach-messages/system-comments", {
        method: "POST",
        body: JSON.stringify({ comment: comment.trim() }),
      });
      onSubmitted();
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm bg-card rounded-xl shadow-xl p-5 space-y-4">
        <h2 className="text-lg font-bold">
          {t("shliach_msg.system_comment_btn", "הערות על המערכת")}
        </h2>
        <textarea
          className="w-full rounded-md border border-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          rows={4}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={t("shliach_msg.comment_ph", "מה תרצה לספר לנו?")}
        />
        <div className="flex items-center gap-2">
          <Button type="button" disabled={!comment.trim() || busy} onClick={submit}>
            {busy ? t("action.saving", "שומר…") : t("action.submit", "שלח")}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("action.cancel", "ביטול")}
          </Button>
        </div>
      </div>
    </div>
  );
}
