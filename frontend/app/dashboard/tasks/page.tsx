"use client";

import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { ReportStatusBadge } from "@/components/ReportStatusBadge";
import { TaskQuickCreateForm } from "@/components/TaskQuickCreateForm";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InlineEdit } from "@/components/ui/InlineEdit";
import { TruncatedText } from "@/components/ui/TruncatedText";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useConfirm } from "@/lib/confirm";
import { useLocalization } from "@/lib/localization";
import { usePersistentState } from "@/lib/persist";
import { useToast } from "@/lib/toast";
import type { Campaign, Task, TaskPage, TaskStatus } from "@/lib/types";

const inputClass =
  "w-full rounded-md border border-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

type SortKey = "volunteer_name" | "created_at" | "report_number";

const STATUS_OPTIONS: TaskStatus[] = ["ACTIVE", "COMPLETED", "PAUSED"];

/** fixes58 §3.4: Tasks management grid — search/filter/sort/paginate, with
 *  inline-edit for status and the volunteer's report summary (the two
 *  fields the spec calls out; everything else is set at creation via the
 *  Users-page quick action and isn't re-editable here). */
export default function TasksPage() {
  const { isAdmin, isCampaignManager, loading } = useAuth();
  const { t } = useLocalization();
  const confirmDialog = useConfirm();
  const { success, error: toastError } = useToast();

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [items, setItems] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(true);

  const [q, setQ] = usePersistentState("crm.tasks.q", "");
  const [statusFilter, setStatusFilter] = usePersistentState<string[]>("crm.tasks.status", []);
  const [campaignFilter, setCampaignFilter] = usePersistentState<number[]>("crm.tasks.campaign", []);
  const [sort, setSort] = usePersistentState<SortKey>("crm.tasks.sort", "created_at");
  const [dir, setDir] = usePersistentState<"asc" | "desc">("crm.tasks.dir", "desc");
  const [page, setPage] = usePersistentState("crm.tasks.page", 1);
  const [pageSize, setPageSize] = usePersistentState("crm.tasks.pageSize", 20);
  // fixes60 §1: the page's own "New Task" button (was only reachable from
  // the Users page's per-row quick action).
  const [creating, setCreating] = useState(false);

  // fixes60 §4: same "Clear all filters" convention as Apartments/Contacts.
  const activeFilterCount = statusFilter.length + campaignFilter.length + (q.trim() ? 1 : 0);
  function clearAllFilters() {
    setStatusFilter([]);
    setCampaignFilter([]);
    setQ("");
    setPage(1);
  }

  const statusLabel: Record<TaskStatus, string> = {
    ACTIVE: t("task.status_active", "פעיל"),
    COMPLETED: t("task.status_completed", "הושלם"),
    PAUSED: t("task.status_paused", "מושהה"),
  };

  useEffect(() => {
    apiFetch<Campaign[]>("/api/campaigns").then(setCampaigns).catch(() => setCampaigns([]));
  }, []);

  function reload() {
    const params = new URLSearchParams();
    statusFilter.forEach((s) => params.append("status", s));
    campaignFilter.forEach((id) => params.append("campaign_id", String(id)));
    if (q.trim()) params.set("q", q.trim());
    params.set("sort", sort);
    params.set("dir", dir);
    params.set("page", String(page));
    params.set("page_size", String(pageSize));
    setBusy(true);
    return apiFetch<TaskPage>(`/api/tasks/list?${params}`)
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
      })
      .catch(() => {
        setItems([]);
        setTotal(0);
      })
      .finally(() => setBusy(false));
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, statusFilter, campaignFilter, sort, dir, page, pageSize]);

  function sortHeader(key: SortKey, label: string) {
    const active = sort === key;
    return (
      <button
        type="button"
        className="flex items-center gap-1 font-medium hover:text-foreground"
        onClick={() => {
          if (active) setDir(dir === "asc" ? "desc" : "asc");
          else {
            setSort(key);
            setDir("asc");
          }
          setPage(1);
        }}
      >
        {label}
        {active ? (
          dir === "asc" ? (
            <ArrowUp className="h-3.5 w-3.5" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5" />
          )
        ) : (
          // fixes54: a dim, always-visible arrow so an inactive sortable
          // column still reads as clickable.
          <ArrowUp className="h-3.5 w-3.5 text-muted-foreground/40" />
        )}
      </button>
    );
  }

  async function saveField(task: Task, data: Partial<Task>) {
    await apiFetch(`/api/tasks/${task.id}`, { method: "PUT", body: JSON.stringify(data) });
    await reload();
  }

  async function remove(task: Task) {
    if (
      !(await confirmDialog({
        message: t("msg.delete_task_confirm", "למחוק את המשימה?"),
        detail: `${task.volunteer_name} — ${task.campaign_name}`,
      }))
    ) {
      return;
    }
    await apiFetch(`/api/tasks/${task.id}`, { method: "DELETE" });
    await reload();
    success(t("msg.deleted", "נמחק בהצלחה"));
  }

  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  if (loading) return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;
  if (!isAdmin && !isCampaignManager) {
    return (
      <p className="text-status-darkred">
        {t("page.admins_only", "אין לך הרשאה לעמוד זה (מנהלים בלבד).")}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("page.tasks_title", "משימות")}</h1>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> {t("page.add_task", "משימה חדשה")}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className={`${inputClass} w-56`}
          placeholder={t("action.search", "חיפוש…")}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <MultiSelectFilter
          allLabel={t("filter.all_task_statuses", "כל הסטטוסים")}
          label={t("task.status", "סטטוס")}
          options={STATUS_OPTIONS.map((s) => ({ id: s, label: statusLabel[s] }))}
          value={statusFilter}
          onChange={(v) => {
            setStatusFilter(v);
            setPage(1);
          }}
        />
        <MultiSelectFilter
          allLabel={t("filter.all_campaigns", "כל הקמפיינים")}
          label={t("task.campaign", "קמפיין")}
          options={campaigns.map((c) => ({ id: c.id, label: c.name }))}
          value={campaignFilter}
          onChange={(v) => {
            setCampaignFilter(v);
            setPage(1);
          }}
        />
        {activeFilterCount > 0 && (
          <Button type="button" variant="outline" onClick={clearAllFilters}>
            <X className="h-4 w-4" /> {t("filter.clear_all", "נקה את כל הסינונים")}
          </Button>
        )}
      </div>

      <Card className="overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-start text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-start">{sortHeader("volunteer_name", t("task.volunteer", "פעיל"))}</th>
              <th className="px-3 py-2 text-start">{t("task.campaign", "קמפיין")}</th>
              <th className="px-3 py-2 text-start">{sortHeader("report_number", t("task.report_numbers", "מספרי דוח"))}</th>
              <th className="px-3 py-2 text-start">{t("task.status", "סטטוס")}</th>
              <th className="px-3 py-2 text-start">{t("task.report_status", "סטטוס דיווח")}</th>
              <th className="px-3 py-2 text-start">{t("task.report_notes", "הערות הפעיל")}</th>
              <th className="px-3 py-2 text-start">{sortHeader("created_at", t("task.created_at", "תאריך יצירה"))}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {busy ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                  {t("action.loading", "טוען…")}
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                  {t("page.no_tasks", "אין משימות להצגה.")}
                </td>
              </tr>
            ) : (
              items.map((task) => (
                <tr key={task.id}>
                  <td className="px-3 py-2">{task.volunteer_name}</td>
                  <td className="px-3 py-2">{task.campaign_name}</td>
                  <td className="px-3 py-2">{task.report_number_names.join(", ") || "—"}</td>
                  <td className="px-3 py-2">
                    <InlineEdit<TaskStatus>
                      value={task.status}
                      display={<span>{statusLabel[task.status]}</span>}
                      onSave={(v) => saveField(task, { status: v })}
                      editor={(draft, setDraft, commit) => (
                        <select
                          className={inputClass}
                          value={draft}
                          onChange={(e) => commit(e.target.value as TaskStatus)}
                          autoFocus
                        >
                          {STATUS_OPTIONS.map((s) => (
                            <option key={s} value={s}>
                              {statusLabel[s]}
                            </option>
                          ))}
                        </select>
                      )}
                    />
                  </td>
                  {/* fixes60 §1: the volunteer's own self-reported status/notes
                      (ShliachReportCompletion, resolved server-side) — replaces
                      the old free-text "Volunteer report" cell nobody actually
                      filled in, since the real report data lives elsewhere. */}
                  <td className="px-3 py-2">
                    {task.latest_report_status ? (
                      <ReportStatusBadge status={task.latest_report_status} />
                    ) : (
                      <span className="text-muted-foreground">
                        {t("task.no_report_yet", "טרם דווח")}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 max-w-[16rem]">
                    <TruncatedText text={task.latest_report_notes || "—"} />
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {task.created_at ? new Date(task.created_at).toLocaleDateString("he-IL") : "—"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-status-darkred/40 text-status-darkred hover:bg-status-darkred/10"
                      onClick={() => remove(task)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      {!busy && total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            <ChevronRight className="h-4 w-4" /> {t("pager.prev", "הקודם")}
          </Button>
          <span className="text-muted-foreground">
            {t("pager.range", "{from}–{to} מתוך {total}")
              .replace("{from}", String((page - 1) * pageSize + 1))
              .replace("{to}", String(Math.min(page * pageSize, total)))
              .replace("{total}", String(total))}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= lastPage}
            onClick={() => setPage(page + 1)}
          >
            {t("pager.next", "הבא")} <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      )}

      {creating && (
        <TaskQuickCreateForm
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false);
            await reload();
            success(t("msg.saved", "נשמר בהצלחה"));
          }}
        />
      )}
    </div>
  );
}
