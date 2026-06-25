"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ContactForm, type ContactFormValues } from "@/components/ContactForm";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Contact, UserSummary } from "@/lib/types";

export default function NewShliachPage() {
  const router = useRouter();
  const { isAdmin, loading } = useAuth();
  const [users, setUsers] = useState<UserSummary[]>([]);

  useEffect(() => {
    apiFetch<UserSummary[]>("/api/users").then(setUsers).catch(() => {});
  }, []);

  async function create(values: ContactFormValues) {
    const contact = await apiFetch<Contact>("/api/contacts", {
      method: "POST",
      body: JSON.stringify({ ...values, contact_type: "shliach" }),
    });
    router.push(`/dashboard/contacts/${contact.id}`);
  }

  if (loading) return <p className="text-gray-400">טוען…</p>;
  if (!isAdmin) {
    return <p className="text-status-darkred">אין לך הרשאה לעמוד זה (מנהלים בלבד).</p>;
  }

  return (
    <div className="space-y-4">
      <Link href="/dashboard/contacts" className="text-sm text-gray-500 hover:underline">
        ← חזרה לאנשי קשר
      </Link>
      <h1 className="text-2xl font-bold">הוסף שליח</h1>
      <p className="text-sm text-gray-500">
        שליח מקבל גישת התחברות למערכת לפי כתובת הדוא״ל, ורואה רק מקורבים בדירות שבאחריותו.
      </p>
      <div className="bg-white rounded-xl shadow-sm p-6">
        <ContactForm
          initial={{ contact_type: "shliach" }}
          users={users}
          onSubmit={create}
          submitLabel="צור שליח"
        />
      </div>
    </div>
  );
}
