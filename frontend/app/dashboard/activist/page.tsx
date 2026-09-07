"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Home, MessageSquare, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

import {
  ReportCompletionModal,
  SystemCommentModal,
} from "@/components/ShliachSelfServiceModals";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  // A failed count fetch used to render as setApartmentsTotal(0), which is
  // indistinguishable from "you genuinely have zero apartments" — an
  // activist would see "0 דירות משויכות" with no hint that loading actually
  // failed and no way to retry. Track the failure separately instead.
  const [apartmentsError, setApartmentsError] = useState(false);
  const [announcements, setAnnouncements] = useState<ShliachAnnouncement[]>([]);
  const [announcementsLoading, setAnnouncementsLoading] = useState(true);
  const [completionModalOpen, setCompletionModalOpen] = useState(false);
  const [commentModalOpen, setCommentModalOpen] = useState(false);

  function loadApartmentsTotal() {
    setApartmentsError(false);
    // fixes54 §6.1: the shliach's own apartments count — already self-scoped
    // server-side (apartments.py::_shliach_apartment_ids) for this role, so
    // a small page_size is enough to read `total`.
    apiFetch<ApartmentPage>("/api/apartments/list?page=1&page_size=20")
      .then((res) => setApartmentsTotal(res.total))
      .catch(() => setApartmentsError(true));
  }

  useEffect(() => {
    if (loading) return;
    if (!isShliach) {
      router.replace("/dashboard");
      return;
    }
    loadApartmentsTotal();
    apiFetch<ShliachAnnouncement[]>("/api/shliach-messages/announcements")
      .then(setAnnouncements)
      .catch(() => setAnnouncements([]))
      .finally(() => setAnnouncementsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, isShliach, router]);

  if (loading || !isShliach) {
    return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;
  }

  const contactId = user?.shliach?.contact_id ?? null;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">
          {t("activist_home.title", "ברוך הבא")}
          {user?.display_name ? `, ${user.display_name}` : ""}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("activist_home.intro", "עמוד הבית שלך — הפעולות והעדכונים שלך במקום אחד.")}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {contactId && (
          <Link href={`/dashboard/contacts/${contactId}`}>
            <Card className="border-2 border-primary/30 p-5 transition-colors hover:bg-primary/5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <UserRound className="h-5 w-5" />
                </div>
                <div className="text-lg font-semibold">
                  {t("activist_home.edit_profile", "עריכת הפרטים שלי")}
                </div>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {t("activist_home.edit_profile_hint", "עדכן את הפרטים האישיים שלך")}
              </p>
            </Card>
          </Link>
        )}
        {apartmentsError ? (
          <Card className="border-2 border-status-darkred/70 p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
                <Home className="h-5 w-5" />
              </div>
              <div className="text-lg font-semibold">
                {t("activist_home.my_apartments", "הדירות שלי")}
              </div>
            </div>
            <p className="mt-2 text-sm text-status-darkred">
              {t("apt.load_failed", "טעינת הדירות נכשלה. נסה שוב.")}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={loadApartmentsTotal}
            >
              {t("action.retry", "נסה שוב")}
            </Button>
          </Card>
        ) : (
          <Link href="/dashboard/apartments">
            <Card className="border-2 border-foreground/70 p-5 transition-colors hover:bg-accent">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
                  <Home className="h-5 w-5" />
                </div>
                <div className="text-lg font-semibold">
                  {t("activist_home.my_apartments", "הדירות שלי")}
                </div>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {apartmentsTotal == null
                  ? t("action.loading", "טוען…")
                  : t("activist_home.my_apartments_count", "{n} דירות משויכות").replace(
                      "{n}", String(apartmentsTotal),
                    )}
              </p>
            </Card>
          </Link>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {/* fixes54 §6.1: only when the activist has ≥1 assigned apartment. */}
        {(apartmentsTotal ?? 0) >= 1 && (
          <Button
            type="button"
            variant="outline"
            className="border-primary text-primary hover:bg-primary/10"
            onClick={() => setCompletionModalOpen(true)}
          >
            {t("shliach_msg.report_completed_btn", "דיווח על השלמת הדוח")}
          </Button>
        )}
        <Button type="button" variant="outline" onClick={() => setCommentModalOpen(true)}>
          <MessageSquare className="h-4 w-4" /> {t("shliach_msg.system_comment_btn", "הערות על המערכת")}
        </Button>
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">
          {t("activist_home.announcements", "עדכונים")}
        </h2>
        {announcementsLoading ? (
          <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>
        ) : announcements.length === 0 ? (
          <p className="text-muted-foreground">{t("activist_home.no_announcements", "אין עדכונים כרגע.")}</p>
        ) : (
          <div className="space-y-3">
            {announcements.map((a, i) => (
              <Card
                key={a.id}
                className={`border-2 p-5 ${i % 2 === 0 ? "border-primary/30" : "border-foreground/70"}`}
              >
                <h3 className="font-semibold">{a.message_title}</h3>
                <div
                  className="mt-2 min-w-0 overflow-hidden break-all p-[5px] text-sm text-foreground [&_a]:break-all [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2"
                  // fixes54 §5: admin-authored HTML from the shliach-config
                  // WYSIWYG editor — trusted content, admin-only write access.
                  // break-all (not break-words/overflow-wrap: break-word): an
                  // admin can paste an unbroken long URL (e.g. a Google Drive
                  // share link) with no natural wrap points. break-words alone
                  // is a soft hint that doesn't reliably force a break for a
                  // long LTR run embedded in RTL bidi text — confirmed live on
                  // real mobile Chrome it still overflowed the card with
                  // break-words; break-all (word-break: break-all) forces a
                  // break at any character, which is a hard guarantee. The
                  // [&_a] rules underline links so admin-pasted raw URLs (no
                  // visual affordance otherwise) read as clickable.
                  dangerouslySetInnerHTML={{ __html: a.message_content }}
                />
              </Card>
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
