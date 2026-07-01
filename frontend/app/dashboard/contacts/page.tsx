"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dotStyle, rowStyle } from "@/lib/colors";
import { useFieldSettings } from "@/lib/fieldSettings";
import { useLocalization } from "@/lib/localization";
import { usePicklist } from "@/lib/picklists";
import { contactFullName, type Contact } from "@/lib/types";

export default function ContactsPage() {
  const router = useRouter();
  const { t } = useLocalization();
  const { isShliach } = useAuth();
  const { isFieldVisible: vis } = useFieldSettings();
  const showStatus = vis("contacts.pipeline_status");
  const showPriority = vis("contacts.priority_score");
  const showColor = vis("contacts.color_tag");
  // name + phone + actions are always shown; add the visible toggleable columns.
  const colCount = 3 + [showStatus, showPriority, showColor].filter(Boolean).length;
  const {
    options: statusOptions,
    labelFor: statusLabel,
    display: statusDisplay,
  } = usePicklist("contact.pipeline_status");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("contact_type", "mekurav"); // contacts page shows mekuravim only
    if (statusFilter) params.set("pipeline_status", statusFilter);
    const qs = params.toString();
    setLoading(true);
    apiFetch<Contact[]>(`/api/contacts${qs ? `?${qs}` : ""}`)
      .then(setContacts)
      .catch(() => setContacts([]))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  const selectClass =
    "rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t("contacts", "אנשי קשר")}</h1>
        <div className="flex items-center gap-2">
          {!isShliach && (
            <Link
              href="/dashboard/contacts/new"
              className="rounded-md bg-status-magenta text-white px-4 py-2 text-sm font-medium hover:opacity-90"
            >
              + {t("page.new_contact", "איש קשר חדש")}
            </Link>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        {showStatus && (
          <select
            className={selectClass}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">{t("filter.all_statuses", "כל הסטטוסים")}</option>
            {statusOptions.map((o) => (
              <option key={o.id} value={o.value}>
                {statusDisplay(o)}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-gray-50 text-gray-600 text-right">
            <tr>
              <th className="px-4 py-2 font-medium">{t("common.name", "שם")}</th>
              <th className="px-4 py-2 font-medium">{t("contacts.phone", "טלפון")}</th>
              {showStatus && (
                <th className="px-4 py-2 font-medium">
                  {t("contacts.pipeline_status", "סטטוס")}
                </th>
              )}
              {showPriority && (
                <th className="px-4 py-2 font-medium">
                  {t("contacts.priority_score", "ציון עדיפות")}
                </th>
              )}
              {showColor && (
                <th className="px-4 py-2 font-medium">{t("contacts.color_tag", "צבע")}</th>
              )}
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-6 text-center text-gray-400">
                  {t("action.loading", "טוען…")}
                </td>
              </tr>
            ) : contacts.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-6 text-center text-gray-400">
                  {t("page.no_contacts", "אין אנשי קשר עדיין.")}
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
                  {showStatus && (
                    <td className="px-4 py-2">{statusLabel(c.pipeline_status)}</td>
                  )}
                  {showPriority && (
                    <td className="px-4 py-2">{c.priority_score ?? ""}</td>
                  )}
                  {showColor && (
                    <td className="px-4 py-2">
                      <span
                        className="inline-block h-4 w-4 rounded-full"
                        style={dotStyle(c.color_tag)}
                      />
                    </td>
                  )}
                  <td className="px-4 py-2 text-left">
                    <Link
                      href={`/dashboard/contacts/${c.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-sm text-status-magenta hover:underline whitespace-nowrap"
                    >
                      {t("action.open_edit", "פתח / עריכה ›")}
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
