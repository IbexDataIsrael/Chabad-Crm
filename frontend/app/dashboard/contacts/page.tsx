"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { rowStyle } from "@/lib/colors";
import { useFieldSettings } from "@/lib/fieldSettings";
import { useLocalization } from "@/lib/localization";
import { usePicklist } from "@/lib/picklists";
import {
  contactFullName,
  type Contact,
  type ContactPage,
  type UserSummary,
} from "@/lib/types";

type SortKey = "created" | "name";

export default function ContactsPage() {
  const router = useRouter();
  const { t } = useLocalization();
  const { user, isShliach } = useAuth();
  const { isFieldVisible: vis } = useFieldSettings();
  const showStatus = vis("contacts.pipeline_status");
  const showPriority = vis("contacts.priority_score");
  // The color has no column of its own (fixes7 §8A) — it tints the whole row.
  const showColor = vis("contacts.color_tag");
  // Owner column is meaningless for a shliach (everything is theirs).
  const showOwner = !isShliach;
  // name + phone + created + actions + the trailing filler column are always
  // shown; add the visible toggleable columns + the owner column.
  const colCount =
    5 + [showStatus, showPriority, showOwner].filter(Boolean).length;
  const {
    options: statusOptions,
    labelFor: statusLabel,
    display: statusDisplay,
  } = usePicklist("contact.pipeline_status");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  // null = waiting for the session user; "" = all users (fixes11 §2.2).
  const [assignedFilter, setAssignedFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("created"); // fixes11 §2.3 default
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Users directory feeds the owner column + filter (admin/staff only).
  useEffect(() => {
    if (isShliach || !user) return;
    apiFetch<UserSummary[]>("/api/users").then(setUsers).catch(() => {});
  }, [isShliach, user]);

  // Default the filter to the logged-in user once the session resolves
  // (fixes11 §2.2); shliach lists are already server-scoped → no filter.
  useEffect(() => {
    if (assignedFilter !== null || !user) return;
    setAssignedFilter(isShliach ? "" : user.guid);
  }, [assignedFilter, user, isShliach]);

  const ownerName = (guid: string | null) =>
    (guid && users.find((u) => u.guid === guid)?.full_name) || "—";

  // Server-side page (fixes8 §2C pattern) instead of the full org dump.
  useEffect(() => {
    if (assignedFilter === null) return; // session not resolved yet
    const params = new URLSearchParams();
    params.set("contact_type", "mekurav"); // contacts page shows mekuravim only
    if (statusFilter) params.set("pipeline_status", statusFilter);
    if (assignedFilter) params.set("assigned_user_id", assignedFilter);
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
  }, [statusFilter, assignedFilter, sort, dir, page, pageSize]);

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
          {/* fixes10 §3.3: shliach users create (their own) contacts too. */}
          <Link
            href="/dashboard/contacts/new"
            className="rounded-md bg-status-magenta text-white px-4 py-2 text-sm font-medium hover:opacity-90"
          >
            + {t("page.new_contact", "איש קשר חדש")}
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        {showStatus && (
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
        {showOwner && users.length > 0 && (
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

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          {/* Data columns are content-width (w-px + nowrap); the empty trailing
              column absorbs the slack so everything condenses to the start. */}
          <thead className="bg-gray-50 text-gray-600 text-right">
            <tr>
              <th className="px-3 py-1.5 font-medium w-px whitespace-nowrap">
                {t("common.name", "שם")}
              </th>
              <th className="px-3 py-1.5 font-medium w-px whitespace-nowrap">
                {t("contacts.phone", "טלפון")}
              </th>
              {showOwner && (
                <th className="px-3 py-1.5 font-medium w-px whitespace-nowrap">
                  {t("contacts.assigned_user_id", "משויך ל")}
                </th>
              )}
              <th className="px-3 py-1.5 font-medium w-px whitespace-nowrap">
                {t("contacts.created_at", "נוצר בתאריך")}
              </th>
              {showStatus && (
                <th className="px-3 py-1.5 font-medium w-px whitespace-nowrap">
                  {t("contacts.pipeline_status", "סטטוס")}
                </th>
              )}
              {showPriority && (
                <th className="px-3 py-1.5 font-medium w-px whitespace-nowrap">
                  {t("contacts.priority_score", "ציון עדיפות")}
                </th>
              )}
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
                  <td className="px-3 py-1.5 w-px whitespace-nowrap" dir="ltr">{c.phone}</td>
                  {showOwner && (
                    <td className="px-3 py-1.5 w-px whitespace-nowrap">
                      {ownerName(c.assigned_user_id)}
                    </td>
                  )}
                  <td className="px-3 py-1.5 w-px whitespace-nowrap" dir="ltr">
                    {new Date(c.created_at).toLocaleDateString("he-IL")}
                  </td>
                  {showStatus && (
                    <td className="px-3 py-1.5 w-px whitespace-nowrap">
                      {statusLabel(c.pipeline_status)}
                    </td>
                  )}
                  {showPriority && (
                    <td className="px-3 py-1.5 w-px whitespace-nowrap">{c.priority_score ?? ""}</td>
                  )}
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
