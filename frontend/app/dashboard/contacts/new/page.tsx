"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ArrowRight, CheckCircle2 } from "lucide-react";

import { ContactForm, type ContactFormValues } from "@/components/ContactForm";
import { SignificantDatesEditor } from "@/components/SignificantDatesEditor";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import type { Contact, UserSummary } from "@/lib/types";

export default function NewContactPage() {
  const router = useRouter();
  const { t } = useLocalization();
  const { success } = useToast();
  const [users, setUsers] = useState<UserSummary[]>([]);
  // After creating a mekurav, reveal the significant-dates editor inline (with the
  // new id) instead of navigating away — so adding dates is immediately available.
  const [created, setCreated] = useState<Contact | null>(null);

  useEffect(() => {
    apiFetch<UserSummary[]>("/api/users").then(setUsers).catch(() => {});
  }, []);

  async function create(values: ContactFormValues) {
    // fixes25: the Mivtzoim visit checklist is logged per visit, not here.
    // fixes35: contact-level custom fields (any type) DO ride this payload.
    const contact = await apiFetch<Contact>("/api/contacts", {
      method: "POST",
      body: JSON.stringify(values),
    });
    success(t("msg.added", "נוסף בהצלחה"));
    // Mekurav → stay and let the user add significant dates right away. Otherwise go.
    if (contact.contact_type === "mekurav") setCreated(contact);
    else router.push(`/dashboard/contacts/${contact.id}`);
  }

  return (
    <div className="space-y-4">
      <Link
        href="/dashboard/contacts"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowRight className="h-4 w-4" /> {t("page.back_to_contacts", "חזרה לאנשי קשר")}
      </Link>
      <h1 className="font-display text-3xl font-bold tracking-wide">{t("page.new_contact", "איש קשר חדש")}</h1>

      {created ? (
        <Card className="p-6 space-y-4">
          <p className="flex items-center gap-2 text-status-green text-sm">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {t("page.contact_created_add_dates", "איש הקשר נוצר. ניתן להוסיף תאריכים חשובים עכשיו:")}
          </p>
          <section>
            <h3 className="text-sm font-semibold mb-3">{t("significant_dates", "תאריכים חשובים")}</h3>
            <SignificantDatesEditor contactId={created.id} />
          </section>
          <Button asChild>
            <Link href={`/dashboard/contacts/${created.id}`}>
              {t("action.done_to_contact", "סיום — מעבר לכרטיס")}
            </Link>
          </Button>
        </Card>
      ) : (
        <Card className="p-6">
          <ContactForm
            users={users}
            onSubmit={create}
            submitLabel={t("action.create_contact", "צור איש קשר")}
          />
        </Card>
      )}
    </div>
  );
}
