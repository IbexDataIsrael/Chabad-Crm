"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { Plus } from "lucide-react";
import { ActivistMessagesEditor } from "@/components/ActivistMessagesEditor";
import { ImagePickerModal } from "@/components/ImagePickerModal";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { RichTextEditor } from "@/components/RichTextEditor";
import { Street2FieldOrderEditor } from "@/components/Street2FieldOrderEditor";
import { MultiSelectSearchFilter } from "@/components/ui/MultiSelectSearchFilter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TabBar } from "@/components/ui/TabBar";
import { useConfirm } from "@/lib/confirm";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCustomFieldDefs } from "@/lib/customFields";
import { useLocalization } from "@/lib/localization";
import { usePersistentState } from "@/lib/persist";
import { FIXED_APARTMENT_PICKLIST_KEYS, usePicklist } from "@/lib/picklists";
import { useToast } from "@/lib/toast";
import {
  buildingDisplayName,
  type Area,
  type ApartmentPage,
  type Building,
  type OrgDetails,
  type PicklistField,
  type ShliachAnnouncement,
  type ShliachSummary,
} from "@/lib/types";

// fixes53 §7/§8: the fixed self-edit fields an admin can lock beyond the
// mandatory 3 (email / areas / report numbers, never configurable — see
// ContactView's MANDATORY_SELF_EDIT_LOCKS). Keys match ContactView's
// `lockKey`/field-key convention exactly.
const FIXED_SELF_EDIT_FIELDS = ["name", "last_name", "phone", "shliach.notes"] as const;

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
  self_edit_locked_fields?: string[];
  // fixes54 §6: which Apartment fields an activist can't inline-edit while
  // doing regular fieldwork — a granular complement to the blanket
  // `disable_edit` above. Distinct from `self_edit_locked_fields`, which
  // locks fields on the activist's OWN contact profile (name/phone/notes,
  // via ContactView's self-edit mode) — a different, working feature that
  // was easy to mistake for this one since both pages used the same
  // "עריכה עצמית" (self-edit) wording. This is the "Edit Lock" section now;
  // customize_fields_locked (below) hides the apartments page's own
  // "Customize fields" column picker from activists entirely.
  apartment_edit_locked_fields?: string[];
  // fixes54 §6: hides the apartments page's "התאמת שדות" (Customize fields)
  // column picker from the activist interface entirely when true.
  customize_fields_locked?: boolean;
  // fixes74 §13: order of the street2 apartment-card fields.
  street2_field_order?: string[];
  // fixes98: the org's "a new task has been assigned to you" email text.
  task_email_text_he?: string;
  task_email_text_en?: string;
}

// fixes98: the page is split into tabs by topic. The first three edit the
// one shliach_view_config form (one Save); the last two save per item.
type ConfigTab = "apartments" | "profile" | "task_email" | "announcements" | "messages";
const FORM_TABS: ConfigTab[] = ["apartments", "profile", "task_email"];

// Same defaults the server uses when the org hasn't set its own text
// (backend app/core/activist_emails.py DEFAULT_TASK_EMAIL_TEXT).
const DEFAULT_TASK_EMAIL_TEXT = {
  he: "שובצה לך משימה חדשה.",
  en: "A new task has been assigned to you.",
};

