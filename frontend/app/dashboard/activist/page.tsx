"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  ReportCompletionModal,
  SystemCommentModal,
} from "@/components/ShliachSelfServiceModals";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import type { ApartmentPage, ShliachAnnouncement } from "@/lib/types";

/** fixes54 §6.1: a standalone landing page for the shliach role — replaces
 *  landing directly on the generic contact-edit page (`/dashboard/contacts/
 *  {id}`, fixes53 §7's default). That page is still where profile edits
 *  actually happen; this page links out to it, plus the apartments grid, the
 *  same self-service actions (now shared via ShliachSelfServiceModals), and
 *  an admin-authored announcement feed. */
export default function ActivistLandingPage() {
  const router = useRouter();
  const { user, isShliach, loading } = useAuth();
  const { t } = useLocalization();
  const { success } = useToast();

  const [apartmentsTotal, setApartmentsTotal] = useState<number | null>(null);
  const [announcements, setAnnouncements] = useState<ShliachAnnouncement[]>([]);
  const [announcementsLoading, setAnnouncementsLoading] = useState(true);
  const [completionModalOpen, setCompletionModalOpen] = useState(false);
  const [commentModalOpen, setCommentModalOpen] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!isShliach) {
      router.replace("/dashboard");
      return;
    }
    // fixes54 §6.1: the shliach's own apartments count — already self-scoped
    // server-side (apartments.py::_shliach_apartment_ids) for this role, so
    // a small page_size is enough to read `total`.
    apiFetch<ApartmentPage>("/api/apartments/list?page=1&page_size=20")
      .then((res) => setApartmentsTotal(res.total))
      .catch(() => setApartmentsTotal(0));
    apiFetch<ShliachAnnouncement[]>("/api/shliach-messages/announcements")
      .then(setAnnouncements)
      .catch(() => setAnnouncements([]))
      .finally(() => setAnnouncementsLoading(false));
  }, [loading, isShliach, router]);

  if (loading || !isShliach) {
    return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;
  }

  const contactId = user?.shliach?.contact_id ?? null;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">
          {t("activist_home.title", "ברוך הבא")}
          {user?.display_name ? `, ${user.display_name}` : ""}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {t("activist_home.intro", "עמוד הבית שלך — הפעולות והעדכונים שלך במקום אחד.")}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {contactId && (
          <Link
            href={`/dashboard/contacts/${contactId}`}
            className="rounded-xl border-2 border-status-magenta/30 bg-white shadow-sm p-5 hover:bg-status-magenta/5"
          >
            <div className="text-lg font-semibold">
              {t("activist_home.edit_profile", "עריכת הפרטים שלי")}
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {t("activist_home.edit_profile_hint", "עדכן את הפרטים האישיים שלך")}
            </p>
          </Link>
        )}
        <Link
          href="/dashboard/apartments"
          className="rounded-xl border-2 border-black/70 bg-white shadow-sm p-5 hover:bg-gray-50"
        >
          <div className="text-lg font-semibold">
            {t("activist_home.my_apartments", "הדירות שלי")}
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {apartmentsTotal == null
              ? t("action.loading", "טוען…")
              : t("activist_home.my_apartments_count", "{n} דירות משויכות").replace(
                  "{n}", String(apartmentsTotal),
                )}
          </p>
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {/* fixes54 §6.1: only when the activist has ≥1 assigned apartment. */}
        {(apartmentsTotal ?? 0) >= 1 && (
          <button
            type="button"
            onClick={() => setCompletionModalOpen(true)}
            className="rounded-md border border-status-magenta text-status-magenta px-4 py-1.5 text-sm font-medium hover:bg-status-magenta/10"
          >
            {t("shliach_msg.report_completed_btn", "דיווח על השלמת הדוח")}
          </button>
        )}
        <button
          type="button"
          onClick={() => setCommentModalOpen(true)}
          className="rounded-md border border-gray-300 text-gray-600 px-4 py-1.5 text-sm font-medium hover:bg-gray-50"
        >
          {t("shliach_msg.system_comment_btn", "הערות על המערכת")}
        </button>
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">
          {t("activist_home.announcements", "עדכונים")}
        </h2>
        {announcementsLoading ? (
          <p className="text-gray-400">{t("action.loading", "טוען…")}</p>
        ) : announcements.length === 0 ? (
          <p className="text-gray-400">{t("activist_home.no_announcements", "אין עדכונים כרגע.")}</p>
        ) : (
          <div className="space-y-3">
            {announcements.map((a, i) => (
              <div
                key={a.id}
                className={`bg-white rounded-xl shadow-sm border-2 ${
                  i % 2 === 0 ? "border-status-magenta/30" : "border-black/70"
                } p-5`}
              >
                <h3 className="font-semibold">{a.message_title}</h3>
                <div
                  className="mt-2 text-sm text-gray-700"
                  // fixes54 §5: admin-authored HTML from the shliach-config
                  // WYSIWYG editor — trusted content, admin-only write access.
                  dangerouslySetInnerHTML={{ __html: a.message_content }}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {completionModalOpen && (
        <ReportCompletionModal
          onClose={() => setCompletionModalOpen(false)}
          onSubmitted={() => {
            setCompletionModalOpen(false);
            success(t("shliach_msg.submitted", "הדיווח נשלח, תודה!"));
          }}
        />
      )}
      {commentModalOpen && (
        <SystemCommentModal
          onClose={() => setCommentModalOpen(false)}
          onSubmitted={() => {
            setCommentModalOpen(false);
            success(t("shliach_msg.submitted", "הדיווח נשלח, תודה!"));
          }}
        />
      )}
    </div>
  );
}
