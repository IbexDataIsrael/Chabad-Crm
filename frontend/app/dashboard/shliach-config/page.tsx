"use client";

import { useEffect, useState, type FormEvent } from "react";

import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { MultiSelectSearchFilter } from "@/components/ui/MultiSelectSearchFilter";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { usePicklist } from "@/lib/picklists";
import { useToast } from "@/lib/toast";
import {
  buildingDisplayName,
  type Area,
  type Building,
  type OrgDetails,
} from "@/lib/types";

/** fixes51 §4: mirrors the Apartments page's own toggleable-column set
 *  (app/dashboard/apartments/page.tsx's FIELD_KEYS) — kept in sync manually
 *  since that list is a page-local const, not a shared export. */
const APARTMENT_FIELD_KEYS = [
  "resident",
  "building",
  "area",
  "report_number",
  "notes",
  "phone",
  "email",
  "language",
  "jewish_status",
  "campaign_status",
  "mezuzah_status",
] as const;
type ApartmentFieldKey = (typeof APARTMENT_FIELD_KEYS)[number];

interface ShliachViewConfigShape {
  disable_edit?: boolean;
  hide_filters?: boolean;
  default_filters?: {
    area_ids?: number[];
    building_ids?: number[];
    jewish_status?: string[];
    mezuzah_status?: string[];
    language?: string[];
  };
  default_columns?: string[] | null;
}