export default function ShliachConfigPage() {
  const { isAdmin, loading } = useAuth();
  const { t, lang } = useLocalization();
  const { success, error: toastError } = useToast();

  const [areas, setAreas] = useState<Area[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const jewish = usePicklist("apartment.Jewish_status");
  const mezuzah = usePicklist("apartment.mezuzah_status");
  const language = usePicklist("apartment.language");
  // fixes53 §8: any admin-added shliach.* custom field/picklist is also a
  // lockable self-edit option, alongside the 4 fixed ones. fixes56 §1:
  // exclude "email" even if an admin created a same-keyed custom
  // field/picklist — it's one of ContactView's MANDATORY_SELF_EDIT_LOCKS
  // (always locked) and must never appear here as if it were optional.
  const shliachCustomFieldDefs = useCustomFieldDefs("contact_shliach").filter(
    (d) => d.field_type !== "select" && d.field_key !== "email",
  );
  const [shliachPicklistDefs, setShliachPicklistDefs] = useState<PicklistField[]>([]);
  useEffect(() => {
    apiFetch<PicklistField[]>("/api/picklists")
      .then((defs) =>
        setShliachPicklistDefs(
          defs.filter((d) => d.entity_type === "contact_shliach" && d.field_key !== "email"),
        ),
      )
      .catch(() => setShliachPicklistDefs([]));
  }, []);

  // fixes71 §A: the Edit Lock list below only ever showed the 11 fixed
  // APARTMENT_FIELD_KEYS — any admin-added apartment custom picklist/custom
  // field could never be locked. Same fetch pattern as shliachPicklistDefs
  // above, just for entity_type="apartment" (mirrors street.tsx's own
  // customDefs/customFieldDefs split).
  const [apartmentPicklistDefs, setApartmentPicklistDefs] = useState<PicklistField[]>([]);
  useEffect(() => {
    apiFetch<PicklistField[]>("/api/picklists")
      .then((defs) =>
        setApartmentPicklistDefs(
          defs.filter(
            (d) => d.entity_type === "apartment" && !FIXED_APARTMENT_PICKLIST_KEYS.includes(d.field_key),
          ),
        ),
      )
      .catch(() => setApartmentPicklistDefs([]));
  }, []);
  const apartmentCustomFieldDefs = useCustomFieldDefs("apartment").filter(
    (d) => d.field_type !== "select",
  );

  const [disableEdit, setDisableEdit] = useState(false);
  const [hideFilters, setHideFilters] = useState(false);
  // fixes53 §8: field-level self-edit locks (Email/Areas/Report Numbers are
  // mandatory and never appear here — see ContactView.MANDATORY_SELF_EDIT_LOCKS).
  const [selfEditLockedFields, setSelfEditLockedFields] = useState<string[]>([]);
  // fixes54 §6: field-level Apartment edit locks — reuses APARTMENT_FIELD_KEYS
  // (already defined above for the "default columns" section).
  const [apartmentEditLockedFields, setApartmentEditLockedFields] = useState<string[]>([]);
  const [customizeFieldsLocked, setCustomizeFieldsLocked] = useState(false);
  const [street2FieldOrder, setStreet2FieldOrder] = useState<string[]>([]);
  const [areaIds, setAreaIds] = useState<number[]>([]);
  const [buildingIds, setBuildingIds] = useState<number[]>([]);
  const [jewishFilter, setJewishFilter] = useState<string[]>([]);
  const [mezuzahFilter, setMezuzahFilter] = useState<string[]>([]);
  const [languageFilter, setLanguageFilter] = useState<string[]>([]);
  // null = "not configured" (the Apartments page's own built-in default
  // applies); otherwise the exact set of columns a shliach starts with.
  const [useDefaultColumns, setUseDefaultColumns] = useState(false);
  const [defaultColumns, setDefaultColumns] = useState<ApartmentFieldKey[]>([]);

  const [taskEmailHe, setTaskEmailHe] = useState("");
  const [taskEmailEn, setTaskEmailEn] = useState("");
  const [tab, setTab] = usePersistentState<ConfigTab>("crm.shliachConfig.tab", "apartments");

  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  // fixes54 §5: admin-managed announcements shown in the feed on the
  // activist landing page — its own CRUD, independent of the settings
  // form's single PUT-on-submit flow above.
  const [announcements, setAnnouncements] = useState<ShliachAnnouncement[]>([]);
  const [announcementsLoading, setAnnouncementsLoading] = useState(true);
  const [editingAnnouncement, setEditingAnnouncement] = useState<
    ShliachAnnouncement | "new" | null
  >(null);
  const confirmDialog = useConfirm();

  function reloadAnnouncements() {
    return apiFetch<ShliachAnnouncement[]>("/api/shliach-messages/announcements")
      .then(setAnnouncements)
      .catch(() => setAnnouncements([]));
  }

  useEffect(() => {
    reloadAnnouncements().finally(() => setAnnouncementsLoading(false));
  }, []);

  async function deleteAnnouncement(a: ShliachAnnouncement) {
    if (
      !(await confirmDialog({
        message: t("shliach_config.announcement_delete_confirm", "למחוק את ההודעה?"),
        detail: a.message_title,
      }))
    ) {
      return;
    }
    await apiFetch(`/api/shliach-messages/announcements/${a.id}`, { method: "DELETE" });
    await reloadAnnouncements();
    success(t("msg.deleted", "נמחק בהצלחה"));
  }

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

  // fixes59 §2b: which shliach(im) currently cover each area — powers the
  // "this filter would hide an activist's own coverage" warning below.
  // Reuses the same endpoint fixes43 §4.2 built for the area-picker conflict
  // check (AreaMultiSelect); a building's own `area_id` stands in for a
  // building-level check since coverage isn't tracked per-building.
  const [areaAssignments, setAreaAssignments] = useState<Record<number, ShliachSummary[]>>({});

  useEffect(() => {
    Promise.all([
      apiFetch<OrgDetails>("/api/organizations/me"),
      apiFetch<Area[]>("/api/areas").catch(() => []),
      apiFetch<Building[]>("/api/buildings").catch(() => []),
      apiFetch<Record<number, ShliachSummary[]>>("/api/areas/shliach-assignments").catch(
        () => ({}),
      ),
    ])
      .then(([org, areaList, buildingList, assignments]) => {
        setAreas(areaList);
        setBuildings(buildingList);
        setAreaAssignments(assignments);
        const cfg = (org.shliach_view_config ?? {}) as ShliachViewConfigShape;
        setDisableEdit(!!cfg.disable_edit);
        setHideFilters(!!cfg.hide_filters);
        setSelfEditLockedFields(cfg.self_edit_locked_fields ?? []);
        setApartmentEditLockedFields(cfg.apartment_edit_locked_fields ?? []);
        setCustomizeFieldsLocked(!!cfg.customize_fields_locked);
        setStreet2FieldOrder(cfg.street2_field_order ?? []);
        setAreaIds(cfg.default_filters?.area_ids ?? []);
        setBuildingIds(cfg.default_filters?.building_ids ?? []);
        setJewishFilter(cfg.default_filters?.jewish_status ?? []);
        setMezuzahFilter(cfg.default_filters?.mezuzah_status ?? []);
        setLanguageFilter(cfg.default_filters?.language ?? []);
        setTaskEmailHe(cfg.task_email_text_he || DEFAULT_TASK_EMAIL_TEXT.he);
        setTaskEmailEn(cfg.task_email_text_en || DEFAULT_TASK_EMAIL_TEXT.en);
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

  function toggleSelfEditLock(key: string) {
    setSelfEditLockedFields((prev) =>
      prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key],
    );
  }

  function toggleApartmentEditLock(key: string) {
    setApartmentEditLockedFields((prev) =>
      prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key],
    );
  }

  // fixes59 §2a: live count of apartments the default filter above currently
  // matches, so an admin sees the effect of a change before saving it —
  // debounced (matches the apartments grid's own filter-change cadence) and
  // scoped by the same params /api/apartments/list already accepts.
  const [matchingApartments, setMatchingApartments] = useState<number | null>(null);
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      areaIds.forEach((id) => params.append("area_ids", String(id)));
      buildingIds.forEach((id) => params.append("building_ids", String(id)));
      jewishFilter.forEach((v) => params.append("jewish_status", v));
      mezuzahFilter.forEach((v) => params.append("mezuzah_status", v));
      languageFilter.forEach((v) => params.append("language", v));
      params.set("page", "1");
      // fixes57 §guard: /api/apartments/list only accepts page_size 20/50/100
      // — we only need `total`, so the smallest allowed value is fine.
      params.set("page_size", "20");
      apiFetch<ApartmentPage>(`/api/apartments/list?${params}`)
        .then((res) => {
          if (!cancelled) setMatchingApartments(res.total);
        })
        .catch(() => {
          if (!cancelled) setMatchingApartments(null);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [loaded, areaIds, buildingIds, jewishFilter, mezuzahFilter, languageFilter]);

  // fixes59 §2b: an area/building filter selection is a *restriction* (only
  // meaningful once non-empty — an empty list means "no restriction, show
  // everything"), so only warn when a non-empty selection would leave out an
  // area/building an activist is actually assigned to today. A building's
  // own area stands in for a per-building assignment check (see the
  // areaAssignments comment above).
  async function confirmFilterExclusions(): Promise<boolean> {
    const excludedArea =
      areaIds.length > 0 &&
      areas.some((a) => !areaIds.includes(a.id) && (areaAssignments[a.id]?.length ?? 0) > 0);
    const excludedBuilding =
      buildingIds.length > 0 &&
      buildings.some(
        (b) =>
          !buildingIds.includes(b.id) &&
          b.area_id != null &&
          (areaAssignments[b.area_id]?.length ?? 0) > 0,
      );
    if (!excludedArea && !excludedBuilding) return true;
    return confirmDialog({
      message: t(
        "shliach_config.filter_conflict_warning",
        ".האזור/הבניין שייך לפעיל קיים",
      ),
    });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!(await confirmFilterExclusions())) return;
    setBusy(true);
    try {
      const shliach_view_config: ShliachViewConfigShape = {
        disable_edit: disableEdit,
        hide_filters: hideFilters,
        self_edit_locked_fields: selfEditLockedFields,
        apartment_edit_locked_fields: apartmentEditLockedFields,
        customize_fields_locked: customizeFieldsLocked,
        street2_field_order: street2FieldOrder,
        default_filters: {
          area_ids: areaIds,
          building_ids: buildingIds,
          jewish_status: jewishFilter,
          mezuzah_status: mezuzahFilter,
          language: languageFilter,
        },
        default_columns: useDefaultColumns ? defaultColumns : null,
        task_email_text_he: taskEmailHe.trim(),
        task_email_text_en: taskEmailEn.trim(),
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
    return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;
  }
  if (!isAdmin) {
    return (
      <p className="text-destructive">
        {t("page.admins_only", "אין לך הרשאה לעמוד זה (מנהלים בלבד).")}
      </p>
    );
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="font-display text-3xl font-bold">
          {t("shliach_config.title", "הגדרות לתצוגת פעילים")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "shliach_config.intro",
            "שולט על תצוגת הדירות שרואים משתמשי פעיל — עריכה, סינון ועמודות ברירת מחדל.",
          )}
        </p>
      </div>

      <TabBar
        tabs={[
          { id: "apartments", label: t("shliach_config.tab_apartments", "תצוגת דירות") },
          { id: "profile", label: t("shliach_config.tab_profile", "פרופיל הפעיל") },
          { id: "task_email", label: t("shliach_config.tab_task_email", "מייל משימה חדשה") },
          { id: "announcements", label: t("shliach_config.tab_announcements", "מודעות בעמוד הבית") },
          { id: "messages", label: t("shliach_config.tab_messages", "הודעות לפעילים") },
        ]}
        value={tab}
        onChange={setTab}
      />

      {FORM_TABS.includes(tab) && (
      <form onSubmit={save} className="bg-card rounded-xl shadow-sm p-6 space-y-6">
        {tab === "apartments" && (<>
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

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={customizeFieldsLocked}
            onChange={(e) => setCustomizeFieldsLocked(e.target.checked)}
          />
          {t(
            "shliach_config.customize_fields_locked",
            "נעל את אפשרות \"התאמת שדות\" — הסתר אותה לגמרי מהפעילים",
          )}
        </label>

        {/* fixes54 §6: "Edit Lock" — which Apartment fields an activist can't
            inline-edit while working (a per-field refinement of the blanket
            "disable_edit" toggle above). This used to be the ONLY field-lock
            section on this page, but it locked the activist's own CONTACT
            profile fields (name/last name/phone) instead — genuinely useful
            (see the renamed section below), just not what "Edit Lock" reads
            as on a page about the apartments an activist works. */}
        <div className="border-t border-border pt-4 space-y-3">
          <span className="block text-sm font-medium">
            {t("shliach_config.apartment_edit_locks", "נעילת שדות לעריכה (דירות)")}
          </span>
          <p className="text-xs text-muted-foreground">
            {t(
              "shliach_config.apartment_edit_locks_hint",
              "סמן שדות דירה שפעילים לא יוכלו לערוך בעצמם. ללא סימון — כל השדות ניתנים לעריכה (אלא אם \"בטל אפשרות עריכה\" מסומן למעלה).",
            )}
          </p>
          <div className="flex flex-wrap gap-3">
            {APARTMENT_FIELD_KEYS.map((k) => (
              <label key={k} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={apartmentEditLockedFields.includes(k)}
                  onChange={() => toggleApartmentEditLock(k)}
                />
                {fieldLabels[k]}
              </label>
            ))}
            {apartmentPicklistDefs.map((d) => (
              <label key={d.field_key} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={apartmentEditLockedFields.includes(d.field_key)}
                  onChange={() => toggleApartmentEditLock(d.field_key)}
                />
                {(lang === "en" ? d.english_label || d.label : d.label) || d.field_key}
              </label>
            ))}
            {apartmentCustomFieldDefs.map((d) => {
              const key = `customfield.apartment.${d.field_key}`;
              return (
                <label key={key} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={apartmentEditLockedFields.includes(key)}
                    onChange={() => toggleApartmentEditLock(key)}
                  />
                  {(lang === "en" ? d.english_label || d.hebrew_label : d.hebrew_label) ||
                    d.field_key}
                </label>
              );
            })}
          </div>
        </div>

        </>)}

        {tab === "profile" && (
        <>
        {/* fixes53 §7/§8: field-level locks for a shliach's own "עריכת המידע
            שלך" self-edit — Email/Areas/Report Numbers are always locked
            (never listed here); anything else is opt-in per org. fixes54 §6:
            renamed from "נעילת שדות לעריכה עצמית" — that generic label read
            as being about the same apartment editing as the section above,
            when it's actually about the activist's own contact profile. */}
        <div className="space-y-3">
          <span className="block text-sm font-medium">
            {t("shliach_config.self_edit_locks", "נעילת שדות בפרופיל האישי של הפעיל")}
          </span>
          <p className="text-xs text-muted-foreground">
            {t(
              "shliach_config.self_edit_locks_hint",
              "אימייל, אזורים ומספרי דוח נעולים תמיד בעריכה עצמית. סמן שדות נוספים לנעילה.",
            )}
          </p>
          <div className="flex flex-wrap gap-3">
            {FIXED_SELF_EDIT_FIELDS.map((key) => (
              <label key={key} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={selfEditLockedFields.includes(key)}
                  onChange={() => toggleSelfEditLock(key)}
                />
                {
                  {
                    name: t("contacts.name", "שם פרטי"),
                    last_name: t("contacts.last_name", "שם משפחה"),
                    phone: t("contacts.phone", "טלפון"),
                    "shliach.notes": t("contact_shliach.notes", "הערות"),
                  }[key]
                }
              </label>
            ))}
            {shliachPicklistDefs.map((d) => (
              <label key={d.field_key} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={selfEditLockedFields.includes(d.field_key)}
                  onChange={() => toggleSelfEditLock(d.field_key)}
                />
                {(lang === "en" ? d.english_label || d.label : d.label) || d.field_key}
              </label>
            ))}
            {shliachCustomFieldDefs.map((d) => (
              <label key={d.field_key} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={selfEditLockedFields.includes(d.field_key)}
                  onChange={() => toggleSelfEditLock(d.field_key)}
                />
                {(lang === "en" ? d.english_label || d.hebrew_label : d.hebrew_label) ||
                  d.field_key}
              </label>
            ))}
          </div>
        </div>

        </>
        )}

        {tab === "apartments" && (<>
        {/* fixes74 §13: order of every field in the activist's street2
            apartment card (built-in + additional). */}
        <div className="border-t border-border pt-4 space-y-3">
          <span className="block text-sm font-medium">
            {t("shliach_config.street2_field_order", "סדר השדות בכרטיס הדירה של הפעיל")}
          </span>
          <p className="text-xs text-muted-foreground">
            {t(
              "shliach_config.street2_field_order_hint",
              "קובע את סדר השדות בחלון הדירה במסלול של הפעיל — שדות מובנים ושדות נוספים. שדות מוסתרים נשארים מוסתרים.",
            )}
          </p>
          <Street2FieldOrderEditor value={street2FieldOrder} onChange={setStreet2FieldOrder} />
        </div>

        <div className="border-t border-border pt-4 space-y-3">
          <span className="block text-sm font-medium">
            {t("shliach_config.default_filters", "סינון ברירת מחדל")}
          </span>
          <p className="text-xs text-muted-foreground">
            {t(
              "shliach_config.default_filters_hint",
              "הסינון שבו תיפתח תצוגת הדירות עבור פעילים.",
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <MultiSelectFilter
              allLabel={t("filter.all_areas", "כל האזורים")}
              label={fieldLabels.area}
              options={areas.map((a) => ({ id: a.id, label: a.area_name }))}
              value={areaIds}
              onChange={setAreaIds}
            />
            <MultiSelectSearchFilter
              className="w-56"
              allLabel={t("filter.all_buildings", "כל הבניינים")}
              label={fieldLabels.building}
              options={buildings.map((b) => ({ id: b.id, label: buildingDisplayName(b) }))}
              value={buildingIds}
              onChange={setBuildingIds}
              searchPlaceholder={t("filter.search_buildings", "חיפוש בניין…")}
            />
            <MultiSelectFilter
              allLabel={t("filter.all_jewish", "כל סטטוסי היהדות")}
              label={fieldLabels.jewish_status}
              options={jewish.options.map((o) => ({ id: o.value, label: jewish.display(o) }))}
              value={jewishFilter}
              onChange={setJewishFilter}
            />
            <MultiSelectFilter
              allLabel={t("filter.all_mezuzah", "כל סטטוסי המזוזה")}
              label={fieldLabels.mezuzah_status}
              options={mezuzah.options.map((o) => ({ id: o.value, label: mezuzah.display(o) }))}
              value={mezuzahFilter}
              onChange={setMezuzahFilter}
            />
            <MultiSelectFilter
              allLabel={t("filter.all_languages", "כל השפות")}
              label={fieldLabels.language}
              options={language.options.map((o) => ({ id: o.value, label: language.display(o) }))}
              value={languageFilter}
              onChange={setLanguageFilter}
            />
          </div>
          {/* fixes59 §2a: live preview so an admin sees the effect of a
              filter change before saving it. */}
          <p className="text-xs text-muted-foreground">
            {matchingApartments == null
              ? t("action.loading", "טוען…")
              : t(
                  "shliach_config.matching_apartments",
                  "{n} דירות תואמות את הסינון הזה",
                ).replace("{n}", String(matchingApartments))}
          </p>
        </div>

        <div className="border-t border-border pt-4 space-y-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={useDefaultColumns}
              onChange={(e) => setUseDefaultColumns(e.target.checked)}
            />
            {t("shliach_config.default_columns", "עמודות ברירת מחדל")}
          </label>
          <p className="text-xs text-muted-foreground">
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
        </>)}

        {/* fixes98: the org's own text for the "new task" email (Hebrew +
            English); the email adds the task details and the org's link. */}
        {tab === "task_email" && (
          <div className="space-y-4">
            <div>
              <span className="block text-sm font-medium">
                {t("shliach_config.task_email_title", "מייל \"שובצה לך משימה חדשה\"")}
              </span>
              <p className="mt-1 text-xs text-muted-foreground">
                {t(
                  "shliach_config.task_email_hint",
                  "נשלח לפעיל כששובצה לו משימה. המייל כולל את שני הטקסטים (עברית ואנגלית), את פרטי המשימה — הכתובת הראשונה, או הטקסט במשימת טקסט — וקישור לדף הארגון.",
                )}
              </p>
            </div>
            <label className="block space-y-1">
              <span className="block text-sm">{t("shliach_config.task_email_he", "טקסט בעברית")}</span>
              <textarea
                dir="rtl"
                rows={3}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                value={taskEmailHe}
                onChange={(e) => setTaskEmailHe(e.target.value)}
              />
            </label>
            <label className="block space-y-1">
              <span className="block text-sm">{t("shliach_config.task_email_en", "טקסט באנגלית")}</span>
              <textarea
                dir="ltr"
                rows={3}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                value={taskEmailEn}
                onChange={(e) => setTaskEmailEn(e.target.value)}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              {t("shliach_config.task_email_empty_hint", "שדה ריק = הטקסט שמוגדר כברירת מחדל במערכת.")}
            </p>
          </div>
        )}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy}>
            {busy ? t("action.saving", "שומר…") : t("action.save", "שמור")}
          </Button>
          {saved && <span className="text-sm text-success">{t("action.saved", "נשמר ✓")}</span>}
        </div>
      </form>
      )}

      {tab === "messages" && <ActivistMessagesEditor />}

      {/* fixes54 §5: announcements for the activist landing page's feed —
          WYSIWYG-authored HTML messages, full CRUD. */}
      {tab === "announcements" && (
      <div className="bg-card rounded-xl shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">
              {t("shliach_config.announcements_title", "הודעות לפעילים")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(
                "shliach_config.announcements_hint",
                "הודעות אלו מוצגות לפעילים בעמוד הבית שלהם, כאשר הן פעילות.",
              )}
            </p>
          </div>
          {editingAnnouncement === null && (
            <Button type="button" size="sm" onClick={() => setEditingAnnouncement("new")}>
              <Plus className="h-4 w-4" /> {t("shliach_config.announcement_add", "הודעה חדשה")}
            </Button>
          )}
        </div>

        {editingAnnouncement !== null && (
          <AnnouncementForm
            item={editingAnnouncement === "new" ? undefined : editingAnnouncement}
            onClose={() => setEditingAnnouncement(null)}
            onSaved={async () => {
              setEditingAnnouncement(null);
              await reloadAnnouncements();
              success(t("msg.saved", "נשמר בהצלחה"));
            }}
          />
        )}

        <div className="rounded-lg border border-border divide-y divide-border">
          {announcementsLoading ? (
            <p className="px-4 py-6 text-center text-muted-foreground">{t("action.loading", "טוען…")}</p>
          ) : announcements.length === 0 ? (
            <p className="px-4 py-6 text-center text-muted-foreground">
              {t("shliach_config.announcements_none", "אין הודעות עדיין.")}
            </p>
          ) : (
            announcements.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{a.message_title}</span>
                    <Badge variant={a.is_visible ? "success" : "secondary"}>
                      {a.is_visible
                        ? t("shliach_config.announcement_visible", "מוצגת")
                        : t("shliach_config.announcement_hidden", "מוסתרת")}
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground" dir="ltr">
                    {new Date(a.updated_at).toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button type="button" size="sm" variant="secondary" onClick={() => setEditingAnnouncement(a)}>
                    {t("action.edit", "ערוך")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-destructive text-destructive hover:bg-destructive/10"
                    onClick={() => deleteAnnouncement(a)}
                  >
                    {t("action.delete", "מחק")}
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      )}
    </div>
  );
}

/** fixes54 §5: add/edit form for one announcement — a WYSIWYG-authored HTML
 *  body via the shared RichTextEditor (same component the superadmin email
 *  templates use, fixes15 §2.1). */
function AnnouncementForm({
  item,
  onClose,
  onSaved,
}: {
  item?: ShliachAnnouncement;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t, lang } = useLocalization();
  const { error: toastError } = useToast();
  const [title, setTitle] = useState(item?.message_title ?? "");
  const [content, setContent] = useState(item?.message_content ?? "");
  const [visible, setVisible] = useState(item?.is_visible ?? true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // fixes56 §2: the RichTextEditor's image-picker button opens this modal and
  // awaits a URL (or null on cancel/close) via a pending-promise resolver.
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const imagePickerResolve = useRef<((url: string | null) => void) | null>(null);

  function openImagePicker(): Promise<string | null> {
    return new Promise((resolve) => {
      imagePickerResolve.current = resolve;
      setImagePickerOpen(true);
    });
  }

  function resolveImagePicker(url: string | null) {
    setImagePickerOpen(false);
    imagePickerResolve.current?.(url);
    imagePickerResolve.current = null;
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!title.trim()) {
      setError(t("shliach_config.announcement_title_required", "יש להזין כותרת"));
      return;
    }
    setBusy(true);
    const body = JSON.stringify({
      message_title: title.trim(),
      message_content: content,
      is_visible: visible,
    });
    try {
      if (item) {
        await apiFetch(`/api/shliach-messages/announcements/${item.id}`, {
          method: "PUT",
          body,
        });
      } else {
        await apiFetch("/api/shliach-messages/announcements", { method: "POST", body });
      }
      await onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה");
      setError(msg);
      toastError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="rounded-lg border border-border p-4 space-y-3">
      <label className="block space-y-1">
        <span className="block text-sm font-medium">
          {t("shliach_config.announcement_title_field", "כותרת ההודעה")}
        </span>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </label>
      <label className="block space-y-1">
        <span className="block text-sm font-medium">
          {t("shliach_config.announcement_content", "תוכן ההודעה")}
        </span>
        <RichTextEditor
          value={content}
          onChange={setContent}
          dir={lang === "en" ? "ltr" : "rtl"}
          imagePicker={openImagePicker}
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={visible}
          onChange={(e) => setVisible(e.target.checked)}
        />
        {t("shliach_config.announcement_visible_toggle", "מוצגת לפעילים")}
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
      {imagePickerOpen && (
        <ImagePickerModal
          onSelect={(url) => resolveImagePicker(url)}
          onClose={() => resolveImagePicker(null)}
        />
      )}
    </form>
  );
}
