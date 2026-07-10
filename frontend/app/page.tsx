"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { ApiError, getToken, resendVerification } from "@/lib/api";
import { useAuth, type LoginOrgOption } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { LanguageToggle } from "@/components/LanguageToggle";

/** Post-login destination from ?redirect= (fixes8 §3), restricted to internal
 *  paths — absolute and protocol-relative URLs fall back to the dashboard. */
function loginTarget(): string {
  if (typeof window === "undefined") return "/dashboard";
  const target = new URLSearchParams(window.location.search).get("redirect");
  if (target && target.startsWith("/") && !target.startsWith("//")) return target;
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
        return;
      }
      router.replace(loginTarget());
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
        return;
      }
      router.replace(loginTarget());
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
      const orgs = googleCredential
        ? await signInWithGoogle(googleCredential, orgId)
        : await signIn(username, password, orgId);
      if (!orgs) router.replace(loginTarget());
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.login_failed"));
    } finally {
      setBusy(false);
    }
  }

  if (orgOptions) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-white rounded-xl shadow-md p-8 space-y-5">
          <div className="text-center">
            <h1 className="text-2xl font-bold">
              {t("auth.select_org_title", "בחירת ארגון")}
            </h1>
            <p className="mt-1 text-sm text-gray-500">
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
                  className="w-full flex items-center gap-3 rounded-lg border border-gray-200 px-4 py-3 text-start hover:border-status-magenta hover:bg-status-magenta/5 disabled:opacity-50"
                >
                  {org.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={org.logo_url}
                      alt=""
                      className="h-8 w-8 rounded-md object-contain border border-gray-200 bg-white"
                    />
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-gray-50">
                      🏢
                    </span>
                  )}
                  <span className="font-medium">{org.name}</span>
                </button>
              </li>
            ))}
          </ul>
          {error && (
            <p className="text-sm text-status-darkred bg-red-50 rounded-md px-3 py-2">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={() => {
              setOrgOptions(null);
              setGoogleCredential(null);
              setError("");
            }}
            className="w-full rounded-md border border-gray-300 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            {t("auth.select_org_back", "חזרה להתחברות")}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-white rounded-xl shadow-md p-8 space-y-5"
      >
        <div className="flex justify-end">
          <LanguageToggle />
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-bold">{t("auth.app_title", "מיני CRM")}</h1>
          <p className="mt-1 text-sm text-gray-500">{t("auth.login_subtitle")}</p>
        </div>

        <div className="space-y-1">
          <label htmlFor="username" className="block text-sm font-medium">
            {t("auth.username")}
          </label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
            className="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className="block text-sm font-medium">
            {t("auth.password")}
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            className="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta"
          />
        </div>

        {error && (
          <p className="text-sm text-status-darkred bg-red-50 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        {unverified && (
          <div className="space-y-2">
            <input
              type="email"
              dir="ltr"
              placeholder={t("auth.your_email")}
              value={resendEmail}
              onChange={(e) => setResendEmail(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => resendEmail && resendVerification(resendEmail)}
              className="w-full rounded-md border border-status-magenta text-status-magenta py-2 text-sm hover:bg-status-magenta/5"
            >
              {t("auth.resend_verification")}
            </button>
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-status-magenta text-white py-2 font-medium hover:opacity-90 disabled:opacity-50"
        >
          {busy ? t("auth.logging_in") : t("auth.login")}
        </button>

        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span className="h-px flex-1 bg-gray-200" />
          {t("common.or", "או")}
          <span className="h-px flex-1 bg-gray-200" />
        </div>

        <GoogleSignInButton onCredential={onGoogleCredential} onError={setError} />

        <p className="text-center text-sm text-gray-500">
          {t("auth.no_account")}{" "}
          <Link href="/signup" className="text-status-magenta hover:underline">
            {t("auth.open_org_account")}
          </Link>
        </p>
      </form>
    </main>
  );
}
