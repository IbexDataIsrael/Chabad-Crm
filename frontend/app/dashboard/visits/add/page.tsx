"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { VisitForm } from "@/components/VisitForm";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import type { Contact, Visit } from "@/lib/types";

/** Dedicated add-visit page (admin). Contact is optional. */
export default function AddVisitPage() {
  const { isAdmin, loading } = useAuth();
  const { t } = useLocalization();
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>([]);

  useEffect(() => {
    if (!loading && !isAdmin) router.replace("/dashboard");
  }, [loading, isAdmin, router]);

  useEffect(() => {
    apiFetch<Contact[]>("/api/contacts?contact_type=mekurav")
      .then(setContacts)
      .catch(() => {});
  }, []);

  if (loading) return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;
  if (!isAdmin) return null;

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold tracking-wide">{t("page.add_visit", "ביקור חדש")}</h1>
        <Link href="/dashboard/visits" className="text-sm text-primary hover:underline">
          {t("page.back_to_visits", "← חזרה לביקורים")}
        </Link>
      </div>

      <VisitForm
        contacts={contacts}
        onCancel={() => router.push("/dashboard/visits")}
        onSave={(payload) =>
          apiFetch<Visit>("/api/visits", {
            method: "POST",
            body: JSON.stringify(payload),
          })
        }
        onDone={() => router.push("/dashboard/visits")}
      />
    </div>
  );
}
