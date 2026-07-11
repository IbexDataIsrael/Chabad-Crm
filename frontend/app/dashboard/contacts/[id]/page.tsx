"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ChecklistFields } from "@/components/ChecklistFields";
import { ContactForm, type ContactFormValues } from "@/components/ContactForm";
import { ContactView } from "@/components/ContactView";
import { CustomFieldsEditor } from "@/components/CustomFieldsEditor";
import { DonationsEditor } from "@/components/DonationsEditor";
import { InteractionsTimeline } from "@/components/InteractionsTimeline";
import { ShliachApartmentsGrid } from "@/components/ShliachApartmentsGrid";
import { SignificantDatesEditor } from "@/components/SignificantDatesEditor";
import { VisitHistoryEditor } from "@/components/VisitHistoryEditor";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import {
  contactFullName,
  emptyChecklist,
  type Checklist,
  type Contact,
  type ContactCustomField,
  type UserSummary,
} from "@/lib/types";

export default function ContactDetailPage() {
  const params = useParams<{ id: string }>();
  const contactId = Number(params.id);
  const router = useRouter();
  const { t } = useLocalization();
  const { isAdmin } = useAuth();
  const { success } = useToast();

  const [contact, setContact] = useState<Contact | null>(null);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [checklist, setChecklist] = useState<Checklist>(emptyChecklist(contactId));
  const [customFields, setCustomFields] = useState<ContactCustomField[]>([]);
  const [editing, setEditing] = useState(false);
  const [notFound, setNotFound] = useState(false);

  async function loadCustomFields() {
    setCustomFields(
      await apiFetch<ContactCustomField[]>(`/api/contacts/${contactId}/custom-fields`),
    );
  }

  useEffect(() => {
    apiFetch<UserSummary[]>("/api/users").then(setUsers).catch(() => {});
    apiFetch<Contact>(`/api/contacts/${contactId}`)
      .then((c) => {
        setContact(c);
        setChecklist(c.checklist ?? emptyChecklist(c.id));
      })
      .catch(() => setNotFound(true));
    loadCustomFields().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  async function save(values: ContactFormValues) {
    await apiFetch<Contact>(`/api/contacts/${contactId}`, {
      method: "PUT",
      body: JSON.stringify(values),
    });
    // Checklist + custom fields apply to mekurav contacts only.
    if (values.contact_type === "mekurav") {
      await apiFetch(`/api/contacts/${contactId}/checklist`, {
        method: "PUT",
        body: JSON.stringify(checklist),
      });
      if (customFields.length > 0) {
        await apiFetch(`/api/contacts/${contactId}/custom-fields`, {
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
    }
    // Reload fresh state.
    const fresh = await apiFetch<Contact>(`/api/contacts/${contactId}`);
    setContact(fresh);
    setChecklist(fresh.checklist ?? emptyChecklist(fresh.id));
    await loadCustomFields();
    setEditing(false);
    success(t("msg.saved", "נשמר בהצלחה"));
  }

  async function remove() {
    if (!confirm(t("msg.delete_contact_confirm", "למחוק את איש הקשר? פעולה זו אינה הפיכה.")))
      return;
    await apiFetch(`/api/contacts/${contactId}`, { method: "DELETE" });
    success(t("msg.deleted", "נמחק"));
    // fixes15 §3.1: return to the page that manages this record — deleting a
    // shliach (a login user) used to incorrectly dump the admin in Contacts.
    router.push(
      contact?.contact_type === "shliach" ? "/dashboard/shluchim" : "/dashboard/contacts",
    );
  }

  if (notFound)
    return <p className="text-gray-500">{t("page.contact_not_found", "איש הקשר לא נמצא.")}</p>;
  if (!contact) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {contact.contact_type === "shliach" ? (
          <Link href="/dashboard/shluchim" className="text-sm text-gray-500 hover:underline">
            {t("page.back_to_shluchim", "← חזרה לפעילים")}
          </Link>
        ) : (
          <Link href="/dashboard/contacts" className="text-sm text-gray-500 hover:underline">
            {t("page.back_to_contacts", "← חזרה לאנשי קשר")}
          </Link>
        )}
        <div className="flex items-center gap-2">
          {editing ? (
            <button
              onClick={() => {
                setEditing(false);
                setChecklist(contact.checklist ?? emptyChecklist(contact.id));
                loadCustomFields();
              }}
              className="text-sm border border-gray-300 rounded-md px-3 py-1 hover:bg-gray-50"
            >
              {t("action.cancel", "ביטול")}
            </button>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="text-sm bg-status-magenta text-white rounded-md px-4 py-1 hover:opacity-90"
            >
              {t("action.edit", "עריכה")}
            </button>
          )}
          <button
            onClick={remove}
            className="text-sm text-status-darkred border border-status-darkred/30 rounded-md px-3 py-1 hover:bg-red-50"
          >
            {t("action.delete", "מחק")}
          </button>
        </div>
      </div>

      <h1 className="text-2xl font-bold">{contactFullName(contact)}</h1>

      <section className="bg-white rounded-xl shadow-sm p-6">
        <h2 className="font-semibold mb-4">
          {contact.contact_type === "shliach"
            ? t("page.shliach_details", "פרטי פעיל")
            : t("page.contact_details", "פרטי איש קשר")}
        </h2>
        {editing ? (
          <ContactForm
            initial={contact}
            users={users}
            onSubmit={save}
            submitLabel={t("action.save_changes", "שמור שינויים")}
            extra={
              contact.contact_type === "mekurav" ? (
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
              ) : undefined
            }
          />
        ) : (
          <ContactView contact={contact} users={users} customFields={customFields} />
        )}
      </section>

      {/* fixes15 §4.2: the apartments assigned to this shliach, as a sub-grid. */}
      {contact.contact_type === "shliach" && (
        <section className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="font-semibold mb-4">
            {t("contact_shliach.apartments", "דירות באחריות הפעיל")}
          </h2>
          <ShliachApartmentsGrid contactId={contact.id} />
        </section>
      )}

      {contact.contact_type === "mekurav" && (
        <section className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="font-semibold mb-4">{t("significant_dates", "תאריכים חשובים")}</h2>
          <SignificantDatesEditor contactId={contact.id} />
        </section>
      )}

      {contact.contact_type === "mekurav" && (
        <section className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="font-semibold mb-4">{t("visit.history", "היסטורית ביקורים")}</h2>
          <VisitHistoryEditor contactId={contact.id} />
        </section>
      )}

      {isAdmin && (
        <section className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="font-semibold mb-4">{t("donation.history", "היסטורית תרומות")}</h2>
          <DonationsEditor contactId={contact.id} />
        </section>
      )}

      <section className="bg-white rounded-xl shadow-sm p-6">
        <h2 className="font-semibold mb-4">{t("interactions", "אינטראקציות")}</h2>
        <InteractionsTimeline contactId={contact.id} />
      </section>
    </div>
  );
}
