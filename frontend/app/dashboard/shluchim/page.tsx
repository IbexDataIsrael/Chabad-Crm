"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { contactFullName, type Contact } from "@/lib/types";

export default function ShluchimPage() {
  const router = useRouter();
  const { isAdmin, loading } = useAuth();
  const { t } = useLocalization();
  const [shluchim, setShluchim] = useState<Contact[]>([]);
  const [busy, setBusy] = useState(true);

  // Admin-only page.
  useEffect(() => {
    if (!loading && !isAdmin) router.replace("/dashboard");
  }, [loading, isAdmin, router]);

  useEffect(() => {
    if (loading || !isAdmin) return;
    apiFetch<Contact[]>("/api/contacts?contact_type=shliach")
      .then(setShluchim)
      .catch(() => setShluchim([]))
      .finally(() => setBusy(false));
  }, [loading, isAdmin]);

  if (loading || !isAdmin) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t("page.shluchim", "פעילים")}</h1>
        <Link
          href="/dashboard/contacts/new-shliach"
          className="rounded-md bg-status-magenta text-white px-4 py-2 text-sm font-medium hover:opacity-90"
        >
          + {t("page.add_shliach", "הוסף פעיל")}
        </Link>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[520px]">
          <thead className="bg-gray-50 text-gray-600 text-start">
            <tr>
              <th className="px-4 py-2 text-start font-medium">{t("common.name", "שם")}</th>
              <th className="px-4 py-2 text-start font-medium">{t("contacts.phone", "טלפון")}</th>
              <th className="px-4 py-2 text-start font-medium">{t("contacts.email", "אימייל")}</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {busy ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-400">
                  {t("action.loading", "טוען…")}
                </td>
              </tr>
            ) : shluchim.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-400">
                  {t("page.no_shluchim", "אין פעילים עדיין.")}
                </td>
              </tr>
            ) : (
              shluchim.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => router.push(`/dashboard/contacts/${c.id}`)}
                  className="border-t border-gray-100 cursor-pointer hover:bg-gray-50/80"
                >
                  <td className="px-4 py-2 font-medium text-status-magenta underline">
                    {contactFullName(c)}
                  </td>
                  <td className="px-4 py-2" dir="ltr">{c.phone}</td>
                  <td className="px-4 py-2" dir="ltr">{c.email ?? ""}</td>
                  <td className="px-4 py-2 text-end">
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
