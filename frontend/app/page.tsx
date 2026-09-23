"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogIn, Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { ApiError, getToken, resendVerification } from "@/lib/api";
import { useAuth, type LoginOrgOption } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { pendingClaimToken } from "@/lib/pendingClaim";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { LanguageToggle } from "@/components/LanguageToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Post-login destination from ?redirect= (fixes8 §3), restricted to internal
 *  paths — absolute and protocol-relative URLs fall back to the dashboard. */
function loginTarget(): string {
  if (typeof window === "undefined") return "/dashboard";
  const target = new URLSearchParams(window.location.search).get("redirect");
  if (target && target.startsWith("/") && !target.startsWith("//")) return target;
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
  useEffect(() => {
    if (getToken() || user) router.replace(loginTarget());
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
      if (err instanceof ApiError && err.status === 403) {
        setUnverified(true);
        setError(t("auth.verify_email_first"));
      } else {
        setError(err instanceof Error ? err.message : t("auth.login_failed"));
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
      if (err instanceof ApiError && err.status === 403) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : t("auth.login_failed"));
      }
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
      setError(err instanceof Error ? err.message : t("auth.login_failed"));
    } finally {
      setBusy(false);
    }
  }

  if (orgOptions) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-card rounded-xl shadow-md p-8 space-y-5">
          <div className="text-center">
            <h1 className="text-2xl font-bold">
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
                  className="w-full flex items-center gap-3 rounded-xl border border-border px-4 py-3 text-start transition-colors hover:border-primary/30 hover:bg-primary/5 disabled:opacity-50"
                >
                  {org.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={org.logo_url}
                      alt=""
                      className="h-8 w-8 rounded-md object-contain border border-border bg-card"
                    />
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background">
                      🏢
                    </span>
                  )}
                  <span className="font-medium">{org.name}</span>
                </button>
              </li>
            ))}
          </ul>
          {error && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
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
    <main className="min-h-screen flex items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-card rounded-xl shadow-md p-8 space-y-5"
      >
        <div className="flex justify-end">
          <LanguageToggle />
        </div>
        <div className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <LogIn className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold">{t("auth.app_title", "מיני CRM")}</h1>
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
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            className="h-11"
          />
        </div>

        {error && (
          <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
            {error}
          </p>
        )}

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
              className="w-full border-primary text-primary hover:bg-primary/5"
              onClick={() => resendEmail && resendVerification(resendEmail)}
            >
              {t("auth.resend_verification")}
            </Button>
          </div>
        )}

        <Button type="submit" disabled={busy} className="w-full h-11 font-medium">
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
          <span className="h-px flex-1 bg-border" />
          {t("common.or", "או")}
          <span className="h-px flex-1 bg-border" />
        </div>

        <GoogleSignInButton onCredential={onGoogleCredential} onError={setError} />

        <p className="text-center text-sm text-muted-foreground">
          {t("auth.no_account")}{" "}
          <Link href="/signup" className="text-primary hover:underline">
            {t("auth.open_org_account")}
          </Link>
        </p>
      </form>
    </main>
  );
}
