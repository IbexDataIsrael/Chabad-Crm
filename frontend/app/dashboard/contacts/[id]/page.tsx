"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ContactView, type ContactPatch } from "@/components/ContactView";
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
  const { success, error: toastError } = useToast();

  const [contact, setContact] = useState<Contact | null>(null);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [recreating, setRecreating] = useState(false);

  useEffect(() => {
    apiFetch<UserSummary[]>("/api/users").then(setUsers).catch(() => {});
    apiFetch<Contact>(`/api/contacts/${contactId}`)
      .then(setContact)
      .catch(() => setNotFound(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  // fixes26 §2: per-field autosave — the fields edit in place (ContactView),
  // each change lands as its own PATCH. fixes25: Mivtzoim / interactions /
  // custom fields are logged per visit, not on the contact.
  async function patchContact(partial: ContactPatch) {
    const fresh = await apiFetch<Contact>(`/api/contacts/${contactId}`, {
      method: "PATCH",
      body: JSON.stringify(partial),
    });
    setContact(fresh);
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

  // fixes26 §4: one-click recovery of a suspended/deleted shliach login.
  async function recreateLogin() {
    if (!contact?.email || recreating) return;
    setRecreating(true);
    try {
      await apiFetch("/api/users/recreate", {
        method: "POST",
        body: JSON.stringify({ email: contact.email }),
      });
      const fresh = await apiFetch<Contact>(`/api/contacts/${contactId}`);
      setContact(fresh);
      success(t("users.user_recreated", "המשתמש נוצר מחדש"));
    } catch (err) {
      toastError(
        err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"),
      );
    } finally {
      setRecreating(false);
    }
  }

  if (notFound)
    return <p className="text-gray-500">{t("page.contact_not_found", "איש הקשר לא נמצא.")}</p>;
  if (!contact) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;

  const loginSuspended =
    contact.contact_type === "shliach" &&
    contact.shliach != null &&
    contact.shliach.login_status != null &&
    contact.shliach.login_status !== "active";

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
        <button
          onClick={remove}
          className="text-sm text-status-darkred border border-status-darkred/30 rounded-md px-3 py-1 hover:bg-red-50"
        >
          {t("action.delete", "מחק")}
        </button>
      </div>

      {/* fixes26 §4: a shliach whose login was deleted or disabled gets a
          prominent notice + one-click recovery (admins only). */}
      {loginSuspended && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-status-darkred/40 bg-red-50 px-4 py-3">
          <span className="text-sm font-medium text-status-darkred">
            {t("users.login_suspended", "הכניסה למערכת הושעתה")}
          </span>
          {isAdmin && contact.email && (
            <button
              type="button"
              onClick={recreateLogin}
              disabled={recreating}
              className="rounded-md bg-status-darkred text-white px-3 py-1 text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {recreating
                ? t("action.saving", "שומר…")
                : t("users.recreate_user", "צור משתמש מחדש")}
            </button>
          )}
        </div>
      )}

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
        {/* fixes26 §2: inline editing replaces the edit-mode form — click a
            value to change it; it saves on click-away / Enter. */}
        <ContactView contact={contact} users={users} onPatch={patchContact} />
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
