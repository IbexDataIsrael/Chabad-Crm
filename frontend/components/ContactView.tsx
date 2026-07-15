"use client";

import { useEffect, useState, type ReactNode } from "react";

import { apiFetch } from "@/lib/api";
import { dotStyle } from "@/lib/colors";
import { useFieldSettings } from "@/lib/fieldSettings";
import { useLocalization } from "@/lib/localization";
import { usePicklist } from "@/lib/picklists";
import {
  apartmentTitle,
  type AdminArea,
  type Apartment,
  type Area,
  type Contact,
  type ReportNumber,
  type UserSummary,
} from "@/lib/types";
import { ContactMap } from "./ContactMap";

/** Read-only display of every contact field. fixes25: the Mivtzoim checklist
 *  and custom fields moved to the visit log. */
export function ContactView({
  contact,
  users,
}: {
  contact: Contact;
  users: UserSummary[];
}) {
  const { t } = useLocalization();
  const { isFieldVisible: vis } = useFieldSettings();
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

  // fixes15 §4.2: a shliach profile shows only shliach-relevant fields — no
  // pipeline/color/priority/address (those are general-CRM/mekurav data).
  const shliachFields: [string | null, string, ReactNode][] = [
    [null, t("contacts.name", "שם פרטי"), contact.name],
    ["contacts.last_name", t("contacts.last_name", "שם משפחה"), contact.last_name || "—"],
    [null, t("contacts.phone", "טלפון"), contact.phone ? <span dir="ltr" key="p">{contact.phone}</span> : "—"],
    ["contacts.email", t("contacts.email", "אימייל"), contact.email ? <span dir="ltr">{contact.email}</span> : "—"],
    [null, t("contacts.contact_type", "סוג איש קשר"), contactType.labelFor(contact.contact_type) || "—"],
    [
      null,
      t("contacts.created_at", "נוצר בתאריך"),
      <span dir="ltr" key="cr">{new Date(contact.created_at).toLocaleDateString("he-IL")}</span>,
    ],
  ];

  // Each entry: [fieldKey | null, label, value]. null = always shown (required).
  const fields: [string | null, string, ReactNode][] = [
    [null, t("contacts.name", "שם פרטי"), contact.name],
    ["contacts.last_name", t("contacts.last_name", "שם משפחה"), contact.last_name || "—"],
    [null, t("contacts.phone", "טלפון"), contact.phone ? <span dir="ltr" key="p">{contact.phone}</span> : "—"],
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
    [
      null,
      t("contacts.created_at", "נוצר בתאריך"),
      <span dir="ltr" key="cr">{new Date(contact.created_at).toLocaleDateString("he-IL")}</span>,
    ],
  ];

  // fixes19 §5: the whole mekurav layout area rides on one section-level
  // visibility switch (hidden by default).
  const mekuravFields: [string | null, string, ReactNode][] =
    mk && vis("contact_mekurav.section")
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
        [
          "contact_mekurav.tzedaka_potential",
          t("contact_mekurav.tzedaka_potential", "פוטנציאל לצדקה"),
          mk.tzedaka_potential || "—",
        ],
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

  // fixes20 §2: admin_area is a top-level administrative grouping shown
  // independently of the mekurav section toggle (its own field toggle,
  // default-visible), so it stays visible even when the section is hidden.
  const mekuravAdminArea: [string | null, string, ReactNode][] = mk
    ? [
        [
          "contact_mekurav.admin_area_id",
          t("contact_mekurav.admin_area_id", "אזור מנהל"),
          <AdminAreaLabel key="aa" id={mk.admin_area_id} />,
        ],
      ]
    : [];

  const allFields = (
    contact.contact_type === "shliach"
      ? shliachFields
      : [...fields, ...mekuravAdminArea, ...mekuravFields]
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
            {/* fixes19: shluchim associate with report numbers (the covered
                apartments grid is gone). */}
            {vis("contact_shliach.report_numbers") && (
              <div className="flex flex-col">
                <dt className="text-xs text-gray-500">
                  {t("contact_shliach.report_numbers", "מספרי דוח באחריות הפעיל")}
                </dt>
                <dd className="text-sm">
                  <ReportNumbersLabel ids={contact.shliach.report_number_ids} />
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

