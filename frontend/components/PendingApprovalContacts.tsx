"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import type { Contact, ContactPage } from "@/lib/types";

/** Instinct-created draft contacts (docs/system_api.md), kept in their own
 *  section above the contacts grid — never mixed into it — until someone
 *  approves them. Renders nothing while there are no drafts.
 *  `onApproved` lets the page refetch its main list, where the approved
 *  contact now belongs. */
export function PendingApprovalContacts({ onApproved }: { onApproved: () => void }) {
  const { t } = useLocalization();
  const { success, error: toastError } = useToast();
  const [drafts, setDrafts] = useState<Contact[]>([]);
  const [approving, setApproving] = useState<number | null>(null);

  function load() {
    apiFetch<ContactPage>(
      "/api/contacts/list?status=draft&sort=created&dir=desc&page_size=100",
    )
      .then((res) => setDrafts(res.items))
      .catch(() => setDrafts([]));
  }

  useEffect(load, []);

  async function approve(id: number) {
    setApproving(id);
    try {
      await apiFetch(`/api/contacts/${id}/approve`, { method: "POST" });
      setDrafts((prev) => prev.filter((c) => c.id !== id));
      success(t("msg.contact_approved", "איש הקשר אושר"));
      onApproved();
    } catch {
      toastError(t("msg.contact_approve_failed", "אישור איש הקשר נכשל"));
    } finally {
      setApproving(null);
    }
  }

  if (drafts.length === 0) return null;

  return (
    <section className="rounded-lg border-2 border-status-orange bg-status-orange/5 p-3">
      <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold">
        {t("contacts.pending_approval", "ממתינים לאישור")}
        <Badge variant="status-orange">{drafts.length}</Badge>
      </h2>
      <ul className="divide-y">
        {drafts.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
            <Badge variant="outline">{t("contacts.draft_badge", "טיוטה")}</Badge>
            <Link
              href={`/dashboard/contacts/${c.id}`}
              className="font-medium hover:underline"
            >
              {[c.name, c.last_name].filter(Boolean).join(" ")}
            </Link>
            {c.phone && <span dir="ltr">{c.phone}</span>}
            {c.email && <span dir="ltr">{c.email}</span>}
            {c.address && <span className="text-muted-foreground">{c.address}</span>}
            {c.source === "instinct" && (
              <span className="text-xs text-muted-foreground">
                {t("contacts.source_instinct", "נוסף דרך Instinct")}
              </span>
            )}
            <Button
              type="button"
              size="sm"
              className="ms-auto min-h-9"
              disabled={approving === c.id}
              onClick={() => approve(c.id)}
            >
              <Check className="h-4 w-4" /> {t("contacts.approve", "אישור")}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
