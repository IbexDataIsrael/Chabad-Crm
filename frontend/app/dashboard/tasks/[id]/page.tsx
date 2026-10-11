"use client";

import { ArrowRight, ClipboardPen, Loader2, Printer, QrCode, Settings, Trash2, UserMinus } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { ReportStatusBadge } from "@/components/ReportStatusBadge";
import { TaskLinkButton, TaskLinkField } from "@/components/tasks/TaskLinkButton";
import { TaskSheetFieldsModal } from "@/components/tasks/TaskSheetFieldsModal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineEdit } from "@/components/ui/InlineEdit";
import { MultiSelectEditor } from "@/components/ui/MultiSelectEditor";
import { MultiSelectSearchFilter } from "@/components/ui/MultiSelectSearchFilter";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useConfirm } from "@/lib/confirm";
import { useLocalization } from "@/lib/localization";
import { usePicklist } from "@/lib/picklists";
import { printTaskSheet } from "@/lib/taskPrint";
import { useTaskSheetCatalog, useTaskSheetFields } from "@/lib/taskSheetFields";
import { taskApartmentsHref, taskStatusLabels, taskStatusOptionsFor } from "@/lib/taskStatus";
import { useToast } from "@/lib/toast";
import type { Campaign, ReportNumber, Task, TaskStatus } from "@/lib/types";

const inputClass =
  "w-full rounded-md border border-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

interface ActivistOption {
  id: number;
  full_name: string;
  role: string;
  is_active: boolean;
}

function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }) : "—";
}

/** fixes67: a single task's own page — every field inline-editable
 *  (per-field autosave through PUT /api/tasks/{id}, same as users/{id}),
 *  plus the list's row actions (print, paper entry, return to pool,
 *  delete). */
