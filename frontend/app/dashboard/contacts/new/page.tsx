"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ChecklistFields } from "@/components/ChecklistFields";
import { ContactForm, type ContactFormValues } from "@/components/ContactForm";
import { CustomFieldsEditor } from "@/components/CustomFieldsEditor";
import { apiFetch } from "@/lib/api";
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
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [checklist, setChecklist] = useState<Checklist>(emptyChecklist());
  const [customFields, setCustomFields] = useState<ContactCustomField[]>([]);

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
    router.push(`/dashboard/contacts/${contact.id}`);
  }

  return (
    <div className="space-y-4">
      <Link href="/dashboard/contacts" className="text-sm text-gray-500 hover:underline">
        ← חזרה לאנשי קשר
      </Link>
      <h1 className="text-2xl font-bold">איש קשר חדש</h1>
      <div className="bg-white rounded-xl shadow-sm p-6">
        <ContactForm
          users={users}
          onSubmit={create}
          submitLabel="צור איש קשר"
          extra={
            <div className="space-y-6 border-t border-gray-100 pt-4">
              <section>
                <h3 className="text-sm font-semibold mb-3">מצוות קהילה</h3>
                <ChecklistFields value={checklist} onChange={setChecklist} />
              </section>
              {customFields.length > 0 && (
                <section>
                  <h3 className="text-sm font-semibold mb-3">שדות נוספים</h3>
                  <CustomFieldsEditor items={customFields} onChange={setCustomFields} />
                </section>
              )}
            </div>
          }
        />
      </div>
    </div>
  );
}
