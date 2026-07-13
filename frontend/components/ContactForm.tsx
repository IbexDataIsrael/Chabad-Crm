"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useFieldSettings } from "@/lib/fieldSettings";
import { useLocalization } from "@/lib/localization";
import { isValidPhone } from "@/lib/validation";
import {
  formatCoords,
  roundCoord,
  MEKURAV_PICKLISTS,
  type AdminArea,
  type Contact,
  type ContactType,
  type UserSummary,
} from "@/lib/types";
import { AddressAutocomplete } from "./AddressAutocomplete";
import { ApartmentPicker } from "./ApartmentPicker";
import { AreaMultiSelect } from "./AreaMultiSelect";
import { DatePicker } from "./DatePicker";
import { EmailInput } from "./EmailInput";
import { PhoneInput } from "./PhoneInput";
import { PicklistSelect } from "./PicklistSelect";
import { ReportNumberMultiSelect } from "./ReportNumberMultiSelect";

export interface MekuravFormValues {
  apartment_id: number | null;
  admin_area_id: number | null; // אזור מנהל (fixes9)
  tzedaka_potential: string | null; // פוטנציאל לצדקה (fixes9)
  first_visit: string | null;
  potential_next_step: string | null;
  rebbe_connection: string | null;
  recommendations: string | null;
  background: string | null;
}

export interface ShliachFormValues {
  notes: string | null;
  /** fixes19: report numbers replace the apartment coverage links. */
  report_number_ids: number[];
  area_ids: number[];
  /** fixes14: optional login password — empty keeps the existing one. */
  password: string | null;
}

export interface ContactFormValues {
  name: string;
  last_name: string | null;
  phone: string;
  email: string | null;
  contact_type: ContactType;
  assigned_user_id: string | null; // owning user's GUID (fixes10)
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  pipeline_status: string | null;
  color_tag: string | null;
  priority_score: number | null;
  mekurav: MekuravFormValues;
  shliach: ShliachFormValues;
  /** Dynamic picklist selections by system_name. */
  picklist_values: Record<string, string | null>;
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
  const { isFieldVisible: vis } = useFieldSettings();
  // The logged-in user's role (distinct from isShliach = the contact's type).
  const { isShliach: isShliachUser } = useAuth();
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
    pipeline_status: initial?.pipeline_status ?? null,
    color_tag: initial?.color_tag ?? null,
    priority_score: initial?.priority_score ?? null,
    mekurav: {
      apartment_id: initial?.mekurav?.apartment_id ?? null,
      admin_area_id: initial?.mekurav?.admin_area_id ?? null,
      tzedaka_potential: initial?.mekurav?.tzedaka_potential ?? null,
      first_visit: initial?.mekurav?.first_visit ?? null,
      potential_next_step: initial?.mekurav?.potential_next_step ?? null,
      rebbe_connection: initial?.mekurav?.rebbe_connection ?? null,
      recommendations: initial?.mekurav?.recommendations ?? null,
      background: initial?.mekurav?.background ?? null,
    },
    shliach: {
      notes: initial?.shliach?.notes ?? null,
      report_number_ids: initial?.shliach?.report_number_ids ?? [],
      area_ids: initial?.shliach?.area_ids ?? [],
      password: null,
    },
    picklist_values: { ...(initial?.picklist_values ?? {}) },
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Phone is optional: empty is valid, a provided value must pass validation.
  const [phoneValid, setPhoneValid] = useState(() => {
    const p = (initial?.phone ?? "").trim();
    return p === "" || isValidPhone(p);
  });

  const isMekurav = values.contact_type === "mekurav";
  const isShliach = values.contact_type === "shliach";

  // Admin areas for the mekurav link dropdown (fixes9 §2C). The section is
  // blocked for shliach users (fixes10 §3.6) — don't fetch or render it.
  const [adminAreas, setAdminAreas] = useState<AdminArea[]>([]);
  useEffect(() => {
    if (!isMekurav || isShliachUser) return;
    apiFetch<AdminArea[]>("/api/admin-areas").then(setAdminAreas).catch(() => {});
  }, [isMekurav, isShliachUser]);

