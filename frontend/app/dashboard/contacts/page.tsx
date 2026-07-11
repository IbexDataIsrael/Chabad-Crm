"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { rowStyle } from "@/lib/colors";
import { useFieldSettings } from "@/lib/fieldSettings";
import { useLocalization } from "@/lib/localization";
import { usePersistentState } from "@/lib/persist";
import { usePicklist } from "@/lib/picklists";
import { useToast } from "@/lib/toast";
import {
  contactFullName,
  type Area,
  type Building,
  type Contact,
  type ContactPage,
  type UserSummary,
} from "@/lib/types";

type SortKey = "created" | "name";

/** Optional grid columns (fixes15 §5.1); name + actions are always shown. */
const COLUMN_KEYS = [
  "phone",
  "email",
  "owner",
  "area",
  "building",
  "created",
  "status",
  "priority",
  "address",
] as const;
type ColumnKey = (typeof COLUMN_KEYS)[number];

// The spec's current default layout: Name, Phone, Assigned-to (+created,
// which the page always showed until now).
const DEFAULT_COLUMNS: ColumnKey[] = ["phone", "owner", "created"];

/** `tel:` link (dialers accept the local format as-is). */
function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

/** WhatsApp deep link — wa.me wants an international number without '+'.
 *  Israeli local numbers (leading 0) become 972…; others pass through. */
function waHref(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `972${digits.slice(1)}`;
  return `https://wa.me/${digits}`;
}

