"use client";

import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ClipboardPen,
  Eye,
  Loader2,
  Plus,
  Printer,
  QrCode,
  Settings,
  Settings2,
  SlidersHorizontal,
  Trash2,
  UserCheck,
  UserMinus,
  X,
  Map as MapIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { ReportStatusBadge } from "@/components/ReportStatusBadge";
import { TaskQuickCreateForm } from "@/components/TaskQuickCreateForm";
import { TaskMapView } from "@/components/TaskMapView";
import { TaskLinkButton } from "@/components/tasks/TaskLinkButton";
import { TaskSheetFieldsModal } from "@/components/tasks/TaskSheetFieldsModal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InlineEdit } from "@/components/ui/InlineEdit";
import { TruncatedText } from "@/components/ui/TruncatedText";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useConfirm } from "@/lib/confirm";
import { useFieldSettings } from "@/lib/fieldSettings";
import { useLocalization } from "@/lib/localization";
import { usePersistentState } from "@/lib/persist";
import { usePicklist } from "@/lib/picklists";
import { useDbPreference } from "@/lib/preferences";
import { useToast } from "@/lib/toast";
import {
  TaskCustomFieldEditor,
  useTaskCustomFields,
  useTaskSheetFacts,
  type TaskCustomField,
} from "@/lib/taskCustomFields";
import { printTaskSheet, printTaskSheets } from "@/lib/taskPrint";
import { useTaskSheetCatalog, useTaskSheetFields } from "@/lib/taskSheetFields";
import {
  TASK_STATUS_OPTIONS,
  taskApartmentsHref,
  taskStatusLabels,
  taskStatusOptionsFor,
} from "@/lib/taskStatus";
import { useSortableList } from "@/lib/useSortableList";
import type { Campaign, Task, TaskPage, TaskStatus } from "@/lib/types";

type AssignmentFilter = "" | "orphan" | "assigned";

interface ActivistOption {
  id: number;
  full_name: string;
  role: string;
  is_active: boolean;
}

const inputClass =
  "w-full rounded-md border border-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

// fixes104 §1: filter controls size to their content — inputClass is w-full,
// which made every filter take a whole row of its own.
const filterClass =
  "rounded-md border border-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

type SortKey = "volunteer_name" | "created_at" | "report_number";

// fixes104 §3: the grid's optional built-in columns (the task number and the
// row actions always show). Custom task fields join as `pl:`/`cf:` keys.
const FIXED_COLUMNS = [
  "volunteer",
  "campaign",
  "report_numbers",
  "status",
  "report_status",
  "report_notes",
  "custom_date",
  "apartment_count",
  "created_at",
] as const;
type FixedColumn = (typeof FIXED_COLUMNS)[number];
// fixes108: custom_date shows by default (it was hidden, so it never appeared
// among the task's fields unless a user went looking in the column chooser).
const DEFAULT_HIDDEN_COLUMNS: string[] = ["apartment_count"];

// The "blank" value the backend list filters understand (same as apartments).
const EMPTY_FIELD_SENTINEL = "\u0000__empty__\u0000";

/** fixes58 §3.4: Tasks management grid — search/filter/sort/paginate, with
 *  inline-edit for the activist and status. fixes67: every row opens its
 *  own page (/dashboard/tasks/{id}) where every field is inline-editable.
 *  fixes104: contacts-style filter bar + column chooser, the org's custom
 *  task fields as columns/filters, and "print all displayed tasks". */