export default function TaskDetailPage() {
  const params = useParams<{ id: string }>();
  const taskId = Number(params.id);
  const router = useRouter();
  const { t, lang } = useLocalization();
  const confirmDialog = useConfirm();
  const { user, isAdmin, isCampaignManager, loading } = useAuth();
  const { success, error: toastError } = useToast();
  const customDate = usePicklist("task.custom_date");
  const allowed = isAdmin || isCampaignManager;

  const [task, setTask] = useState<Task | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [reportNumbers, setReportNumbers] = useState<ReportNumber[]>([]);
  const [activists, setActivists] = useState<ActivistOption[]>([]);
  const [printing, setPrinting] = useState(false);
  const [fieldsModalOpen, setFieldsModalOpen] = useState(false);
  const [taskSheetFields] = useTaskSheetFields();
  // fixes74 §9: the printable columns (hidden fields excluded).
  const { columns: taskSheetCatalog } = useTaskSheetCatalog();

  useEffect(() => {
    if (loading || !allowed) return;
    apiFetch<Task>(`/api/tasks/${taskId}`).then(setTask).catch(() => setNotFound(true));
    apiFetch<Campaign[]>("/api/campaigns").then(setCampaigns).catch(() => setCampaigns([]));
    apiFetch<ReportNumber[]>("/api/report-numbers").then(setReportNumbers).catch(() => setReportNumbers([]));
    apiFetch<ActivistOption[]>("/api/users")
      .then((rows) => setActivists(rows.filter((u) => u.role === "shliach" && u.is_active)))
      .catch(() => setActivists([]));
  }, [loading, allowed, taskId]);

  const statusLabel = taskStatusLabels(t);

  async function patch(data: Partial<Task>) {
    const updated = await apiFetch<Task>(`/api/tasks/${taskId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    setTask(updated);
    success(t("msg.saved", "נשמר בהצלחה"));
  }

  async function print() {
    if (!task || task.apartment_count === 0) return;
    setPrinting(true);
    const err = await printTaskSheet({
      taskId: task.id,
      orgName: user?.organization?.name ?? "",
      orgLogoUrl: user?.organization?.logo_url,
      t,
      lang,
      fields: taskSheetFields,
      catalog: taskSheetCatalog,
    });
    setPrinting(false);
    if (err) toastError(err);
  }

  async function unassign() {
    if (
      !(await confirmDialog({
        message: t("task.unassign_confirm", "להחזיר את המשימה למאגר המשימות הפתוחות?"),
        detail: t(
          "task.unassign_detail",
          "הדפים שכבר הודפסו ימשיכו לעבוד — הפעיל הבא שיסרוק את הקוד יקבל את המשימה.",
        ),
      }))
    ) {
      return;
    }
    setTask(await apiFetch<Task>(`/api/tasks/${taskId}/unassign`, { method: "POST" }));
    success(t("task.unassigned_toast", "המשימה הוחזרה למאגר"));
  }

  async function remove() {
    if (!task) return;
    if (
      !(await confirmDialog({
        message: t("msg.delete_task_confirm", "למחוק את המשימה?"),
        detail: `${task.volunteer_name || t("task.orphan_badge", "לא משויך")} — ${task.campaign_name}`,
      }))
    ) {
      return;
    }
    await apiFetch(`/api/tasks/${taskId}`, { method: "DELETE" });
    success(t("msg.deleted", "נמחק בהצלחה"));
    router.push("/dashboard/tasks");
  }

  if (loading) return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;
  if (!allowed) {
    return (
      <p className="text-status-darkred">
        {t("page.admins_only", "אין לך הרשאה לעמוד זה (מנהלים בלבד).")}
      </p>
    );
  }
  if (notFound) {
    return (
      <div className="space-y-3">
        <BackLink label={t("page.back_to_tasks", "← חזרה למשימות")} />
        <p className="text-status-darkred">{t("task.not_found", "המשימה לא נמצאה.")}</p>
      </div>
    );
  }
  if (!task) return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;

  function reportNumberNames(ids: number[]): string {
    if (ids.length === 0) return "—";
    const byId = new Map(reportNumbers.map((rn) => [rn.id, rn.name]));
    return ids.map((id) => byId.get(id) ?? `#${id}`).join(", ");
  }

  const claimedVia =
    task.claimed_via === "qr"
      ? t("task.claimed_via_qr", "נלקחה בסריקת קוד QR")
      : task.claimed_via === "manual"
        ? t("task.claimed_via_manual", "שויכה ידנית")
      : task.claimed_via === "paper"
        ? t("task.claimed_via_paper", "הוזנה מדף מודפס במשרד")
        : task.volunteer_user_id
          ? t("task.claimed_via_manual", "שויכה ידנית")
          : "—";

  const activistDisplay = task.is_orphan ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-status-orange/40 bg-status-orange/10 px-2 py-0.5 text-xs font-medium text-status-orange">
      {t("task.orphan_badge", "לא משויך")}
    </span>
  ) : task.volunteer_user_id == null ? (
    <span className="text-muted-foreground">{t("task.office_handled", "בטיפול המשרד")}</span>
  ) : (
    <span className="inline-flex items-center gap-1">
      {task.volunteer_name}
      {task.claimed_via === "qr" && <QrCode className="h-3.5 w-3.5 text-muted-foreground" />}
    </span>
  );

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BackLink label={t("page.back_to_tasks", "← חזרה למשימות")} />
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            disabled={task.apartment_count === 0 || printing}
            title={
              task.apartment_count === 0
                ? t("task.print_no_apartments", "אין דירות במשימה — אין מה להדפיס.")
                : undefined
            }
            onClick={print}
          >
            {printing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
            {t("task.print", "הדפסת משימה")}
          </Button>
          <TaskLinkButton task={task} />
          <Button
            size="sm"
            variant="outline"
            title={t("task_pdf.fields_settings_title", "עיצוב דף ההדפסה")}
            onClick={() => setFieldsModalOpen(true)}
          >
            <Settings className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href={taskApartmentsHref(task)}>
              <ClipboardPen className="h-4 w-4" /> {t("task.paper_entry", "הזנת נתונים מדף מודפס")}
            </Link>
          </Button>
          {!task.is_orphan && (
            <Button size="sm" variant="outline" onClick={unassign}>
              <UserMinus className="h-4 w-4" /> {t("task.unassign", "החזרה למאגר")}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="border-status-darkred/30 text-status-darkred hover:bg-status-darkred/10"
            onClick={remove}
          >
            <Trash2 className="h-4 w-4" /> {t("action.delete", "מחק")}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">
          {t("task.title", "משימה")} #{task.id} — {task.campaign_name}
        </h1>
        <Badge variant="secondary">{statusLabel[task.status]}</Badge>
      </div>

      <section className="bg-card border border-border rounded-xl shadow-sm p-6 space-y-4">
        <h2 className="font-semibold">{t("page.task_details", "פרטי משימה")}</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
          <Field label={t("task.volunteer", "פעיל")}>
            <InlineEdit<number | "">
              value={task.volunteer_user_id ?? ""}
              display={activistDisplay}
              commitOnBlur={false}
              // Choosing no activist = returning it to the pool, which has
              // its own confirmed endpoint (also clears the claim audit).
              onSave={(v) =>
                v === "" ? (task.is_orphan ? Promise.resolve() : unassign()) : patch({ volunteer_user_id: v })
              }
              editor={(draft, _setDraft, commit) => (
                <select
                  className={inputClass}
                  value={draft}
                  onChange={(e) => commit(e.target.value ? Number(e.target.value) : "")}
                >
                  <option value="">{t("task.no_activist", "ללא פעיל (מאגר משימות פתוחות)")}</option>
                  {activists.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.full_name}
                    </option>
                  ))}
                </select>
              )}
            />
          </Field>

          <Field label={t("task.campaign", "קמפיין")}>
            <InlineEdit<number>
              value={task.campaign_id}
              display={<span>{task.campaign_name}</span>}
              commitOnBlur={false}
              onSave={(v) => patch({ campaign_id: v })}
              editor={(draft, _setDraft, commit) => (
                <select
                  className={inputClass}
                  value={draft}
                  onChange={(e) => commit(Number(e.target.value))}
                >
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            />
          </Field>

          {/* fixes98: a text task has instructions instead of report numbers. */}
          {task.task_text != null ? (
          <Field label={t("task.text", "טקסט המשימה")} wide>
            <InlineEdit<string>
              value={task.task_text}
              display={<span className="whitespace-pre-wrap">{task.task_text}</span>}
              enterCommits={false}
              onSave={(v) => (v.trim() ? patch({ task_text: v.trim() }) : Promise.resolve())}
              editor={(draft, setDraft) => (
                <textarea
                  className={inputClass}
                  rows={4}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
              )}
            />
          </Field>
          ) : (
          <Field label={t("task.report_numbers", "מספרי דוח")} wide>
            <InlineEdit<number[]>
              value={task.report_number_ids}
              display={<span>{reportNumberNames(task.report_number_ids)}</span>}
              commitOnBlur={false}
              onSave={(v) => patch({ report_number_ids: v })}
              editor={(draft, setDraft, commit) => (
                <MultiSelectEditor onApply={() => commit(draft)}>
                  <MultiSelectSearchFilter
                    allLabel={t("contact_shliach.no_report_numbers_selected", "לא נבחרו מספרי דוח")}
                    options={reportNumbers.map((rn) => ({ id: rn.id, label: rn.name }))}
                    value={draft}
                    onChange={setDraft}
                    searchPlaceholder={t("select.search_ph", "הקלד לחיפוש…")}
                  />
                </MultiSelectEditor>
              )}
            />
          </Field>
          )}

          <Field label={t("task.custom_date", "תאריך מותאם")}>
            <InlineEdit<number | "">
              value={task.custom_date_value_id ?? ""}
              display={
                <span>
                  {task.custom_date_value ? customDate.labelFor(task.custom_date_value) : "—"}
                </span>
              }
              commitOnBlur={false}
              onSave={(v) => patch({ custom_date_value_id: v === "" ? null : v })}
              editor={(draft, _setDraft, commit) => (
                <select
                  className={inputClass}
                  value={draft}
                  onChange={(e) => commit(e.target.value ? Number(e.target.value) : "")}
                >
                  <option value="">—</option>
                  {customDate.options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {customDate.display(o)}
                    </option>
                  ))}
                </select>
              )}
            />
          </Field>

          <Field label={t("task.status", "סטטוס")}>
            <InlineEdit<TaskStatus>
              value={task.status}
              display={<span>{statusLabel[task.status]}</span>}
              commitOnBlur={false}
              onSave={(v) => patch({ status: v })}
              editor={(draft, _setDraft, commit) => (
                <select
                  className={inputClass}
                  value={draft}
                  onChange={(e) => commit(e.target.value as TaskStatus)}
                >
                  {taskStatusOptionsFor(task).map((s) => (
                    <option key={s} value={s}>
                      {statusLabel[s]}
                    </option>
                  ))}
                </select>
              )}
            />
          </Field>

          <Field label={t("task.apartment_count", "מספר דירות")}>
            <span>{task.apartment_count}</span>
          </Field>

          <Field label={t("task.volunteer_report_summary", "דיווח הפעיל")} wide>
            <InlineEdit<string>
              value={task.volunteer_report_summary ?? ""}
              display={
                <span className="whitespace-pre-wrap">{task.volunteer_report_summary || "—"}</span>
              }
              enterCommits={false}
              onSave={(v) => patch({ volunteer_report_summary: v.trim() || null })}
              editor={(draft, setDraft) => (
                <textarea
                  className={inputClass}
                  rows={3}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
              )}
            />
          </Field>
        </dl>
      </section>

      <section className="bg-card border border-border rounded-xl shadow-sm p-6 space-y-4">
        <h2 className="font-semibold">{t("page.task_activity", "דיווח ושיוך")}</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
          <Field label={t("task.report_status", "סטטוס דיווח")}>
            {task.latest_report_status ? (
              <ReportStatusBadge status={task.latest_report_status} />
            ) : (
              <span className="text-muted-foreground">{t("task.no_report_yet", "טרם דווח")}</span>
            )}
          </Field>
          <Field label={t("task.report_notes", "הערות הפעיל")}>
            <span className="whitespace-pre-wrap">{task.latest_report_notes || "—"}</span>
          </Field>
          <Field label={t("task.claimed_how", "אופן השיוך")}>
            <span>{claimedVia}</span>
          </Field>
          <Field label={t("task.claimed_at", "תאריך שיוך")}>
            <span>{formatDateTime(task.assigned_at ?? task.claimed_at)}</span>
          </Field>
          {/* fixes74 §1: the same link the printed QR encodes. */}
          <Field label={t("task.assignment_link", "קישור לשיוך המשימה")} wide>
            <TaskLinkField task={task} />
          </Field>
          <Field label={t("task.created_at", "תאריך יצירה")}>
            <span>{formatDateTime(task.created_at)}</span>
          </Field>
          <Field label={t("task.updated_at", "עודכן לאחרונה")}>
            <span>{formatDateTime(task.updated_at)}</span>
          </Field>
        </dl>
      </section>
      {fieldsModalOpen && <TaskSheetFieldsModal onClose={() => setFieldsModalOpen(false)} />}
    </div>
  );
}

function BackLink({ label }: { label: string }) {
  return (
    <Link
      href="/dashboard/tasks"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
    >
      <ArrowRight className="h-4 w-4" /> {label.replace(/^←\s*/, "")}
    </Link>
  );
}

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`flex flex-col ${wide ? "sm:col-span-2" : ""}`}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}
