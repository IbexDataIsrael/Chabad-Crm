"use client";

import { useEffect, useState, type ReactNode } from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dotStyle } from "@/lib/colors";
import { useCustomFieldDefs } from "@/lib/customFields";
import { useFieldSettings } from "@/lib/fieldSettings";
import { useLocalization } from "@/lib/localization";
import { FIXED_CONTACT_PICKLIST_KEYS, usePicklist, usePicklistsMap } from "@/lib/picklists";
import {
  apartmentTitle,
  formatCoords,
  roundCoord,
  MEKURAV_PICKLISTS,
  type AdminArea,
  type Apartment,
  type Area,
  type Contact,
  type PicklistField,
  type ReportNumber,
  type UserSummary,
} from "@/lib/types";
import { isValidEmail, isValidPhone, EMAIL_HINT, PHONE_HINT } from "@/lib/validation";
import { AddressAutocomplete } from "./AddressAutocomplete";
import { ApartmentPicker } from "./ApartmentPicker";
import { AreaMultiSelect } from "./AreaMultiSelect";
import { ContactMap } from "./ContactMap";
import { CustomFieldValueDisplay, CustomFieldValueInput } from "./CustomFieldValueInput";
import { DatePicker } from "./DatePicker";
import { PicklistSelect } from "./PicklistSelect";
import { ReportNumberMultiSelect } from "./ReportNumberMultiSelect";
import { InlineEdit } from "./ui/InlineEdit";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

/** A one-field partial for PATCH /api/contacts/{id} (fixes26 §2). */
export type ContactPatch = Record<string, unknown>;

/** Display of every contact field. fixes26 §2: when `onPatch` is provided the
 *  fields edit in place, Google-style — click a value, change it, click away
 *  (or Enter) to save; pickers save on selection. Without `onPatch` it is the
 *  old read-only card. fixes25: the Mivtzoim checklist and custom fields live
 *  on the visit log. */
