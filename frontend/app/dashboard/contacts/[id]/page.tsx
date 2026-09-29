"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowRight, RotateCcw, Settings2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { ContactView, type ContactPatch } from "@/components/ContactView";
import { DonationsEditor } from "@/components/DonationsEditor";
import {
  ReportCompletionModal,
  SystemCommentModal,
} from "@/components/ShliachSelfServiceModals";
import { SignificantDatesEditor } from "@/components/SignificantDatesEditor";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { VisitHistoryEditor } from "@/components/VisitHistoryEditor";
import { VisitSummary } from "@/components/VisitSummary";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useConfirm } from "@/lib/confirm";
import { telHref, waHref } from "@/lib/contactActions";
import { useFieldSettings } from "@/lib/fieldSettings";
import { useLocalization } from "@/lib/localization";
import { useDbPreference } from "@/lib/preferences";
import { useToast } from "@/lib/toast";
import { contactFullName, type Contact, type UserSummary } from "@/lib/types";

/** fixes30 §2b: the orderable page segments; the stored preference is
 *  sanitized against this list (unknown keys dropped, missing appended). */
const SEGMENT_KEYS = ["main", "visits", "visitSummary", "dates", "donations"] as const;
type SegmentKey = (typeof SEGMENT_KEYS)[number];
const DEFAULT_SEGMENT_ORDER: SegmentKey[] = [...SEGMENT_KEYS];

