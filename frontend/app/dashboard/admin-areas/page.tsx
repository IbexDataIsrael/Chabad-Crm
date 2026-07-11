"use client";

import { useEffect, useState, type FormEvent } from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { usePersistentState } from "@/lib/persist";
import { useToast } from "@/lib/toast";
import { type AdminArea } from "@/lib/types";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";
const toolbarSelectClass =
  "rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none";

type SortKey = "name" | "created";

/** Admin-area (אזור מנהל, fixes9 §2) CRUD: list + add + inline edit + delete.
 *  Reads for every org user; mutations are admin-only (mirrors Areas).
 *  fixes15 §6: name filter + sorting + pagination, persisted (§1.2). */
export default function AdminAreasPage() {
  const { isAdmin, loading } = useAuth();
  const { t } = useLocalization();
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
    if (!confirm(`${t("msg.delete_admin_area_confirm", "למחוק את אזור המנהל?")} '${aa.name}'`)) {
      return;
    }
    await apiFetch(`/api/admin-areas/${aa.id}`, { method: "DELETE" });
    await reload();
    success(t("msg.deleted", "נמחק בהצלחה"));
  }

  if (loading) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;

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
          <button
            onClick={() => setAdding(true)}
            className="rounded-md bg-status-magenta text-white px-4 py-1.5 text-sm font-medium hover:opacity-90"
          >
            + {t("page.add_admin_area", "אזור מנהל חדש")}
          </button>
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
        <span className="flex items-center gap-2 text-gray-500">
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
        <span className="ms-auto flex items-center gap-2 text-gray-500">
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

      <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
        {busy ? (
          <p className="px-4 py-6 text-center text-gray-400">{t("action.loading", "טוען…")}</p>
        ) : sorted.length === 0 ? (
          <p className="px-4 py-6 text-center text-gray-400">
            {t("page.no_admin_areas", "אין אזורי מנהל להצגה.")}
          </p>
        ) : (
          visible.map((aa) => (
            <div key={aa.id} className="px-4 py-3 flex flex-wrap items-center gap-2">
              <div className="min-w-[10rem]">
                <span className="font-medium">{aa.name}</span>
                {aa.comments && (
                  <div className="text-sm text-gray-500">{aa.comments}</div>
                )}
              </div>
              {isAdmin && (
                <div className="flex items-center gap-2 ms-auto">
                  <button
                    onClick={() => {
                      setAdding(false);
                      setEditing(aa);
                    }}
                    className="rounded-md bg-gray-800 text-white px-3 py-1 text-xs hover:opacity-90"
                  >
                    {t("action.edit", "ערוך")}
                  </button>
                  <button
                    onClick={() => remove(aa)}
                    className="rounded-md border border-status-darkred/40 text-status-darkred px-2 py-1 text-xs hover:bg-red-50"
                  >
                    {t("action.delete", "מחק")}
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Client-side pager (fixes15 §6). */}
      {!busy && sorted.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => setPage(safePage - 1)}
            className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("pager.prev", "→ הקודם")}
          </button>
          <span className="text-gray-500">{rangeText}</span>
          <button
            type="button"
            disabled={safePage >= lastPage}
            onClick={() => setPage(safePage + 1)}
            className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("pager.next", "הבא ←")}
          </button>
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
    <form onSubmit={save} className="bg-white rounded-xl shadow-sm p-4 space-y-3">
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
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-status-magenta text-white px-5 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {busy ? t("action.saving", "שומר…") : t("action.save", "שמור")}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
        >
          {t("action.cancel", "ביטול")}
        </button>
      </div>
    </form>
  );
}
