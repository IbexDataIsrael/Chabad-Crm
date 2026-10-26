"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogIn, Loader2, Building2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { ApiError, resendVerification } from "@/lib/api";
import { authErrorText } from "@/lib/authErrors";
import { useAuth, type LoginOrgOption } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { pendingClaimToken } from "@/lib/pendingClaim";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { LanguageToggle } from "@/components/LanguageToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/PasswordInput";

/** Post-login destination from ?redirect= (fixes8 §3), restricted to internal
 *  paths — absolute and protocol-relative URLs fall back to the dashboard. */
// Activist-only screens. The ?redirect= is captured from whoever's session
// just ended — on a shared device that's often a different person than the
// one logging in now, so e.g. a superadmin used to land on an activist's
// street2 screen.
const ACTIVIST_ONLY_PREFIXES = ["/dashboard/street", "/dashboard/activist"];

function loginTarget(role: string): string {
  if (typeof window === "undefined") return "/dashboard";
  const target = new URLSearchParams(window.location.search).get("redirect");
  if (target && target.startsWith("/") && !target.startsWith("//")) {
    const activistOnly = ACTIVIST_ONLY_PREFIXES.some((p) => target.startsWith(p));
    const superadminMismatch = role === "superadmin" && !target.startsWith("/dashboard/admin");
    if (!(activistOnly && role !== "shliach") && !superadminMismatch) return target;
    return "/dashboard";
  }
  // fixes65 §4: a QR claim interrupted by a trip to this login screen.
  const claimToken = pendingClaimToken();
  if (claimToken) return `/tasks/claim/${encodeURIComponent(claimToken)}`;
  return "/dashboard";
}

