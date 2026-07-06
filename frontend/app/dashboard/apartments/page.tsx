"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { ApartmentEditor } from "@/components/ApartmentEditor";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import {
  apartmentTitle,
  buildingDisplayName,
  type ApartmentListItem,
  type Building,
  type Floor,
} from "@/lib/types";

const inputClass =
  "rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

export default function ApartmentsPage() {
  const { loading, isShliach } = useAuth();
  const { t } = useLocalization();
  const [items, setItems] = useState<ApartmentListItem[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [filterBuilding, setFilterBuilding] = useState("");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [busy, setBusy] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function reload(buildingId = filterBuilding, q = query) {
    const params = new URLSearchParams();
    if (buildingId) params.set("building_id", buildingId);
    if (q.trim()) params.set("q", q.trim());
    const qs = params.toString();
    setItems(await apiFetch<ApartmentListItem[]>(`/api/apartments/list${qs ? `?${qs}` : ""}`));
  }

  useEffect(() => {
    Promise.all([
      reload(),
      apiFetch<Building[]>("/api/buildings").then(setBuildings).catch(() => {}),
    ])
      .catch(() => setItems([]))
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced dynamic search (street name / label / resident).
  function onQueryChange(v: string) {
    setQuery(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => reload(filterBuilding, v).catch(() => {}), 300);
  }

  function onBuildingChange(v: string) {
    setFilterBuilding(v);
    reload(v, query).catch(() => {});
  }

  if (loading) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t("apartments", "דירות")}</h1>
        {!isShliach && (
          <div className="flex items-center gap-2">
            {!batchOpen && (
              <button
                onClick={() => setBatchOpen(true)}
                className="rounded-md border border-status-magenta text-status-magenta px-4 py-1.5 text-sm font-medium hover:bg-status-magenta/10"
              >
                {t("batch.open", "יצירה מרובה")}
              </button>
            )}
            {!adding && (
              <button
                onClick={() => setAdding(true)}
                className="rounded-md bg-status-magenta text-white px-4 py-1.5 text-sm font-medium hover:opacity-90"
              >
                + {t("apt.add_apartment", "הוסף דירה")}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Dataset filters (fixes7 §2): building bound + street-name lookup. */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-500">{t("filter.by_building", "סנן לפי בניין:")}</span>
        <select
          className={inputClass}
          value={filterBuilding}
          onChange={(e) => onBuildingChange(e.target.value)}
        >
          <option value="">{t("filter.all_buildings", "כל הבניינים")}</option>
          {buildings.map((b) => (
            <option key={b.id} value={b.id}>
              {buildingDisplayName(b)}
            </option>
          ))}
        </select>
        <input
          className={`${inputClass} flex-1 min-w-[12rem]`}
          placeholder={t("apt.street_search", "חיפוש לפי שם רחוב…")}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
      </div>

      {batchOpen && (
        <BatchModal
          buildings={buildings}
          onClose={() => setBatchOpen(false)}
          onDone={async () => {
            setBatchOpen(false);
            await reload();
          }}
        />
      )}

      {adding && (
        <div className="bg-white rounded-xl shadow-sm p-4">
          <ApartmentEditor
            onClose={() => setAdding(false)}
            onSaved={async () => {
              setAdding(false);
              await reload();
            }}
          />
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
        {busy ? (
          <p className="px-4 py-6 text-center text-gray-400">{t("action.loading", "טוען…")}</p>
        ) : items.length === 0 ? (
          <p className="px-4 py-6 text-center text-gray-400">
            {t("apt.no_apartments_page", "אין דירות להצגה.")}
          </p>
        ) : (
          items.map((a) => (
            <div key={a.id} className="px-4 py-3 flex flex-wrap items-center gap-2">
              <div className="min-w-[9rem]">
                <Link
                  href={`/dashboard/apartments/${a.id}`}
                  className="font-medium text-status-magenta hover:underline"
                >
                  {apartmentTitle(a)}
                </Link>
                {a.name && <span className="ms-2 text-sm text-gray-600">{a.name}</span>}
                <div className="text-xs text-gray-500">
                  {[buildingDisplayName({ id: a.building_id, building_name: a.building_name, building_address: a.building_address }), a.area_name]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <div className="ms-auto text-sm">
                {a.contact_id ? (
                  <Link
                    href={`/dashboard/contacts/${a.contact_id}`}
                    className="rounded-full bg-status-magenta/10 text-status-magenta px-3 py-1 hover:bg-status-magenta/20"
                  >
                    {a.contact_name}
                  </Link>
                ) : (
                  <span className="text-gray-400">{t("apt.no_contact", "ללא איש קשר")}</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** Bulk apartment generator (fixes7 §5): building → floors → explicit label
 *  tokens → Cartesian product, in one request/transaction. */
function BatchModal({
  buildings,
  onClose,
  onDone,
}: {
  buildings: Building[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { t } = useLocalization();
  const { success, error: toastError } = useToast();
  const [buildingId, setBuildingId] = useState<number | "">("");
  const [floors, setFloors] = useState<Floor[]>([]);
  const [selectedFloors, setSelectedFloors] = useState<number[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [labelInput, setLabelInput] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (buildingId === "") {
      setFloors([]);
      setSelectedFloors([]);
      return;
    }
    apiFetch<Floor[]>(`/api/buildings/${buildingId}/floors`)
      .then((f) => {
        setFloors(f);
        setSelectedFloors([]);
      })
      .catch(() => setFloors([]));
  }, [buildingId]);

  function toggleFloor(id: number) {
    setSelectedFloors((prev) =>
      prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id],
    );
  }

  function addLabel() {
    // Explicit token selection: comma/space-separated entries become chips.
    const tokens = labelInput
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (tokens.length === 0) return;
    setLabels((prev) => [...prev, ...tokens.filter((tk) => !prev.includes(tk))]);
    setLabelInput("");
  }

  async function run() {
    setError("");
    if (buildingId === "" || selectedFloors.length === 0 || labels.length === 0) {
      setError(t("batch.pick_floor_label", "יש לבחור לפחות קומה אחת ותווית אחת"));
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<{ created: number; skipped: number }>(
        "/api/apartments/batch",
        {
          method: "POST",
          body: JSON.stringify({
            building_id: Number(buildingId),
            floor_ids: selectedFloors,
            labels,
          }),
        },
      );
      success(
        t("batch.result", "נוצרו {created} דירות ({skipped} דולגו — קיימות)")
          .replace("{created}", String(res.created))
          .replace("{skipped}", String(res.skipped)),
      );
      await onDone();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה");
      setError(msg);
      toastError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg bg-white rounded-xl shadow-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div>
          <h2 className="text-lg font-bold">{t("batch.title", "יצירת דירות מרובות")}</h2>
          <p className="text-sm text-gray-500">
            {t(
              "batch.intro",
              "בחר בניין, קומות ותוויות דירה — כל השילובים ייווצרו בבת אחת.",
            )}
          </p>
        </div>

        <label className="block space-y-1">
          <span className="block text-sm font-medium">{t("apartments.building_id", "בניין")}</span>
          <select
            className={`${inputClass} w-full`}
            value={buildingId}
            onChange={(e) => setBuildingId(e.target.value === "" ? "" : Number(e.target.value))}
          >
            <option value="">{t("apt.choose_building", "בחר בניין…")}</option>
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {buildingDisplayName(b)}
              </option>
            ))}
          </select>
        </label>

        {buildingId !== "" && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="block text-sm font-medium">{t("batch.floors", "קומות")}</span>
              {floors.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedFloors(floors.map((f) => f.id))}
                  className="text-xs text-status-magenta hover:underline"
                >
                  {t("batch.select_all", "בחר הכל")}
                </button>
              )}
            </div>
            {floors.length === 0 ? (
              <p className="text-sm text-gray-400">
                {t("batch.no_floors", "לבניין זה אין קומות. הוסף קומות בעריכת הבניין.")}
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {floors.map((f) => (
                  <label
                    key={f.id}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm cursor-pointer ${
                      selectedFloors.includes(f.id)
                        ? "border-status-magenta bg-status-magenta/10 text-status-magenta"
                        : "border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="accent-status-magenta"
                      checked={selectedFloors.includes(f.id)}
                      onChange={() => toggleFloor(f.id)}
                    />
                    {f.name}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="space-y-1">
          <span className="block text-sm font-medium">
            {t("batch.labels", "מספרי / אותיות דירות")}
          </span>
          {labels.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {labels.map((l) => (
                <li
                  key={l}
                  className="inline-flex items-center gap-1 rounded-full bg-status-magenta/10 text-status-magenta px-3 py-1 text-sm"
                >
                  {l}
                  <button
                    type="button"
                    onClick={() => setLabels((prev) => prev.filter((x) => x !== l))}
                    className="text-status-magenta/70 hover:text-status-darkred"
                    aria-label={t("action.remove", "הסר")}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2">
            <input
              className={`${inputClass} w-40`}
              dir="ltr"
              placeholder={t("batch.label_placeholder", "לדוגמה A או 1")}
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addLabel();
                }
              }}
            />
            <button
              type="button"
              onClick={addLabel}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              + {t("batch.add_label", "הוסף")}
            </button>
          </div>
        </div>

        {error && <p className="text-sm text-status-darkred">{error}</p>}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="rounded-md bg-status-magenta text-white px-5 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {busy ? t("action.saving", "שומר…") : t("batch.create", "צור דירות")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
          >
            {t("action.cancel", "ביטול")}
          </button>
        </div>
      </div>
    </div>
  );
}