export default function ContactDetailPage() {
  const params = useParams<{ id: string }>();
  const contactId = Number(params.id);
  const router = useRouter();
  const { t } = useLocalization();
  const confirmDialog = useConfirm();
  const { isAdmin, isShliach, isCampaignManager, user, refresh: refreshAuth } = useAuth();
  const { success, error: toastError } = useToast();
  const { isFieldVisible: vis } = useFieldSettings();

  const [contact, setContact] = useState<Contact | null>(null);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [recreating, setRecreating] = useState(false);
  // fixes30 §2b: user-configurable segment order (follows the account).
  const [segmentOrder, setSegmentOrder] = useDbPreference<SegmentKey[]>(
    "contact.segmentOrder", DEFAULT_SEGMENT_ORDER,
  );
  const [orderOpen, setOrderOpen] = useState(false);
  // fixes53 §7: a shliach's own profile starts read-only — "Edit your data"
  // enables inline editing (still subject to ContactView's self-edit locks).
  const [selfEditActive, setSelfEditActive] = useState(false);
  const [completionModalOpen, setCompletionModalOpen] = useState(false);
  const [commentModalOpen, setCommentModalOpen] = useState(false);

  useEffect(() => {
    apiFetch<UserSummary[]>("/api/users").then(setUsers).catch(() => {});
    apiFetch<Contact>(`/api/contacts/${contactId}`)
      .then(setContact)
      .catch(() => setNotFound(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  // fixes26 §2: per-field autosave — the fields edit in place (ContactView),
  // each change lands as its own PATCH. fixes25: Mivtzoim / interactions /
  // custom fields are logged per visit, not on the contact.
  async function patchContact(partial: ContactPatch) {
    const fresh = await apiFetch<Contact>(`/api/contacts/${contactId}`, {
      method: "PATCH",
      body: JSON.stringify(partial),
    });
    setContact(fresh);
    // Bug fix: a shliach editing their OWN profile here (self-edit) can
    // change the name backend/app/routers/auth.py's GET /api/auth/me
    // display_name is resolved from — but AuthContext.user is only
    // populated at login/mount, so the header kept showing the pre-edit
    // name until a full reload. Same pattern already used after an
    // org-settings save (dashboard/settings/page.tsx) that touches cached
    // auth data. /me also falls back to a same-org contact carrying the
    // user's email (admins/staff), so that self-edit counts too.
    const myEmail = user?.email?.toLowerCase();
    const isSelf =
      (isShliach && user?.shliach?.contact_id === contactId) ||
      (!!myEmail &&
        [contact?.email, fresh.email].some((e) => e?.toLowerCase() === myEmail));
    if (isSelf) {
      refreshAuth().catch(() => {});
    }
  }

  async function remove() {
    if (!(await confirmDialog({ message: t("msg.delete_contact_confirm", "למחוק את איש הקשר? פעולה זו אינה הפיכה.") })))
      return;
    await apiFetch(`/api/contacts/${contactId}`, { method: "DELETE" });
    success(t("msg.deleted", "נמחק"));
    // fixes15 §3.1: return to the page that manages this record — deleting a
    // shliach (a login user) used to incorrectly dump the admin in Contacts.
    router.push(
      contact?.contact_type === "shliach" ? "/dashboard/users" : "/dashboard/contacts",
    );
  }

  // fixes26 §4: one-click recovery of a suspended/deleted shliach login.
  async function recreateLogin() {
    if (!contact?.email || recreating) return;
    setRecreating(true);
    try {
      await apiFetch("/api/users/recreate", {
        method: "POST",
        body: JSON.stringify({ email: contact.email }),
      });
      const fresh = await apiFetch<Contact>(`/api/contacts/${contactId}`);
      setContact(fresh);
      success(t("users.user_recreated", "המשתמש נוצר מחדש"));
    } catch (err) {
      toastError(
        err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"),
      );
    } finally {
      setRecreating(false);
    }
  }

  if (notFound)
    return <p className="text-muted-foreground">{t("page.contact_not_found", "איש הקשר לא נמצא.")}</p>;
  if (!contact) return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;

  const loginSuspended =
    contact.contact_type === "shliach" &&
    contact.shliach != null &&
    contact.shliach.login_status != null &&
    contact.shliach.login_status !== "active";

  // fixes53 §7: the viewer is a shliach looking at their own linked contact
  // — "Edit your data" gates editing, and Email/Areas/Report Numbers (plus
  // any admin-configured extras) stay locked even once editing is on.
  const isOwnShliachProfile = isShliach && user?.shliach?.contact_id === contact.id;
  const selfEditLockedFields = new Set(
    user?.organization?.shliach_view_config?.self_edit_locked_fields ?? [],
  );

  // fixes30 §2b: sanitized effective order + reorder handler.
  const order: SegmentKey[] = [
    ...segmentOrder.filter((k) => SEGMENT_KEYS.includes(k)),
    ...SEGMENT_KEYS.filter((k) => !segmentOrder.includes(k)),
  ];
  function moveSegment(key: SegmentKey, delta: -1 | 1) {
    const idx = order.indexOf(key);
    const to = idx + delta;
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    [next[idx], next[to]] = [next[to], next[idx]];
    setSegmentOrder(next);
  }
  const segmentLabels: Record<SegmentKey, string> = {
    main: t("contact.segment_main", "תצוגה עיקרית של איש קשר"),
    visits: t("visit.history", "היסטורית ביקורים"),
    visitSummary: t("nav.visit_summary", "סיכום ביקורים"),
    dates: t("significant_dates", "תאריכים חשובים"),
    donations: t("donation.history", "היסטורית תרומות"),
  };

  // Each segment keeps its own visibility rule; the order only rearranges
  // whichever of them render. Per repeated user feedback, the colored border
  // per SECTION (fixes52 §1) was the wrong reading of "make it easier to
  // read" — reverted to a plain shadow card, matching every other card in
  // the app; readability now comes from bordering each FIELD instead (see
  // ContactView.tsx).
  function renderSegment(key: SegmentKey) {
    switch (key) {
      case "main":
        return (
          <section
            key="main"
            className="bg-card border border-border rounded-xl shadow-sm p-6"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">
                {contact!.contact_type === "shliach"
                  ? t("page.shliach_details", "פרטי פעיל")
                  : t("page.contact_details", "פרטי איש קשר")}
              </h2>
              {/* fixes53 §7: an activist's own profile starts read-only; this
                  button is what turns on inline editing (mandatory-locked
                  fields stay locked even after). */}
              {isOwnShliachProfile && !selfEditActive && (
                <Button type="button" size="sm" onClick={() => setSelfEditActive(true)}>
                  {t("contact.edit_your_data", "עריכת המידע שלך")}
                </Button>
              )}
            </div>
            {/* fixes26 §2: inline editing replaces the edit-mode form — click a
                value to change it; it saves on click-away / Enter. */}
            <ContactView
              contact={contact!}
              users={users}
              onPatch={isOwnShliachProfile && !selfEditActive ? undefined : patchContact}
              isSelfEdit={isOwnShliachProfile}
              lockedFieldKeys={selfEditLockedFields}
            />
            {/* fixes53 §7: report-completion + system-feedback — independent
                of the profile-edit toggle above, always available. */}
            {isOwnShliachProfile && (
              <div className="mt-5 pt-4 border-t border-border flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-primary text-primary hover:bg-primary/10"
                  onClick={() => setCompletionModalOpen(true)}
                >
                  {t("shliach_msg.report_completed_btn", "דיווח על השלמת הדוח")}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setCommentModalOpen(true)}>
                  {t("shliach_msg.system_comment_btn", "הערות על המערכת")}
                </Button>
              </div>
            )}
          </section>
        );
      case "visits":
        // fixes25: interactions/Mivtzoim are logged per visit.
        if (contact!.contact_type !== "mekurav") return null;
        return (
          <section
            key="visits"
            className="bg-card border border-border rounded-xl shadow-sm p-6"
          >
            <h2 className="font-semibold mb-4">{t("visit.history", "היסטורית ביקורים")}</h2>
            <VisitHistoryEditor contactId={contact!.id} />
          </section>
        );
      case "visitSummary":
        // fixes38 §1.3: same scoping as the "visits" segment.
        if (contact!.contact_type !== "mekurav") return null;
        return (
          <section
            key="visitSummary"
            className="bg-card border border-border rounded-xl shadow-sm p-6"
          >
            <h2 className="font-semibold mb-4">{t("nav.visit_summary", "סיכום ביקורים")}</h2>
            <VisitSummary contactId={contact!.id} />
          </section>
        );
      case "dates":
        if (contact!.contact_type !== "mekurav") return null;
        return (
          <section
            key="dates"
            className="bg-card border border-border rounded-xl shadow-sm p-6"
          >
            <h2 className="font-semibold mb-4">{t("significant_dates", "תאריכים חשובים")}</h2>
            <SignificantDatesEditor contactId={contact!.id} />
          </section>
        );
      case "donations":
        // fixes18 §3.1: donations are mekurav relationship data, admin-only.
        if (!isAdmin || contact!.contact_type !== "mekurav") return null;
        return (
          <section
            key="donations"
            className="bg-card border border-border rounded-xl shadow-sm p-6"
          >
            <h2 className="font-semibold mb-4">{t("donation.history", "היסטורית תרומות")}</h2>
            <DonationsEditor contactId={contact!.id} />
          </section>
        );
    }
  }

  // fixes58 §3.7: Campaign Manager never gets Contacts (Volunteer/shliach
  // management goes through the Users page, not this one) — same direct-URL
  // gap fix as the Contacts list page.
  if (isCampaignManager) {
    return (
      <p className="text-status-darkred">
        {t("page.admins_only", "אין לך הרשאה לעמוד זה (מנהלים בלבד).")}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* fixes54 §3.3: the "back to activists" link is gone — "activists"
            have no standalone list page any more (that nav entry merged into
            Users, fixes42 §4A), and for a shliach viewing their own profile
            it pointed at an admin-only page that would just bounce them.
            A non-shliach contact still gets its "back to contacts" link. */}
        {contact.contact_type !== "shliach" ? (
          <Link
            href="/dashboard/contacts"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
          >
            <ArrowRight className="h-4 w-4" /> {t("page.back_to_contacts", "חזרה לאנשי קשר")}
          </Link>
        ) : (
          <span />
        )}
        {/* fixes64 §4: an activist's own page drops the segment-reorder and
            delete buttons — reordering is pointless once the mekurav-only
            segments (visits/dates/donations) are already hidden below, and
            removing a shliach login belongs on the Users page instead. */}
        {contact.contact_type !== "shliach" && (
          <div className="flex items-center gap-2">
            {/* fixes30 §2b: open the segment-order configuration. */}
            <Button variant="outline" size="sm" onClick={() => setOrderOpen((v) => !v)}>
              <Settings2 className="h-4 w-4" /> {t("contact.display_order", "סדר תצוגה")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-status-darkred/30 text-status-darkred hover:bg-status-darkred/10"
              onClick={remove}
            >
              <Trash2 className="h-4 w-4" /> {t("action.delete", "מחק")}
            </Button>
          </div>
        )}
      </div>

      {/* fixes30 §2b: reorder the page segments; saved to the account. */}
      {orderOpen && (
        <div className="bg-card border border-border rounded-xl shadow-sm p-4 space-y-2">
          <h3 className="text-sm font-semibold">
            {t("contact.display_order", "סדר תצוגה")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t(
              "contact.display_order_hint",
              "קבע את סדר הקטעים בכרטיס איש הקשר. ההעדפה נשמרת בחשבון שלך.",
            )}
          </p>
          <ul className="space-y-1.5">
            {order.map((k, i) => (
              <li
                key={k}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-1.5 text-sm"
              >
                <span>
                  <span className="text-muted-foreground me-2">{i + 1}.</span>
                  {segmentLabels[k]}
                </span>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={i === 0}
                    onClick={() => moveSegment(k, -1)}
                    title={t("action.move_up", "העלה")}
                    className="rounded border border-border px-2 py-0.5 hover:bg-accent disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={i === order.length - 1}
                    onClick={() => moveSegment(k, 1)}
                    title={t("action.move_down", "הורד")}
                    className="rounded border border-border px-2 py-0.5 hover:bg-accent disabled:opacity-30"
                  >
                    ↓
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* fixes26 §4: a shliach whose login was deleted or disabled gets a
          prominent notice + one-click recovery (admins only). */}
      {loginSuspended && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-status-darkred/40 bg-status-darkred/10 px-4 py-3">
          <span className="text-sm font-medium text-status-darkred">
            {t("users.login_suspended", "הכניסה למערכת הושעתה")}
          </span>
          {isAdmin && contact.email && (
            <Button
              type="button"
              size="sm"
              className="bg-status-darkred hover:bg-status-darkred/90"
              onClick={recreateLogin}
              disabled={recreating}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {recreating
                ? t("action.saving", "שומר…")
                : t("users.recreate_user", "צור משתמש מחדש")}
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{contactFullName(contact)}</h1>
        {/* fixes17 §2.1: one-click call / WhatsApp / mail from the profile.
            fixes38 §3.1: each icon now has its own Manage Fields toggle. */}
        <span className="flex items-center gap-2">
          {contact.phone && vis("contacts.action_call") && (
            <a
              href={telHref(contact.phone)}
              title={t("action.call", "חיוג")}
              className="rounded-full border border-border px-2.5 py-1.5 text-sm leading-none hover:bg-status-green/10"
            >
              📞 {t("action.call", "חיוג")}
            </a>
          )}
          {contact.phone && vis("contacts.action_whatsapp") && (
            <a
              href={waHref(contact.phone)}
              target="_blank"
              rel="noopener noreferrer"
              title={t("action.whatsapp", "וואטסאפ")}
              className="rounded-full border border-border px-2.5 py-1.5 text-sm leading-none hover:bg-status-green/10"
            >
              💬 {t("action.whatsapp", "וואטסאפ")}
            </a>
          )}
          {contact.email && vis("contacts.action_email") && (
            <a
              href={`mailto:${contact.email}`}
              title={t("action.send_email", "שליחת מייל")}
              className="rounded-full border border-border px-2.5 py-1.5 text-sm leading-none hover:bg-primary/10"
            >
              ✉ {t("action.send_email", "שליחת מייל")}
            </a>
          )}
        </span>
      </div>

      {/* fixes19 §2: the "apartments covered by the activist" grid is gone —
          shluchim associate with report numbers (shown in the details card).
          fixes30 §2b: the segments render in the user's configured order. */}
      {order.map(renderSegment)}

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
