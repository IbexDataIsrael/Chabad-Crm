"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { DatePicker } from "@/components/DatePicker";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { visibleOwnerOptions } from "@/lib/ownerFilter";
import type { UserSummary, VisitSummaryOut } from "@/lib/types";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** fixes38 §1.2: current-week default — Sunday-start for Hebrew, Monday-start
 *  for English (the app's only two locales). */
function currentWeekRange(lang: string): [string, string] {
  const now = new Date();
  const weekStartDow = lang === "en" ? 1 : 0;
  const diff = (now.getDay() - weekStartDow + 7) % 7;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return [toIso(start), toIso(end)];
}

const dateInputClass =
  "rounded-md border border-input px-3 py-1.5 text-sm focus:border-primary focus:outline-none";

/** fixes38 §1.2/§1.3: "Summary of Visits" report + per-contact Visit Summary
 *  section — same component, `contactId` scopes it to one contact and hides
 *  the admin "view all" toggle (irrelevant once a specific contact is picked). */
export function VisitSummary({ contactId }: { contactId?: number }) {
  const { t, lang } = useLocalization();
  const { user, isShliach } = useAuth();
  const [[defaultFrom, defaultTo]] = useState(() => currentWeekRange(lang));
  const [dateFrom, setDateFrom] = useState<string | null>(defaultFrom);
  const [dateTo, setDateTo] = useState<string | null>(defaultTo);
  // fixes50 §3.1: a standing "every date" toggle — the date pickers keep
  // their last value underneath so switching back off restores them.
  const [allDates, setAllDates] = useState(false);
  const [scopeAll, setScopeAll] = useState(false);
  const [data, setData] = useState<VisitSummaryOut | null>(null);
  // fixes40 §3: "Filter by contact owner" — same permission/search logic as
  // the Contacts page (fixes40 §2), shown next to the org-wide toggle.
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [assignedFilter, setAssignedFilter] = useState<string>("");
  const showOwnerFilter = contactId == null && !isShliach;
  const activistsMayViewContacts = user?.organization?.shliach_can_view_contacts ?? false;
  const ownerOptions = visibleOwnerOptions(users, activistsMayViewContacts);

  useEffect(() => {
    if (!showOwnerFilter) return;
    apiFetch<UserSummary[]>("/api/users").then(setUsers).catch(() => {});
  }, [showOwnerFilter]);

  // A selected owner that fell out of `ownerOptions` (deleted user, or the
  // org just turned "Activists may view contacts" off) resets to "all".
  useEffect(() => {
    if (assignedFilter && !ownerOptions.some((u) => u.guid === assignedFilter)) {
      setAssignedFilter("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerOptions, assignedFilter]);

  useEffect(() => {
    // fixes50 §3.1: "all dates" skips the range entirely; otherwise both
    // ends are required (unchanged from before this round).
    if (!allDates && (!dateFrom || !dateTo)) return;
    const params = new URLSearchParams();
    if (!allDates && dateFrom && dateTo) {
      params.set("date_from", dateFrom);
      params.set("date_to", dateTo);
    }
    if (contactId != null) params.set("contact_id", String(contactId));
    else if (assignedFilter) params.set("assigned_user_id", assignedFilter);
    // fixes50 §3.2: scope_all is no longer admin-only — see the matching
    // backend change (routers/visits.py) for why (staff already had the
    // narrower assigned_user_id widening; this closes the "all at once" gap).
    else if (!isShliach && scopeAll) params.set("scope_all", "true");
    let active = true;
    setData(null);
    apiFetch<VisitSummaryOut>(`/api/visits/summary?${params}`)
      .then((res) => {
        if (active) setData(res);
      })
      .catch(() => {
        if (active) setData({ total: 0, categories: [] });
      });
    return () => {
      active = false;
    };
  }, [dateFrom, dateTo, allDates, contactId, assignedFilter, scopeAll, isShliach]);

  // fixes39: the breakdown is dynamic (any active entity_type="visit"
  // boolean custom field) — the server only ever returns active
  // (CustomFieldDefinition.is_active) definitions, so there's no separate
  // client-side visibility filter to apply anymore.
  const categories = data?.categories ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">{t("visits.date_range", "טווח תאריכי ביקור")}:</span>
        <DatePicker
          value={dateFrom}
          onChange={setDateFrom}
          className={dateInputClass}
          placeholder={t("visits.date_from", "מתאריך")}
          disabled={allDates}
        />
        <DatePicker
          value={dateTo}
          onChange={setDateTo}
          className={dateInputClass}
          placeholder={t("visits.date_to", "עד תאריך")}
          disabled={allDates}
        />
        {/* fixes50 §3.1: prominent standing action to view every visitor
            regardless of the date range — the pickers above stay disabled
            (but keep their value) while it's on. */}
        <Button
          type="button"
          variant={allDates ? "default" : "outline"}
          size="sm"
          onClick={() => setAllDates((v) => !v)}
        >
          {t("visitsummary.all_dates", "הצג את כל התאריכים")}
        </Button>
        {/* fixes40 §3: "Filter by contact owner" — same permission/search
            logic as the Contacts page (fixes40 §2). Picking a specific
            owner supersedes the org-wide toggle below (same priority the
            backend applies), so that toggle is disabled while one is set. */}
        {showOwnerFilter && ownerOptions.length > 0 && (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            {t("filter.by_assigned", "משויך ל:")}
            <SearchableSelect
              className="w-48"
              value={assignedFilter || null}
              onChange={(guid) => setAssignedFilter(guid ?? "")}
              options={ownerOptions.map((u) => ({ id: u.guid, label: u.full_name }))}
              placeholder={t("filter.all_users", "כל המשתמשים")}
              emptyLabel={t("filter.all_users", "כל המשתמשים")}
            />
            {/* fixes42 §1: a standing, one-click way back to the unfiltered
                list — not just the hidden "clear" row inside the combobox. */}
            {assignedFilter && (
              <Button type="button" variant="outline" size="sm" onClick={() => setAssignedFilter("")}>
                {t("filter.show_all_records", "הצג את כל הרשומות")}
              </Button>
            )}
          </span>
        )}
        {/* fixes38 §1.2.4: toggle to view org-wide visits instead of just
            the ones assigned to the caller. Irrelevant (and hidden) once
            scoped to a single contact. fixes50 §3.2: no longer admin-only —
            staff already had the narrower assigned_user_id widening
            (fixes40 §3), so the "everyone at once" toggle now matches that
            same non-shliach guard instead of stopping staff from ever
            reaching an aggregate view. */}
        {contactId == null && !isShliach && (
          <label
            className={`inline-flex items-center gap-1.5 text-sm ${
              assignedFilter ? "text-muted-foreground" : "cursor-pointer"
            }`}
          >
            <input
              type="checkbox"
              className="accent-primary"
              checked={scopeAll}
              disabled={!!assignedFilter}
              onChange={(e) => setScopeAll(e.target.checked)}
            />
            {t("visitsummary.scope_all", "הצג את כל הביקורים בארגון")}
          </label>
        )}
      </div>

      {data === null ? (
        <p className="text-sm text-muted-foreground">{t("action.loading", "טוען…")}</p>
      ) : (
        <>
          <p className="text-sm font-medium">
            {t("visitsummary.total", "סה\"כ ביקורים: {n}").replace("{n}", String(data.total))}
          </p>
          {categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("visitsummary.none", "אין ביקורים בטווח שנבחר.")}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {categories.map((cat) => (
                <Card key={cat.key} className="p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium">
                      {(lang === "en" ? cat.english_label : null) || cat.hebrew_label}
                    </span>
                    <Badge className="rounded-full">{cat.count}</Badge>
                  </div>
                  {cat.items.length === 0 ? (
                    <p className="text-xs text-muted-foreground">{t("visitsummary.category_empty", "אין רשומות")}</p>
                  ) : (
                    <ul className="space-y-1">
                      {cat.items.map((item) => (
                        <li key={item.visit_id} className="text-xs">
                          {/* fixes38 §1.2.2: clickable link to the contact page. */}
                          <Link
                            href={`/dashboard/contacts/${item.contact_id}`}
                            className="text-primary hover:underline"
                          >
                            {item.contact_name || `#${item.contact_id}`}
                          </Link>
                          <span className="text-muted-foreground"> — {item.visit_date.slice(0, 10)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