export default function TasksPage() {
  const { isAdmin, isCampaignManager, loading, user } = useAuth();
  const { t, lang } = useLocalization();
  const confirmDialog = useConfirm();
  const { success, error: toastError } = useToast();
  const customDate = usePicklist("task.custom_date");

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [items, setItems] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(true);
  const [fieldsModalOpen, setFieldsModalOpen] = useState(false);
  const [taskSheetFields] = useTaskSheetFields();
  // fixes74 §9: the printable columns (hidden fields excluded).
  const { columns: taskSheetCatalog } = useTaskSheetCatalog();
  // fixes104 §2: the org's own task fields (Picklists page → Tasks tab).
  const { fields: customFields, picklists: customPicklists } = useTaskCustomFields();
  const { isFieldVisible } = useFieldSettings();
  const taskFacts = useTaskSheetFacts();

  const [q, setQ] = usePersistentState("crm.tasks.q", "");
  const [statusFilter, setStatusFilter] = usePersistentState<string[]>("crm.tasks.status", []);
  const [campaignFilter, setCampaignFilter] = usePersistentState<number[]>("crm.tasks.campaign", []);
  // fixes65 §8: the orphan pool (printed, unclaimed) vs. assigned tasks.
  const [assignmentFilter, setAssignmentFilter] = usePersistentState<AssignmentFilter>(
    "crm.tasks.assignment", "",
  );
  // fixes104 §2: custom task field filters — picklists by value, other
  // fields by yes/no or "contains" text (debounced, like apartments).
  const [picklistFilters, setPicklistFilters] = usePersistentState<Record<string, string[]>>(
    "crm.tasks.picklistFilters", {},
  );
  const [customFieldFilters, setCustomFieldFilters] = usePersistentState<Record<string, string>>(
    "crm.tasks.customFieldFilters", {},
  );
  const [debouncedCustomFieldFilters, setDebouncedCustomFieldFilters] = useState(customFieldFilters);
  const customFieldDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // fixes104 §1: the filter block can be tucked away (filters keep applying).
  const [filtersOpen, setFiltersOpen] = usePersistentState("crm.tasks.filtersOpen", true);
  // fixes104 §3: which columns show and in what order — DB-stored like the
  // contacts grid. `hiddenColumns` null = the defaults; `columnOrder` empty =
  // the natural order (anything not in it keeps its natural position).
  const [hiddenColumns, setHiddenColumns] = useDbPreference<string[] | null>("tasks.hiddenColumns", null);
  const [columnOrder, setColumnOrder] = useDbPreference<string[]>("tasks.columnOrder", []);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const { containerRef: columnsSortableRef, withClickGuard } = useSortableList<HTMLDivElement>(
    (orderedKeys) => {
      if (orderedKeys.length > 0) setColumnOrder(orderedKeys);
    },
  );
  const [activists, setActivists] = useState<ActivistOption[]>([]);
  const [printingId, setPrintingId] = useState<number | null>(null);
  const [printingAll, setPrintingAll] = useState(false);
  // fixes96: the task whose map is open in the modal.
  const [mapTaskId, setMapTaskId] = useState<number | null>(null);
  useEffect(() => {
    if (mapTaskId == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMapTaskId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mapTaskId]);
  const [sort, setSort] = usePersistentState<SortKey>("crm.tasks.sort", "created_at");
  const [dir, setDir] = usePersistentState<"asc" | "desc">("crm.tasks.dir", "desc");
  const [page, setPage] = usePersistentState("crm.tasks.page", 1);
  const [pageSize, setPageSize] = usePersistentState("crm.tasks.pageSize", 20);
  // fixes60 §1: the page's own "New Task" button (was only reachable from
  // the Users page's per-row quick action).
  const [creating, setCreating] = useState(false);

  // Only filters on fields the org still has (a deleted/hidden field's saved
  // selection silently stops applying).
  const customFieldKeys = new Set(customFields.map((f) => f.fieldKey));
  const activePicklistFilters = Object.entries(picklistFilters).filter(
    ([k, v]) => customFieldKeys.has(k) && v.length > 0,
  );
  const activeCustomFieldFilters = Object.entries(debouncedCustomFieldFilters).filter(
    ([k, v]) => customFieldKeys.has(k) && v !== "",
  );
  const customFilterCount =
    activePicklistFilters.length +
    Object.entries(customFieldFilters).filter(([k, v]) => customFieldKeys.has(k) && v !== "").length;

  // fixes60 §4: same "Clear all filters" convention as Apartments/Contacts.
  const activeFilterCount =
    statusFilter.length +
    campaignFilter.length +
    (q.trim() ? 1 : 0) +
    (assignmentFilter ? 1 : 0) +
    customFilterCount;
  function clearAllFilters() {
    setStatusFilter([]);
    setCampaignFilter([]);
    setAssignmentFilter("");
    setQ("");
    setPicklistFilters({});
    setCustomFieldFilters({});
    setDebouncedCustomFieldFilters({});
    setPage(1);
  }

  function onCustomFieldFilterChange(fieldKey: string, value: string, immediate = false) {
    setCustomFieldFilters((prev) => ({ ...prev, [fieldKey]: value }));
    setPage(1);
    if (customFieldDebounceRef.current) clearTimeout(customFieldDebounceRef.current);
    const apply = () => setDebouncedCustomFieldFilters((prev) => ({ ...prev, [fieldKey]: value }));
    if (immediate) apply();
    else customFieldDebounceRef.current = setTimeout(apply, 300);
  }

  const statusLabel = taskStatusLabels(t);

  useEffect(() => {
    apiFetch<Campaign[]>("/api/campaigns").then(setCampaigns).catch(() => setCampaigns([]));
    apiFetch<ActivistOption[]>("/api/users")
      .then((rows) => setActivists(rows.filter((u) => u.role === "shliach" && u.is_active)))
      .catch(() => setActivists([]));
  }, []);

  const customFilterKey = JSON.stringify([activePicklistFilters, activeCustomFieldFilters]);

  function reload() {
    const params = new URLSearchParams();
    statusFilter.forEach((s) => params.append("status", s));
    campaignFilter.forEach((id) => params.append("campaign_id", String(id)));
    if (assignmentFilter) params.set("assignment", assignmentFilter);
    if (q.trim()) params.set("q", q.trim());
    for (const [fieldKey, values] of activePicklistFilters) {
      values.forEach((v) => params.append("picklist", `${fieldKey}:${v}`));
    }
    for (const [fieldKey, value] of activeCustomFieldFilters) {
      params.append("custom_field_filter", `${fieldKey}:${value}`);
    }
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
  }, [q, statusFilter, campaignFilter, assignmentFilter, customFilterKey, sort, dir, page, pageSize]);

  // --- Columns (fixes104 §3) -------------------------------------------------
  const fixedColumnLabels: Record<FixedColumn, string> = {
    volunteer: t("task.volunteer", "פעיל"),
    campaign: t("task.campaign", "קמפיין"),
    report_numbers: t("task.report_numbers", "מספרי דוח"),
    status: t("task.status", "סטטוס"),
    report_status: t("task.report_status", "סטטוס דיווח"),
    report_notes: t("task.report_notes", "הערות הפעיל"),
    custom_date: t("task.custom_date", "תאריך מותאם"),
    apartment_count: t("task.apartment_count", "מספר דירות"),
    created_at: t("task.created_at", "תאריך יצירה"),
  };
  const customByKey = new Map<string, TaskCustomField>(customFields.map((f) => [f.key, f]));
  // fixes108: an org that hid task.custom_date on the Fields page loses the column.
  const allColumnKeys: string[] = [
    ...FIXED_COLUMNS.filter((k) => k !== "custom_date" || isFieldVisible("task.custom_date")),
    ...customFields.map((f) => f.key),
  ];
  const columnLabel = (key: string) =>
    customByKey.get(key)?.label ?? fixedColumnLabels[key as FixedColumn] ?? key;
  const hidden = new Set(hiddenColumns ?? DEFAULT_HIDDEN_COLUMNS);
  const orderIndex = new Map(columnOrder.map((k, i) => [k, i]));
  const sortedColumnKeys = [...allColumnKeys].sort(
    (a, b) => (orderIndex.get(a) ?? Number.MAX_SAFE_INTEGER) - (orderIndex.get(b) ?? Number.MAX_SAFE_INTEGER),
  );
  const activeColumns = sortedColumnKeys.filter((k) => !hidden.has(k));
  // task number + active columns + actions.
  const colCount = activeColumns.length + 2;

  function toggleColumn(key: string) {
    setHiddenColumns((prev) => {
      const current = prev ?? DEFAULT_HIDDEN_COLUMNS;
      return current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    });
  }

  // fixes38-style ▲/▼ fallback for dragging (trackpads don't always drag).
  function moveColumn(key: string, delta: -1 | 1) {
    const idx = activeColumns.indexOf(key);
    const to = idx + delta;
    if (idx === -1 || to < 0 || to >= activeColumns.length) return;
    const full = [...sortedColumnKeys];
    const ia = full.indexOf(activeColumns[idx]);
    const ib = full.indexOf(activeColumns[to]);
    [full[ia], full[ib]] = [full[ib], full[ia]];
    setColumnOrder(full);
  }

  function resetColumns() {
    setHiddenColumns(null);
    setColumnOrder([]);
  }

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

  function headerCell(key: string): ReactNode {
    if (key === "volunteer") return sortHeader("volunteer_name", columnLabel(key));
    if (key === "report_numbers") return sortHeader("report_number", columnLabel(key));
    if (key === "created_at") return sortHeader("created_at", columnLabel(key));
    return columnLabel(key);
  }

  async function saveField(task: Task, data: Partial<Task>) {
    await apiFetch(`/api/tasks/${task.id}`, { method: "PUT", body: JSON.stringify(data) });
    await reload();
  }

  const printOptions = {
    orgName: user?.organization?.name ?? "",
    orgLogoUrl: user?.organization?.logo_url,
    t,
    lang,
    fields: taskSheetFields,
    catalog: taskSheetCatalog,
    taskFacts,
  };

  // fixes65 §3: the printable task sheet (QR only while unassigned).
  async function printTask(task: Task) {
    if (task.apartment_count === 0) return;
    setPrintingId(task.id);
    const err = await printTaskSheet({ ...printOptions, taskId: task.id });
    setPrintingId(null);
    if (err) toastError(err);
  }

  // fixes104 §4: every task shown on this page, in the grid's order, in one
  // PDF. Tasks with no apartments (e.g. text tasks) have no sheet.
  const printableItems = items.filter((task) => task.apartment_count > 0);
  async function printAllDisplayed() {
    if (printableItems.length === 0) return;
    setPrintingAll(true);
    const { printed, error } = await printTaskSheets({
      ...printOptions,
      taskIds: printableItems.map((task) => task.id),
    });
    setPrintingAll(false);
    if (error) {
      toastError(error);
      return;
    }
    const skipped = items.length - printed;
    success(
      skipped > 0
        ? t("task.print_all_done_skipped", "הודפסו {n} משימות ({skipped} ללא דירות דולגו)")
            .replace("{n}", String(printed))
            .replace("{skipped}", String(skipped))
        : t("task.print_all_done", "הודפסו {n} משימות").replace("{n}", String(printed)),
    );
  }

  // fixes65 §4: admin override — back to the orphan pool (printouts stay valid).
  async function unassign(task: Task) {
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
    await apiFetch(`/api/tasks/${task.id}/unassign`, { method: "POST" });
    await reload();
    success(t("task.unassigned_toast", "המשימה הוחזרה למאגר"));
  }

  function volunteerCell(task: Task) {
    const current = task.volunteer_user_id;
    const display = task.is_orphan ? (
      <span className="inline-flex items-center gap-1 rounded-full border border-status-orange/40 bg-status-orange/10 px-2 py-0.5 text-xs font-medium text-status-orange">
        {t("task.orphan_badge", "לא משויך")}
      </span>
    ) : current == null ? (
      <span className="text-muted-foreground">{t("task.office_handled", "בטיפול המשרד")}</span>
    ) : (
      <span className="inline-flex items-center gap-1">
        {task.volunteer_name}
        {task.claimed_via === "qr" && (
          <span title={t("task.claimed_via_qr", "נלקחה בסריקת קוד QR")}>
            <QrCode className="h-3.5 w-3.5 text-muted-foreground" />
          </span>
        )}
        {/* fixes74 §4: picked by hand in this table (claim link switched off). */}
        {task.claimed_via === "manual" && (
          <span title={t("task.claimed_via_manual", "שויכה ידנית")}>
            <UserCheck className="h-3.5 w-3.5 text-muted-foreground" />
          </span>
        )}
      </span>
    );
    return (
      <InlineEdit<number | "">
        value={current ?? ""}
        display={display}
        onSave={(v) => (v === "" ? Promise.resolve() : saveField(task, { volunteer_user_id: v }))}
        editor={(draft, _setDraft, commit) => (
          <select
            className={inputClass}
            value={draft}
            onChange={(e) => commit(e.target.value ? Number(e.target.value) : "")}
            autoFocus
          >
            <option value="">{t("task.select_activist", "בחר פעיל")}</option>
            {activists.map((a) => (
              <option key={a.id} value={a.id}>
                {a.full_name}
              </option>
            ))}
          </select>
        )}
      />
    );
  }

  function cell(task: Task, key: string): ReactNode {
    const custom = customByKey.get(key);
    if (custom) {
      return (
        <TaskCustomFieldEditor
          task={task}
          field={custom}
          labelFor={customPicklists.labelFor}
          onSave={(data) => saveField(task, data)}
        />
      );
    }
    switch (key as FixedColumn) {
      case "volunteer":
        return volunteerCell(task);
      case "campaign":
        return (
          // fixes67: the row's way into its own task page.
          <Link href={`/dashboard/tasks/${task.id}`} className="text-primary hover:underline">
            {task.campaign_name}
          </Link>
        );
      case "report_numbers":
        // fixes98: a text task shows its text instead.
        return task.task_text ? (
          <span className="line-clamp-2 whitespace-pre-wrap" title={task.task_text}>
            📝 {task.task_text}
          </span>
        ) : (
          task.report_number_names.join(", ") || "—"
        );
      case "status":
        return (
          <InlineEdit<TaskStatus>
            value={task.status}
            display={<span>{statusLabel[task.status]}</span>}
            onSave={(v) => saveField(task, { status: v })}
            editor={(draft, _setDraft, commit) => (
              <select
                className={inputClass}
                value={draft}
                onChange={(e) => commit(e.target.value as TaskStatus)}
                autoFocus
              >
                {taskStatusOptionsFor(task).map((s) => (
                  <option key={s} value={s}>
                    {statusLabel[s]}
                  </option>
                ))}
              </select>
            )}
          />
        );
      // fixes60 §1: the volunteer's own self-reported status/notes
      // (ShliachReportCompletion, resolved server-side).
      case "report_status":
        return task.latest_report_status ? (
          <ReportStatusBadge status={task.latest_report_status} />
        ) : (
          <span className="text-muted-foreground">{t("task.no_report_yet", "טרם דווח")}</span>
        );
      case "report_notes":
        return <TruncatedText text={task.latest_report_notes || "—"} />;
      case "custom_date":
        return task.custom_date_value ? customDate.labelFor(task.custom_date_value) : "—";
      case "apartment_count":
        return <span className="tabular-nums">{task.apartment_count}</span>;
      case "created_at":
        return (
          <span className="text-muted-foreground">
            {task.created_at ? new Date(task.created_at).toLocaleDateString("he-IL") : "—"}
          </span>
        );
      default:
        return null;
    }
  }

  async function remove(task: Task) {
    if (
      !(await confirmDialog({
        message: t("msg.delete_task_confirm", "למחוק את המשימה?"),
        detail: `${task.volunteer_name || t("task.orphan_badge", "לא משויך")} — ${task.campaign_name}`,
      }))
    ) {
      return;
    }
    await apiFetch(`/api/tasks/${task.id}`, { method: "DELETE" });
    await reload();
    success(t("msg.deleted", "נמחק בהצלחה"));
  }

  function customFilter(f: TaskCustomField): ReactNode {
    if (f.kind === "pl") {
      const opts = customPicklists.map[f.fieldKey] ?? [];
      return (
        <MultiSelectFilter
          key={f.key}
          allLabel={f.label}
          label={f.label}
          options={[
            { id: EMPTY_FIELD_SENTINEL, label: t("filter.empty_option", "- (ריק)") },
            ...opts.map((o) => ({ id: o.value, label: customPicklists.display(o) })),
          ]}
          value={picklistFilters[f.fieldKey] ?? []}
          onChange={(vals) => {
            setPicklistFilters((prev) => ({ ...prev, [f.fieldKey]: vals }));
            setPage(1);
          }}
        />
      );
    }
    const value = customFieldFilters[f.fieldKey] ?? "";
    if (f.def.field_type === "boolean") {
      return (
        <select
          key={f.key}
          className={filterClass}
          aria-label={f.label}
          value={value}
          onChange={(e) => onCustomFieldFilterChange(f.fieldKey, e.target.value, true)}
        >
          <option value="">{f.label}</option>
          <option value="true">{t("filter.yes", "כן")}</option>
          <option value="false">{t("filter.no", "לא")}</option>
        </select>
      );
    }
    const isEmpty = value === EMPTY_FIELD_SENTINEL;
    return (
      <div key={f.key} className="flex items-center gap-1">
        <input
          className={`${filterClass} w-40`}
          placeholder={f.label}
          aria-label={f.label}
          disabled={isEmpty}
          value={isEmpty ? "" : value}
          onChange={(e) => onCustomFieldFilterChange(f.fieldKey, e.target.value)}
        />
        <label
          className="flex cursor-pointer items-center gap-1 whitespace-nowrap text-xs text-muted-foreground"
          title={t("filter.empty_hint_task", "הצג רק משימות ללא ערך בשדה זה")}
        >
          <input
            type="checkbox"
            className="accent-primary"
            checked={isEmpty}
            onChange={(e) =>
              onCustomFieldFilterChange(f.fieldKey, e.target.checked ? EMPTY_FIELD_SENTINEL : "", true)
            }
          />
          {t("filter.empty", "ריק")}
        </label>
      </div>
    );
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t("page.tasks_title", "משימות")}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {activeFilterCount > 0 && (
            <Button type="button" variant="outline" onClick={clearAllFilters}>
              <X className="h-4 w-4" /> {t("filter.clear_all", "נקה את כל הסינונים")}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => setFiltersOpen((v) => !v)}>
            <SlidersHorizontal className="h-4 w-4" />
            {filtersOpen ? t("filter.hide_filters", "הסתר סינון") : t("filter.show_filters", "הצג סינון")}
            {/* Collapsed filters keep applying — surface how many are active. */}
            {!filtersOpen && activeFilterCount > 0 && (
              <span className="ms-1 inline-flex items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-xs leading-none text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
          </Button>
          <Button type="button" variant="outline" onClick={() => setColumnsOpen((v) => !v)}>
            <Settings2 className="h-4 w-4" /> {t("columns.configure", "התאמת עמודות")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="border-primary text-primary hover:bg-primary/10"
            disabled={busy || printingAll || printableItems.length === 0}
            title={
              printableItems.length === 0
                ? t("task.print_all_none", "אין משימות עם דירות להדפסה בעמוד זה")
                : undefined
            }
            onClick={printAllDisplayed}
          >
            {printingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}{" "}
            {t("task.print_all", "הדפסת כל המשימות המוצגות")}
            {printableItems.length > 0 && ` (${printableItems.length})`}
          </Button>
          <Button
            variant="outline"
            title={t("task_pdf.fields_settings_title", "עיצוב דף ההדפסה")}
            aria-label={t("task_pdf.fields_settings_title", "עיצוב דף ההדפסה")}
            onClick={() => setFieldsModalOpen(true)}
          >
            <Settings className="h-4 w-4" />
          </Button>
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> {t("page.add_task", "משימה חדשה")}
          </Button>
        </div>
      </div>
      {fieldsModalOpen && <TaskSheetFieldsModal onClose={() => setFieldsModalOpen(false)} />}
      {mapTaskId != null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3"
          onClick={(e) => {
            if (e.target === e.currentTarget) setMapTaskId(null);
          }}
        >
          <div role="dialog" aria-modal="true" className="w-full max-w-4xl space-y-3 rounded-xl bg-card p-4 shadow-xl">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-bold">
                {t("task.map_title", "מפת משימה #{id}").replace("{id}", String(mapTaskId))}
              </h2>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setMapTaskId(null)}
                aria-label={t("action.close", "סגור")}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <TaskMapView taskId={mapTaskId} heightClass="h-[65vh]" />
          </div>
        </div>
      )}

      {/* fixes104 §3: same column chooser as the contacts grid. */}
      {columnsOpen && (
        <div className="space-y-2 rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t("columns.title", "עמודות מוצגות")}</h3>
            <button type="button" onClick={resetColumns} className="text-xs text-primary hover:underline">
              {t("columns.reset", "איפוס ברירת מחדל")}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("columns.reorder_hint", "גרור עמודה פעילה כדי לשנות את סדר ההצגה.")}
          </p>
          <div ref={columnsSortableRef} className="flex flex-wrap gap-2">
            {activeColumns.map((key, idx) => (
              <span key={key} data-sort-key={key} className="inline-flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={withClickGuard(() => toggleColumn(key))}
                  className="cursor-grab rounded-md border border-primary bg-primary/10 px-3 py-1.5 text-sm text-primary active:cursor-grabbing"
                >
                  ⠿ {columnLabel(key)}
                </button>
                <span className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => moveColumn(key, -1)}
                    title={t("action.move_up", "העלה")}
                    aria-label={t("action.move_up", "העלה")}
                    className="flex h-7 w-7 items-center justify-center rounded text-sm leading-none text-muted-foreground hover:bg-accent hover:text-primary active:bg-muted disabled:opacity-20"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    disabled={idx === activeColumns.length - 1}
                    onClick={() => moveColumn(key, 1)}
                    title={t("action.move_down", "הורד")}
                    aria-label={t("action.move_down", "הורד")}
                    className="flex h-7 w-7 items-center justify-center rounded text-sm leading-none text-muted-foreground hover:bg-accent hover:text-primary active:bg-muted disabled:opacity-20"
                  >
                    ▼
                  </button>
                </span>
              </span>
            ))}
            {sortedColumnKeys
              .filter((key) => hidden.has(key))
              .map((key) => (
                <button
                  key={key}
                  type="button"
                  data-sort-key={key}
                  data-sortable-disabled=""
                  onClick={() => toggleColumn(key)}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
                >
                  {columnLabel(key)}
                </button>
              ))}
          </div>
        </div>
      )}

      {/* fixes104 §1: one wrapping row of content-width filters, like the
          contacts/apartments pages. */}
      {filtersOpen && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <MultiSelectFilter
            allLabel={t("filter.all_task_statuses", "כל הסטטוסים")}
            label={t("task.status", "סטטוס")}
            options={TASK_STATUS_OPTIONS.map((s) => ({ id: s, label: statusLabel[s] }))}
            value={statusFilter}
            onChange={(v) => {
              setStatusFilter(v);
              setPage(1);
            }}
          />
          <select
            className={filterClass}
            value={assignmentFilter}
            aria-label={t("task.assignment", "שיוך")}
            onChange={(e) => {
              setAssignmentFilter(e.target.value as AssignmentFilter);
              setPage(1);
            }}
          >
            <option value="">{t("filter.all_assignments", "כל המשימות")}</option>
            <option value="orphan">{t("filter.orphan_tasks", "יתומות / לא משויכות")}</option>
            <option value="assigned">{t("filter.assigned_tasks", "משויכות")}</option>
          </select>
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
          {customFields.map(customFilter)}
          <input
            className={`${filterClass} min-w-[12rem] flex-1`}
            placeholder={t("action.search", "חיפוש…")}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
      )}

      <Card className="overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-start text-muted-foreground">
            <tr>
              {/* fixes74 §7: the task number first (rightmost in RTL). */}
              <th className="px-3 py-2 text-start">{t("task.number", "מס' משימה")}</th>
              {activeColumns.map((key) => (
                <th key={key} className="whitespace-nowrap px-3 py-2 text-start">
                  {headerCell(key)}
                </th>
              ))}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {busy ? (
              <tr>
                <td colSpan={colCount} className="px-3 py-6 text-center text-muted-foreground">
                  {t("action.loading", "טוען…")}
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-3 py-6 text-center text-muted-foreground">
                  {t("page.no_tasks", "אין משימות להצגה.")}
                </td>
              </tr>
            ) : (
              items.map((task) => (
                <tr key={task.id}>
                  <td className="px-3 py-2 font-medium tabular-nums">
                    <Link href={`/dashboard/tasks/${task.id}`} className="text-primary hover:underline">
                      #{task.id}
                    </Link>
                  </td>
                  {activeColumns.map((key) => (
                    <td
                      key={key}
                      className={`px-3 py-2 ${key === "report_notes" || customByKey.has(key) ? "max-w-[16rem]" : ""}`}
                    >
                      {cell(task, key)}
                    </td>
                  ))}
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <Button size="sm" variant="outline" asChild>
                        <Link
                          href={`/dashboard/tasks/${task.id}`}
                          title={t("task.open", "פתיחת משימה")}
                          aria-label={t("task.open", "פתיחת משימה")}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={task.apartment_count === 0 || printingId === task.id}
                        title={
                          task.apartment_count === 0
                            ? t("task.print_no_apartments", "אין דירות במשימה — אין מה להדפיס.")
                            : t("task.print", "הדפסת משימה")
                        }
                        aria-label={t("task.print", "הדפסת משימה")}
                        onClick={() => printTask(task)}
                      >
                        {printingId === task.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Printer className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      {/* fixes96: the task's buildings on a map (modal). */}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={task.apartment_count === 0}
                        title={t("task.map", "מפת המשימה")}
                        aria-label={t("task.map", "מפת המשימה")}
                        onClick={() => setMapTaskId(task.id)}
                      >
                        <MapIcon className="h-3.5 w-3.5" />
                      </Button>
                      <TaskLinkButton task={task} />
                      <Button size="sm" variant="outline" asChild>
                        <Link
                          href={taskApartmentsHref(task)}
                          title={t("task.paper_entry", "הזנת נתונים מדף מודפס")}
                          aria-label={t("task.paper_entry", "הזנת נתונים מדף מודפס")}
                        >
                          <ClipboardPen className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                      {!task.is_orphan && (
                        <Button
                          size="sm"
                          variant="outline"
                          title={t("task.unassign", "החזרה למאגר")}
                          aria-label={t("task.unassign", "החזרה למאגר")}
                          onClick={() => unassign(task)}
                        >
                          <UserMinus className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-status-darkred/40 text-status-darkred hover:bg-status-darkred/10"
                        aria-label={t("action.delete", "מחק")}
                        onClick={() => remove(task)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
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
          onSaved={async (createdCount) => {
            setCreating(false);
            await reload();
            success(
              createdCount != null
                ? t("task.bulk_created", "נוצרו {n} משימות").replace("{n}", String(createdCount))
                : t("msg.saved", "נשמר בהצלחה"),
            );
          }}
        />
      )}
    </div>
  );
}
