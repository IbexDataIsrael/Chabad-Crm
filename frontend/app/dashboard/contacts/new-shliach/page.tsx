"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ContactForm, type ContactFormValues } from "@/components/ContactForm";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import type { Area, Contact, UserSummary } from "@/lib/types";

export default function NewShliachPage() {
  const router = useRouter();
  const { isAdmin, loading } = useAuth();
  const { t } = useLocalization();
  const { success } = useToast();
  const [users, setUsers] = useState<UserSummary[]>([]);
  // Gate the form on areas existing — a shliach is defined by the areas they cover.
  const [areas, setAreas] = useState<Area[] | null>(null);

  useEffect(() => {
    apiFetch<UserSummary[]>("/api/users").then(setUsers).catch(() => {});
    apiFetch<Area[]>("/api/areas").then(setAreas).catch(() => setAreas([]));
  }, []);

  async function create(values: ContactFormValues) {
    const contact = await apiFetch<Contact>("/api/contacts", {
      method: "POST",
      body: JSON.stringify({ ...values, contact_type: "shliach" }),
    });
    success(t("msg.added", "נוסף בהצלחה"));
    router.push(`/dashboard/contacts/${contact.id}`);
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
    <div className="space-y-4">
      <Link href="/dashboard/users" className="text-sm text-gray-500 hover:underline">
        {t("page.back_to_shluchim", "← חזרה לפעילים")}
      </Link>
      <h1 className="text-2xl font-bold">{t("page.add_shliach", "הוסף פעיל")}</h1>
      <p className="text-sm text-gray-500">
        {t(
          "page.shliach_intro",
          "פעיל מקבל גישת התחברות למערכת לפי כתובת הדוא״ל, ורואה רק מקורבים בדירות שבאחריותו.",
        )}
      </p>
      {areas !== null && areas.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-6 space-y-3">
          <p className="text-status-darkred text-sm">
            {t("error.no_areas_for_shliach", "נא להוסיף לפחות אזור אחד למערכת")}
          </p>
          <Link
            href="/dashboard/areas/add"
            className="inline-block rounded-md bg-status-magenta text-white px-4 py-2 text-sm font-medium hover:opacity-90"
          >
            {t("page.add_area", "הוסף אזור")}
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <ContactForm
            initial={{ contact_type: "shliach" }}
            users={users}
            onSubmit={create}
            submitLabel={t("action.create_shliach", "צור פעיל")}
          />
        </div>
      )}
    </div>
  );
}