export function ContactView({
  contact,
  users,
  onPatch,
}: {
  contact: Contact;
  users: UserSummary[];
  onPatch?: (partial: ContactPatch) => Promise<void>;
}) {
  const { t, lang } = useLocalization();
  const { isFieldVisible: vis } = useFieldSettings();
  // The logged-in user's role (distinct from the contact's type).
  const { isShliach: isShliachUser } = useAuth();
  const status = usePicklist("contact.pipeline_status");
  const potential = usePicklist("contact.potential_next_step");
  const color = usePicklist("contact.color_tag");
  const contactType = usePicklist("contact.contact_type");
  const jewishStatus = usePicklist("Jewish_status");
  const affiliation = usePicklist("affiliation");
  const language = usePicklist("language");

  const assignee = users.find((u) => u.guid === contact.assigned_user_id);
  const mk = contact.mekurav ?? null;
  const isMekurav = contact.contact_type === "mekurav";
  const hasCoords = contact.latitude != null && contact.longitude != null;
  const canEdit = onPatch != null;

  // Admin areas for the inline editor (blocked for shliach users, fixes10 §3.6).
  const [adminAreas, setAdminAreas] = useState<AdminArea[]>([]);
  useEffect(() => {
    if (!canEdit || !isMekurav || isShliachUser) return;
    apiFetch<AdminArea[]>("/api/admin-areas").then(setAdminAreas).catch(() => {});
  }, [canEdit, isMekurav, isShliachUser]);

  // fixes34 §1.1: any admin-added contact picklist beyond the fixed set.
  const [customDefs, setCustomDefs] = useState<PicklistField[]>([]);
  useEffect(() => {
    apiFetch<PicklistField[]>("/api/picklists")
      .then((defs) =>
        setCustomDefs(
          defs.filter(
            (d) =>
              !FIXED_CONTACT_PICKLIST_KEYS.includes(d.field_key) &&
              !d.field_key.startsWith("apartment.") &&
              !d.field_key.startsWith("visit.") &&
              !d.field_key.startsWith("checklist.") &&
              !d.field_key.startsWith("interaction.") &&
              !d.field_key.startsWith("shliach.") &&
              !d.field_key.startsWith("significant_date."),
          ),
        ),
      )
      .catch(() => setCustomDefs([]));
  }, []);
  const customPicklists = usePicklistsMap(customDefs.map((d) => d.field_key));

  // fixes35: any non-select custom field for whichever contact_type applies.
  const mekuravCustomFieldDefs = useCustomFieldDefs("contact_mekurav").filter(
    (d) => d.field_type !== "select",
  );
  const shliachCustomFieldDefs = useCustomFieldDefs("contact_shliach").filter(
    (d) => d.field_type !== "select",
  );
  // fixes35 §5: contact_shliach's own select-type custom picklists.
  const [shliachPicklistDefs, setShliachPicklistDefs] = useState<PicklistField[]>([]);
  useEffect(() => {
    apiFetch<PicklistField[]>("/api/picklists")
      .then((defs) =>
        setShliachPicklistDefs(defs.filter((d) => d.field_key.startsWith("shliach."))),
      )
      .catch(() => setShliachPicklistDefs([]));
  }, []);
  const shliachPicklists = usePicklistsMap(shliachPicklistDefs.map((d) => d.field_key));

  /** Inline text/textarea editor for a top-level or nested string column. */
  function inlineText(
    field: string,
    value: string | null,
    opts: {
      dir?: "ltr";
      multiline?: boolean;
      nested?: "mekurav" | "shliach";
      validate?: (v: string) => string | null;
    } = {},
  ): ReactNode {
    const displayNode = value ? (
      <span dir={opts.dir} className="whitespace-pre-wrap">
        {value}
      </span>
    ) : (
      "—"
    );
    if (!onPatch) return displayNode;
    return (
      <InlineEdit<string>
        value={value ?? ""}
        display={displayNode}
        validate={opts.validate}
        enterCommits={!opts.multiline}
        onSave={(v) => {
          const next = v.trim() === "" ? null : v.trim();
          return onPatch(
            opts.nested ? { [opts.nested]: { [field]: next } } : { [field]: next },
          );
        }}
        editor={(draft, setDraft) =>
          opts.multiline ? (
            <textarea
              className={inputClass}
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          ) : (
            <input
              className={inputClass}
              dir={opts.dir}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          )
        }
      />
    );
  }

  /** Inline picklist editor — selecting a value saves it immediately. */
  function inlinePicklist(
    fieldKey: string,
    value: string | null,
    displayNode: ReactNode,
    save: (v: string | null) => ContactPatch,
  ): ReactNode {
    if (!onPatch) return displayNode;
    return (
      <InlineEdit<string | null>
        value={value}
        display={displayNode}
        commitOnBlur={false}
        onSave={(v) => onPatch(save(v))}
        editor={(draft, _setDraft, commit) => (
          <PicklistSelect fieldKey={fieldKey} value={draft} onChange={commit} />
        )}
      />
    );
  }

  /** fixes35: inline editor for one non-select custom field value. */
  function inlineCustomField(
    fieldKey: string,
    fieldType: "text" | "number" | "boolean" | "date",
    value: string | number | boolean | null,
  ): ReactNode {
    const displayNode = <CustomFieldValueDisplay fieldType={fieldType} value={value} />;
    if (!onPatch) return displayNode;
    return (
      <InlineEdit<string | number | boolean | null>
        value={value}
        display={displayNode}
        commitOnBlur={fieldType === "text" || fieldType === "number"}
        onSave={(v) => onPatch({ custom_field_values: { [fieldKey]: v } })}
        editor={(draft, setDraft, commit) => (
          <CustomFieldValueInput
            fieldType={fieldType}
            value={draft}
            onChange={fieldType === "boolean" || fieldType === "date" ? commit : setDraft}
          />
        )}
      />
    );
  }

  const nameNode = inlineText("name", contact.name, {
    validate: (v) =>
      v.trim() === "" ? t("validation.name_required", "יש להזין שם פרטי") : null,
  });
  const lastNameNode = inlineText("last_name", contact.last_name);
  const phoneNode = inlineText("phone", contact.phone, {
    dir: "ltr",
    // fixes29 §2: same message the add form's PhoneInput shows under its field.
    validate: (v) =>
      v.trim() === "" || isValidPhone(v.trim())
        ? null
        : t("validation.phone_hint", PHONE_HINT),
  });
  const emailNode = inlineText("email", contact.email, {
    dir: "ltr",
    validate: (v) =>
      v.trim() === "" || isValidEmail(v.trim())
        ? null
        : t("validation.email_hint", EMAIL_HINT),
  });
  const createdNode = (
    <span dir="ltr">{new Date(contact.created_at).toLocaleDateString("he-IL")}</span>
  );

  const assignedNode =
    // Ownership is forced server-side for shliach users — display only.
    onPatch && !isShliachUser ? (
      <InlineEdit<string | null>
        value={contact.assigned_user_id}
        display={assignee?.full_name ?? "—"}
        commitOnBlur={false}
        onSave={(v) => onPatch({ assigned_user_id: v })}
        editor={(draft, _setDraft, commit) => (
          <select
            className={inputClass}
            value={draft ?? ""}
            onChange={(e) => commit(e.target.value === "" ? null : e.target.value)}
          >
            <option value="">—</option>
            {users.map((u) => (
              <option key={u.guid} value={u.guid}>
                {u.full_name}
              </option>
            ))}
          </select>
        )}
      />
    ) : (
      assignee?.full_name ?? "—"
    );

  const addressNode = onPatch ? (
    <InlineEdit<{ address: string | null; latitude: number | null; longitude: number | null }>
      value={{
        address: contact.address,
        latitude: contact.latitude,
        longitude: contact.longitude,
      }}
      display={contact.address || "—"}
      onSave={(v) => onPatch({ ...v })}
      editor={(draft, setDraft, commit) => (
        <AddressAutocomplete
          className={inputClass}
          value={draft.address ?? ""}
          onChange={(address) =>
            // Manual typing clears coords so the server geocodes on save.
            setDraft({ address: address || null, latitude: null, longitude: null })
          }
          onPlace={(p) =>
            commit({
              address: p.address || null,
              latitude: roundCoord(p.lat),
              longitude: roundCoord(p.lng),
            })
          }
        />
      )}
    />
  ) : (
    contact.address || "—"
  );

  // fixes15 §4.2: a shliach profile shows only shliach-relevant fields.
  // fixes34 §3.1: phone/email gained an org-wide toggle, but a shliach
  // contact's own profile keeps both force-visible regardless (email doubles
  // as their login identity) — key stays null (always shown) on purpose.
  const shliachFields: [string | null, string, ReactNode][] = [
    [null, t("contacts.name", "שם פרטי"), nameNode],
    ["contacts.last_name", t("contacts.last_name", "שם משפחה"), lastNameNode],
    [null, t("contacts.phone", "טלפון"), phoneNode],
    [null, t("contacts.email", "אימייל"), emailNode],
    [null, t("contacts.contact_type", "סוג איש קשר"), contactType.labelFor(contact.contact_type) || "—"],
    [null, t("contacts.created_at", "נוצר בתאריך"), createdNode],
    // fixes35 §5: any admin-added shliach.* custom picklist.
    ...shliachPicklistDefs.map(
      (d): [string | null, string, ReactNode] => [
        d.field_key,
        (lang === "en" ? d.english_label || d.label : d.label) || d.field_key,
        inlinePicklist(
          d.field_key,
          contact.picklist_values?.[d.field_key] ?? null,
          shliachPicklists.labelFor(d.field_key, contact.picklist_values?.[d.field_key]) || "—",
          (v) => ({ picklist_values: { [d.field_key]: v } }),
        ),
      ],
    ),
    // fixes35: any non-select custom field for shliach contacts.
    ...shliachCustomFieldDefs.map(
      (d): [string | null, string, ReactNode] => [
        `customfield.contact_shliach.${d.field_key}`,
        (lang === "en" ? d.english_label || d.hebrew_label : d.hebrew_label) || d.field_key,
        inlineCustomField(
          d.field_key,
          d.field_type as "text" | "number" | "boolean" | "date",
          contact.custom_field_values?.[d.field_key] ?? null,
        ),
      ],
    ),
  ];

  // Each entry: [fieldKey | null, label, value]. null = always shown (required).
  const fields: [string | null, string, ReactNode][] = [
    [null, t("contacts.name", "שם פרטי"), nameNode],
    ["contacts.last_name", t("contacts.last_name", "שם משפחה"), lastNameNode],
    // fixes34 §3.1: phone/email are now toggleable (fixes28 §1 made them
    // permanently visible; this round reverses that per an explicit ask).
    ["contacts.phone", t("contacts.phone", "טלפון"), phoneNode],
    ["contacts.email", t("contacts.email", "אימייל"), emailNode],
    [null, t("contacts.contact_type", "סוג איש קשר"), contactType.labelFor(contact.contact_type) || "—"],
    ["contacts.assigned_user_id", t("contacts.assigned_user_id", "משויך ל"), assignedNode],
    [
      "contacts.pipeline_status",
      t("contacts.pipeline_status", "סטטוס"),
      inlinePicklist(
        "contact.pipeline_status",
        contact.pipeline_status,
        status.labelFor(contact.pipeline_status) || "—",
        (v) => ({ pipeline_status: v }),
      ),
    ],
    [
      "contacts.color_tag",
      t("contacts.color_tag", "צבע"),
      inlinePicklist(
        "contact.color_tag",
        contact.color_tag,
        contact.color_tag ? (
          <span className="inline-flex items-center gap-2">
            <span
              className="inline-block h-3.5 w-3.5 rounded-full"
              style={dotStyle(contact.color_tag)}
            />
            {color.labelFor(contact.color_tag)}
          </span>
        ) : (
          "—"
        ),
        (v) => ({ color_tag: v }),
      ),
    ],
    [
      "contacts.priority_score",
      t("contacts.priority_score", "ציון עדיפות"),
      onPatch ? (
        <InlineEdit<string>
          value={contact.priority_score == null ? "" : String(contact.priority_score)}
          display={contact.priority_score ?? "—"}
          onSave={(v) =>
            onPatch({ priority_score: v.trim() === "" ? null : Number(v) })
          }
          editor={(draft, setDraft) => (
            <input
              type="number"
              className={inputClass}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          )}
        />
      ) : (
        contact.priority_score ?? "—"
      ),
    ],
    ["contacts.address", t("contacts.address", "כתובת"), addressNode],
    [null, t("contacts.created_at", "נוצר בתאריך"), createdNode],
  ];

  // fixes20 §2: coordinates ride their own (default-hidden) toggle; they come
  // from the address picker / server geocoding, so they stay read-only.
  const coordsRow: [string | null, string, ReactNode][] =
    vis("contacts.address") && vis("contacts.coordinates")
      ? [
          [
            "contacts.coordinates",
            t("contacts.coordinates", "קואורדינטות"),
            <span dir="ltr" key="co">{formatCoords(contact.latitude, contact.longitude) || "—"}</span>,
          ],
        ]
      : [];

  // fixes19 §5: the whole mekurav layout area rides on one section-level
  // visibility switch (hidden by default).
  const mekuravFields: [string | null, string, ReactNode][] =
    mk && vis("contact_mekurav.section")
      ? [
          [
            "contact_mekurav.apartment_id",
            t("contact_mekurav.apartment_id", "דירה"),
            onPatch ? (
              <InlineEdit<number | null>
                value={mk.apartment_id}
                display={<ApartmentLabel id={mk.apartment_id} />}
                onSave={(v) => onPatch({ mekurav: { apartment_id: v } })}
                editor={(draft, setDraft) => (
                  <ApartmentPicker value={draft} onChange={setDraft} />
                )}
              />
            ) : (
              <ApartmentLabel id={mk.apartment_id} />
            ),
          ],
          [
            "contact_mekurav.first_visit",
            t("contact_mekurav.first_visit", "ביקור ראשון"),
            onPatch ? (
              <InlineEdit<string | null>
                value={mk.first_visit}
                display={
                  mk.first_visit ? new Date(mk.first_visit).toLocaleString("he-IL") : "—"
                }
                onSave={(v) => onPatch({ mekurav: { first_visit: v } })}
                editor={(draft, setDraft) => (
                  <DatePicker value={draft} onChange={setDraft} withTime className={inputClass} />
                )}
              />
            ) : mk.first_visit ? (
              new Date(mk.first_visit).toLocaleString("he-IL")
            ) : (
              "—"
            ),
          ],
          [
            "contact_mekurav.potential_next_step",
            t("contact_mekurav.potential_next_step", "פוטנציאל לצעד"),
            inlinePicklist(
              "contact.potential_next_step",
              mk.potential_next_step,
              potential.labelFor(mk.potential_next_step) || "—",
              (v) => ({ mekurav: { potential_next_step: v } }),
            ),
          ],
          [
            "contact_mekurav.tzedaka_potential",
            t("contact_mekurav.tzedaka_potential", "פוטנציאל לצדקה"),
            inlineText("tzedaka_potential", mk.tzedaka_potential, { nested: "mekurav" }),
          ],
          [
            "contact_mekurav.recommendations",
            t("contact_mekurav.recommendations", "המלצות"),
            inlineText("recommendations", mk.recommendations, {
              nested: "mekurav",
              multiline: true,
            }),
          ],
          [
            "contact_mekurav.background",
            t("contact_mekurav.background", "רקע"),
            inlineText("background", mk.background, {
              nested: "mekurav",
              multiline: true,
            }),
          ],
          ...MEKURAV_PICKLISTS.map(
            (key): [string | null, string, ReactNode] => [
              key,
              t(`picklist.${key}`),
              inlinePicklist(
                key,
                contact.picklist_values?.[key] ?? null,
                ({ Jewish_status: jewishStatus, affiliation, language }[key] ?? jewishStatus)
                  .labelFor(contact.picklist_values?.[key]) || "—",
                (v) => ({ picklist_values: { [key]: v } }),
              ),
            ],
          ),
          // fixes34 §1.1: any admin-added custom contact picklist (the later
          // `allFields.filter` below applies `vis(d.field_key)`, same as
          // every other entry keyed by a real field_key).
          ...customDefs.map(
            (d): [string | null, string, ReactNode] => [
              d.field_key,
              (lang === "en" ? d.english_label || d.label : d.label) || d.field_key,
              inlinePicklist(
                d.field_key,
                contact.picklist_values?.[d.field_key] ?? null,
                customPicklists.labelFor(d.field_key, contact.picklist_values?.[d.field_key]) ||
                  "—",
                (v) => ({ picklist_values: { [d.field_key]: v } }),
              ),
            ],
          ),
          // fixes35: any non-select custom field for mekurav contacts.
          ...mekuravCustomFieldDefs.map(
            (d): [string | null, string, ReactNode] => [
              `customfield.contact_mekurav.${d.field_key}`,
              (lang === "en" ? d.english_label || d.hebrew_label : d.hebrew_label) ||
                d.field_key,
              inlineCustomField(
                d.field_key,
                d.field_type as "text" | "number" | "boolean" | "date",
                contact.custom_field_values?.[d.field_key] ?? null,
              ),
            ],
          ),
        ]
      : [];

  // fixes20 §2: admin_area is a top-level administrative grouping shown
  // independently of the mekurav section toggle (its own field toggle,
  // default-visible), so it stays visible even when the section is hidden.
  const mekuravAdminArea: [string | null, string, ReactNode][] = mk
    ? [
        [
          "contact_mekurav.admin_area_id",
          t("contact_mekurav.admin_area_id", "אזור מנהל"),
          onPatch && !isShliachUser ? (
            <InlineEdit<number | null>
              value={mk.admin_area_id}
              display={<AdminAreaLabel id={mk.admin_area_id} />}
              commitOnBlur={false}
              onSave={(v) => onPatch({ mekurav: { admin_area_id: v } })}
              editor={(draft, _setDraft, commit) => (
                <select
                  className={inputClass}
                  value={draft ?? ""}
                  onChange={(e) =>
                    commit(e.target.value === "" ? null : Number(e.target.value))
                  }
                >
                  <option value="">—</option>
                  {adminAreas.map((aa) => (
                    <option key={aa.id} value={aa.id}>
                      {aa.name}
                    </option>
                  ))}
                </select>
              )}
            />
          ) : (
            <AdminAreaLabel id={mk.admin_area_id} />
          ),
        ],
      ]
    : [];

  const allFields = (
    contact.contact_type === "shliach"
      ? shliachFields
      : [...fields, ...coordsRow, ...mekuravAdminArea, ...mekuravFields]
  ).filter(([key]) => key === null || vis(key));

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
        {allFields.map(([, label, value]) => (
          <div key={label} className="flex flex-col">
            <dt className="text-xs text-gray-500">{label}</dt>
            <dd className="text-sm">{value}</dd>
          </div>
        ))}
        {contact.shliach && (
          <>
            {vis("contact_shliach.areas") && (
              <div className="flex flex-col">
                <dt className="text-xs text-gray-500">{t("contact_shliach.areas", "אזורים באחריות הפעיל")}</dt>
                <dd className="text-sm">
                  {onPatch ? (
                    <InlineEdit<number[]>
                      value={contact.shliach.area_ids}
                      display={<AreaNames ids={contact.shliach.area_ids} />}
                      onSave={(ids) => onPatch({ shliach: { area_ids: ids } })}
                      editor={(draft, setDraft) => (
                        <AreaMultiSelect value={draft} onChange={setDraft} />
                      )}
                    />
                  ) : (
                    <AreaNames ids={contact.shliach.area_ids} />
                  )}
                </dd>
              </div>
            )}
            {/* fixes19: shluchim associate with report numbers (the covered
                apartments grid is gone). */}
            {vis("contact_shliach.report_numbers") && (
              <div className="flex flex-col">
                <dt className="text-xs text-gray-500">
                  {t("contact_shliach.report_numbers", "מספרי דוח באחריות הפעיל")}
                </dt>
                <dd className="text-sm">
                  {onPatch ? (
                    <InlineEdit<number[]>
                      value={contact.shliach.report_number_ids}
                      display={<ReportNumbersLabel ids={contact.shliach.report_number_ids} />}
                      onSave={(ids) => onPatch({ shliach: { report_number_ids: ids } })}
                      editor={(draft, setDraft) => (
                        <ReportNumberMultiSelect value={draft} onChange={setDraft} />
                      )}
                    />
                  ) : (
                    <ReportNumbersLabel ids={contact.shliach.report_number_ids} />
                  )}
                </dd>
              </div>
            )}
            {vis("contact_shliach.notes") && (
              <div className="flex flex-col">
                <dt className="text-xs text-gray-500">{t("contact_shliach.notes", "הערות")}</dt>
                <dd className="text-sm">
                  {inlineText("notes", contact.shliach.notes, {
                    nested: "shliach",
                    multiline: true,
                  })}
                </dd>
              </div>
            )}
            {/* fixes14: without a password the login is Google-only, which can
                lock the shliach out. Empty input keeps the current password. */}
            {onPatch && (
              <div className="flex flex-col">
                <dt className="text-xs text-gray-500">
                  {t("contact_shliach.password", "סיסמה למערכת (לא חובה)")}
                </dt>
                <dd className="text-sm">
                  <InlineEdit<string>
                    value=""
                    display={
                      <span className="text-status-magenta">
                        {t("contact_shliach.password_set", "קבע סיסמה חדשה")}
                      </span>
                    }
                    onSave={(v) =>
                      v.trim() === ""
                        ? Promise.resolve()
                        : onPatch({ shliach: { password: v } })
                    }
                    editor={(draft, setDraft) => (
                      <input
                        type="password"
                        className={inputClass}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        autoComplete="new-password"
                      />
                    )}
                  />
                </dd>
              </div>
            )}
          </>
        )}
      </dl>

      {/* Map goes with the (mekurav) address — shliach profiles skip it. */}
      {isMekurav && hasCoords && (
        <ContactMap lat={contact.latitude as number} lng={contact.longitude as number} />
      )}

      {/* fixes25: the Mivtzoim checklist + custom fields moved to the visit
          log (each visit records what happened on it). */}

      <p className="text-xs text-gray-300" dir="ltr">
        GUID: {contact.guid}
      </p>
    </div>
  );
}