export default function ShliachConfigPage() {
  const { isAdmin, loading } = useAuth();
  const { t } = useLocalization();
  const { success, error: toastError } = useToast();

  const [areas, setAreas] = useState<Area[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const jewish = usePicklist("apartment.Jewish_status");
  const mezuzah = usePicklist("apartment.mezuzah_status");
  const language = usePicklist("apartment.language");

  const [disableEdit, setDisableEdit] = useState(false);
  const [hideFilters, setHideFilters] = useState(false);
  const [areaIds, setAreaIds] = useState<number[]>([]);
  const [buildingIds, setBuildingIds] = useState<number[]>([]);
  const [jewishFilter, setJewishFilter] = useState<string[]>([]);
  const [mezuzahFilter, setMezuzahFilter] = useState<string[]>([]);
  const [languageFilter, setLanguageFilter] = useState<string[]>([]);
  // null = "not configured" (the Apartments page's own built-in default
  // applies); otherwise the exact set of columns a shliach starts with.
  const [useDefaultColumns, setUseDefaultColumns] = useState(false);
  const [defaultColumns, setDefaultColumns] = useState<ApartmentFieldKey[]>([]);

  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const fieldLabels: Record<ApartmentFieldKey, string> = {
    resident: t("apartments.name", "שם דייר"),
    building: t("apartments.building_id", "בניין"),
    area: t("buildings.area_id", "אזור"),
    report_number: t("apartments.report_number_id", "מספר דוח"),
    notes: t("apartments.apartment_notes", "הערות"),
    phone: t("apartments.phone", "טלפון"),
    email: t("apartments.email", "אימייל"),
    language: t("picklist.apartment.language", "שפה"),
    jewish_status: t("picklist.apartment.Jewish_status", "יהדות"),
    campaign_status: t("picklist.apartment.campaign_status", "סטטוס קמפיין"),
    mezuzah_status: t("picklist.apartment.mezuzah_status", "מזוזה"),
  };

  useEffect(() => {
    Promise.all([
      apiFetch<OrgDetails>("/api/organizations/me"),
      apiFetch<Area[]>("/api/areas").catch(() => []),
      apiFetch<Building[]>("/api/buildings").catch(() => []),
    ])
      .then(([org, areaList, buildingList]) => {
        setAreas(areaList);
        setBuildings(buildingList);
        const cfg = (org.shliach_view_config ?? {}) as ShliachViewConfigShape;
        setDisableEdit(!!cfg.disable_edit);
        setHideFilters(!!cfg.hide_filters);
        setAreaIds(cfg.default_filters?.area_ids ?? []);
        setBuildingIds(cfg.default_filters?.building_ids ?? []);
        setJewishFilter(cfg.default_filters?.jewish_status ?? []);
        setMezuzahFilter(cfg.default_filters?.mezuzah_status ?? []);
        setLanguageFilter(cfg.default_filters?.language ?? []);
        if (cfg.default_columns) {
          setUseDefaultColumns(true);
          setDefaultColumns(cfg.default_columns as ApartmentFieldKey[]);
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  function toggleColumn(k: ApartmentFieldKey) {
    setDefaultColumns((prev) =>
      prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k],
    );
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const shliach_view_config: ShliachViewConfigShape = {
        disable_edit: disableEdit,
        hide_filters: hideFilters,
        default_filters: {
          area_ids: areaIds,
          building_ids: buildingIds,
          jewish_status: jewishFilter,
          mezuzah_status: mezuzahFilter,
          language: languageFilter,
        },
        default_columns: useDefaultColumns ? defaultColumns : null,
      };
      await apiFetch("/api/organizations/me", {
        method: "PUT",
        body: JSON.stringify({ shliach_view_config }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      success(t("msg.saved", "נשמר בהצלחה"));
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setBusy(false);
    }
  }

  if (loading || !loaded) {
    return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;
  }
  if (!isAdmin) {
    return (
      <p className="text-status-darkred">
        {t("page.admins_only", "אין לך הרשאה לעמוד זה (מנהלים בלבד).")}
      </p>
    );
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">
          {t("shliach_config.title", "הגדרות לתצוגת פעילים")}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {t(
            "shliach_config.intro",
            "שולט על תצוגת הדירות שרואים משתמשי פעיל — עריכה, סינון ועמודות ברירת מחדל.",
          )}
        </p>
      </div>

      <form onSubmit={save} className="bg-white rounded-xl shadow-sm p-6 space-y-6">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={disableEdit}
            onChange={(e) => setDisableEdit(e.target.checked)}
          />
          {t("shliach_config.disable_edit", "בטל אפשרות עריכה לפעילים")}
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={hideFilters}
            onChange={(e) => setHideFilters(e.target.checked)}
          />
          {t("shliach_config.hide_filters", "הסתר את כל הסינונים מהפעילים")}
        </label>

        <div className="border-t border-gray-100 pt-4 space-y-3">
          <span className="block text-sm font-medium">
            {t("shliach_config.default_filters", "סינון ברירת מחדל")}
          </span>
          <p className="text-xs text-gray-400">
            {t(
              "shliach_config.default_filters_hint",
              "הסינון שבו תיפתח תצוגת הדירות עבור פעילים.",
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <MultiSelectFilter
              allLabel={t("filter.all_areas", "כל האזורים")}
              options={areas.map((a) => ({ id: a.id, label: a.area_name }))}
              value={areaIds}
              onChange={setAreaIds}
            />
            <MultiSelectSearchFilter
              className="w-56"
              allLabel={t("filter.all_buildings", "כל הבניינים")}
              options={buildings.map((b) => ({ id: b.id, label: buildingDisplayName(b) }))}
              value={buildingIds}
              onChange={setBuildingIds}
              searchPlaceholder={t("filter.search_buildings", "חיפוש בניין…")}
            />
            <MultiSelectFilter
              allLabel={t("filter.all_jewish", "כל סטטוסי היהדות")}
              options={jewish.options.map((o) => ({ id: o.value, label: jewish.display(o) }))}
              value={jewishFilter}
              onChange={setJewishFilter}
            />
            <MultiSelectFilter
              allLabel={t("filter.all_mezuzah", "כל סטטוסי המזוזה")}
              options={mezuzah.options.map((o) => ({ id: o.value, label: mezuzah.display(o) }))}
              value={mezuzahFilter}
              onChange={setMezuzahFilter}
            />
            <MultiSelectFilter
              allLabel={t("filter.all_languages", "כל השפות")}
              options={language.options.map((o) => ({ id: o.value, label: language.display(o) }))}
              value={languageFilter}
              onChange={setLanguageFilter}
            />
          </div>
        </div>

        <div className="border-t border-gray-100 pt-4 space-y-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={useDefaultColumns}
              onChange={(e) => setUseDefaultColumns(e.target.checked)}
            />
            {t("shliach_config.default_columns", "עמודות ברירת מחדל")}
          </label>
          <p className="text-xs text-gray-400">
            {t(
              "shliach_config.default_columns_hint",
              "כאשר כבוי, פעילים מתחילים מברירת המחדל הכללית של המערכת. פעיל יכול תמיד להתאים אישית את העמודות שלו דרך \"התאמת שדות\" בעמוד הדירות.",
            )}
          </p>
          {useDefaultColumns && (
            <div className="flex flex-wrap gap-3">
              {APARTMENT_FIELD_KEYS.map((k) => (
                <label key={k} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={defaultColumns.includes(k)}
                    onChange={() => toggleColumn(k)}
                  />
                  {fieldLabels[k]}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-status-magenta text-white px-5 py-2 font-medium hover:opacity-90 disabled:opacity-50"
          >
            {busy ? t("action.saving", "שומר…") : t("action.save", "שמור")}
          </button>
          {saved && <span className="text-sm text-status-green">{t("action.saved", "נשמר ✓")}</span>}
        </div>
      </form>
    </div>
  );
}
