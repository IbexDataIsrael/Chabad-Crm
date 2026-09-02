"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ArrowRight, Plus } from "lucide-react";

import { ContactForm, type ContactFormValues } from "@/components/ContactForm";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { isFeatureEnabled, useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import type { Area, Contact, UserSummary } from "@/lib/types";

export default function NewShliachPage() {
  const router = useRouter();
  const { isAdmin, loading, user } = useAuth();
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

  if (loading) return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;
  if (!isAdmin) {
    return (
      <p className="text-status-darkred">
        {t("page.admins_only", "אין לך הרשאה לעמוד זה (מנהלים בלבד).")}
      </p>
    );
  }
  // fixes54 §8: the superadmin "Activist system" toggle — off blocks
  // provisioning a new activist login (defense in depth; the backend itself
  // also rejects contact_type=shliach creation — routers/contacts.py).
  if (!isFeatureEnabled(user?.organization, "activist_system_enabled")) {
    return (
      <p className="text-status-darkred">
        {t("page.module_disabled", "התכונה הזו כבויה עבור הארגון שלך.")}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <Link
        href="/dashboard/users"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowRight className="h-4 w-4" /> {t("page.back_to_shluchim", "חזרה לפעילים")}
      </Link>
      <h1 className="text-2xl font-bold">{t("page.add_shliach", "הוסף פעיל")}</h1>
      <p className="text-sm text-muted-foreground">
        {t(
          "page.shliach_intro",
          "פעיל מקבל גישת התחברות למערכת לפי כתובת הדוא״ל, ורואה רק מקורבים בדירות שבאחריותו.",
        )}
      </p>
      {areas !== null && areas.length === 0 ? (
        <Card className="p-6 space-y-3">
          <p className="text-status-darkred text-sm">
            {t("error.no_areas_for_shliach", "נא להוסיף לפחות אזור אחד למערכת")}
          </p>
          <Button asChild>
            <Link href="/dashboard/areas/add">
              <Plus className="h-4 w-4" /> {t("page.add_area", "הוסף אזור")}
            </Link>
          </Button>
        </Card>
      ) : (
        <Card className="p-6">
          <ContactForm
            initial={{ contact_type: "shliach" }}
            users={users}
            onSubmit={create}
            submitLabel={t("action.create_shliach", "צור פעיל")}
          />
        </Card>
      )}
    </div>
  );
}
