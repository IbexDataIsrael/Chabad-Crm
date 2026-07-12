"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useLocalization } from "@/lib/localization";
import { contactFullName, type Contact, type Donation } from "@/lib/types";
import { useConfirm } from "@/lib/confirm";
import { DatePicker } from "./DatePicker";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

/**
 * Donation history (admin). With `contactId` it's the per-contact section (contact
 * locked); without it, the standalone page (all donations + a contact picker, incl.
 * contact-less rows).
 */
export function DonationsEditor({ contactId }: { contactId?: number }) {
  const { t } = useLocalization();
  const confirmDialog = useConfirm();
  const [donations, setDonations] = useState<Donation[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ id: number | null } | null>(null);

  const qs = contactId ? `?contact_id=${contactId}` : "";

  async function reload() {
    setDonations(await apiFetch<Donation[]>(`/api/donations${qs}`));
  }

  useEffect(() => {
    reload()
      .catch(() => setDonations([]))
      .finally(() => setLoading(false));
    if (!contactId) {
      apiFetch<Contact[]>("/api/contacts?contact_type=mekurav")
        .then(setContacts)
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  async function remove(id: number) {
    if (!(await confirmDialog({ message: t("donation.delete_confirm", "למחוק תרומה זו?") }))) return;
    await apiFetch(`/api/donations/${id}`, { method: "DELETE" });
    await reload();
  }

  const editingDonation =
    editing && editing.id != null ? donations.find((d) => d.id === editing.id) : undefined;

  if (loading) return <p className="text-sm text-gray-400">{t("action.loading", "טוען…")}</p>;

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-gray-50 text-gray-600 text-xs">
            <tr>
              {!contactId && (
                <th className="px-3 py-2 text-start font-medium">{t("donation.contact", "איש קשר")}</th>
              )}
              <th className="px-3 py-2 text-start font-medium">{t("donation.date", "תאריך")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("donation.amount", "סכום")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("donation.ongoing", "הוראת קבע")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("donation.payments", "תשלומים")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("donation.notes", "הערות")}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {donations.length === 0 ? (
              <tr>
                <td colSpan={contactId ? 6 : 7} className="px-3 py-6 text-center text-gray-400">
                  {t("donation.none", "אין תרומות עדיין.")}
                </td>
              </tr>
            ) : (
              donations.map((d) => (
                <tr key={d.id} className="border-t border-gray-100">
                  {!contactId && (
                    <td className="px-3 py-2">
                      {d.contact_id ? (
                        <Link
                          href={`/dashboard/contacts/${d.contact_id}`}
                          className="text-status-magenta hover:underline"
                        >
                          {d.contact_name}
                        </Link>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  )}
                  <td className="px-3 py-2" dir="ltr">
                    {new Date(d.donation_date).toLocaleDateString("he-IL")}
                  </td>
                  <td className="px-3 py-2" dir="ltr">{d.amount ?? ""}</td>
                  <td className="px-3 py-2">{d.is_ongoing ? "✓" : ""}</td>
                  <td className="px-3 py-2" dir="ltr">{d.number_of_payments ?? ""}</td>
                  <td className="px-3 py-2">{d.notes}</td>
                  <td className="px-3 py-2 text-end whitespace-nowrap">
                    <button
                      onClick={() => setEditing({ id: d.id })}
                      className="text-sm text-status-magenta hover:underline me-2"
                    >
                      {t("action.edit", "ערוך")}
                    </button>
                    <button
                      onClick={() => remove(d.id)}
                      className="text-sm text-status-darkred hover:underline"
                    >
                      {t("action.delete", "מחק")}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editing ? (
        <DonationForm
          key={editing.id ?? "new"}
          initial={editingDonation}
          contacts={contacts}
          lockedContactId={contactId}
          onCancel={() => setEditing(null)}
          onSave={async (payload) => {
            if (editing.id != null) {
              await apiFetch(`/api/donations/${editing.id}`, {
                method: "PUT",
                body: JSON.stringify(payload),
              });
            } else {
              await apiFetch("/api/donations", {
                method: "POST",
                body: JSON.stringify(payload),
              });
            }
            setEditing(null);
            await reload();
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing({ id: null })}
          className="text-sm text-status-magenta hover:underline"
        >
          + {t("donation.add", "הוסף תרומה")}
        </button>
      )}
    </div>
  );
}

function DonationForm({
  initial,
  contacts,
  lockedContactId,
  onSave,
  onCancel,
}: {
  initial?: Donation;
  contacts: Contact[];
  lockedContactId?: number;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useLocalization();
  const [contactSel, setContactSel] = useState<number | "">(
    lockedContactId ?? initial?.contact_id ?? "",
  );
  const [date, setDate] = useState<string | null>(initial?.donation_date ?? null);
  const [amount, setAmount] = useState<string>(initial?.amount?.toString() ?? "");
  const [ongoing, setOngoing] = useState(initial?.is_ongoing ?? false);
  const [payments, setPayments] = useState<string>(
    initial?.number_of_payments?.toString() ?? "",
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setError("");
    if (!date) {
      setError(t("donation.pick_date", "יש לבחור תאריך"));
      return;
    }
    setBusy(true);
    try {
      await onSave({
        contact_id: lockedContactId ?? (contactSel === "" ? null : Number(contactSel)),
        donation_date: date,
        amount: amount === "" ? null : Number(amount),
        is_ongoing: ongoing,
        number_of_payments: payments === "" ? null : Number(payments),
        notes: notes || null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-gray-200 p-3 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {lockedContactId === undefined && (
          <label className="block space-y-1">
            <span className="block text-sm font-medium">{t("donation.contact", "איש קשר")}</span>
            <select
              className={inputClass}
              value={contactSel}
              onChange={(e) => setContactSel(e.target.value === "" ? "" : Number(e.target.value))}
            >
              <option value="">{t("donation.no_contact", "ללא איש קשר")}</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {contactFullName(c)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block space-y-1">
          <span className="block text-sm font-medium">{t("donation.date", "תאריך")}</span>
          <DatePicker value={date} onChange={setDate} className={inputClass} />
        </label>
        <label className="block space-y-1">
          <span className="block text-sm font-medium">{t("donation.amount", "סכום")}</span>
          <input
            type="number"
            dir="ltr"
            className={inputClass}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span className="block text-sm font-medium">{t("donation.payments", "מספר תשלומים")}</span>
          <input
            type="number"
            dir="ltr"
            className={inputClass}
            value={payments}
            onChange={(e) => setPayments(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={ongoing} onChange={(e) => setOngoing(e.target.checked)} />
          {t("donation.ongoing", "האם הוראת קבע")}
        </label>
        <label className="block space-y-1 sm:col-span-2">
          <span className="block text-sm font-medium">{t("donation.notes", "הערות")}</span>
          <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      {error && <p className="text-sm text-status-darkred">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-md bg-status-magenta text-white px-4 py-1.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {busy ? t("action.saving", "שומר…") : t("action.save", "שמור")}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-gray-500 hover:underline">
          {t("action.cancel", "ביטול")}
        </button>
      </div>
    </div>
  );
}
