"use client";

import { useEffect, useState, type FormEvent } from "react";

import { EmailInput } from "@/components/EmailInput";
import { PhoneInput } from "@/components/PhoneInput";
import { PicklistSelect } from "@/components/PicklistSelect";
import { apiFetch } from "@/lib/api";
import { useFieldSettings } from "@/lib/fieldSettings";
import { useLocalization } from "@/lib/localization";
import {
  buildingDisplayName,
  contactFullName,
  type Apartment,
  type Building,
  type Contact,
  type Floor,
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
  onSaved: () => Promise<void>;
}) {
  const { t } = useLocalization();
  const { isFieldVisible: vis } = useFieldSettings();
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
  const [language, setLanguage] = useState<string | null>(apt?.language ?? null);
  const [notes, setNotes] = useState(apt?.apartment_notes ?? "");
  const [contactId, setContactId] = useState<number | "">("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<Building[]>("/api/buildings").then(setBuildings).catch(() => {});
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
    };
    try {
      if (apt) {
        await apiFetch(`/api/apartments/${apt.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch("/api/apartments", {
          method: "POST",
          body: JSON.stringify({
            ...payload,
            contact_id: contactId === "" ? null : Number(contactId),
          }),
        });
      }
      await onSaved();
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
          <select
            className={inputClass}
            value={buildingId}
            onChange={(e) => {
              setBuildingId(e.target.value === "" ? "" : Number(e.target.value));
              setFloor("");
            }}
            required
          >
            <option value="">{t("apt.choose_building", "בחר בניין…")}</option>
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {buildingDisplayName(b)}
              </option>
            ))}
          </select>
        </label>
        {/* The apartment label (apartment_name) renders before the floor so
            the two can't be conflated — the label is the apartment's identity,
            the floor is where it sits. */}
        {vis("apartments.apartment_name") && (
          <label className="block space-y-1">
            <span className="block text-sm font-medium">
              {t("apartments.apartment_name", "מספר דירה")}
            </span>
            <input className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} />
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
            <PicklistSelect
              fieldKey="apartment.language"
              value={language}
              onChange={setLanguage}
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
            <select
              className={inputClass}
              value={contactId}
              onChange={(e) => setContactId(e.target.value === "" ? "" : Number(e.target.value))}
            >
              <option value="">—</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {contactFullName(c)}
                </option>
              ))}
            </select>
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
