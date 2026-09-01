"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { Plus } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useConfirm } from "@/lib/confirm";
import { useLocalization } from "@/lib/localization";
import { naturalCompare } from "@/lib/naturalSort";
import { usePersistentState } from "@/lib/persist";
import { useToast } from "@/lib/toast";
import { useSortableList } from "@/lib/useSortableList";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  contactFullName,
  type JewishCounts,
  type ReportNumber,
  type ShliachSummary,
} from "@/lib/types";

// fixes53 §3: the grid's optional (toggleable) columns — name + actions
// always show.
const OPTIONAL_COLUMNS = ["jews", "engaged", "activist", "created_at"] as const;
type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number];
type SortKey = "name" | OptionalColumn;

interface Row {
  rn: ReportNumber;
  jews: number;
  engaged: number;
  activists: ShliachSummary[];
}

/** Report-number (מספר דוח, fixes19) CRUD: list + add + inline edit + delete.
 *  fixes53 §3: grown into a grid — calculated Jewish-status columns, the
 *  covering activist(s) (linked to their contact page), a direct link to
 *  that report number's apartments, customizable columns and sorting.
 *  Admin-only — the whole management page is gated on the admin role. */
export default function ReportNumbersPage() {
  const { isAdmin, loading } = useAuth();
  const { t } = useLocalization();
  const confirmDialog = useConfirm();
  const { success } = useToast();
  const [items, setItems] = useState<ReportNumber[]>([]);
  const [jewishCounts, setJewishCounts] = useState<Record<number, JewishCounts>>({});
  const [assignments, setAssignments] = useState<Record<number, ShliachSummary[]>>({});
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ReportNumber | null>(null);
  const [busy, setBusy] = useState(true);
  const [query, setQuery] = useState("");
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [fields, setFields] = usePersistentState<OptionalColumn[]>(
    "crm.reportNumbers.fields", ["jews", "engaged", "activist"],
  );
  // fixes54 §2: "Customize Columns" parity with Contacts — a persisted
  // relative order spanning every optional column (a permutation of
  // OPTIONAL_COLUMNS); anything not yet in it keeps OPTIONAL_COLUMNS' own
  // order, so an existing "which columns are on" preference is unaffected
  // until someone actually drags one.
  const [fieldOrder, setFieldOrder] = usePersistentState<OptionalColumn[]>(
    "crm.reportNumbers.fieldOrder", [],
  );
  const fieldOrderIndex = new Map(fieldOrder.map((k, i) => [k, i]));
  const sortedOptionalColumns = [...OPTIONAL_COLUMNS].sort((a, b) => {
    const ai = fieldOrderIndex.get(a) ?? Number.MAX_SAFE_INTEGER;
    const bi = fieldOrderIndex.get(b) ?? Number.MAX_SAFE_INTEGER;
    return ai - bi;
  });
  const orderedActiveFields = sortedOptionalColumns.filter((f) => fields.includes(f));
  function reorderFields(orderedKeys: string[]) {
    if (orderedKeys.length > 0) setFieldOrder(orderedKeys as OptionalColumn[]);
  }
  const { containerRef: fieldsSortableRef, withClickGuard } =
    useSortableList<HTMLDivElement>(reorderFields);
  // fixes38-style guaranteed-reliable fallback alongside the drag —
  // ▲/▼ buttons swap adjacent active columns directly, no gesture involved.
  function moveActiveField(f: OptionalColumn, delta: -1 | 1) {
    const idx = orderedActiveFields.indexOf(f);
    const to = idx + delta;
    if (idx === -1 || to < 0 || to >= orderedActiveFields.length) return;
    const fullKeys = [...sortedOptionalColumns];
    const ia = fullKeys.indexOf(orderedActiveFields[idx]);
    const ib = fullKeys.indexOf(orderedActiveFields[to]);
    [fullKeys[ia], fullKeys[ib]] = [fullKeys[ib], fullKeys[ia]];
    setFieldOrder(fullKeys);
  }
  const [sortKey, setSortKey] = usePersistentState<SortKey>(
    "crm.reportNumbers.sortKey", "name",
  );
  const [sortDir, setSortDir] = usePersistentState<"asc" | "desc">(
    "crm.reportNumbers.sortDir", "asc",
  );

  async function reload() {
    const [rns, counts, links] = await Promise.all([
      apiFetch<ReportNumber[]>("/api/report-numbers"),
      apiFetch<Record<number, JewishCounts>>("/api/report-numbers/jewish-counts"),
      apiFetch<Record<number, ShliachSummary[]>>(
        "/api/report-numbers/shliach-assignments",
      ),
    ]);
    setItems(rns);
    setJewishCounts(counts);
    setAssignments(links);
  }

  useEffect(() => {
    reload()
      .catch(() => setItems([]))
      .finally(() => setBusy(false));
  }, []);

  async function remove(rn: ReportNumber) {
    if (
      !(await confirmDialog({
        message: t(
          "report.delete_confirm",
          "למחוק את מספר הדוח? השיוכים לדירות ולפעילים יוסרו.",
        ),
        detail: rn.name,
      }))
    ) {
      return;
    }
    await apiFetch(`/api/report-numbers/${rn.id}`, { method: "DELETE" });
    await reload();
    success(t("msg.deleted", "נמחק בהצלחה"));
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
  if (!isAdmin) {
    return (
      <p className="text-status-darkred">
        {t("page.admins_only", "אין לך הרשאה לעמוד זה (מנהלים בלבד).")}
      </p>
    );
  }

  const rows: Row[] = items
    .filter((rn) => !query.trim() || rn.name.includes(query.trim()))
    .map((rn) => ({
      rn,
      jews: jewishCounts[rn.id]?.jews ?? 0,
      engaged: jewishCounts[rn.id]?.engaged ?? 0,
      activists: assignments[rn.id] ?? [],
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
      case "created_at":
        return sign * ((a.rn.created_at ?? "").localeCompare(b.rn.created_at ?? ""));
      default:
        return sign * naturalCompare(a.rn.name, b.rn.name);
    }
  });

  const columnLabels: Record<OptionalColumn, string> = {
    jews: t("report.jews_count", "מספר יהודים"),
    engaged: t("report.engaged_jews_count", "מספר יהודים מעוניינים"),
    activist: t("report.activist_name", "שם הפעיל"),
    created_at: t("sort.created", "תאריך יצירה"),
  };

  function SortHeader({ column, label }: { column: SortKey; label: string }) {
    // A user complaint on production traced back here: only the *active*
    // sort column ever showed an arrow, so every other header looked like
    // plain non-interactive text with no visual hint it's clickable — a
    // discoverability gap, not a missing feature. Every sortable header now
    // always carries an indicator: a dim "⇅" when inactive, a solid ↑/↓
    // when it's the active key.
    const active = sortKey === column;
    return (
      <th
        className="px-3 py-2 text-start font-medium cursor-pointer select-none hover:bg-accent"
        onClick={() => onSortClick(column)}
      >
        {label}{" "}
        <span className={active ? "text-foreground" : "text-muted-foreground"}>
          {active ? (sortDir === "asc" ? "↑" : "↓") : "⇅"}
        </span>
      </th>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("page.report_numbers", "מספרי דוח")}</h1>
        {!adding && !editing && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> {t("report.add", "מספר דוח חדש")}
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {t(
          "page.report_numbers_intro",
          "ניהול מספרי הדוח של הארגון — משמשים לשיוך דירות ופעילים.",
        )}
      </p>

      {(adding || editing) && (
        <ReportNumberForm
          item={editing ?? undefined}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setAdding(false);
            setEditing(null);
            await reload();
            success(t("msg.saved", "נשמר בהצלחה"));
          }}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="max-w-xs"
          placeholder={t("filter.search_name", "חיפוש לפי שם…")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          className={fieldsOpen ? "border-primary bg-primary/10 text-primary" : undefined}
          onClick={() => setFieldsOpen(!fieldsOpen)}
        >
          {t("columns.title", "עמודות מוצגות")}
        </Button>
      </div>

      {/* fixes54 §2: "Customize Columns" parity with Contacts — toggle
          visibility (click) + reorder (drag, or the ▲/▼ fallback) in one
          panel instead of a plain toggle-only list. */}
      {fieldsOpen && (
        <div className="bg-card rounded-xl shadow-sm p-4 space-y-2">
          <p className="text-xs text-muted-foreground">
            {t("columns.reorder_hint", "גרור עמודה פעילה כדי לשנות את סדר ההצגה.")}
          </p>
          <div ref={fieldsSortableRef} className="flex flex-wrap gap-2">
            {orderedActiveFields.map((f, activeIdx) => (
              <span key={f} data-sort-key={f} className="inline-flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={withClickGuard(() => toggleField(f))}
                  className="rounded-md border px-3 py-1.5 text-sm border-status-magenta bg-status-magenta/10 text-status-magenta cursor-grab active:cursor-grabbing"
                >
                  ⠿ {columnLabels[f]}
                </button>
                <span className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    disabled={activeIdx === 0}
                    onClick={() => moveActiveField(f, -1)}
                    title={t("action.move_up", "העלה")}
                    className="flex items-center justify-center w-7 h-7 rounded text-sm leading-none text-muted-foreground hover:text-status-magenta hover:bg-accent active:bg-muted disabled:opacity-20"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    disabled={activeIdx === orderedActiveFields.length - 1}
                    onClick={() => moveActiveField(f, 1)}
                    title={t("action.move_down", "הורד")}
                    className="flex items-center justify-center w-7 h-7 rounded text-sm leading-none text-muted-foreground hover:text-status-magenta hover:bg-accent active:bg-muted disabled:opacity-20"
                  >
                    ▼
                  </button>
                </span>
              </span>
            ))}
            {sortedOptionalColumns.filter((f) => !fields.includes(f)).map((f) => (
              <button
                key={f}
                type="button"
                data-sort-key={f}
                data-sortable-disabled=""
                onClick={() => toggleField(f)}
                className="rounded-md border px-3 py-1.5 text-sm border-border text-muted-foreground hover:bg-accent"
              >
                {columnLabels[f]}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="bg-card rounded-xl shadow-sm overflow-x-auto">
        {busy ? (
          <p className="px-4 py-6 text-center text-muted-foreground">{t("action.loading", "טוען…")}</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-muted-foreground">
            {t("report.none", "אין מספרי דוח עדיין.")}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-background text-muted-foreground">
              <tr>
                <SortHeader column="name" label={t("report_number.name", "שם")} />
                {orderedActiveFields.map((f) => (
                  <SortHeader key={f} column={f} label={columnLabels[f]} />
                ))}
                <th className="px-3 py-2 text-start font-medium">
                  {t("action.actions", "פעולות")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(({ rn, jews, engaged, activists }) => (
                <tr key={rn.id}>
                  <td className="px-3 py-2 font-medium">{rn.name}</td>
                  {orderedActiveFields.map((f) => (
                    <td key={f} className="px-3 py-2">
                      {f === "jews" && jews}
                      {f === "engaged" && engaged}
                      {f === "created_at" &&
                        (rn.created_at ? new Date(rn.created_at).toLocaleDateString() : "—")}
                      {f === "activist" &&
                        (activists.length === 0 ? (
                          <span className="text-muted-foreground">
                            {t("report.no_activist", "אין פעיל משויך")}
                          </span>
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
                      {/* fixes53 §3: deep link to this report number's apartments. */}
                      <Button asChild size="sm" variant="outline" className="border-primary text-primary hover:bg-primary/10">
                        <Link href={`/dashboard/apartments?report_number_ids=${rn.id}`}>
                          {t("report.view_apartments", "הצג דירות")}
                        </Link>
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setAdding(false);
                          setEditing(rn);
                        }}
                      >
                        {t("action.edit", "ערוך")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-destructive text-destructive hover:bg-destructive/10"
                        onClick={() => remove(rn)}
                      >
                        {t("action.delete", "מחק")}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ReportNumberForm({
  item,
  onClose,
  onSaved,
}: {
  item?: ReportNumber;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useLocalization();
  const [name, setName] = useState(item?.name ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const body = JSON.stringify({ name: name.trim() });
    try {
      if (item) {
        await apiFetch(`/api/report-numbers/${item.id}`, { method: "PUT", body });
      } else {
        await apiFetch("/api/report-numbers", { method: "POST", body });
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="bg-card rounded-xl shadow-sm p-4 space-y-3">
      <h3 className="font-medium">
        {item ? t("action.edit", "ערוך") : t("report.add", "מספר דוח חדש")}
      </h3>
      <label className="block space-y-1 max-w-sm">
        <span className="block text-sm font-medium">{t("report_number.name", "שם")}</span>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("report.name_ph", "שם / מספר…")}
          required
        />
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? t("action.saving", "שומר…") : t("action.save", "שמור")}
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>
          {t("action.cancel", "ביטול")}
        </Button>
      </div>
    </form>
  );
}
