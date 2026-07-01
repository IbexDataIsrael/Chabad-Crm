"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { VisitForm } from "@/components/VisitForm";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { usePicklist } from "@/lib/picklists";
import type { Contact, Visit } from "@/lib/types";

export default function VisitsPage() {
  const { isAdmin, loading } = useAuth();
  const { t } = useLocalization();
  const { labelFor } = usePicklist("visit.type");
  const [visits, setVisits] = useState<Visit[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function reload() {
    setVisits(await apiFetch<Visit[]>("/api/visits"));
  }

  useEffect(() => {
    if (loading || !isAdmin) return;
    reload().catch(() => setVisits([])).finally(() => setLoaded(true));
    apiFetch<Contact[]>("/api/contacts?contact_type=mekurav")
      .then(setContacts)
      .catch(() => {});
  }, [loading, isAdmin]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return visits;
    return visits.filter(
      (v) =>
        (v.contact_name ?? "").toLowerCase().includes(q) ||
        (v.notes ?? "").toLowerCase().includes(q),
    );
  }, [visits, query]);

  async function remove(id: number) {
    if (!confirm(t("visit.delete_confirm", "למחוק ביקור זה?"))) return;
    await apiFetch(`/api/visits/${id}`, { method: "DELETE" });
    await reload();
  }

  if (loading) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;
  if (!isAdmin) {
    return (
      <p className="text-status-darkred">
        {t("page.admins_only", "אין לך הרשאה לעמוד זה (מנהלים בלבד).")}
      </p>
    );
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("page.visits", "ביקורים")}</h1>
        <Link
          href="/dashboard/visits/add"
          className="rounded-md bg-status-magenta text-white px-4 py-1.5 text-sm font-medium hover:opacity-90"
        >
          {t("visit.add", "הוסף ביקור")}
        </Link>
      </div>

      <input
        className="w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta"
        placeholder={t("visit.search_ph", "חיפוש לפי איש קשר או הערות…")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-gray-50 text-gray-600 text-xs">
            <tr>
              <th className="px-3 py-2 text-start font-medium">{t("visit.contact", "איש קשר")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("visit.date", "תאריך")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("visit.type", "סוג ביקור")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("visit.location", "מיקום")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("visit.notes", "הערות")}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {!loaded ? null : shown.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-gray-400">
                  {t("visit.none", "אין ביקורים עדיין.")}
                </td>
              </tr>
            ) : (
              shown.map((v) =>
                editingId === v.id ? (
                  <tr key={v.id} className="border-t border-gray-100">
                    <td colSpan={6} className="p-3">
                      <VisitForm
                        initial={v}
                        contacts={contacts}
                        onCancel={() => setEditingId(null)}
                        onSave={async (payload) => {
                          await apiFetch(`/api/visits/${v.id}`, {
                            method: "PUT",
                            body: JSON.stringify(payload),
                          });
                          setEditingId(null);
                          await reload();
                        }}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={v.id} className="border-t border-gray-100">
                    <td className="px-3 py-2">
                      {v.contact_id ? (
                        <Link
                          href={`/dashboard/contacts/${v.contact_id}`}
                          className="text-status-magenta hover:underline"
                        >
                          {v.contact_name}
                        </Link>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2" dir="ltr">
                      {new Date(v.visit_date).toLocaleDateString("he-IL")}
                    </td>
                    <td className="px-3 py-2">{v.visit_type ? labelFor(v.visit_type) : ""}</td>
                    <td className="px-3 py-2">{v.location}</td>
                    <td className="px-3 py-2">{v.notes}</td>
                    <td className="px-3 py-2 text-end whitespace-nowrap">
                      <button
                        onClick={() => setEditingId(v.id)}
                        className="text-sm text-status-magenta hover:underline me-2"
                      >
                        {t("action.edit", "ערוך")}
                      </button>
                      <button
                        onClick={() => remove(v.id)}
                        className="text-sm text-status-darkred hover:underline"
                      >
                        {t("action.delete", "מחק")}
                      </button>
                    </td>
                  </tr>
                ),
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
