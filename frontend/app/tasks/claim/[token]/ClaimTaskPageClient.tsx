"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { CheckCircle2, Loader2, Lock, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { ActivistRegisterForm, OrgSignInForm } from "@/components/public/PublicAuthForms";
import { WaveRule } from "@/components/public/WaveRule";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { setPageOrg } from "@/lib/pageOrg";
import { forgetClaimToken, rememberClaimToken } from "@/lib/pendingClaim";
import type { ClaimInfo, ClaimResult, ClaimState } from "@/lib/types";

type Outcome = ClaimState | "wrong_org" | "not_activist";

/** fixes65 §4: where an orphan task sheet's QR code lands.
 *  - signed out → task summary + register (auto-claims) or sign in;
 *  - signed-in activist of the task's org → claimed on arrival;
 *  - fixes66 §2: an assigned task's sheet carries the same QR as the
 *    activist's door into the system — signed out, it offers sign-in and
 *    the owner lands on "this task is yours";
 *  - already theirs / someone else's / office-handled / expired → a clear
 *    final message. */
export function ClaimTaskPageClient() {
  const { token } = useParams<{ token: string }>();
  const { t } = useLocalization();
  const { user, loading } = useAuth();
  const [info, setInfo] = useState<ClaimInfo | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [mode, setMode] = useState<"register" | "signin">("register");
  const claiming = useRef(false);
  // A final outcome set by a form callback wins over a later re-fetch
  // triggered by the same sign-in (which would otherwise say "already
  // yours" right after "claimed").
  const outcomeRef = useRef<Outcome | null>(null);

  useEffect(() => {
    rememberClaimToken(token);
  }, [token]);

  // The browser tab shows the task's org name + logo (TitleManager owns both).
  useEffect(() => {
    setPageOrg(
      info?.organization_name
        ? { name: info.organization_name, logoUrl: info.organization_logo_url }
        : null,
    );
    return () => setPageOrg(null);
  }, [info?.organization_name, info?.organization_logo_url]);

  const settle = useCallback((o: Outcome) => {
    outcomeRef.current = o;
    setOutcome(o);
    if (o !== "available") forgetClaimToken();
  }, []);

  const runClaim = useCallback(async () => {
    if (claiming.current) return;
    claiming.current = true;
    try {
      const res = await apiFetch<ClaimResult>(`/api/tasks/claim/${encodeURIComponent(token)}`, {
        method: "POST",
      });
      settle(res.detail && res.state === "available" ? "not_activist" : res.state);
    } catch {
      settle("invalid");
    } finally {
      claiming.current = false;
    }
  }, [token, settle]);

  // Load the task summary once auth has settled (the state is relative to
  // the signed-in user when there is one), then claim straight away when
  // an activist of this org opened the link.
  useEffect(() => {
    if (loading) return;
    let active = true;
    apiFetch<ClaimInfo>(`/api/public/claim/${encodeURIComponent(token)}`)
      .then((res) => {
        if (!active) return;
        setInfo(res);
        if (outcomeRef.current === "claimed") return;
        // fixes66 §2: signed out on an activist's own task — offer sign-in
        // (below) instead of the "taken" dead end; once signed in, the
        // re-fetch answers "yours" (the owner) or "taken" (anyone else).
        if (res.state === "taken" && res.has_activist && !user) return;
        if (res.state !== "available") {
          settle(res.state);
          return;
        }
        if (!user) return; // show register / sign-in
        if (user.organization_id !== res.organization_id) settle("wrong_org");
        else if (user.role !== "shliach") settle("not_activist");
        else runClaim();
      })
      .catch(() => active && settle("invalid"));
    return () => {
      active = false;
    };
  }, [token, user, loading, runClaim, settle]);

  const summary = info && info.state !== "invalid" && (
    <div className="glass-card px-5 py-5">
      <div className="flex items-center gap-3">
        {info.organization_logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={info.organization_logo_url} alt="" className="h-10 w-10 rounded-lg bg-white/90 object-contain p-1" />
        )}
        <p className="text-sm text-muted-foreground">{info.organization_name}</p>
      </div>
      <h1 className="mt-3 font-[family-name:var(--font-frank-ruhl)] text-3xl font-bold leading-tight text-foreground">
        {info.campaign_name || t("claim.task", "משימה")}
      </h1>
      <WaveRule className="mt-2 h-3 w-24" />
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-muted-foreground">{t("task.report_numbers", "מספרי דוח")}</dt>
          <dd className="mt-0.5 font-medium">{info.report_number_names.join(", ") || "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("claim.apartments", "דירות במשימה")}</dt>
          <dd className="mt-0.5 font-medium">{info.apartment_count}</dd>
        </div>
      </dl>
    </div>
  );

  let body: ReactNode;
  if (!info || loading || (outcome === null && user && info.state === "available")) {
    body = (
      <div className="flex justify-center py-10 text-primary" aria-busy="true">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  } else if (outcome === "claimed" || outcome === "yours") {
    body = (
      <Notice tone="good" icon={<CheckCircle2 className="h-6 w-6" />}>
        <p className="text-lg font-semibold">
          {outcome === "claimed"
            ? t("claim.success", "המשימה שלך!")
            : t("claim.already_yours", "המשימה הזו כבר שלך.")}
        </p>
        <p className="mt-1 text-sm opacity-80">
          {t("claim.success_hint", "הדירות של המשימה מופיעות עכשיו באזור האישי שלך.")}
        </p>
        <Link
          href="/dashboard"
          className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-gradient-to-b from-primary/95 to-primary px-4 py-3 font-semibold text-primary-foreground shadow-glow transition-all hover:from-primary hover:to-primary/85"
        >
          {t("claim.open_my_tasks", "למשימות שלי")}
        </Link>
      </Notice>
    );
  } else if (outcome === null && info.state === "taken" && info.has_activist && !user) {
    // fixes66 §2: signed out on an assigned task — the activist's way in.
    body = (
      <section className="glass-card p-5">
        <h2 className="text-lg font-semibold text-foreground">
          {t("claim.assigned_signin_title", "המשימה משויכת לפעיל — התחברו כדי לפתוח אותה")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "claim.assigned_signin_hint",
            "זו המשימה שלכם? התחברו עם החשבון שלכם ותגיעו ישר לדירות של המשימה.",
          )}
        </p>
        <div className="mt-4">
          <OrgSignInForm organizationId={info.organization_id!} onSignedIn={() => undefined} />
        </div>
      </section>
    );
  } else if (outcome === "taken") {
    body = (
      <Notice tone="locked" icon={<Lock className="h-6 w-6" />}>
        <p className="text-lg font-semibold">{t("claim.locked_title", "המשימה כבר נלקחה")}</p>
        <p className="mt-1 text-sm opacity-80">
          {t(
            "claim.locked",
            "המשימה כבר שויכה לפעיל אחר או שהמשרד מטפל בה. לפרטים אפשר לפנות לרכז/ת.",
          )}
        </p>
      </Notice>
    );
  } else if (outcome === "wrong_org" || outcome === "not_activist") {
    body = (
      <Notice tone="locked" icon={<TriangleAlert className="h-6 w-6" />}>
        <p className="text-sm">
          {outcome === "wrong_org"
            ? t("claim.wrong_org", "את/ה מחובר/ת לארגון אחר. יש להתנתק ולהתחבר עם החשבון של הארגון הזה.")
            : t("claim.not_activist", "רק פעילים יכולים לקחת משימה דרך הקוד. מנהלים משייכים משימות מעמוד המשימות.")}
        </p>
      </Notice>
    );
  } else if (outcome === "invalid" || info.state === "invalid") {
    body = (
      <Notice tone="locked" icon={<TriangleAlert className="h-6 w-6" />}>
        <p className="text-lg font-semibold">{t("claim.link_invalid", "הקישור למשימה אינו בתוקף עוד.")}</p>
        <p className="mt-1 text-sm opacity-80">
          {t("claim.link_invalid_hint", "ייתכן שהמשימה הסתיימה או נמחקה.")}
        </p>
      </Notice>
    );
  } else {
    // Signed out, task available.
    body = (
      <section className="glass-card p-5">
        <h2 className="text-lg font-semibold text-foreground">
          {mode === "register"
            ? t("claim.register_title", "נרשמים ומקבלים את המשימה")
            : t("claim.signin_title", "מתחברים ומקבלים את המשימה")}
        </h2>
        <div className="mt-4">
          {mode === "register" ? (
            <ActivistRegisterForm
              claimToken={token}
              organizationId={info.organization_id ?? undefined}
              onRegistered={(res) => settle(res.claim_state ?? "invalid")}
            />
          ) : (
            <OrgSignInForm organizationId={info.organization_id!} onSignedIn={() => undefined} />
          )}
        </div>
        <button
          type="button"
          onClick={() => setMode(mode === "register" ? "signin" : "register")}
          className="mt-5 w-full text-center text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {mode === "register"
            ? t("claim.have_account", "כבר יש לך חשבון? התחברות")
            : t("claim.no_account", "אין לך חשבון? הרשמה")}
        </button>
      </section>
    );
  }

  return (
    <main className="min-h-screen px-4 py-8">
      <div className="mx-auto max-w-md space-y-4">
        {summary}
        {body}
      </div>
    </main>
  );
}

function Notice({
  tone,
  icon,
  children,
}: {
  tone: "good" | "locked";
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      className="glass-card flex gap-3 p-5"
    >
      <span className={tone === "good" ? "text-success" : "text-destructive"}>{icon}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}
