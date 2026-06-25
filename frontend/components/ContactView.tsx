"use client";

import { useEffect, useState, type ReactNode } from "react";

import { apiFetch } from "@/lib/api";
import { dotStyle } from "@/lib/colors";
import { useLocalization } from "@/lib/localization";
import { usePicklist } from "@/lib/picklists";
import {
  CHECKLIST_ROWS,
  type Apartment,
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
  const area = usePicklist("contact.area");
  const status = usePicklist("contact.pipeline_status");
  const potential = usePicklist("contact.potential_next_step");
  const color = usePicklist("contact.color_tag");
  const torah = usePicklist("checklist.torah_thought");
  const contactType = usePicklist("contact.contact_type");

  const assignee = users.find((u) => u.id === contact.assigned_user_id);
  const cl = contact.checklist ?? null;
  const mk = contact.mekurav ?? null;
  const isMekurav = contact.contact_type === "mekurav";
  const hasCoords = contact.latitude != null && contact.longitude != null;

  const fields: [string, ReactNode][] = [
    [t("contacts.name", "שם פרטי"), contact.name],
    [t("contacts.last_name", "שם משפחה"), contact.last_name || "—"],
    [t("contacts.phone", "טלפון"), <span dir="ltr" key="p">{contact.phone}</span>],
    [t("contacts.email", "אימייל"), contact.email ? <span dir="ltr">{contact.email}</span> : "—"],
    [t("contacts.contact_type", "סוג איש קשר"), contactType.labelFor(contact.contact_type) || "—"],
    [t("contacts.area", "אזור"), area.labelFor(contact.area) || "—"],
    [t("contacts.assigned_user_id", "משויך ל"), assignee?.full_name ?? "—"],
    [t("contacts.pipeline_status", "סטטוס"), status.labelFor(contact.pipeline_status) || "—"],
    [
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
    [t("contacts.priority_score", "ציון עדיפות"), contact.priority_score ?? "—"],
    [t("contacts.address", "כתובת"), contact.address || "—"],
  ];

  const mekuravFields: [string, ReactNode][] = mk
    ? [
        [
          t("contact_mekurav.apartment_id", "דירה"),
          <ApartmentLabel key="ap" id={mk.apartment_id} />,
        ],
        [
          t("contact_mekurav.first_visit", "ביקור ראשון"),
          mk.first_visit ? new Date(mk.first_visit).toLocaleString("he-IL") : "—",
        ],
        [
          t("contact_mekurav.potential_next_step", "פוטנציאל לצעד"),
          potential.labelFor(mk.potential_next_step) || "—",
        ],
        [t("contact_mekurav.rebbe_connection", "קשר לרבי"), mk.rebbe_connection || "—"],
        [t("contact_mekurav.recommendations", "המלצות"), mk.recommendations || "—"],
        [t("contact_mekurav.background", "רקע"), mk.background || "—"],
      ]
    : [];

  const allFields = [...fields, ...mekuravFields];

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
        {allFields.map(([label, value]) => (
          <div key={label} className="flex flex-col">
            <dt className="text-xs text-gray-500">{label}</dt>
            <dd className="text-sm">{value}</dd>
          </div>
        ))}
        {contact.shliach && (
          <>
            <div className="flex flex-col">
              <dt className="text-xs text-gray-500">דירות באחריות השליח</dt>
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
            <div className="flex flex-col">
              <dt className="text-xs text-gray-500">{t("contact_shliach.notes", "הערות")}</dt>
              <dd className="text-sm">{contact.shliach.notes || "—"}</dd>
            </div>
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
          <h3 className="text-sm font-semibold mb-2">שדות נוספים</h3>
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
