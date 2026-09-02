"use client";

import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { usePersistentState } from "@/lib/persist";
import { useToast } from "@/lib/toast";
import { type AdminArea } from "@/lib/types";
import { useConfirm } from "@/lib/confirm";

const inputClass =
  "w-full rounded-md border border-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";
const toolbarSelectClass =
  "rounded-md border border-input px-3 py-2 text-sm focus:border-primary focus:outline-none";

type SortKey = "name" | "created";

/** Admin-area (אזור מנהל, fixes9 §2) CRUD: list + add + inline edit + delete.
 *  Reads for every org user; mutations are admin-only (mirrors Areas).
 *  fixes15 §6: name filter + sorting + pagination, persisted (§1.2). */
export default function AdminAreasPage() {
  const { isAdmin, loading } = useAuth();
  const { t } = useLocalization();
  const confirmDialog = useConfirm();
  const { success } = useToast();
  const [items, setItems] = useState<AdminArea[]>([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AdminArea | null>(null);
  const [busy, setBusy] = useState(true);
  const [query, setQuery] = usePersistentState("crm.adminAreas.q", "");
  const [sort, setSort] = usePersistentState<SortKey>("crm.adminAreas.sort", "name");
  const [dir, setDir] = usePersistentState<"asc" | "desc">("crm.adminAreas.dir", "asc");
  const [page, setPage] = usePersistentState("crm.adminAreas.page", 1);
  const [pageSize, setPageSize] = usePersistentState("crm.adminAreas.pageSize", 20);

  async function reload() {
    setItems(await apiFetch<AdminArea[]>("/api/admin-areas"));
  }

  useEffect(() => {
    reload()
      .catch(() => setItems([]))
      .finally(() => setBusy(false));
  }, []);

  async function remove(aa: AdminArea) {
    if (!(await confirmDialog({ message: t("msg.delete_admin_area_confirm", "למחוק את אזור המנהל?"), detail: aa.name }))) {
      return;
    }
    await apiFetch(`/api/admin-areas/${aa.id}`, { method: "DELETE" });
    await reload();
    success(t("msg.deleted", "נמחק בהצלחה"));
  }

  if (loading) return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;

  // Client-side filter → sort → page (small per-org list).
  const filtered = items.filter(
    (aa) =>
      !query.trim() ||
      aa.name.includes(query.trim()) ||
      (aa.comments ?? "").includes(query.trim()),
  );
  const sorted = [...filtered].sort((a, b) => {
    const cmp =
      sort === "created"
        ? (a.created_at ?? "").localeCompare(b.created_at ?? "")
        : a.name.localeCompare(b.name, "he");
    return dir === "desc" ? -cmp : cmp;
  });
  const lastPage = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, lastPage);
  const visible = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);
  const rangeText = t("pager.range", "{from}–{to} מתוך {total}")
    .replace("{from}", String(sorted.length === 0 ? 0 : (safePage - 1) * pageSize + 1))
    .replace("{to}", String(Math.min(safePage * pageSize, sorted.length)))
    .replace("{total}", String(sorted.length));

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("page.admin_areas_title", "אזורי מנהל")}</h1>
        {isAdmin && !adding && !editing && (
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> {t("page.add_admin_area", "אזור מנהל חדש")}
          </Button>
        )}
      </div>

      {(adding || editing) && (
        <AdminAreaForm
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

      {/* fixes15 §6: filter + sort toolbar. */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input
          className={`${toolbarSelectClass} min-w-[12rem]`}
          placeholder={t("filter.search_name", "חיפוש לפי שם…")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
        <span className="flex items-center gap-2 text-muted-foreground">
          {t("sort.label", "מיון:")}
          <select
            className={toolbarSelectClass}
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as SortKey);
              setPage(1);
            }}
          >
            <option value="name">{t("sort.by_name", "שם")}</option>
            <option value="created">{t("sort.created", "תאריך יצירה")}</option>
          </select>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => {
              setDir(dir === "asc" ? "desc" : "asc");
              setPage(1);
            }}
            title={dir === "asc" ? t("sort.asc", "עולה") : t("sort.desc", "יורד")}
          >
            {dir === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
          </Button>
        </span>
        <span className="ms-auto flex items-center gap-2 text-muted-foreground">
          {t("pager.page_size", "בעמוד:")}
          <select
            className={toolbarSelectClass}
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

      <Card className="divide-y divide-border shadow-sm">
        {busy ? (
          <p className="px-4 py-6 text-center text-muted-foreground">{t("action.loading", "טוען…")}</p>
        ) : sorted.length === 0 ? (
          <p className="px-4 py-6 text-center text-muted-foreground">
            {t("page.no_admin_areas", "אין אזורי מנהל להצגה.")}
          </p>
        ) : (
          visible.map((aa) => (
            <div key={aa.id} className="px-4 py-3 flex flex-wrap items-center gap-2">
              <div className="min-w-[10rem]">
                <span className="font-medium">{aa.name}</span>
                {aa.comments && (
                  <div className="text-sm text-muted-foreground">{aa.comments}</div>
                )}
              </div>
              {isAdmin && (
                <div className="flex items-center gap-2 ms-auto">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setAdding(false);
                      setEditing(aa);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" /> {t("action.edit", "ערוך")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-status-darkred/40 text-status-darkred hover:bg-status-darkred/10"
                    onClick={() => remove(aa)}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> {t("action.delete", "מחק")}
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
      </Card>

      {/* Client-side pager (fixes15 §6). */}
      {!busy && sorted.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={safePage <= 1}
            onClick={() => setPage(safePage - 1)}
          >
            <ChevronRight className="h-4 w-4" /> {t("pager.prev", "הקודם")}
          </Button>
          <span className="text-muted-foreground">{rangeText}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={safePage >= lastPage}
            onClick={() => setPage(safePage + 1)}
          >
            {t("pager.next", "הבא")} <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

function AdminAreaForm({
  item,
  onClose,
  onSaved,
}: {
  item?: AdminArea;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useLocalization();
  const [name, setName] = useState(item?.name ?? "");
  const [comments, setComments] = useState(item?.comments ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const body = JSON.stringify({ name: name.trim(), comments: comments.trim() || null });
    try {
      if (item) {
        await apiFetch(`/api/admin-areas/${item.id}`, { method: "PUT", body });
      } else {
        await apiFetch("/api/admin-areas", { method: "POST", body });
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="bg-card border border-border rounded-xl shadow-sm p-4 space-y-3">
      <h3 className="font-medium">
        {item
          ? t("page.edit_admin_area", "עריכת אזור מנהל")
          : t("page.add_admin_area", "אזור מנהל חדש")}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="block text-sm font-medium">{t("admin_areas.name", "שם")}</span>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label className="block space-y-1">
          <span className="block text-sm font-medium">
            {t("admin_areas.comments", "הערות")}
          </span>
          <input
            className={inputClass}
            value={comments}
            onChange={(e) => setComments(e.target.value)}
          />
        </label>
      </div>
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
  );
}
