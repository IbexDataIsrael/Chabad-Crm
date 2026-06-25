"use client";

import { useState, type FormEvent, type ReactNode } from "react";

import { useLocalization } from "@/lib/localization";
import type { Contact, ContactType, UserSummary } from "@/lib/types";
import { AddressAutocomplete } from "./AddressAutocomplete";
import { ApartmentMultiSelect } from "./ApartmentMultiSelect";
import { ApartmentPicker } from "./ApartmentPicker";
import { DatePicker } from "./DatePicker";
import { PicklistSelect } from "./PicklistSelect";

export interface MekuravFormValues {
  apartment_id: number | null;
  first_visit: string | null;
  potential_next_step: string | null;
  rebbe_connection: string | null;
  recommendations: string | null;
  background: string | null;
}

export interface ShliachFormValues {
  notes: string | null;
  apartment_ids: number[];
}

export interface ContactFormValues {
  name: string;
  last_name: string | null;
  phone: string;
  email: string | null;
  contact_type: ContactType;
  assigned_user_id: number | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  area: string | null;
  pipeline_status: string | null;
  color_tag: string | null;
  priority_score: number | null;
  mekurav: MekuravFormValues;
  shliach: ShliachFormValues;
}

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

export function ContactForm({
  initial,
  users,
  onSubmit,
  submitLabel,
  extra,
}: {
  initial?: Partial<Contact>;
  users: UserSummary[];
  onSubmit: (values: ContactFormValues) => Promise<void>;
  submitLabel: string;
  extra?: ReactNode;
}) {
  const { t } = useLocalization();
  const [values, setValues] = useState<ContactFormValues>({
    name: initial?.name ?? "",
    last_name: initial?.last_name ?? null,
    phone: initial?.phone ?? "",
    email: initial?.email ?? null,
    contact_type: initial?.contact_type ?? "mekurav",
    assigned_user_id: initial?.assigned_user_id ?? null,
    address: initial?.address ?? null,
    latitude: initial?.latitude ?? null,
    longitude: initial?.longitude ?? null,
    area: initial?.area ?? null,
    pipeline_status: initial?.pipeline_status ?? null,
    color_tag: initial?.color_tag ?? null,
    priority_score: initial?.priority_score ?? null,
    mekurav: {
      apartment_id: initial?.mekurav?.apartment_id ?? null,
      first_visit: initial?.mekurav?.first_visit ?? null,
      potential_next_step: initial?.mekurav?.potential_next_step ?? null,
      rebbe_connection: initial?.mekurav?.rebbe_connection ?? null,
      recommendations: initial?.mekurav?.recommendations ?? null,
      background: initial?.mekurav?.background ?? null,
    },
    shliach: {
      notes: initial?.shliach?.notes ?? null,
      apartment_ids: initial?.shliach?.apartment_ids ?? [],
    },
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isMekurav = values.contact_type === "mekurav";
  const isShliach = values.contact_type === "shliach";

  function set<K extends keyof ContactFormValues>(key: K, v: ContactFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  function setMekurav<K extends keyof MekuravFormValues>(key: K, v: MekuravFormValues[K]) {
    setValues((prev) => ({ ...prev, mekurav: { ...prev.mekurav, [key]: v } }));
  }

  function setShliach<K extends keyof ShliachFormValues>(key: K, v: ShliachFormValues[K]) {
    setValues((prev) => ({ ...prev, shliach: { ...prev.shliach, [key]: v } }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await onSubmit(values);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שמירה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Field label={t("contacts.name", "שם פרטי")}>
        <input
          className={inputClass}
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          required
        />
      </Field>

      <Field label={t("contacts.last_name", "שם משפחה")}>
        <input
          className={inputClass}
          value={values.last_name ?? ""}
          onChange={(e) => set("last_name", e.target.value || null)}
        />
      </Field>

      <Field label={t("contacts.phone", "טלפון")}>
        <input
          type="tel"
          dir="ltr"
          className={inputClass}
          value={values.phone}
          onChange={(e) => set("phone", e.target.value)}
          required
        />
      </Field>

      <Field label={t("contacts.email", "דוא״ל") + (isShliach ? " (להתחברות)" : "")}>
        <input
          type="email"
          dir="ltr"
          className={inputClass}
          value={values.email ?? ""}
          onChange={(e) => set("email", e.target.value || null)}
          required={isShliach}
        />
      </Field>

      <Field label={t("contacts.area", "אזור")}>
        <PicklistSelect
          fieldKey="contact.area"
          value={values.area}
          onChange={(v) => set("area", v)}
        />
      </Field>

      <Field label={t("contacts.assigned_user_id", "משויך ל")}>
        <select
          className={inputClass}
          value={values.assigned_user_id ?? ""}
          onChange={(e) =>
            set(
              "assigned_user_id",
              e.target.value === "" ? null : Number(e.target.value),
            )
          }
        >
          <option value="">—</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.full_name}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t("contacts.pipeline_status", "סטטוס")}>
        <PicklistSelect
          fieldKey="contact.pipeline_status"
          value={values.pipeline_status}
          onChange={(v) => set("pipeline_status", v)}
        />
      </Field>

      <Field label={t("contacts.color_tag", "צבע")}>
        <PicklistSelect
          fieldKey="contact.color_tag"
          value={values.color_tag}
          onChange={(v) => set("color_tag", v)}
        />
      </Field>

      <Field label={t("contacts.priority_score", "ציון עדיפות")}>
        <input
          type="number"
          className={inputClass}
          value={values.priority_score ?? ""}
          onChange={(e) =>
            set("priority_score", e.target.value === "" ? null : Number(e.target.value))
          }
        />
      </Field>

      <div className="sm:col-span-2">
        <Field label={t("contacts.address", "כתובת")}>
          <AddressAutocomplete
            className={inputClass}
            value={values.address ?? ""}
            onChange={(address) =>
              // Manual typing clears coords so the server geocodes on save.
              setValues((prev) => ({
                ...prev,
                address: address || null,
                latitude: null,
                longitude: null,
              }))
            }
            onPlace={(p) => {
              setValues((prev) => ({
                ...prev,
                address: p.address || null,
                latitude: p.lat,
                longitude: p.lng,
              }));
            }}
          />
        </Field>
      </div>

      <Field label={t("contacts.latitude", "קו רוחב")}>
        <input
          type="number"
          step="any"
          className={inputClass}
          dir="ltr"
          value={values.latitude ?? ""}
          onChange={(e) =>
            set("latitude", e.target.value === "" ? null : Number(e.target.value))
          }
        />
      </Field>

      <Field label={t("contacts.longitude", "קו אורך")}>
        <input
          type="number"
          step="any"
          className={inputClass}
          dir="ltr"
          value={values.longitude ?? ""}
          onChange={(e) =>
            set("longitude", e.target.value === "" ? null : Number(e.target.value))
          }
        />
      </Field>

      {isMekurav && (
        <>
          <div className="sm:col-span-2">
            <Field label={t("contact_mekurav.apartment_id", "דירה")}>
              <ApartmentPicker
                value={values.mekurav.apartment_id}
                onChange={(id) => setMekurav("apartment_id", id)}
              />
            </Field>
          </div>

          <Field label={t("contact_mekurav.first_visit", "ביקור ראשון")}>
            <DatePicker
              value={values.mekurav.first_visit}
              onChange={(v) => setMekurav("first_visit", v)}
              withTime
              className={inputClass}
            />
          </Field>

          <Field label={t("contact_mekurav.potential_next_step", "פוטנציאל לצעד")}>
            <PicklistSelect
              fieldKey="contact.potential_next_step"
              value={values.mekurav.potential_next_step}
              onChange={(v) => setMekurav("potential_next_step", v)}
            />
          </Field>

          <div className="sm:col-span-2">
            <Field label={t("contact_mekurav.rebbe_connection", "קשר לרבי")}>
              <textarea
                className={inputClass}
                rows={2}
                value={values.mekurav.rebbe_connection ?? ""}
                onChange={(e) => setMekurav("rebbe_connection", e.target.value || null)}
              />
            </Field>
          </div>

          <div className="sm:col-span-2">
            <Field label={t("contact_mekurav.recommendations", "המלצות")}>
              <textarea
                className={inputClass}
                rows={2}
                value={values.mekurav.recommendations ?? ""}
                onChange={(e) => setMekurav("recommendations", e.target.value || null)}
              />
            </Field>
          </div>

          <div className="sm:col-span-2">
            <Field label={t("contact_mekurav.background", "רקע")}>
              <textarea
                className={inputClass}
                rows={2}
                value={values.mekurav.background ?? ""}
                onChange={(e) => setMekurav("background", e.target.value || null)}
              />
            </Field>
          </div>
        </>
      )}

      {isShliach && (
        <>
          <div className="sm:col-span-2">
            <Field label="דירות באחריות השליח">
              <ApartmentMultiSelect
                value={values.shliach.apartment_ids}
                onChange={(ids) => setShliach("apartment_ids", ids)}
              />
            </Field>
          </div>

          <div className="sm:col-span-2">
            <Field label={t("contact_shliach.notes", "הערות")}>
              <textarea
                className={inputClass}
                rows={2}
                value={values.shliach.notes ?? ""}
                onChange={(e) => setShliach("notes", e.target.value || null)}
              />
            </Field>
          </div>
        </>
      )}

      {extra && <div className="sm:col-span-2">{extra}</div>}

      {error && (
        <p className="sm:col-span-2 text-sm text-status-darkred bg-red-50 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={busy}
          className="w-full sm:w-auto rounded-md bg-status-magenta text-white px-5 py-2 font-medium hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "שומר…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
