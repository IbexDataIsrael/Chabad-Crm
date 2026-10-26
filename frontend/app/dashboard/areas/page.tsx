"use client";

import Link from "next/link";
import { MapPin, Plus, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";

import { AreasMap } from "@/components/AreasMap";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError, apiFetch } from "@/lib/api";
import { isFeatureEnabled, useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { naturalCompare } from "@/lib/naturalSort";
import { usePersistentState } from "@/lib/persist";
import { useToast } from "@/lib/toast";
import {
  contactFullName,
  type Area,
  type GeneratePolygonResult,
  type JewishCounts,
  type ShliachSummary,
} from "@/lib/types";
import { useConfirm } from "@/lib/confirm";

// fixes53 §3: the grid's optional (toggleable) columns — name always shows.
const OPTIONAL_COLUMNS = ["boundary", "jews", "engaged", "activist"] as const;
type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number];
type SortKey = "name" | OptionalColumn;

interface Row {
  area: Area;
  jews: number;
  engaged: number;
  activists: ShliachSummary[];
}

export default function AreasPage() {
  const { isAdmin, loading, user } = useAuth();
  const { t } = useLocalization();
  const { success: toastSuccess, error: toastError } = useToast();
  const [areas, setAreas] = useState<Area[]>([]);
  const [jewishCounts, setJewishCounts] = useState<Record<number, JewishCounts>>({});
  const [assignments, setAssignments] = useState<Record<number, ShliachSummary[]>>({});
  const [generatingAll, setGeneratingAll] = useState(false);
  // fixes15 §7.1 multi-select filter + §1.1 pagination, persisted (§1.2).
  const [areaIds, setAreaIds] = usePersistentState<number[]>("crm.areas.ids", []);
  const [page, setPage] = usePersistentState("crm.areas.page", 1);
  const [pageSize, setPageSize] = usePersistentState("crm.areas.pageSize", 20);
  // fixes53 §3: grid controls, matching apartments/report-numbers.
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [fields, setFields] = usePersistentState<OptionalColumn[]>(
    "crm.areas.fields", ["boundary", "jews", "engaged", "activist"],
  );
  const [sortKey, setSortKey] = usePersistentState<SortKey>("crm.areas.sortKey", "name");
  const [sortDir, setSortDir] = usePersistentState<"asc" | "desc">("crm.areas.sortDir", "asc");

  async function reload() {
    const [rows, counts, links] = await Promise.all([
      apiFetch<Area[]>("/api/areas"),
      apiFetch<Record<number, JewishCounts>>("/api/areas/jewish-counts"),
      apiFetch<Record<number, ShliachSummary[]>>("/api/areas/shliach-assignments"),
    ]);
    setAreas(rows);
    setJewishCounts(counts);
    setAssignments(links);
  }

  useEffect(() => {
    reload().catch(() => {});
  }, []);

  // fixes60 §5: bulk convex-hull generation for every area in one call,
  // reporting per-area outcomes (a mix of ok/skipped is expected — areas
  // with <3 geocoded buildings are skipped, not an error).
  async function generateAllBoundaries() {
    setGeneratingAll(true);
    try {
      const results = await apiFetch<GeneratePolygonResult[]>(
        "/api/areas/generate-polygons",
        { method: "POST" },
      );
      const ok = results.filter((r) => r.ok).length;
      const skipped = results.length - ok;
      await reload();
      if (ok === 0) {
        toastError(
          t("areas.generate_all_none", "לא ניתן היה ליצור תחומים (אין מספיק בניינים עם קואורדינטות).")
        );
      } else {
        toastSuccess(
          t("areas.generate_all_result", "נוצרו תחומים ל-{ok} אזורים ({skipped} דולגו)")
            .replace("{ok}", String(ok))
            .replace("{skipped}", String(skipped)),
        );
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("msg.action_failed", "הפעולה נכשלה"));
    } finally {
      setGeneratingAll(false);
    }
  }

  function toggleField(f: OptionalColumn) {
    setFields((prev) => (prev.includes(f) ? prev.filter((k) => k !== f) : [...prev, f]));
  }

  function activistLabel(activists: ShliachSummary[]): string {
    return activists.map((a) => contactFullName(a)).join(", ");
  }

  function onSortClick(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  if (loading) return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;
  // fixes54 §8: the superadmin "Area display" toggle — off hides this
  // module for everyone in the org (defense in depth alongside the nav
  // link, which is already gone — see dashboard/layout.tsx).
  if (!isFeatureEnabled(user?.organization, "area_display_enabled")) {
    return (
      <p className="text-destructive">
        {t("page.module_disabled", "התכונה הזו כבויה עבור הארגון שלך.")}
      </p>
    );
  }

  const filtered =
    areaIds.length === 0 ? areas : areas.filter((a) => areaIds.includes(a.id));

  const rows: Row[] = filtered.map((area) => ({
    area,
    jews: jewishCounts[area.id]?.jews ?? 0,
    engaged: jewishCounts[area.id]?.engaged ?? 0,
    activists: assignments[area.id] ?? [],
  }));
  const sign = sortDir === "asc" ? 1 : -1;
  rows.sort((a, b) => {
    switch (sortKey) {
      case "jews":
        return sign * (a.jews - b.jews);
      case "engaged":
        return sign * (a.engaged - b.engaged);
      case "activist":
        return sign * naturalCompare(activistLabel(a.activists), activistLabel(b.activists));
      case "boundary":
        return sign * (Number(!!a.area.area_polygon) - Number(!!b.area.area_polygon));
      default:
        return sign * naturalCompare(a.area.area_name, b.area.area_name);
    }
  });

  const lastPage = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, lastPage);
  const visible = rows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const rangeText = t("pager.range", "{from}–{to} מתוך {total}")
    .replace("{from}", String(rows.length === 0 ? 0 : (safePage - 1) * pageSize + 1))
    .replace("{to}", String(Math.min(safePage * pageSize, rows.length)))
    .replace("{total}", String(rows.length));

  const inputClass =
    "rounded-md border border-input px-3 py-2 text-sm focus:border-primary focus:outline-none";

  const columnLabels: Record<OptionalColumn, string> = {
    boundary: t("page.area_boundary_col", "תחום"),
    jews: t("report.jews_count", "מספר יהודים"),
    engaged: t("report.engaged_jews_count", "מספר יהודים מעוניינים"),
    activist: t("report.activist_name", "שם הפעיל"),
  };

  function SortHeader({ column, label }: { column: SortKey; label: string }) {
    return (
      <th
        className="px-3 py-2 text-start font-medium cursor-pointer select-none hover:bg-accent"
        onClick={() => onSortClick(column)}
      >
        {label} {sortKey === column ? (sortDir === "asc" ? "↑" : "↓") : ""}
      </th>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-4xl">{t("areas", "אזורים")}</h1>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={generatingAll}
              onClick={generateAllBoundaries}
            >
              <MapPin className="h-4 w-4" />
              {generatingAll
                ? t("action.loading", "טוען…")
                : t("areas.generate_all_boundaries", "צור תחומים לכל האזורים")}
            </Button>
            <Button asChild>
              <Link href="/dashboard/areas/add">
                <Plus className="h-4 w-4" /> {t("page.add_area", "אזור חדש")}
              </Link>
            </Button>
          </div>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{t("page.areas_intro")}</p>

      {areas.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t("filter.by_area", "סנן לפי אזור:")}</span>
          <MultiSelectFilter
            allLabel={t("filter.all", "הכל")}
            options={areas.map((a) => ({ id: a.id, label: a.area_name }))}
            value={areaIds}
            onChange={(ids) => {
              setAreaIds(ids);
              setPage(1);
            }}
          />
          <Button
            type="button"
            variant="outline"
            className={fieldsOpen ? "border-primary bg-primary/10 text-primary hover:bg-primary/10" : ""}
            onClick={() => setFieldsOpen(!fieldsOpen)}
          >
            <Settings2 className="h-4 w-4" /> {t("columns.title", "עמודות מוצגות")}
          </Button>
          <span className="ms-auto flex items-center gap-2 text-muted-foreground">
            {t("pager.page_size", "בעמוד:")}
            <select
              className={inputClass}
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

      {fieldsOpen && (
        <div className="glass-card p-4 flex flex-wrap gap-2">
          {OPTIONAL_COLUMNS.map((f) => {
            const active = fields.includes(f);
            return (
              <button
                key={f}
                type="button"
                onClick={() => toggleField(f)}
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-accent"
                }`}
              >
                {active ? "✓ " : ""}
                {columnLabels[f]}
              </button>
            );
          })}
        </div>
      )}

      {/* All the org's zone polygons on one map (fixes7 §7A) — filtered. */}
      {filtered.some((a) => a.area_polygon) && (
        <div className="glass-card p-2 space-y-1">
          <h2 className="px-2 pt-1 text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
            <MapPin className="h-4 w-4" /> {t("areas.map_all", "מפת האזורים")}
          </h2>
          <AreasMap areas={filtered} />
        </div>
      )}

      <div className="glass-card overflow-x-auto">
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-muted-foreground">
            {t("page.no_areas", "אין אזורים עדיין.")}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-background text-muted-foreground">
              <tr>
                <SortHeader column="name" label={t("areas.area_name", "כותרת")} />
                {fields.map((f) => (
                  <SortHeader key={f} column={f} label={columnLabels[f]} />
                ))}
                <th className="px-3 py-2 text-start font-medium">
                  {t("action.actions", "פעולות")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map(({ area, jews, engaged, activists }) => (
                <AreaRow
                  key={area.id}
                  area={area}
                  jews={jews}
                  engaged={engaged}
                  activists={activists}
                  fields={fields}
                  isAdmin={isAdmin}
                  onChanged={reload}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Client-side pager (fixes15 §1.1 — areas live in one small list). */}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => setPage(safePage - 1)}
            className="rounded-md border border-input px-3 py-1.5 hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("pager.prev", "→ הקודם")}
          </button>
          <span className="text-muted-foreground">{rangeText}</span>
          <button
            type="button"
            disabled={safePage >= lastPage}
            onClick={() => setPage(safePage + 1)}
            className="rounded-md border border-input px-3 py-1.5 hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("pager.next", "הבא ←")}
          </button>
        </div>
      )}
    </div>
  );
}

function AreaRow({
  area,
  jews,
  engaged,
  activists,
  fields,
  isAdmin,
  onChanged,
}: {
  area: Area;
  jews: number;
  engaged: number;
  activists: ShliachSummary[];
  fields: OptionalColumn[];
  isAdmin: boolean;
  onChanged: () => Promise<void>;
}) {
  const { t } = useLocalization();
  const confirmDialog = useConfirm();
  const { success: toastSuccess, error: toastError } = useToast();
  // fixes33 §2.2: only set while the backend reports the area has buildings
  // and we're waiting on the admin's cascade/unassign/abort choice.
  const [cascadeChoiceOpen, setCascadeChoiceOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);

  // fixes60 §5: single-area convex-hull generation, mirroring the page-level
  // bulk action — same endpoint family, one area's outcome.
  async function generateBoundary() {
    setGenerating(true);
    try {
      const result = await apiFetch<GeneratePolygonResult>(
        `/api/areas/${area.id}/generate-polygon`,
        { method: "POST" },
      );
      if (result.ok) {
        toastSuccess(t("areas.generate_one_ok", "התחום נוצר בהצלחה"));
        await onChanged();
      } else {
        toastError(
          result.skipped_reason ??
            t("areas.generate_one_skipped", "לא ניתן היה ליצור תחום לאזור זה"),
        );
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("msg.action_failed", "הפעולה נכשלה"));
    } finally {
      setGenerating(false);
    }
  }

  async function attemptDelete(mode?: "cascade" | "unassign") {
    const qs = mode ? `?mode=${mode}` : "";
    try {
      await apiFetch(`/api/areas/${area.id}${qs}`, { method: "DELETE" });
      setCascadeChoiceOpen(false);
      await onChanged();
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        (err.body as { has_buildings?: boolean } | undefined)?.has_buildings
      ) {
        setCascadeChoiceOpen(true);
        return;
      }
      toastError(err instanceof Error ? err.message : t("msg.delete_failed", "מחיקה נכשלה"));
    }
  }

  async function remove() {
    if (!(await confirmDialog({ message: t("msg.delete_area_confirm", "למחוק את האזור?"), detail: area.area_name })))
      return;
    await attemptDelete();
  }

  async function resolveCascadeChoice(mode: "cascade" | "unassign") {
    setBusy(true);
    try {
      await attemptDelete(mode);
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td className="px-3 py-2">
        <Link
          href={`/dashboard/areas/${area.id}`}
          className="font-medium text-primary hover:underline"
        >
          {/* fixes62 §2.2: a name like "א13" must not have its digits reordered
              when this LTR-container cell inherits English/LTR text direction. */}
          <bdi>{area.area_name}</bdi>
        </Link>
      </td>
      {fields.map((f) => (
        <td key={f} className="px-3 py-2">
          {f === "jews" && jews}
          {f === "engaged" && engaged}
          {f === "boundary" &&
            (area.area_polygon ? (
              <Badge variant="success">{t("page.area_has_boundary", "תחום מוגדר")}</Badge>
            ) : (
              <Badge variant="secondary">{t("page.area_no_boundary", "ללא תחום")}</Badge>
            ))}
          {f === "activist" &&
            (activists.length === 0 ? (
              <span className="text-muted-foreground">{t("report.no_activist", "אין פעיל משויך")}</span>
            ) : (
              <span className="flex flex-wrap gap-1">
                {activists.map((a, i) => (
                  <span key={a.id}>
                    <Link
                      href={`/dashboard/contacts/${a.id}`}
                      className="text-primary hover:underline"
                    >
                      {contactFullName(a)}
                    </Link>
                    {i < activists.length - 1 ? "," : ""}
                  </span>
                ))}
              </span>
            ))}
        </td>
      ))}
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <Link
            href={`/dashboard/areas/${area.id}`}
            className="text-primary hover:underline"
          >
            {t("page.show_area", "הצג אזור »")}
          </Link>
          {isAdmin && (
            <>
              <Button asChild size="sm" variant="secondary">
                <Link href={`/dashboard/areas/${area.id}/edit`}>{t("action.edit", "ערוך")}</Link>
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={generating}
                onClick={generateBoundary}
              >
                {generating
                  ? t("action.loading", "טוען…")
                  : area.area_polygon
                    ? t("areas.regenerate_boundary", "צור תחום מחדש")
                    : t("areas.generate_boundary", "צור תחום")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-destructive/40 text-destructive hover:bg-destructive/10"
                onClick={remove}
              >
                {t("action.delete", "מחק")}
              </Button>
            </>
          )}
        </div>
        {/* fixes33 §2.2: three real outcomes (cascade / unassign / abort), not a
            plain yes/no — the generic useConfirm modal only has two. */}
        {cascadeChoiceOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-sm glass-card p-5 space-y-4">
              <h2 className="text-lg font-bold">{t("confirm.title", "אישור פעולה")}</h2>
              <p className="text-sm text-foreground">
                {t(
                  "areas.delete_has_buildings_confirm",
                  "לאזור זה יש בניינים. האם למחוק את הבניינים?",
                )}
              </p>
              <div className="flex flex-col items-stretch gap-2 pt-1">
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => resolveCascadeChoice("cascade")}
                >
                  {t("areas.delete_cascade_buildings", "מחק בניינים ודירות")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => resolveCascadeChoice("unassign")}
                >
                  {t("areas.delete_keep_buildings", "השאר בניינים (בטל שיוך לאזור)")}
                </Button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setCascadeChoiceOpen(false)}
                  className="text-xs text-muted-foreground hover:underline"
                >
                  {t("action.cancel", "ביטול")}
                </button>
              </div>
            </div>
          </div>
        )}
      </td>
    </tr>
  );
}