/** Resolves an apartment id to its name (with its building) for display. */
function ApartmentLabel({ id }: { id: number | null }) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (id == null) {
      setLabel(null);
      return;
    }
    let active = true;
    apiFetch<Apartment>(`/api/apartments/${id}`)
      .then((a) => active && setLabel(apartmentTitle(a)))
      .catch(() => active && setLabel(null));
    return () => {
      active = false;
    };
  }, [id]);

  if (id == null) return <>—</>;
  return <>{label ?? "…"}</>;
}

/** Resolves an admin-area id to its name for display (fixes9). */
function AdminAreaLabel({ id }: { id: number | null }) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (id == null) {
      setLabel(null);
      return;
    }
    let active = true;
    apiFetch<AdminArea>(`/api/admin-areas/${id}`)
      .then((aa) => active && setLabel(aa.name))
      // 403 for shliach users (fixes10 §3.6) / deleted area → show a dash.
      .catch(() => active && setLabel("—"));
    return () => {
      active = false;
    };
  }, [id]);

  if (id == null) return <>—</>;
  return <>{label ?? "…"}</>;
}

/** Resolves the shliach's report-number ids to their names (fixes19). */
function ReportNumbersLabel({ ids }: { ids: number[] }) {
  const [names, setNames] = useState<string[] | null>(null);

  useEffect(() => {
    if (ids.length === 0) {
      setNames([]);
      return;
    }
    let active = true;
    apiFetch<ReportNumber[]>("/api/report-numbers")
      .then((all) => {
        if (!active) return;
        const byId = new Map(all.map((rn) => [rn.id, rn.name]));
        setNames(ids.map((id) => byId.get(id) ?? `#${id}`));
      })
      .catch(() => active && setNames([]));
    return () => {
      active = false;
    };
  }, [ids]);

  if (ids.length === 0) return <>—</>;
  return <>{names === null ? "…" : names.join(", ") || "—"}</>;
}

/** Resolves area ids to their names, comma-joined. */
function AreaNames({ ids }: { ids: number[] }) {
  if (ids.length === 0) return <>—</>;
  return (
    <>
      {ids.map((id, i) => (
        <span key={id}>
          {i > 0 && ", "}
          <AreaLabel id={id} />
        </span>
      ))}
    </>
  );
}

/** Resolves an area id to its name for display. */
function AreaLabel({ id }: { id: number }) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiFetch<Area>(`/api/areas/${id}`)
      .then((a) => active && setLabel(a.area_name))
      .catch(() => active && setLabel(null));
    return () => {
      active = false;
    };
  }, [id]);

  return <>{label ?? "…"}</>;
}
