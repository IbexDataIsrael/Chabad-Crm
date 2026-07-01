"use client";

import { useEffect, useState, type ReactNode } from "react";

import { apiFetch } from "@/lib/api";
import { dotStyle } from "@/lib/colors";
import { useFieldSettings } from "@/lib/fieldSettings";
import { useLocalization } from "@/lib/localization";
import { usePicklist } from "@/lib/picklists";
import {
  CHECKLIST_ROWS,
  type Apartment,
  type Area,
  type Contact,
  type ContactCustomField,
  type UserSummary,
} from "@/lib/types";
import { ContactMap } from "./ContactMap";

/** Read-only display of every contact field, checklist (with notes), and custom fields. */
export function ContactView({
  contact,
  users,
  customFields,
}: {
  contact: Contact;
  users: UserSummary[];
  customFields: ContactCustomField[];
}) {
  const { t } = useLocalization();
  const { isFieldVisible: vis } = useFieldSettings();
  const status = usePicklist("contact.pipeline_status");
  const potential = usePicklist("contact.potential_next_step");
  const color = usePicklist("contact.color_tag");
  const torah = usePicklist("checklist.torah_thought");
  const contactType = usePicklist("contact.contact_type");
  const jewishStatus = usePicklist("Jewish_status");
  const affiliation = usePicklist("affiliation");
  const language = usePicklist("language");

  const assignee = users.find((u) => u.id === contact.assigned_user_id);
  const cl = contact.checklist ?? null;
  const mk = contact.mekurav ?? null;
  const isMekurav = contact.contact_type === "mekurav";
  const hasCoords = contact.latitude != null && contact.longitude != null;

  // Each entry: [fieldKey | null, label, value]. null = always shown (required).
  const fields: [string | null, string, ReactNode][] = [
    [null, t("contacts.name", "שם פרטי"), contact.name],
    ["contacts.last_name", t("contacts.last_name", "שם משפחה"), contact.last_name || "—"],
    [null, t("contacts.phone", "טלפון"), <span dir="ltr" key="p">{contact.phone}</span>],
    ["contacts.email", t("contacts.email", "אימייל"), contact.email ? <span dir="ltr">{contact.email}</span> : "—"],
    [null, t("contacts.contact_type", "סוג איש קשר"), contactType.labelFor(contact.contact_type) || "—"],
    ["contacts.assigned_user_id", t("contacts.assigned_user_id", "משויך ל"), assignee?.full_name ?? "—"],
    ["contacts.pipeline_status", t("contacts.pipeline_status", "סטטוס"), status.labelFor(contact.pipeline_status) || "—"],
    [
      "contacts.color_tag",
      t("contacts.color_tag", "צבע"),
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
    ],
    ["contacts.priority_score", t("contacts.priority_score", "ציון עדיפות"), contact.priority_score ?? "—"],
    ["contacts.address", t("contacts.address", "כתובת"), contact.address || "—"],
  ];

  const mekuravFields: [string | null, string, ReactNode][] = mk
    ? [
        [
          "contact_mekurav.apartment_id",
          t("contact_mekurav.apartment_id", "דירה"),
          <ApartmentLabel key="ap" id={mk.apartment_id} />,
        ],
        [
          "contact_mekurav.first_visit",
          t("contact_mekurav.first_visit", "ביקור ראשון"),
          mk.first_visit ? new Date(mk.first_visit).toLocaleString("he-IL") : "—",
        ],
        [
          "contact_mekurav.potential_next_step",
          t("contact_mekurav.potential_next_step", "פוטנציאל לצעד"),
          potential.labelFor(mk.potential_next_step) || "—",
        ],
        ["contact_mekurav.rebbe_connection", t("contact_mekurav.rebbe_connection", "קשר לרבי"), mk.rebbe_connection || "—"],
        ["contact_mekurav.recommendations", t("contact_mekurav.recommendations", "המלצות"), mk.recommendations || "—"],
        ["contact_mekurav.background", t("contact_mekurav.background", "רקע"), mk.background || "—"],
        [
          "Jewish_status",
          t("picklist.Jewish_status"),
          jewishStatus.labelFor(contact.picklist_values?.["Jewish_status"]) || "—",
        ],
        [
          "affiliation",
          t("picklist.affiliation"),
          affiliation.labelFor(contact.picklist_values?.["affiliation"]) || "—",
        ],
        [
          "language",
          t("picklist.language"),
          language.labelFor(contact.picklist_values?.["language"]) || "—",
        ],
      ]
    : [];

  const allFields = [...fields, ...mekuravFields].filter(
    ([key]) => key === null || vis(key),
  );

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
                  {contact.shliach.area_ids.length === 0
                    ? "—"
                    : contact.shliach.area_ids.map((id, i) => (
                        <span key={id}>
                          {i > 0 && ", "}
                          <AreaLabel id={id} />
                        </span>
                      ))}
                </dd>
              </div>
            )}
            {vis("contact_shliach.apartments") && (
              <div className="flex flex-col">
                <dt className="text-xs text-gray-500">{t("contact_shliach.apartments", "דירות באחריות הפעיל")}</dt>
                <dd className="text-sm">
                  {contact.shliach.apartment_ids.length === 0 ? (
                    "—"
                  ) : (
                    contact.shliach.apartment_ids.map((id, i) => (
                      <span key={id}>
                        {i > 0 && ", "}
                        <ApartmentLabel id={id} />
                      </span>
                    ))
                  )}
                </dd>
              </div>
            )}
            {vis("contact_shliach.notes") && (
              <div className="flex flex-col">
                <dt className="text-xs text-gray-500">{t("contact_shliach.notes", "הערות")}</dt>
                <dd className="text-sm">{contact.shliach.notes || "—"}</dd>
              </div>
            )}
          </>
        )}
      </dl>

      {hasCoords && (
        <ContactMap lat={contact.latitude as number} lng={contact.longitude as number} />
      )}

      {/* Checklist + custom fields are mekurav-only — never shown for a shliach. */}
      {isMekurav && (
        <div>
          <h3 className="text-sm font-semibold mb-2">
            {t("community_checklists", "מצוות קהילה")}
          </h3>
          <ul className="space-y-1">
            {CHECKLIST_ROWS.map(({ bool, note }) => (
              <Row
                key={bool}
                label={t(`community_checklists.${bool}`)}
                on={Boolean(cl?.[bool])}
                note={(cl?.[note] as string | null) ?? null}
              />
            ))}
            <li className="text-sm">
              <span className="text-gray-500">
                {t("community_checklists.torah_thought", "דבר תורה")}:{" "}
              </span>
              {torah.labelFor(cl?.torah_thought) || "—"}
            </li>
          </ul>
        </div>
      )}

      {isMekurav && customFields.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2">{t("page.extra_fields", "שדות נוספים")}</h3>
          <ul className="space-y-1">
            {customFields.map((f) => (
              <Row
                key={f.definition_id}
                label={f.hebrew_label}
                on={f.checked}
                note={f.note}
              />
            ))}
          </ul>
        </div>
      )}

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
      .then((a) => active && setLabel(a.apartment_name))
      .catch(() => active && setLabel(null));
    return () => {
      active = false;
    };
  }, [id]);

  if (id == null) return <>—</>;
  return <>{label ?? "…"}</>;
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

function Row({
  label,
  on,
  note,
}: {
  label: string;
  on: boolean;
  note: string | null;
}) {
  return (
    <li className="text-sm flex flex-wrap items-center gap-x-2">
      <span className={on ? "text-status-green" : "text-gray-400"}>
        {on ? "✓" : "✗"} {label}
      </span>
      {note && <span className="text-gray-500">— {note}</span>}
    </li>
  );
}
