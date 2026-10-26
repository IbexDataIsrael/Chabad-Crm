"use client";

import Link from "next/link";
import { Eye, Pencil, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { VisitDetails } from "@/components/VisitDetails";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { usePersistentState } from "@/lib/persist";
import { usePicklist } from "@/lib/picklists";
import type { Visit } from "@/lib/types";
import { useConfirm } from "@/lib/confirm";

export default function VisitsPage() {
  const { isAdmin, loading } = useAuth();
  const { t } = useLocalization();
  const confirmDialog = useConfirm();
  const { labelFor } = usePicklist("visit.type");
  const [visits, setVisits] = useState<Visit[]>([]);
  // fixes15 §1.1/§1.2: search + paging survive navigation.
  const [query, setQuery] = usePersistentState("crm.visits.q", "");
  const [page, setPage] = usePersistentState("crm.visits.page", 1);
  const [pageSize, setPageSize] = usePersistentState("crm.visits.pageSize", 20);
  // fixes29 §1: the search/paging filter row can be tucked away (visibility
  // only — a hidden search keeps filtering the rows).
  const [filtersOpen, setFiltersOpen] = usePersistentState("crm.visits.filtersOpen", true);
  // fixes26 §2: a row expands to a read-only view ("הצג") or to the inline
  // per-field editor ("ערוך") — both render VisitDetails.
  const [expanded, setExpanded] = useState<{ id: number; mode: "view" | "edit" } | null>(
    null,
  );
  const [loaded, setLoaded] = useState(false);

  async function reload() {
    setVisits(await apiFetch<Visit[]>("/api/visits"));
  }

  useEffect(() => {
    if (loading || !isAdmin) return;
    reload().catch(() => setVisits([])).finally(() => setLoaded(true));
  }, [loading, isAdmin]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return visits;
    return visits.filter(
      (v) =>
        (v.contact_name ?? "").toLowerCase().includes(q) ||
        (v.notes ?? "").toLowerCase().includes(q),
    );
  }, [visits, query]);

  async function remove(id: number) {
    if (!(await confirmDialog({ message: t("visit.delete_confirm", "למחוק ביקור זה?") }))) return;
    await apiFetch(`/api/visits/${id}`, { method: "DELETE" });
    await reload();
  }

  // Client-side pager over the filtered rows (fixes15 §1.1).
  const lastPage = Math.max(1, Math.ceil(shown.length / pageSize));
  const safePage = Math.min(page, lastPage);
  const visible = shown.slice((safePage - 1) * pageSize, safePage * pageSize);
  const rangeText = t("pager.range", "{from}–{to} מתוך {total}")
    .replace("{from}", String(shown.length === 0 ? 0 : (safePage - 1) * pageSize + 1))
    .replace("{to}", String(Math.min(safePage * pageSize, shown.length)))
    .replace("{total}", String(shown.length));

  if (loading) return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;
  if (!isAdmin) {
    return (
      <p className="text-destructive">
        {t("page.admins_only", "אין לך הרשאה לעמוד זה (מנהלים בלבד).")}
      </p>
    );
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold tracking-wide">{t("page.visits", "ביקורים")}</h1>
        <div className="flex items-center gap-2">
          {/* fixes29 §1: show/hide the search/paging filter row below. */}
          <Button type="button" variant="outline" size="sm" onClick={() => setFiltersOpen((v) => !v)}>
            <SlidersHorizontal className="h-4 w-4" />
            {filtersOpen ? t("filter.hide_filters", "הסתר סינון") : t("filter.show_filters", "הצג סינון")}
          </Button>
          <Button asChild size="sm">
            <Link href="/dashboard/visits/add">
              <Plus className="h-4 w-4" /> {t("visit.add", "הוסף ביקור")}
            </Link>
          </Button>
        </div>
      </div>

      {filtersOpen && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Input
            className="w-full max-w-sm"
            placeholder={t("visit.search_ph", "חיפוש לפי איש קשר או הערות…")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
          <span className="ms-auto flex items-center gap-2 text-muted-foreground">
            {t("pager.page_size", "בעמוד:")}
            <select
              className="rounded-md border border-input px-3 py-2 text-sm focus:border-primary focus:outline-none"
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
      )}

      <div className="bg-card rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-background text-muted-foreground text-xs">
            <tr>
              <th className="px-3 py-2 text-start font-medium">{t("visit.contact", "איש קשר")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("visit.date", "תאריך")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("visit.type", "סוג ביקור")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("visit.location", "מיקום")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("visit.notes", "הערות")}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {!loaded ? null : shown.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  {t("visit.none", "אין ביקורים עדיין.")}
                </td>
              </tr>
            ) : (
              visible.map((v) =>
                expanded?.id === v.id ? (
                  <tr key={v.id} className="border-t border-border">
                    <td colSpan={6} className="p-3">
                      <VisitDetails
                        visit={v}
                        readOnly={expanded.mode === "view"}
                        onPatch={async (partial) => {
                          await apiFetch<Visit>(`/api/visits/${v.id}`, {
                            method: "PATCH",
                            body: JSON.stringify(partial),
                          });
                          await reload();
                        }}
                        onClose={() => setExpanded(null)}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={v.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      {v.contact_id ? (
                        <Link
                          href={`/dashboard/contacts/${v.contact_id}`}
                          className="text-primary hover:underline"
                        >
                          {v.contact_name}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2" dir="ltr">
                      {new Date(v.visit_date).toLocaleDateString("he-IL")}
                    </td>
                    <td className="px-3 py-2">{v.visit_type ? labelFor(v.visit_type) : ""}</td>
                    <td className="px-3 py-2">{v.location}</td>
                    <td className="px-3 py-2">{v.notes}</td>
                    <td className="px-3 py-2 text-end whitespace-nowrap">
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t("action.view", "הצג")}
                        aria-label={t("action.view", "הצג")}
                        className="h-8 w-8 text-primary hover:text-primary"
                        onClick={() => setExpanded({ id: v.id, mode: "view" })}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t("action.edit", "ערוך")}
                        aria-label={t("action.edit", "ערוך")}
                        className="h-8 w-8 text-primary hover:text-primary"
                        onClick={() => setExpanded({ id: v.id, mode: "edit" })}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t("action.delete", "מחק")}
                        aria-label={t("action.delete", "מחק")}
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => remove(v.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ),
              )
            )}
          </tbody>
        </table>
      </div>

      {loaded && shown.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={safePage <= 1}
            onClick={() => setPage(safePage - 1)}
          >
            {t("pager.prev", "→ הקודם")}
          </Button>
          <span className="text-muted-foreground">{rangeText}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={safePage >= lastPage}
            onClick={() => setPage(safePage + 1)}
          >
            {t("pager.next", "הבא ←")}
          </Button>
        </div>
      )}
    </div>
  );
}