export default function ContactsPage() {
  const router = useRouter();
  const { t } = useLocalization();
  const { user, isShliach } = useAuth();
  const { error: toastError } = useToast();
  const { isFieldVisible: vis } = useFieldSettings();
  // The color has no column of its own (fixes7 §8A) — it tints the whole row.
  const showColor = vis("contacts.color_tag");
  const {
    options: statusOptions,
    labelFor: statusLabel,
    display: statusDisplay,
  } = usePicklist("contact.pipeline_status");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  // fixes15 §1.2: every filter/sort/page selection survives navigation.
  const [statusFilter, setStatusFilter] = usePersistentState(
    "crm.contacts.status", "",
  );
  // null = waiting for the session user; "" = all users (fixes11 §2.2).
  const [assignedFilter, setAssignedFilter] = usePersistentState<string | null>(
    "crm.contacts.assigned", null,
  );
  const [areaIds, setAreaIds] = usePersistentState<number[]>(
    "crm.contacts.areaIds", [],
  );
  const [buildingIds, setBuildingIds] = usePersistentState<number[]>(
    "crm.contacts.buildingIds", [],
  );
  const [query, setQuery] = usePersistentState("crm.contacts.q", "");
  const [mitzvotOnly, setMitzvotOnly] = usePersistentState(
    "crm.contacts.mitzvot", false,
  );
  const [sort, setSort] = usePersistentState<SortKey>(
    "crm.contacts.sort", "created", // fixes11 §2.3 default
  );
  const [dir, setDir] = usePersistentState<"asc" | "desc">(
    "crm.contacts.dir", "desc",
  );
  const [page, setPage] = usePersistentState("crm.contacts.page", 1);
  const [pageSize, setPageSize] = usePersistentState("crm.contacts.pageSize", 20);
  const [columns, setColumns] = usePersistentState<ColumnKey[]>(
    "crm.contacts.columns", DEFAULT_COLUMNS,
  );
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  // Debounce the text search; `debouncedQ` is what actually hits the server.
  const [debouncedQ, setDebouncedQ] = useState(query);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Users directory feeds the owner column + filter (admin/staff only).
  useEffect(() => {
    if (isShliach || !user) return;
    apiFetch<UserSummary[]>("/api/users").then(setUsers).catch(() => {});
  }, [isShliach, user]);

  // Areas + buildings feed the geographic multi-select filters (fixes15 §5.1).
  useEffect(() => {
    if (!user) return;
    apiFetch<Area[]>("/api/areas").then(setAreas).catch(() => {});
    apiFetch<Building[]>("/api/buildings").then(setBuildings).catch(() => {});
  }, [user]);

  // Default the filter to the logged-in user once the session resolves
  // (fixes11 §2.2); shliach lists are already server-scoped → no filter.
  useEffect(() => {
    if (assignedFilter !== null || !user) return;
    setAssignedFilter(isShliach ? "" : user.guid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignedFilter, user, isShliach]);

  const ownerName = (guid: string | null) =>
    (guid && users.find((u) => u.guid === guid)?.full_name) || "—";

  function onQueryChange(v: string) {
    setQuery(v);
    setPage(1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQ(v), 300);
  }

  function listParams(): URLSearchParams {
    const params = new URLSearchParams();
    params.set("contact_type", "mekurav"); // contacts page shows mekuravim only
    if (statusFilter) params.set("pipeline_status", statusFilter);
    if (assignedFilter) params.set("assigned_user_id", assignedFilter);
    if (debouncedQ.trim()) params.set("q", debouncedQ.trim());
    areaIds.forEach((id) => params.append("area_ids", String(id)));
    buildingIds.forEach((id) => params.append("building_ids", String(id)));
    if (mitzvotOnly) params.set("has_mitzvot", "true");
    return params;
  }

  // Server-side page (fixes8 §2C pattern) instead of the full org dump.
  useEffect(() => {
    if (assignedFilter === null) return; // session not resolved yet
    const params = listParams();
    params.set("sort", sort);
    params.set("dir", dir);
    params.set("page", String(page));
    params.set("page_size", String(pageSize));
    setLoading(true);
    apiFetch<ContactPage>(`/api/contacts/list?${params}`)
      .then((res) => {
        setContacts(res.items);
        setTotal(res.total);
      })
      .catch(() => {
        setContacts([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    statusFilter, assignedFilter, debouncedQ, areaIds, buildingIds,
    mitzvotOnly, sort, dir, page, pageSize,
  ]);

  // fixes15 §5.2: mass email to the WHOLE filtered set via mailto: BCC.
  async function bulkEmail() {
    try {
      const emails = await apiFetch<string[]>(
        `/api/contacts/emails?${listParams()}`,
      );
      if (emails.length === 0) {
        toastError(t("msg.no_emails_in_list", "אין כתובות אימייל ברשימה המסוננת."));
        return;
      }
      window.location.href = `mailto:?bcc=${encodeURIComponent(emails.join(","))}`;
    } catch {
      toastError(t("msg.no_emails_in_list", "אין כתובות אימייל ברשימה המסוננת."));
    }
  }

  // Column availability = org-level field settings; the user's selection
  // (localStorage) picks among the available ones. Owner is meaningless for
  // a shliach (everything is theirs).
  const availability: Record<ColumnKey, boolean> = {
    phone: true,
    email: vis("contacts.email"),
    owner: !isShliach,
    area: true,
    building: true,
    created: true,
    status: vis("contacts.pipeline_status"),
    priority: vis("contacts.priority_score"),
    address: vis("contacts.address"),
  };
  const columnLabels: Record<ColumnKey, string> = {
    phone: t("contacts.phone", "טלפון"),
    email: t("contacts.email", "אימייל"),
    owner: t("contacts.assigned_user_id", "משויך ל"),
    area: t("contacts.area", "אזור"),
    building: t("contacts.building", "בניין"),
    created: t("contacts.created_at", "נוצר בתאריך"),
    status: t("contacts.pipeline_status", "סטטוס"),
    priority: t("contacts.priority_score", "ציון עדיפות"),
    address: t("contacts.address", "כתובת"),
  };
  const activeColumns = COLUMN_KEYS.filter(
    (k) => availability[k] && columns.includes(k),
  );
  // name + actions + quick actions + the trailing filler column.
  const colCount = 4 + activeColumns.length;

  function toggleColumn(k: ColumnKey) {
    setColumns((prev) =>
      prev.includes(k) ? prev.filter((c) => c !== k) : [...prev, k],
    );
  }

  function cell(c: Contact, k: ColumnKey) {
    switch (k) {
      case "phone":
        return <span dir="ltr">{c.phone}</span>;
      case "email":
        return <span dir="ltr">{c.email ?? ""}</span>;
      case "owner":
        return ownerName(c.assigned_user_id);
      case "area":
        return c.area_name ?? "—";
      case "building":
        return c.building_name ?? "—";
      case "created":
        return (
          <span dir="ltr">{new Date(c.created_at).toLocaleDateString("he-IL")}</span>
        );
      case "status":
        return statusLabel(c.pipeline_status);
      case "priority":
        return c.priority_score ?? "";
      case "address":
        return c.address ?? "—";
    }
  }

  const buildingOptions = buildings
    .filter((b) => areaIds.length === 0 || areaIds.includes(b.area_id))
    .map((b) => ({
      id: b.id,
      label:
        (b.building_address ?? "").split(",")[0].trim() ||
        b.building_name ||
        `#${b.id}`,
    }));

  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const rangeText = t("pager.range", "{from}–{to} מתוך {total}")
    .replace("{from}", String(total === 0 ? 0 : (page - 1) * pageSize + 1))
    .replace("{to}", String(Math.min(page * pageSize, total)))
    .replace("{total}", String(total));

  const selectClass =
    "rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t("contacts", "אנשי קשר")}</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={bulkEmail}
            className="rounded-md border border-status-magenta text-status-magenta px-4 py-2 text-sm font-medium hover:bg-status-magenta/10"
          >
            ✉ {t("action.bulk_email", "מייל לכל התוצאות")}
          </button>
          {/* fixes10 §3.3: shliach users create (their own) contacts too. */}
          <Link
            href="/dashboard/contacts/new"
            className="rounded-md bg-status-magenta text-white px-4 py-2 text-sm font-medium hover:opacity-90"
          >
            + {t("page.new_contact", "איש קשר חדש")}
          </Link>
        </div>
      </div>

      {/* fixes15 §5.1: apartments-style filters — geo multi-selects + search. */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <MultiSelectFilter
          allLabel={t("filter.all_areas", "כל האזורים")}
          options={areas.map((a) => ({ id: a.id, label: a.area_name }))}
          value={areaIds}
          onChange={(ids) => {
            setAreaIds(ids);
            // Drop building selections that fall outside the chosen areas.
            setBuildingIds((prev) =>
              ids.length === 0
                ? prev
                : prev.filter((bid) =>
                    buildings.some((b) => b.id === bid && ids.includes(b.area_id)),
                  ),
            );
            setPage(1);
          }}
        />
        <MultiSelectFilter
          allLabel={t("filter.all_buildings", "כל הבניינים")}
          options={buildingOptions}
          value={buildingIds}
          onChange={(ids) => {
            setBuildingIds(ids);
            setPage(1);
          }}
        />
        <input
          className={`${selectClass} flex-1 min-w-[12rem]`}
          placeholder={t("filter.search_contacts", "חיפוש לפי שם, טלפון או אימייל…")}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        {/* fixes15 §5.1: mitzvot quick filter. */}
        <label className="inline-flex items-center gap-1.5 text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            className="accent-status-magenta"
            checked={mitzvotOnly}
            onChange={(e) => {
              setMitzvotOnly(e.target.checked);
              setPage(1);
            }}
          />
          {t("filter.mitzvot_only", "רק עם מצוות קהילה")}
        </label>
      </div>

      <div className="flex flex-wrap gap-3">
        {availability.status && (
          <select
            className={selectClass}
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t("filter.all_statuses", "כל הסטטוסים")}</option>
            {statusOptions.map((o) => (
              <option key={o.id} value={o.value}>
                {statusDisplay(o)}
              </option>
            ))}
          </select>
        )}
        {/* fixes11 §2.2: owner filter, defaulting to the logged-in user. */}
        {!isShliach && users.length > 0 && (
          <span className="flex items-center gap-2 text-sm text-gray-500">
            {t("filter.by_assigned", "משויך ל:")}
            <select
              className={selectClass}
              value={assignedFilter ?? ""}
              onChange={(e) => {
                setAssignedFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{t("filter.all_users", "כל המשתמשים")}</option>
              {users.map((u) => (
                <option key={u.guid} value={u.guid}>
                  {u.full_name}
                </option>
              ))}
            </select>
          </span>
        )}
        {/* fixes11 §2.3: sorting — default is creation date, newest first. */}
        <span className="flex items-center gap-2 text-sm text-gray-500">
          {t("sort.label", "מיון:")}
          <select
            className={selectClass}
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as SortKey);
              setPage(1);
            }}
          >
            <option value="created">{t("sort.created", "תאריך יצירה")}</option>
            <option value="name">{t("sort.by_name", "שם")}</option>
          </select>
          <button
            type="button"
            onClick={() => {
              setDir(dir === "asc" ? "desc" : "asc");
              setPage(1);
            }}
            className="rounded-md border border-gray-300 px-3 py-2 hover:bg-gray-50"
            title={dir === "asc" ? t("sort.asc", "עולה") : t("sort.desc", "יורד")}
          >
            {dir === "asc" ? "↑" : "↓"}
          </button>
        </span>
        <span className="ms-auto flex items-center gap-2 text-sm text-gray-500">
          <button
            type="button"
            onClick={() => setColumnsOpen((v) => !v)}
            className="rounded-md border border-gray-300 px-3 py-2 hover:bg-gray-50"
          >
            ⚙ {t("columns.configure", "התאמת עמודות")}
          </button>
          {t("pager.page_size", "בעמוד:")}
          <select
            className={selectClass}
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
          >
            {[20, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </span>
      </div>

      {/* fixes15 §5.1: user-selected grid columns (persisted per browser). */}
      {columnsOpen && (
        <div className="bg-white rounded-xl shadow-sm p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t("columns.title", "עמודות מוצגות")}</h3>
            <button
              type="button"
              onClick={() => setColumns(DEFAULT_COLUMNS)}
              className="text-xs text-status-magenta hover:underline"
            >
              {t("columns.reset", "איפוס ברירת מחדל")}
            </button>
          </div>
          <p className="text-xs text-gray-400">
            {t(
              "columns.hint",
              "בחר אילו עמודות יוצגו בטבלה. ההעדפה נשמרת בדפדפן זה.",
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {COLUMN_KEYS.filter((k) => availability[k]).map((k) => {
              const on = columns.includes(k);
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => toggleColumn(k)}
                  className={`rounded-md border px-3 py-1.5 text-sm ${
                    on
                      ? "border-status-magenta bg-status-magenta/10 text-status-magenta"
                      : "border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {on ? "✓ " : ""}
                  {columnLabels[k]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          {/* Data columns are content-width (w-px + nowrap); the empty trailing
              column absorbs the slack so everything condenses to the start. */}
          <thead className="bg-gray-50 text-gray-600 text-right">
            <tr>
              <th className="px-3 py-1.5 font-medium w-px whitespace-nowrap">
                {t("common.name", "שם")}
              </th>
              {activeColumns.map((k) => (
                <th key={k} className="px-3 py-1.5 font-medium w-px whitespace-nowrap">
                  {columnLabels[k]}
                </th>
              ))}
              <th className="px-3 py-1.5 font-medium w-px whitespace-nowrap"></th>
              <th className="px-3 py-1.5 font-medium w-px whitespace-nowrap"></th>
              <th className="w-full"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-6 text-center text-gray-400">
                  {t("action.loading", "טוען…")}
                </td>
              </tr>
            ) : contacts.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-6 text-center text-gray-400">
                  {t("page.no_contacts", "אין אנשי קשר עדיין.")}
                </td>
              </tr>
            ) : (
              contacts.map((c) => (
                <tr
                  key={c.id}
                  style={showColor ? rowStyle(c.color_tag) : undefined}
                  onClick={() => router.push(`/dashboard/contacts/${c.id}`)}
                  className="border-t border-gray-100 cursor-pointer hover:bg-gray-50/80"
                >
                  <td
                    className="px-3 py-1.5 font-medium text-status-magenta underline max-w-[11rem] truncate"
                    title={contactFullName(c)}
                  >
                    {contactFullName(c)}
                  </td>
                  {activeColumns.map((k) => (
                    <td key={k} className="px-3 py-1.5 w-px whitespace-nowrap">
                      {cell(c, k)}
                    </td>
                  ))}
                  {/* fixes15 §5.2: single-click call / WhatsApp / email. */}
                  <td className="px-3 py-1.5 w-px whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      {c.phone && (
                        <a
                          href={telHref(c.phone)}
                          onClick={(e) => e.stopPropagation()}
                          title={t("action.call", "חיוג")}
                          className="rounded-full border border-gray-200 p-1.5 leading-none hover:bg-status-green/10"
                        >
                          📞
                        </a>
                      )}
                      {c.phone && (
                        <a
                          href={waHref(c.phone)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title={t("action.whatsapp", "וואטסאפ")}
                          className="rounded-full border border-gray-200 p-1.5 leading-none hover:bg-status-green/10"
                        >
                          💬
                        </a>
                      )}
                      {c.email && (
                        <a
                          href={`mailto:${c.email}`}
                          onClick={(e) => e.stopPropagation()}
                          title={t("action.send_email", "שליחת מייל")}
                          className="rounded-full border border-gray-200 p-1.5 leading-none hover:bg-status-magenta/10"
                        >
                          ✉
                        </a>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 w-px whitespace-nowrap">
                    <Link
                      href={`/dashboard/contacts/${c.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-sm text-status-magenta hover:underline whitespace-nowrap"
                    >
                      {t("action.open_edit", "פתח / עריכה ›")}
                    </Link>
                  </td>
                  <td></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Server-side pager (fixes8 §2C pattern). */}
      {!loading && total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("pager.prev", "→ הקודם")}
          </button>
          <span className="text-gray-500">{rangeText}</span>
          <button
            type="button"
            disabled={page >= lastPage}
            onClick={() => setPage(page + 1)}
            className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("pager.next", "הבא ←")}
          </button>
        </div>
      )}
    </div>
  );
}