  function set<K extends keyof ContactFormValues>(key: K, v: ContactFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  function setMekurav<K extends keyof MekuravFormValues>(key: K, v: MekuravFormValues[K]) {
    setValues((prev) => ({ ...prev, mekurav: { ...prev.mekurav, [key]: v } }));
  }

  function setShliach<K extends keyof ShliachFormValues>(key: K, v: ShliachFormValues[K]) {
    setValues((prev) => ({ ...prev, shliach: { ...prev.shliach, [key]: v } }));
  }

  function setPicklistValue(systemName: string, v: string | null) {
    setValues((prev) => ({
      ...prev,
      picklist_values: { ...prev.picklist_values, [systemName]: v },
    }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!phoneValid) {
      setError(t("validation.phone_invalid", "מספר טלפון לא תקין"));
      return;
    }
    setBusy(true);
    try {
      await onSubmit(values);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
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

      {vis("contacts.last_name") && (
        <Field label={t("contacts.last_name", "שם משפחה")}>
          <input
            className={inputClass}
            value={values.last_name ?? ""}
            onChange={(e) => set("last_name", e.target.value || null)}
          />
        </Field>
      )}

      <Field label={t("contacts.phone", "טלפון")}>
        <PhoneInput
          value={values.phone}
          onChange={(v) => set("phone", v)}
          onValidityChange={setPhoneValid}
          required
        />
      </Field>

      {/* Email is required for a shliach (login), so it's always shown for them. */}
      {(vis("contacts.email") || isShliach) && (
        <Field
          label={
            t("contacts.email", "אימייל") +
            (isShliach ? ` (${t("contacts.email_for_login", "להתחברות")})` : "")
          }
        >
          <EmailInput
            value={values.email ?? ""}
            onChange={(v) => set("email", v || null)}
            required={isShliach}
          />
        </Field>
      )}

      {/* Ownership is forced server-side for shliach users — no picker. */}
      {vis("contacts.assigned_user_id") && !isShliachUser && (
        <Field label={t("contacts.assigned_user_id", "משויך ל")}>
          <select
            className={inputClass}
            value={values.assigned_user_id ?? ""}
            onChange={(e) =>
              set("assigned_user_id", e.target.value === "" ? null : e.target.value)
            }
          >
            <option value="">—</option>
            {users.map((u) => (
              <option key={u.guid} value={u.guid}>
                {u.full_name}
              </option>
            ))}
          </select>
        </Field>
      )}

      {vis("contacts.pipeline_status") && (
        <Field label={t("contacts.pipeline_status", "סטטוס")}>
          <PicklistSelect
            fieldKey="contact.pipeline_status"
            value={values.pipeline_status}
            onChange={(v) => set("pipeline_status", v)}
          />
        </Field>
      )}

      {vis("contacts.color_tag") && (
        <Field label={t("contacts.color_tag", "צבע")}>
          <PicklistSelect
            fieldKey="contact.color_tag"
            value={values.color_tag}
            onChange={(v) => set("color_tag", v)}
          />
        </Field>
      )}

      {vis("contacts.priority_score") && (
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
      )}

      {vis("contacts.address") && (
        <>
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
                    latitude: roundCoord(p.lat),
                    longitude: roundCoord(p.lng),
                  }));
                }}
              />
            </Field>
          </div>

          {/* fixes20 §2: coordinates get their own visibility toggle
              (default-hidden) rather than riding on the address field. */}
          {vis("contacts.coordinates") && (
            <div className="sm:col-span-2">
              <Field label={t("contacts.coordinates", "קואורדינטות")}>
                {/* Read-only, minimal x,y — coords come from the address picker / geocoding. */}
                <span
                  dir="ltr"
                  className="block rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600"
                >
                  {formatCoords(values.latitude, values.longitude) || "—"}
                </span>
              </Field>
            </div>
          )}
        </>
      )}

      {/* fixes20 §2: admin_area is a top-level administrative grouping, shown
          independently of the mekurav section toggle (its own field toggle,
          default-visible) so it stays visible even when the section is hidden. */}
      {isMekurav && vis("contact_mekurav.admin_area_id") && !isShliachUser && (
        <Field label={t("contact_mekurav.admin_area_id", "אזור מנהל")}>
          <select
            className={inputClass}
            value={values.mekurav.admin_area_id ?? ""}
            onChange={(e) =>
              setMekurav(
                "admin_area_id",
                e.target.value === "" ? null : Number(e.target.value),
              )
            }
          >
            <option value="">—</option>
            {adminAreas.map((aa) => (
              <option key={aa.id} value={aa.id}>
                {aa.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      {/* fixes19 §5: the rest of the mekurav layout area rides on one
          section-level visibility switch (hidden by default; admins opt in from
          the fields configuration page). */}
      {isMekurav && vis("contact_mekurav.section") && (
        <>
          {vis("contact_mekurav.apartment_id") && (
            <div className="sm:col-span-2">
              <Field label={t("contact_mekurav.apartment_id", "דירה")}>
                <ApartmentPicker
                  value={values.mekurav.apartment_id}
                  onChange={(id) => setMekurav("apartment_id", id)}
                />
              </Field>
            </div>
          )}

          {vis("contact_mekurav.first_visit") && (
            <Field label={t("contact_mekurav.first_visit", "ביקור ראשון")}>
              <DatePicker
                value={values.mekurav.first_visit}
                onChange={(v) => setMekurav("first_visit", v)}
                withTime
                className={inputClass}
              />
            </Field>
          )}

          {vis("contact_mekurav.potential_next_step") && (
            <Field label={t("contact_mekurav.potential_next_step", "פוטנציאל לצעד")}>
              <PicklistSelect
                fieldKey="contact.potential_next_step"
                value={values.mekurav.potential_next_step}
                onChange={(v) => setMekurav("potential_next_step", v)}
              />
            </Field>
          )}

          {vis("contact_mekurav.tzedaka_potential") && (
            <Field label={t("contact_mekurav.tzedaka_potential", "פוטנציאל לצדקה")}>
              <input
                className={inputClass}
                value={values.mekurav.tzedaka_potential ?? ""}
                onChange={(e) => setMekurav("tzedaka_potential", e.target.value || null)}
              />
            </Field>
          )}

          {vis("contact_mekurav.rebbe_connection") && (
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
          )}

          {vis("contact_mekurav.recommendations") && (
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
          )}

          {vis("contact_mekurav.background") && (
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
          )}

          {MEKURAV_PICKLISTS.filter((key) => vis(key)).map((key) => (
            <Field key={key} label={t(`picklist.${key}`)}>
              <PicklistSelect
                fieldKey={key}
                value={values.picklist_values[key] ?? null}
                onChange={(v) => setPicklistValue(key, v)}
              />
            </Field>
          ))}
        </>
      )}

      {isShliach && (
        <>
          {vis("contact_shliach.areas") && (
            <div className="sm:col-span-2">
              <Field label={t("contact_shliach.areas", "אזורים באחריות הפעיל")}>
                <AreaMultiSelect
                  value={values.shliach.area_ids}
                  onChange={(ids) => setShliach("area_ids", ids)}
                />
              </Field>
            </div>
          )}

          {/* fixes19: shluchim are associated with report numbers (the
              apartment coverage picker is gone). */}
          {vis("contact_shliach.report_numbers") && (
            <div className="sm:col-span-2">
              <Field
                label={t(
                  "contact_shliach.report_numbers",
                  "מספרי דוח באחריות הפעיל",
                )}
              >
                <ReportNumberMultiSelect
                  value={values.shliach.report_number_ids}
                  onChange={(ids) => setShliach("report_number_ids", ids)}
                />
              </Field>
            </div>
          )}

          {/* fixes14: without a password the login is Google-only, which can
              lock the shliach out entirely. Empty keeps the current password. */}
          <Field label={t("contact_shliach.password", "סיסמה למערכת (לא חובה)")}>
            <input
              type="password"
              className={inputClass}
              value={values.shliach.password ?? ""}
              onChange={(e) => setShliach("password", e.target.value || null)}
              autoComplete="new-password"
            />
            <span className="mt-1 block text-xs text-gray-400">
              {t(
                "contact_shliach.password_hint",
                "עם סיסמה הפעיל מתחבר עם האימייל והסיסמה; ללא סיסמה — עם Google בלבד. שדה ריק לא משנה סיסמה קיימת.",
              )}
            </span>
          </Field>

          {vis("contact_shliach.notes") && (
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
          )}
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
          {busy ? t("action.saving", "שומר…") : submitLabel}
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
