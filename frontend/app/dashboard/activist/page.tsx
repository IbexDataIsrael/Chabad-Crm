"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Footprints, Home, MessageSquare, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

import {
  ReportCompletionModal,
  SystemCommentModal,
} from "@/components/ShliachSelfServiceModals";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { routeCacheSummary } from "@/lib/activistRoute";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { usePersistentState } from "@/lib/persist";
import { useToast } from "@/lib/toast";
import type { ApartmentPage, CampaignActiveStat, ShliachAnnouncement } from "@/lib/types";

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
  // fixes58 §3.2/Phase 6: one dynamic stat tile per active campaign.
  const [campaignStats, setCampaignStats] = useState<CampaignActiveStat[]>([]);
  // fixes68 §1/EDIT: today's done/total for the "Start route" tile, read
  // straight from the route cache (no extra network call from this page).
  const [routeSummary, setRouteSummary] = useState<{ done: number; total: number } | null>(null);

  // The count here used to ignore every filter, so it always showed the
  // activist's *full* assigned set — bigger than what the Apartments page
  // actually lists whenever a filter is active there, whether that filter
  // came from the admin's default_filters (shliach-config) or the activist's
  // own persisted selection. Reading the exact same localStorage keys the
  // Apartments page filters on (fixes15 §1.2) and falling back to the same
  // admin default when a key is still empty (fixes51 §4's "apply once, only
  // while untouched" rule) makes this tile predict precisely what that page
  // will show, instead of a separate, larger number.
  const [areaIds] = usePersistentState<number[]>("crm.apartments.areaIds", []);
  const [buildingIds] = usePersistentState<number[]>("crm.apartments.buildingIds", []);
  const [reportNumberIds] = usePersistentState<number[]>(
    "crm.apartments.reportNumberIds", [],
  );
  const [jewishFilter] = usePersistentState<string[]>("crm.apartments.jewish", []);
  const [mezuzahFilter] = usePersistentState<string[]>("crm.apartments.mezuzah", []);
  const [languageFilter] = usePersistentState<string[]>("crm.apartments.language", []);
  const [query] = usePersistentState("crm.apartments.q", "");

  function loadApartmentsTotal() {
    setApartmentsError(false);
    const defaultFilters = (user?.organization?.shliach_view_config?.default_filters ?? {}) as {
      area_ids?: number[];
      building_ids?: number[];
      jewish_status?: string[];
      mezuzah_status?: string[];
      language?: string[];
    };
    const effective = (persisted: number[] | string[], fallback?: (number | string)[]) =>
      persisted.length > 0 ? persisted : fallback ?? [];
    const params = new URLSearchParams();
    effective(areaIds, defaultFilters.area_ids).forEach((id) =>
      params.append("area_ids", String(id)),
    );
    effective(buildingIds, defaultFilters.building_ids).forEach((id) =>
      params.append("building_ids", String(id)),
    );
    reportNumberIds.forEach((id) => params.append("report_number_ids", String(id)));
    effective(jewishFilter, defaultFilters.jewish_status).forEach((v) =>
      params.append("jewish_status", String(v)),
    );
    effective(mezuzahFilter, defaultFilters.mezuzah_status).forEach((v) =>
      params.append("mezuzah_status", String(v)),
    );
    effective(languageFilter, defaultFilters.language).forEach((v) =>
      params.append("language", String(v)),
    );
    if (query.trim()) params.set("q", query.trim());
    params.set("page", "1");
    params.set("page_size", "20");
    // fixes54 §6.1: the shliach's own apartments count — already self-scoped
    // server-side (apartments.py::_shliach_apartment_ids) for this role, so
    // a small page_size is enough to read `total`.
    apiFetch<ApartmentPage>(`/api/apartments/list?${params}`)
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
    setRouteSummary(routeCacheSummary());
    apiFetch<ShliachAnnouncement[]>("/api/shliach-messages/announcements")
      .then(setAnnouncements)
      .catch(() => setAnnouncements([]))
      .finally(() => setAnnouncementsLoading(false));
    apiFetch<CampaignActiveStat[]>("/api/campaigns/active-stats")
      .then(setCampaignStats)
      .catch(() => setCampaignStats([]));
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

      {/* fixes68 §1/EDIT: the entry point into the door-to-door route flow. */}
      <Link href="/dashboard/activist/route">
        <Card className="border-2 border-primary bg-primary/5 p-5 transition-colors hover:bg-primary/10">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Footprints className="h-5 w-5" />
            </div>
            <div className="text-lg font-semibold">
              {t("activist_route.title", "התחל סיבוב")}
            </div>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {routeSummary
              ? t("activist_route.progress", "{done} / {total} דלתות")
                  .replace("{done}", String(routeSummary.done))
                  .replace("{total}", String(routeSummary.total))
              : t(
                  "activist_home.start_route_hint",
                  "סיבוב דלת אחר דלת לדירות המשויכות לך",
                )}
          </p>
        </Card>
      </Link>

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

      {/* fixes58 §3.2/Phase 6: one dynamic stat tile per active campaign,
          same fetch-count-into-tile pattern as "my apartments" above. */}
      {campaignStats.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {campaignStats.map((c) => (
            <Card key={c.id} className="border-2 border-primary/30 p-5">
              <div className="text-lg font-semibold">{c.name}</div>
              {c.custom_stats_text && (
                <p className="mt-2 text-sm text-muted-foreground">
                  {c.custom_stats_text.replace("{{count}}", String(c.count))}
                </p>
              )}
            </Card>
          ))}
        </div>
      )}

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
