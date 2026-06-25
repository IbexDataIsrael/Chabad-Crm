"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dotStyle, rowStyle } from "@/lib/colors";
import { useLocalization } from "@/lib/localization";
import { usePicklist } from "@/lib/picklists";
import { contactFullName, type Contact } from "@/lib/types";

export default function ContactsPage() {
  const router = useRouter();
  const { t } = useLocalization();
  const { isAdmin } = useAuth();
  const { options: statusOptions, labelFor: statusLabel } = usePicklist(
    "contact.pipeline_status",
  );
  const { options: areaOptions, labelFor: areaLabel } = usePicklist("contact.area");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [areaFilter, setAreaFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams();
    if (areaFilter) params.set("area", areaFilter);
    if (statusFilter) params.set("pipeline_status", statusFilter);
    const qs = params.toString();
    setLoading(true);
    apiFetch<Contact[]>(`/api/contacts${qs ? `?${qs}` : ""}`)
      .then(setContacts)
      .catch(() => setContacts([]))
      .finally(() => setLoading(false));
  }, [areaFilter, statusFilter]);

  const selectClass =
    "rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t("contacts", "אנשי קשר")}</h1>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Link
              href="/dashboard/contacts/new-shliach"
              className="rounded-md border border-status-magenta text-status-magenta px-4 py-2 text-sm font-medium hover:bg-status-magenta/5"
            >
              + הוסף שליח
            </Link>
          )}
          <Link
            href="/dashboard/contacts/new"
            className="rounded-md bg-status-magenta text-white px-4 py-2 text-sm font-medium hover:opacity-90"
          >
            + איש קשר חדש
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <select
          className={selectClass}
          value={areaFilter}
          onChange={(e) => setAreaFilter(e.target.value)}
        >
          <option value="">כל האזורים</option>
          {areaOptions.map((o) => (
            <option key={o.id} value={o.value}>
              {o.hebrew_label}
            </option>
          ))}
        </select>
        <select
          className={selectClass}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">כל הסטטוסים</option>
          {statusOptions.map((o) => (
            <option key={o.id} value={o.value}>
              {o.hebrew_label}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-gray-50 text-gray-600 text-right">
            <tr>
              <th className="px-4 py-2 font-medium">שם</th>
              <th className="px-4 py-2 font-medium">{t("contacts.phone", "טלפון")}</th>
              <th className="px-4 py-2 font-medium">{t("contacts.area", "אזור")}</th>
              <th className="px-4 py-2 font-medium">
                {t("contacts.pipeline_status", "סטטוס")}
              </th>
              <th className="px-4 py-2 font-medium">
                {t("contacts.priority_score", "ציון עדיפות")}
              </th>
              <th className="px-4 py-2 font-medium">{t("contacts.color_tag", "צבע")}</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-gray-400">
                  טוען…
                </td>
              </tr>
            ) : contacts.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-gray-400">
                  אין אנשי קשר. לחץ על &quot;איש קשר חדש&quot; כדי להוסיף.
                </td>
              </tr>
            ) : (
              contacts.map((c) => (
                <tr
                  key={c.id}
                  style={rowStyle(c.color_tag)}
                  onClick={() => router.push(`/dashboard/contacts/${c.id}`)}
                  className="border-t border-gray-100 cursor-pointer hover:bg-gray-50/80"
                >
                  <td className="px-4 py-2 font-medium text-status-magenta underline">
                    {contactFullName(c)}
                  </td>
                  <td className="px-4 py-2" dir="ltr">{c.phone}</td>
                  <td className="px-4 py-2">{areaLabel(c.area)}</td>
                  <td className="px-4 py-2">{statusLabel(c.pipeline_status)}</td>
                  <td className="px-4 py-2">{c.priority_score ?? ""}</td>
                  <td className="px-4 py-2">
                    <span
                      className="inline-block h-4 w-4 rounded-full"
                      style={dotStyle(c.color_tag)}
                    />
                  </td>
                  <td className="px-4 py-2 text-left">
                    <Link
                      href={`/dashboard/contacts/${c.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-sm text-status-magenta hover:underline whitespace-nowrap"
                    >
                      פתח / עריכה ›
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