export default function LoginPage() {
  const { signIn, signInWithGoogle, user } = useAuth();
  const { t } = useLocalization();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [unverified, setUnverified] = useState(false);
  const [resendEmail, setResendEmail] = useState("");
  const [busy, setBusy] = useState(false);
  // fixes14: when the identity spans several orgs, login pauses on a selection
  // screen. The Google credential is kept for the second (org-scoped) call.
  const [orgOptions, setOrgOptions] = useState<LoginOrgOption[] | null>(null);
  const [googleCredential, setGoogleCredential] = useState<string | null>(null);

  // Already authenticated → go straight to the intended page (or dashboard).
  // Waits for `user` (not just a stored token) so the target can be checked
  // against the role of whoever actually signed in.
  useEffect(() => {
    if (user) router.replace(loginTarget(user.role));
  }, [user, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setUnverified(false);
    setBusy(true);
    try {
      const orgs = await signIn(username, password);
      if (orgs) {
        setGoogleCredential(null);
        setOrgOptions(orgs);
      }
      // On success (orgs === null) the "already authenticated" effect below
      // fires from the `user` state update and performs the redirect — a
      // second, explicit router.replace() here raced it (two concurrent
      // navigations to the same target could cancel a *later* router.replace
      // from a child page, e.g. superadmin's /dashboard -> /dashboard/admin
      // hop, leaving the app stuck on the loading state).
    } catch (err) {
      // fixes75 §8: every message goes through the translation table.
      if (err instanceof ApiError && err.code === "auth.error.not_verified") {
        setUnverified(true);
        setError(t("auth.verify_email_first", "עליך לאמת את כתובת האימייל לפני ההתחברות."));
      } else {
        setError(authErrorText(err, t));
      }
    } finally {
      setBusy(false);
    }
  }

  async function onGoogleCredential(credential: string) {
    setError("");
    setUnverified(false);
    setBusy(true);
    try {
      const orgs = await signInWithGoogle(credential);
      if (orgs) {
        setGoogleCredential(credential);
        setOrgOptions(orgs);
      }
      // See onSubmit: redirect is handled solely by the effect below.
    } catch (err) {
      setError(authErrorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  // fixes14: complete the login into the explicitly chosen organization.
  async function onSelectOrg(orgId: number) {
    setError("");
    setBusy(true);
    try {
      // See onSubmit: redirect is handled solely by the effect below (it
      // fires once `user` is set, whichever branch resolves it).
      await (googleCredential
        ? signInWithGoogle(googleCredential, orgId)
        : signIn(username, password, orgId));
    } catch (err) {
      setError(authErrorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  if (orgOptions) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="glass-card w-full max-w-sm space-y-5 p-8">
          <div className="text-center">
            <h1 className="font-display text-4xl font-bold tracking-wide">
              {t("auth.select_org_title", "בחירת ארגון")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(
                "auth.select_org_subtitle",
                "החשבון שלך מקושר למספר ארגונים. יש לבחור לאיזה ארגון להתחבר.",
              )}
            </p>
          </div>
          <ul className="space-y-2">
            {orgOptions.map((org) => (
              <li key={org.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onSelectOrg(org.id)}
                  className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-start transition-colors hover:border-primary/40 hover:bg-primary/10 disabled:opacity-50"
                >
                  {org.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={org.logo_url}
                      alt=""
                      className="h-8 w-8 rounded-md border border-white/10 bg-card object-contain"
                    />
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-white/5">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                    </span>
                  )}
                  <span className="font-medium">{org.name}</span>
                </button>
              </li>
            ))}
          </ul>
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => {
              setOrgOptions(null);
              setGoogleCredential(null);
              setError("");
            }}
          >
            {t("auth.select_org_back", "חזרה להתחברות")}
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen">
      {/* Brand panel — desktop only. Decorative SVG rings + display type;
          the page content reads fine without it on mobile. */}
      <div className="relative hidden flex-1 items-center justify-center overflow-hidden lg:flex">
        {/* Decorative concentric rings, fading toward the edges. */}
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 m-auto h-[46rem] w-[46rem] opacity-60"
          viewBox="0 0 800 800"
          fill="none"
        >
          <defs>
            <radialGradient id="login-rings" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.22" />
              <stop offset="55%" stopColor="hsl(var(--primary))" stopOpacity="0.05" />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="400" cy="400" r="380" stroke="hsl(var(--border))" strokeWidth="1.5" />
          <circle cx="400" cy="400" r="300" stroke="hsl(var(--border))" strokeWidth="1" strokeDasharray="3 9" />
          <circle cx="400" cy="400" r="220" stroke="hsl(var(--muted-foreground))" strokeOpacity="0.5" strokeWidth="1" />
          <circle cx="400" cy="400" r="140" stroke="hsl(var(--primary))" strokeOpacity="0.45" strokeWidth="1" strokeDasharray="2 6" />
          <circle cx="400" cy="400" r="380" fill="url(#login-rings)" />
        </svg>
        <div className="relative max-w-md px-10 text-center">
          <span className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-b from-primary/95 to-primary shadow-glow">
            <Building2 className="h-8 w-8 text-primary-foreground" />
          </span>
          <h1 className="font-display text-7xl font-bold leading-none tracking-wide text-foreground">
            {t("auth.app_title", "נקודות יהודיות")}
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">{t("auth.login_subtitle")}</p>
          <div className="mx-auto mt-8 h-px w-40 bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center p-6">
        <form
          onSubmit={onSubmit}
          className="glass-card w-full max-w-sm space-y-5 p-8"
        >
          <div className="flex justify-end">
            <LanguageToggle />
          </div>
          <div className="text-center lg:hidden">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <LogIn className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-bold">{t("auth.app_title", "נקודות יהודיות")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("auth.login_subtitle")}</p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="username">{t("auth.username")}</Label>
            <Input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              className="h-11"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="password">{t("auth.password")}</Label>
            <PasswordInput
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="h-11"
            />
          </div>

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          {/* fixes75 §7 */}
          <p className="text-end text-sm">
            <Link href="/forgot-password" className="text-primary hover:underline">
              {t("auth.forgot_password", "שכחת סיסמה?")}
            </Link>
          </p>

          {unverified && (
            <div className="space-y-2">
              <Input
                type="email"
                dir="ltr"
                placeholder={t("auth.your_email")}
                value={resendEmail}
                onChange={(e) => setResendEmail(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                className="w-full border-primary/50 text-primary hover:bg-primary/10"
                onClick={() => resendEmail && resendVerification(resendEmail)}
              >
                {t("auth.resend_verification")}
              </Button>
            </div>
          )}

          <Button type="submit" disabled={busy} className="h-11 w-full font-medium">
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("auth.logging_in")}
              </>
            ) : (
              t("auth.login")
            )}
          </Button>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-white/10" />
            {t("common.or", "או")}
            <span className="h-px flex-1 bg-white/10" />
          </div>

          <GoogleSignInButton onCredential={onGoogleCredential} onError={setError} />

          <p className="text-center text-sm text-muted-foreground">
            {t("auth.no_account")}{" "}
            <Link href="/signup" className="text-primary hover:underline">
              {t("auth.open_org_account")}
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}
