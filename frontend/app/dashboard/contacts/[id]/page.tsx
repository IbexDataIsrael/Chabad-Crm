"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ContactForm, type ContactFormValues } from "@/components/ContactForm";
import { ContactView } from "@/components/ContactView";
import { DonationsEditor } from "@/components/DonationsEditor";
import { SignificantDatesEditor } from "@/components/SignificantDatesEditor";
import { VisitHistoryEditor } from "@/components/VisitHistoryEditor";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useConfirm } from "@/lib/confirm";
import { telHref, waHref } from "@/lib/contactActions";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import { contactFullName, type Contact, type UserSummary } from "@/lib/types";

export default function ContactDetailPage() {
  const params = useParams<{ id: string }>();
  const contactId = Number(params.id);
  const router = useRouter();
  const { t } = useLocalization();
  const confirmDialog = useConfirm();
  const { isAdmin } = useAuth();
  const { success } = useToast();

  const [contact, setContact] = useState<Contact | null>(null);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [editing, setEditing] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    apiFetch<UserSummary[]>("/api/users").then(setUsers).catch(() => {});
    apiFetch<Contact>(`/api/contacts/${contactId}`)
      .then(setContact)
      .catch(() => setNotFound(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  async function save(values: ContactFormValues) {
    // fixes25: Mivtzoim / interactions / custom fields are logged per visit —
    // the contact save carries only the contact's own data.
    await apiFetch<Contact>(`/api/contacts/${contactId}`, {
      method: "PUT",
      body: JSON.stringify(values),
    });
    const fresh = await apiFetch<Contact>(`/api/contacts/${contactId}`);
    setContact(fresh);
    setEditing(false);
    success(t("msg.saved", "נשמר בהצלחה"));
  }

  async function remove() {
    if (!(await confirmDialog({ message: t("msg.delete_contact_confirm", "למחוק את איש הקשר? פעולה זו אינה הפיכה.") })))
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
              onClick={() => setEditing(false)}
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

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{contactFullName(contact)}</h1>
        {/* fixes17 §2.1: one-click call / WhatsApp / mail from the profile. */}
        <span className="flex items-center gap-2">
          {contact.phone && (
            <a
              href={telHref(contact.phone)}
              title={t("action.call", "חיוג")}
              className="rounded-full border border-gray-200 px-2.5 py-1.5 text-sm leading-none hover:bg-status-green/10"
            >
              📞 {t("action.call", "חיוג")}
            </a>
          )}
          {contact.phone && (
            <a
              href={waHref(contact.phone)}
              target="_blank"
              rel="noopener noreferrer"
              title={t("action.whatsapp", "וואטסאפ")}
              className="rounded-full border border-gray-200 px-2.5 py-1.5 text-sm leading-none hover:bg-status-green/10"
            >
              💬 {t("action.whatsapp", "וואטסאפ")}
            </a>
          )}
          {contact.email && (
            <a
              href={`mailto:${contact.email}`}
              title={t("action.send_email", "שליחת מייל")}
              className="rounded-full border border-gray-200 px-2.5 py-1.5 text-sm leading-none hover:bg-status-magenta/10"
            >
              ✉ {t("action.send_email", "שליחת מייל")}
            </a>
          )}
        </span>
      </div>

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
          />
        ) : (
          <ContactView contact={contact} users={users} />
        )}
      </section>

      {/* fixes19 §2: the "apartments covered by the activist" grid is gone —
          shluchim associate with report numbers (shown in the details card). */}

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

      {/* fixes18 §3.1: donations are mekurav relationship data — a shliach
          profile no longer shows this section. fixes25: interactions moved
          into the visit log above. */}
      {isAdmin && contact.contact_type === "mekurav" && (
        <section className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="font-semibold mb-4">{t("donation.history", "היסטורית תרומות")}</h2>
          <DonationsEditor contactId={contact.id} />
        </section>
      )}
    </div>
  );
}
