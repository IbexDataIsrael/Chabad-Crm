"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ChecklistFields } from "@/components/ChecklistFields";
import { ContactForm, type ContactFormValues } from "@/components/ContactForm";
import { CustomFieldsEditor } from "@/components/CustomFieldsEditor";
import { SignificantDatesEditor } from "@/components/SignificantDatesEditor";
import { apiFetch } from "@/lib/api";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import {
  emptyChecklist,
  type Checklist,
  type Contact,
  type ContactCustomField,
  type CustomFieldDefinition,
  type UserSummary,
} from "@/lib/types";

export default function NewContactPage() {
  const router = useRouter();
  const { t } = useLocalization();
  const { success } = useToast();
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [checklist, setChecklist] = useState<Checklist>(emptyChecklist());
  const [customFields, setCustomFields] = useState<ContactCustomField[]>([]);
  // After creating a mekurav, reveal the significant-dates editor inline (with the
  // new id) instead of navigating away — so adding dates is immediately available.
  const [created, setCreated] = useState<Contact | null>(null);

  useEffect(() => {
    apiFetch<UserSummary[]>("/api/users").then(setUsers).catch(() => {});
    apiFetch<CustomFieldDefinition[]>("/api/custom-fields")
      .then((defs) =>
        setCustomFields(
          defs.map((d) => ({
            definition_id: d.id,
            field_key: d.field_key,
            hebrew_label: d.hebrew_label,
            checked: false,
            note: null,
          })),
        ),
      )
      .catch(() => {});
  }, []);

  async function create(values: ContactFormValues) {
    const contact = await apiFetch<Contact>("/api/contacts", {
      method: "POST",
      body: JSON.stringify(values),
    });
    await apiFetch(`/api/contacts/${contact.id}/checklist`, {
      method: "PUT",
      body: JSON.stringify(checklist),
    });
    if (customFields.length > 0) {
      await apiFetch(`/api/contacts/${contact.id}/custom-fields`, {
        method: "PUT",
        body: JSON.stringify(
          customFields.map((c) => ({
            definition_id: c.definition_id,
            checked: c.checked,
            note: c.note,
          })),
        ),
      });
    }
    success(t("msg.added", "נוסף בהצלחה"));
    // Mekurav → stay and let the user add significant dates right away. Otherwise go.
    if (contact.contact_type === "mekurav") setCreated(contact);
    else router.push(`/dashboard/contacts/${contact.id}`);
  }

  return (
    <div className="space-y-4">
      <Link href="/dashboard/contacts" className="text-sm text-gray-500 hover:underline">
        {t("page.back_to_contacts", "← חזרה לאנשי קשר")}
      </Link>
      <h1 className="text-2xl font-bold">{t("page.new_contact", "איש קשר חדש")}</h1>

      {created ? (
        <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
          <p className="text-status-green text-sm">
            {t("page.contact_created_add_dates", "איש הקשר נוצר. ניתן להוסיף תאריכים חשובים עכשיו:")}
          </p>
          <section>
            <h3 className="text-sm font-semibold mb-3">{t("significant_dates", "תאריכים חשובים")}</h3>
            <SignificantDatesEditor contactId={created.id} />
          </section>
          <Link
            href={`/dashboard/contacts/${created.id}`}
            className="inline-block rounded-md bg-status-magenta text-white px-5 py-2 text-sm font-medium hover:opacity-90"
          >
            {t("action.done_to_contact", "סיום — מעבר לכרטיס")}
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <ContactForm
            users={users}
            onSubmit={create}
            submitLabel={t("action.create_contact", "צור איש קשר")}
            extra={
              <div className="space-y-6 border-t border-gray-100 pt-4">
                <section>
                  <h3 className="text-sm font-semibold mb-3">{t("community_checklists", "מצוות קהילה")}</h3>
                  <ChecklistFields value={checklist} onChange={setChecklist} />
                </section>
                {customFields.length > 0 && (
                  <section>
                    <h3 className="text-sm font-semibold mb-3">{t("page.extra_fields", "שדות נוספים")}</h3>
                    <CustomFieldsEditor items={customFields} onChange={setCustomFields} />
                  </section>
                )}
              </div>
            }
          />
        </div>
      )}
    </div>
  );
}
