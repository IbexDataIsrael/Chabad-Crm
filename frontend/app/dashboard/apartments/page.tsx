"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import {
  contactFullName,
  type ApartmentListItem,
  type Building,
  type Contact,
} from "@/lib/types";

export default function ApartmentsPage() {
  const { loading } = useAuth();
  const { t } = useLocalization();
  const [items, setItems] = useState<ApartmentListItem[]>([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(true);

  async function reload() {
    setItems(await apiFetch<ApartmentListItem[]>("/api/apartments/list"));
  }

  useEffect(() => {
    reload()
      .catch(() => setItems([]))
      .finally(() => setBusy(false));
  }, []);

  if (loading) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("apartments", "דירות")}</h1>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="rounded-md bg-status-magenta text-white px-4 py-1.5 text-sm font-medium hover:opacity-90"
          >
            + {t("apt.add_apartment", "הוסף דירה")}
          </button>
        )}
      </div>

      {adding && (
        <ApartmentEditor
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            await reload();
          }}
        />
      )}

      <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
        {busy ? (
          <p className="px-4 py-6 text-center text-gray-400">{t("action.loading", "טוען…")}</p>
        ) : items.length === 0 ? (
          <p className="px-4 py-6 text-center text-gray-400">
            {t("apt.no_apartments_page", "אין דירות להצגה.")}
          </p>
        ) : (
          items.map((a) => (
            <div key={a.id} className="px-4 py-3 flex flex-wrap items-center gap-2">
              <div className="min-w-[9rem]">
                <Link
                  href={`/dashboard/apartments/${a.id}`}
                  className="font-medium text-status-magenta hover:underline"
                >
                  {a.apartment_name}
                </Link>
                <div className="text-xs text-gray-500">
                  {[a.building_name, a.area_name].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div className="ms-auto text-sm">
                {a.contact_id ? (
                  <Link
                    href={`/dashboard/contacts/${a.contact_id}`}
                    className="rounded-full bg-status-magenta/10 text-status-magenta px-3 py-1 hover:bg-status-magenta/20"
                  >
                    {a.contact_name}
                  </Link>
                ) : (
                  <span className="text-gray-400">{t("apt.no_contact", "ללא איש קשר")}</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ApartmentEditor({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useLocalization();
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [buildingId, setBuildingId] = useState<number | "">("");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [contactId, setContactId] = useState<number | "">("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<Building[]>("/api/buildings").then(setBuildings).catch(() => {});
    apiFetch<Contact[]>("/api/contacts?contact_type=mekurav")
      .then(setContacts)
      .catch(() => {});
  }, []);

  const inputClass =
    "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (buildingId === "") {
      setError(t("apt.select_building", "יש לבחור בניין"));
      return;
    }
    setBusy(true);
    try {
      await apiFetch("/api/apartments", {
        method: "POST",
        body: JSON.stringify({
          building_id: Number(buildingId),
          apartment_name: name,
          apartment_notes: notes || null,
          contact_id: contactId === "" ? null : Number(contactId),
        }),
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="bg-white rounded-xl shadow-sm p-4 space-y-3">
      <h3 className="font-medium">{t("apt.new_apartment", "דירה חדשה")}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="block text-sm font-medium">{t("apartments.building_id", "בניין")}</span>
          <select
            className={inputClass}
            value={buildingId}
            onChange={(e) => setBuildingId(e.target.value === "" ? "" : Number(e.target.value))}
            required
          >
            <option value="">{t("apt.choose_building", "בחר בניין…")}</option>
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.building_name}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="block text-sm font-medium">{t("apartments.apartment_name", "כותרת")}</span>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="block space-y-1 sm:col-span-2">
          <span className="block text-sm font-medium">{t("apartments.apartment_notes", "הערות")}</span>
          <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <label className="block space-y-1 sm:col-span-2">
          <span className="block text-sm font-medium">
            {t("apt.associate_contact", "שייך איש קשר קיים (לא חובה)")}
          </span>
          <select
            className={inputClass}
            value={contactId}
            onChange={(e) => setContactId(e.target.value === "" ? "" : Number(e.target.value))}
          >
            <option value="">—</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {contactFullName(c)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="text-sm text-status-darkred">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-status-magenta text-white px-5 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {busy ? t("action.saving", "שומר…") : t("action.save", "שמור")}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
        >
          {t("action.cancel", "ביטול")}
        </button>
      </div>
    </form>
  );
}
