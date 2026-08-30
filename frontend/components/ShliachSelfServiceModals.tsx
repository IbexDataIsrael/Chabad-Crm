"use client";

import { useState } from "react";

import { apiFetch } from "@/lib/api";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import type { ReportCompletionStatus } from "@/lib/types";

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

  const choices: { value: ReportCompletionStatus; label: string }[] = [
    { value: "completed", label: t("shliach_msg.status_completed", "דוח הושלם") },
    { value: "not_completed", label: t("shliach_msg.status_not_completed", "דוח לא הושלם") },
    { value: "partial", label: t("shliach_msg.status_partial", "דוח הושלם חלקית") },
  ];

  async function submit() {
    if (!status) return;
    setBusy(true);
    try {
      await apiFetch("/api/shliach-messages/report-completions", {
        method: "POST",
        body: JSON.stringify({ status, comments: comments.trim() || null }),
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
      <div className="w-full max-w-sm bg-white rounded-xl shadow-xl p-5 space-y-4">
        <h2 className="text-lg font-bold">
          {t("shliach_msg.report_completed_btn", "דיווח על השלמת הדוח")}
        </h2>
        <div className="space-y-2">
          {choices.map((c) => (
            <label
              key={c.value}
              className="flex items-center gap-2 text-sm rounded-md border border-gray-200 px-3 py-2 cursor-pointer hover:bg-gray-50"
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
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta"
            rows={3}
            value={comments}
            onChange={(e) => setComments(e.target.value)}
          />
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!status || busy}
            onClick={submit}
            className="rounded-md bg-status-magenta text-white px-5 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {busy ? t("action.saving", "שומר…") : t("action.submit", "שלח")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
          >
            {t("action.cancel", "ביטול")}
          </button>
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
      <div className="w-full max-w-sm bg-white rounded-xl shadow-xl p-5 space-y-4">
        <h2 className="text-lg font-bold">
          {t("shliach_msg.system_comment_btn", "הערות על המערכת")}
        </h2>
        <textarea
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta"
          rows={4}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={t("shliach_msg.comment_ph", "מה תרצה לספר לנו?")}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!comment.trim() || busy}
            onClick={submit}
            className="rounded-md bg-status-magenta text-white px-5 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {busy ? t("action.saving", "שומר…") : t("action.submit", "שלח")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
          >
            {t("action.cancel", "ביטול")}
          </button>
        </div>
      </div>
    </div>
  );
}
