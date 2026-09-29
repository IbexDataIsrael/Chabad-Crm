"use client";

import { useEffect, useState, type FormEvent } from "react";

import { ConfirmModal } from "@/components/ConfirmModal";
import { MultiSelectSearchFilter } from "@/components/ui/MultiSelectSearchFilter";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useLocalization } from "@/lib/localization";
import { usePicklist } from "@/lib/picklists";
import { taskStatusLabels } from "@/lib/taskStatus";
import type { Campaign, ReportNumber, TaskStatus } from "@/lib/types";

const inputClass =
  "w-full rounded-md border border-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";


interface ActivistOption {
  id: number;
  full_name: string;
  role: string;
}

/** fixes58 §3.3: the Users-page quick-action "Add task" form — modeled on
 *  VisitForm's locked-subject shape (the volunteer here plays the same role
 *  `lockedContactId` does there). Campaign is required (auto-selected when
 *  only one is active); report numbers and the custom-date picklist are
 *  optional. fixes60 §1: `volunteerUserId`/`volunteerName` are now optional —
 *  omit both (the Tasks page's own "New Task" button does) to get a real
 *  activist picker instead of a locked one. */
export function TaskQuickCreateForm({
  volunteerUserId,
  volunteerName,
  onClose,
  onSaved,
}: {
  volunteerUserId?: number;
  volunteerName?: string;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { t } = useLocalization();
  const customDate = usePicklist("task.custom_date");

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [reportNumbers, setReportNumbers] = useState<ReportNumber[]>([]);
  const [activists, setActivists] = useState<ActivistOption[]>([]);
  // fixes66 §3: "" = no activist — the task enters the orphan (open) pool,
  // after a confirm. (Replaces fixes65's separate "assign later" choice.)
  const [selectedVolunteerId, setSelectedVolunteerId] = useState<number | "">(
    volunteerUserId ?? "",
  );
  const [confirmNoActivist, setConfirmNoActivist] = useState(false);
  const [campaignId, setCampaignId] = useState<number | "">("");
  const [reportNumberIds, setReportNumberIds] = useState<number[]>([]);
  const [customDateValueId, setCustomDateValueId] = useState<number | "">("");
  const [status, setStatus] = useState<TaskStatus>("ACTIVE");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const statusLabel = taskStatusLabels(t);
  // fixes74 §2: without an activist the new task is "available", with one it
  // is "taken" — the first option follows the activist choice (the backend
  // applies the same rule).
  const noActivist = selectedVolunteerId === "";
  const statusOptions: TaskStatus[] = [noActivist ? "AVAILABLE" : "ACTIVE", "COMPLETED", "PAUSED"];
  const shownStatus: TaskStatus =
    status === "ACTIVE" || status === "AVAILABLE" ? statusOptions[0] : status;

  useEffect(() => {
    apiFetch<Campaign[]>("/api/campaigns?active=true")
      .then((rows) => {
        setCampaigns(rows);
        if (rows.length === 1) setCampaignId(rows[0].id);
      })
      .catch(() => setCampaigns([]));
    apiFetch<ReportNumber[]>("/api/report-numbers")
      .then(setReportNumbers)
      .catch(() => setReportNumbers([]));
    // fixes60 §1: only needed when no volunteer was locked in via props.
    if (volunteerUserId === undefined) {
      apiFetch<ActivistOption[]>("/api/users")
        .then((rows) => setActivists(rows.filter((u) => u.role === "shliach")))
        .catch(() => setActivists([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (campaignId === "") {
      setError(t("validation.campaign_required", "יש לבחור קמפיין"));
      return;
    }
    if (selectedVolunteerId === "") {
      setConfirmNoActivist(true);
      return;
    }
    void create();
  }

  async function create() {
    setConfirmNoActivist(false);
    setBusy(true);
    try {
      await apiFetch("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          campaign_id: campaignId,
          volunteer_user_id: selectedVolunteerId === "" ? null : selectedVolunteerId,
          report_number_ids: reportNumberIds,
          custom_date_value_id: customDateValueId === "" ? null : customDateValueId,
          status: shownStatus,
        }),
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={save}
        className="w-full max-w-md bg-card rounded-xl shadow-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <div>
          <h2 className="text-lg font-bold">{t("page.add_task", "משימה חדשה")}</h2>
          {volunteerName && <p className="text-sm text-muted-foreground">{volunteerName}</p>}
        </div>

        {volunteerUserId === undefined && (
          <label className="block space-y-1">
            <span className="block text-sm font-medium">{t("task.volunteer", "פעיל")}</span>
            <select
              className={inputClass}
              value={selectedVolunteerId}
              onChange={(e) => setSelectedVolunteerId(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">{t("task.no_activist", "ללא פעיל (מאגר משימות פתוחות)")}</option>
              {activists.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.full_name}
                </option>
              ))}
            </select>
            {selectedVolunteerId === "" && (
              <span className="block text-xs text-muted-foreground">
                {t(
                  "task.assign_later_hint",
                  "המשימה תמתין במאגר המשימות הפתוחות. הדפיסו אותה — הדף יכלול קוד QR שדרכו פעיל יוכל לקחת אותה.",
                )}
              </span>
            )}
          </label>
        )}

        <label className="block space-y-1">
          <span className="block text-sm font-medium">{t("task.campaign", "קמפיין")}</span>
          <select
            className={inputClass}
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value ? Number(e.target.value) : "")}
            required
          >
            <option value="">{t("task.select_campaign", "בחר קמפיין")}</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1">
          <span className="block text-sm font-medium">{t("task.report_numbers", "מספרי דוח")}</span>
          <MultiSelectSearchFilter
            allLabel={t("contact_shliach.no_report_numbers_selected", "לא נבחרו מספרי דוח")}
            options={reportNumbers.map((rn) => ({ id: rn.id, label: rn.name }))}
            value={reportNumberIds}
            onChange={setReportNumberIds}
            searchPlaceholder={t("select.search_ph", "הקלד לחיפוש…")}
          />
        </label>

        <label className="block space-y-1">
          <span className="block text-sm font-medium">{t("task.custom_date", "תאריך מותאם")}</span>
          <select
            className={inputClass}
            value={customDateValueId}
            onChange={(e) => setCustomDateValueId(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">—</option>
            {customDate.options.map((o) => (
              <option key={o.id} value={o.id}>
                {customDate.display(o)}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1">
          <span className="block text-sm font-medium">{t("task.status", "סטטוס")}</span>
          <select
            className={inputClass}
            value={shownStatus}
            onChange={(e) => setStatus(e.target.value as TaskStatus)}
          >
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {statusLabel[s]}
              </option>
            ))}
          </select>
        </label>

        {error && <p className="text-sm text-status-darkred">{error}</p>}

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? t("action.saving", "שומר…") : t("action.save", "שמור")}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("action.cancel", "ביטול")}
          </Button>
        </div>
      </form>
      {confirmNoActivist && (
        <ConfirmModal
          message={t(
            "task.confirm_no_activist",
            "אתם עומדים ליצור משימה ללא פעיל. האם אתם בטוחים?",
          )}
          busy={busy}
          onConfirm={() => void create()}
          onCancel={() => setConfirmNoActivist(false)}
        />
      )}
    </div>
  );
}
