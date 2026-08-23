"use client";

import { useEffect, useState, type FormEvent } from "react";

import { CustomFieldValueInput } from "@/components/CustomFieldValueInput";
import { EmailInput } from "@/components/EmailInput";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { PhoneInput } from "@/components/PhoneInput";
import { PicklistSelect } from "@/components/PicklistSelect";
import { SearchableSelect } from "@/components/SearchableSelect";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCustomFieldDefs } from "@/lib/customFields";
import { useFieldSettings } from "@/lib/fieldSettings";
import { useLocalization } from "@/lib/localization";
import { FIXED_APARTMENT_PICKLIST_KEYS, usePicklist } from "@/lib/picklists";
import {
  buildingDisplayName,
  contactFullName,
  type Apartment,
  type Building,
  type Contact,
  type CustomFieldValueMap,
  type Floor,
  type PicklistField,
  type ReportNumber,
} from "@/lib/types";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

/**
 * Full apartment form (fixes7 §2/§4) — the same structural flow as editing a
 * contact: one editor for create (no `apt`) and update (with `apt`), with every
 * data field, picklists, and per-org field visibility.
 */
export function ApartmentEditor({
  apt,
  initialBuildingId,
  onClose,
  onSaved,
}: {
  apt?: Apartment;
  /** Preselected building for the create flow (fixes12 — used when embedding
   *  the add view in a building's context via ?building=<id>). */
  initialBuildingId?: number;
  onClose: () => void;
  /** fixes19: editing returns a NEW active version — `saved` carries its id. */
  onSaved: (saved: Apartment) => Promise<void>;
}) {
  const { t, lang } = useLocalization();
  const { isFieldVisible: vis } = useFieldSettings();
  const { isShliach } = useAuth();
  const languagePicklist = usePicklist("apartment.language");
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [buildingId, setBuildingId] = useState<number | "">(
    apt?.building_id ?? initialBuildingId ?? "",
  );
  const [label, setLabel] = useState(apt?.apartment_name ?? "");
  const [floor, setFloor] = useState(apt?.floor ?? "");
  const [resident, setResident] = useState(apt?.name ?? "");
  const [phone, setPhone] = useState(apt?.phone ?? "");
  const [phoneValid, setPhoneValid] = useState(true);
  const [email, setEmail] = useState(apt?.email ?? "");
  const [emailValid, setEmailValid] = useState(true);
  const [jewishStatus, setJewishStatus] = useState<string | null>(apt?.jewish_status ?? null);
  const [campaignStatus, setCampaignStatus] = useState<string | null>(
    apt?.campaign_status ?? null,
  );
  const [mezuzahStatus, setMezuzahStatus] = useState<string | null>(
    apt?.mezuzah_status ?? null,
  );
  // fixes51 §2.2: multi-select (was single-value, fixes13).
  const [language, setLanguage] = useState<string[]>(apt?.language ?? []);
  const [notes, setNotes] = useState(apt?.apartment_notes ?? "");
  const [contactId, setContactId] = useState<number | "">("");
  // fixes19: linked report number (searchable dropdown).
  const [reportNumbers, setReportNumbers] = useState<ReportNumber[]>([]);
  const [reportNumberId, setReportNumberId] = useState<number | "">(
    apt?.report_number_id ?? "",
  );
  // fixes32-stillnotdone §2: any admin-added apartment.* picklist beyond the
  // fixed 4 above — same mechanism as the apartments list grid, so a new
  // custom picklist shows up here with no further code changes.
  const [customDefs, setCustomDefs] = useState<PicklistField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string | null>>(
    apt?.picklist_values ?? {},
  );
  // fixes35: any non-select apartment custom field (text/number/boolean/date).
  const customFieldDefs = useCustomFieldDefs("apartment").filter((d) => d.field_type !== "select");
  const [customFieldValues, setCustomFieldValues] = useState<CustomFieldValueMap>(
    apt?.custom_field_values ?? {},
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<Building[]>("/api/buildings").then(setBuildings).catch(() => {});
    apiFetch<ReportNumber[]>("/api/report-numbers")
      .then(setReportNumbers)
      .catch(() => {});
    apiFetch<PicklistField[]>("/api/picklists")
      .then((defs) =>
        setCustomDefs(
          defs.filter(
            (d) =>
              d.entity_type === "apartment" &&
              !FIXED_APARTMENT_PICKLIST_KEYS.includes(d.field_key),
          ),
        ),
      )
      .catch(() => setCustomDefs([]));
    if (!apt) {
      apiFetch<Contact[]>("/api/contacts?contact_type=mekurav")
        .then(setContacts)
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the selected building's floors for the floor dropdown.
  useEffect(() => {
    if (buildingId === "") {
      setFloors([]);
      return;
    }
    apiFetch<Floor[]>(`/api/buildings/${buildingId}/floors`)
      .then(setFloors)
      .catch(() => setFloors([]));
  }, [buildingId]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (buildingId === "") {
      setError(t("apt.select_building", "יש לבחור בניין"));
      return;
    }
    if (!phoneValid || !emailValid) {
      setError(t("msg.save_failed", "שמירה נכשלה"));
      return;
    }
    setBusy(true);
    const payload = {
      building_id: Number(buildingId),
      apartment_name: label || null,
      floor: floor || null,
      name: resident || null,
      phone: phone || null,
      email: email || null,
      jewish_status: jewishStatus,
      campaign_status: campaignStatus,
      mezuzah_status: mezuzahStatus,
      language,
      apartment_notes: notes || null,
      report_number_id: reportNumberId === "" ? null : Number(reportNumberId),
      picklist_values: customValues,
      custom_field_values: customFieldValues,
    };
    try {
      let saved: Apartment;
      if (apt) {
        // fixes19: the PUT retires this version and returns the NEW active one.
        saved = await apiFetch<Apartment>(`/api/apartments/${apt.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      } else {
        saved = await apiFetch<Apartment>("/api/apartments", {
          method: "POST",
          body: JSON.stringify({
            ...payload,
            contact_id: contactId === "" ? null : Number(contactId),
          }),
        });
      }
      await onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <h3 className="font-medium">
        {apt ? t("apt.edit_apartment", "עריכת דירה") : t("apt.new_apartment", "דירה חדשה")}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="block text-sm font-medium">{t("apartments.building_id", "בניין")}</span>
          <SearchableSelect
            value={buildingId === "" ? null : buildingId}
            onChange={(id) => {
              setBuildingId(id ?? "");
              setFloor("");
            }}
            options={buildings.map((b) => ({ id: b.id, label: buildingDisplayName(b) }))}
            placeholder={t("apt.choose_building", "בחר בניין…")}
          />
        </label>
        {/* The apartment label (apartment_name) renders before the floor so
            the two can't be conflated — the label is the apartment's identity,
            the floor is where it sits. */}
        {vis("apartments.apartment_name") && (
          <label className="block space-y-1">
            <span className="block text-sm font-medium">
              {t("apartments.apartment_name", "מספר דירה")}
            </span>
            <input
              className={inputClass}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              disabled={isShliach}
            />
          </label>
        )}
        {vis("apartments.floor") && (
          <label className="block space-y-1">
            <span className="block text-sm font-medium">{t("apartments.floor", "קומה")}</span>
            <select
              className={inputClass}
              value={floor}
              onChange={(e) => setFloor(e.target.value)}
              disabled={buildingId === ""}
            >
              <option value="">—</option>
              {floors.map((f) => (
                <option key={f.id} value={f.name}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {vis("apartments.name") && (
          <label className="block space-y-1">
            <span className="block text-sm font-medium">{t("apartments.name", "שם דייר")}</span>
            <input
              className={inputClass}
              value={resident}
              onChange={(e) => setResident(e.target.value)}
            />
          </label>
        )}
        {vis("apartments.phone") && (
          <label className="block space-y-1">
            <span className="block text-sm font-medium">{t("apartments.phone", "טלפון")}</span>
            <PhoneInput value={phone} onChange={setPhone} onValidityChange={setPhoneValid} />
          </label>
        )}
        {vis("apartments.email") && (
          <label className="block space-y-1">
            <span className="block text-sm font-medium">{t("apartments.email", "אימייל")}</span>
            <EmailInput value={email} onChange={setEmail} onValidityChange={setEmailValid} />
          </label>
        )}
        {vis("apartment.Jewish_status") && (
          <label className="block space-y-1">
            <span className="block text-sm font-medium">
              {t("picklist.apartment.Jewish_status", "יהדות")}
            </span>
            <PicklistSelect
              fieldKey="apartment.Jewish_status"
              value={jewishStatus}
              onChange={setJewishStatus}
            />
          </label>
        )}
        {vis("apartment.campaign_status") && (
          <label className="block space-y-1">
            <span className="block text-sm font-medium">
              {t("picklist.apartment.campaign_status", "סטטוס קמפיין")}
            </span>
            <PicklistSelect
              fieldKey="apartment.campaign_status"
              value={campaignStatus}
              onChange={setCampaignStatus}
            />
          </label>
        )}
        {vis("apartment.mezuzah_status") && (
          <label className="block space-y-1">
            <span className="block text-sm font-medium">
              {t("picklist.apartment.mezuzah_status", "מזוזה")}
            </span>
            <PicklistSelect
              fieldKey="apartment.mezuzah_status"
              value={mezuzahStatus}
              onChange={setMezuzahStatus}
            />
          </label>
        )}
        {vis("apartment.language") && (
          <label className="block space-y-1">
            <span className="block text-sm font-medium">
              {t("picklist.apartment.language", "שפה")}
            </span>
            {/* fixes51 §2.2: multi-select (was a single PicklistSelect). */}
            <MultiSelectFilter
              allLabel={t("filter.all_languages", "כל השפות")}
              options={languagePicklist.options.map((o) => ({
                id: o.value,
                label: languagePicklist.display(o),
              }))}
              value={language}
              onChange={setLanguage}
            />
          </label>
        )}
        {/* fixes32-stillnotdone §2: any admin-added apartment.* picklist. */}
        {customDefs.map((d) => (
          <label key={d.field_key} className="block space-y-1">
            <span className="block text-sm font-medium">
              {(lang === "en" ? d.english_label || d.label : d.label) || d.field_key}
            </span>
            <PicklistSelect
              fieldKey={d.field_key}
              value={customValues[d.field_key] ?? null}
              onChange={(v) =>
                setCustomValues((prev) => ({ ...prev, [d.field_key]: v }))
              }
            />
          </label>
        ))}
        {/* fixes35: any non-select apartment custom field. */}
        {customFieldDefs.map((d) => (
          <label key={d.field_key} className="block space-y-1">
            <span className="block text-sm font-medium">
              {(lang === "en" ? d.english_label || d.hebrew_label : d.hebrew_label) ||
                d.field_key}
            </span>
            <CustomFieldValueInput
              fieldType={d.field_type}
              value={customFieldValues[d.field_key] ?? null}
              onChange={(v) =>
                setCustomFieldValues((prev) => ({ ...prev, [d.field_key]: v }))
              }
            />
          </label>
        ))}
        {/* fixes19: searchable report-number dropdown (מספר דוח). */}
        {vis("apartments.report_number_id") && (
          <label className="block space-y-1">
            <span className="block text-sm font-medium">
              {t("apartments.report_number_id", "מספר דוח")}
            </span>
            <SearchableSelect
              value={reportNumberId === "" ? null : reportNumberId}
              onChange={(id) => setReportNumberId(id ?? "")}
              options={reportNumbers.map((rn) => ({ id: rn.id, label: rn.name }))}
              placeholder={t("apt.choose_report_number", "בחר מספר דוח…")}
            />
          </label>
        )}
        {vis("apartments.apartment_notes") && (
          <label className="block space-y-1 sm:col-span-2">
            <span className="block text-sm font-medium">
              {t("apartments.apartment_notes", "הערות")}
            </span>
            <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        )}
        {!apt && (
          <label className="block space-y-1 sm:col-span-2">
            <span className="block text-sm font-medium">
              {t("apt.associate_contact", "שייך איש קשר קיים (לא חובה)")}
            </span>
            <SearchableSelect
              value={contactId === "" ? null : contactId}
              onChange={(id) => setContactId(id ?? "")}
              options={contacts.map((c) => ({ id: c.id, label: contactFullName(c) }))}
              placeholder="—"
            />
          </label>
        )}
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
