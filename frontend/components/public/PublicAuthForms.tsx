"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";

import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { apiFetch, ApiError } from "@/lib/api";
import { authErrorText } from "@/lib/authErrors";
import { googleClientId } from "@/lib/google";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { isValidEmail } from "@/lib/validation";
import { PasswordInput } from "@/components/ui/PasswordInput";
import type { PublicRegisterResponse } from "@/lib/types";

/** fixes65: shared by the org landing page (/org/<slug>) and the QR claim
 *  page (/tasks/claim/<token>) — the bay-toned public look, not the
 *  dashboard's card styling. */

export const publicInputClass =
  "block w-full rounded-lg border border-[#0E3B4A]/20 bg-white px-3.5 py-2.5 text-[15px] text-[#13232B] " +
  "placeholder:text-[#13232B]/35 focus:border-[#1692C0] focus:outline-none focus:ring-2 focus:ring-[#1692C0]/25";

const primaryButtonClass =
  "inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#D99A2B] px-4 py-3 text-[15px] font-semibold " +
  "text-[#13232B] transition-colors hover:bg-[#C98A1D] focus-visible:outline focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-[#0E3B4A] disabled:opacity-60";

function PublicField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-medium text-[#13232B]">{label}</span>
      {children}
      {hint && <span className="block text-xs text-[#13232B]/55">{hint}</span>}
    </label>
  );
}

function strongPassword(pw: string): boolean {
  return pw.length >= 8 && /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /\d/.test(pw);
}

function FormError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg bg-[#8b0000]/[0.07] px-3 py-2 text-sm text-[#8b0000]">
      {message}
    </p>
  );
}

function Divider() {
  const { t } = useLocalization();
  return (
    <div className="flex items-center gap-3 text-xs text-[#13232B]/50">
      <span className="h-px flex-1 bg-[#0E3B4A]/15" />
      {t("common.or", "או")}
      <span className="h-px flex-1 bg-[#0E3B4A]/15" />
    </div>
  );
}

/** Activist self-registration. Exactly one of `orgSlug` (landing page) or
 *  `claimToken` (QR flow — the backend also claims the task) is set. */
export function ActivistRegisterForm({
  orgSlug,
  claimToken,
  organizationId,
  onRegistered,
  onSignedIn,
}: {
  orgSlug?: string;
  claimToken?: string;
  /** The org this form joins — lets Google fall back to a scoped sign-in
   *  when the Google account is already registered (409). */
  organizationId?: number;
  onRegistered: (res: PublicRegisterResponse) => void | Promise<void>;
  /** Called instead of onRegistered when that 409 fallback signed an
   *  existing user in (there's no PublicRegisterResponse then). */
  onSignedIn?: () => void | Promise<void>;
}) {
  const { t } = useLocalization();
  const { signInWithToken, signInWithGoogle } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const target = { org_slug: orgSlug ?? null, claim_token: claimToken ?? null };

  async function finish(res: PublicRegisterResponse) {
    await signInWithToken(res.access_token);
    await onRegistered(res);
  }

  function describe(err: unknown): string {
    if (err instanceof ApiError && err.status === 409) {
      return t("public.already_registered", "כתובת האימייל כבר רשומה. יש להתחבר במקום להירשם.");
    }
    if (err instanceof ApiError && err.status === 410) {
      return t("claim.link_invalid", "הקישור למשימה אינו בתוקף עוד.");
    }
    if (err instanceof ApiError && err.status === 403) {
      return t("public.registration_closed", "ההרשמה לארגון זה סגורה כרגע.");
    }
    return err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!fullName.trim()) {
      setError(t("public.full_name_required", "יש למלא שם מלא."));
      return;
    }
    if (!isValidEmail(email.trim())) {
      setError(t("msg.invalid_email", "כתובת אימייל לא תקינה"));
      return;
    }
    if (!strongPassword(password)) {
      setError(
        t("public.password_rule", "לפחות 8 תווים, עם אות גדולה, אות קטנה וספרה (באנגלית)."),
      );
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<PublicRegisterResponse>("/api/public/register", {
        method: "POST",
        body: JSON.stringify({
          full_name: fullName,
          email: email.trim(),
          password,
          phone: phone.trim() || null,
          ...target,
        }),
      });
      await finish(res);
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }

  async function onGoogle(credential: string) {
    setError("");
    setBusy(true);
    try {
      // The typed name is required for Google too — the account used to be
      // created under the Google profile name, ignoring this form. With the
      // name blank this can only be a returning user, so just try signing in.
      if (!fullName.trim()) {
        if (organizationId != null) {
          try {
            await signInWithGoogle(credential, organizationId);
            await onSignedIn?.();
            return;
          } catch {
            // Not registered yet — fall through to the name-required prompt.
          }
        }
        setError(t("public.full_name_required", "יש למלא שם מלא."));
        return;
      }
      const res = await apiFetch<PublicRegisterResponse>("/api/public/register-google", {
        method: "POST",
        body: JSON.stringify({
          credential,
          full_name: fullName.trim(),
          phone: phone.trim() || null,
          ...target,
        }),
      });
      await finish(res);
    } catch (err) {
      // Bug fix: "Join" is the org page's default tab, so returning users
      // press Google here too — register-google rightly 409s an existing
      // email, but that must mean "sign them in", not an error. Same
      // credential, same org-scoped login OrgSignInForm uses.
      if (err instanceof ApiError && err.status === 409 && organizationId != null) {
        try {
          await signInWithGoogle(credential, organizationId);
          await onSignedIn?.();
          return;
        } catch (loginErr) {
          setError(authErrorText(loginErr, t));
          return;
        }
      }
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <PublicField label={`${t("public.full_name", "שם מלא")} *`}>
        <input
          className={publicInputClass}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          autoComplete="name"
          required
        />
      </PublicField>
      <PublicField
        label={t("contacts.email", "אימייל")}
        hint={t("public.email_is_login", "האימייל ישמש אותך להתחברות למערכת.")}
      >
        <input
          type="email"
          dir="ltr"
          className={publicInputClass}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
      </PublicField>
      <PublicField
        label={t("auth.password", "סיסמה")}
        hint={t("public.password_rule", "לפחות 8 תווים, עם אות גדולה, אות קטנה וספרה (באנגלית).")}
      >
        <PasswordInput
          dir="ltr"
          className={publicInputClass}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
      </PublicField>
      <PublicField label={t("public.phone_optional", "טלפון (לא חובה)")}>
        <input
          type="tel"
          dir="ltr"
          className={publicInputClass}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="tel"
        />
      </PublicField>

      <FormError message={error} />

      <button type="submit" disabled={busy} className={primaryButtonClass}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {claimToken
          ? t("claim.register_and_claim", "הרשמה וקבלת המשימה")
          : t("public.register_submit", "הצטרפות כפעיל")}
      </button>

      {googleClientId && (
        <>
          <Divider />
          <GoogleSignInButton onCredential={onGoogle} onError={setError} />
        </>
      )}
    </form>
  );
}

/** Password / Google sign-in, scoped to one organization so a multi-org
 *  identity lands straight in this one (no org picker). */
export function OrgSignInForm({
  organizationId,
  onSignedIn,
}: {
  organizationId: number;
  onSignedIn: () => void | Promise<void>;
}) {
  const { t } = useLocalization();
  const { signIn, signInWithGoogle } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await signIn(username.trim(), password, organizationId);
      await onSignedIn();
    } catch (err) {
      setError(authErrorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function onGoogle(credential: string) {
    setError("");
    setBusy(true);
    try {
      await signInWithGoogle(credential, organizationId);
      await onSignedIn();
    } catch (err) {
      setError(authErrorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <PublicField label={t("public.email_or_username", "אימייל או שם משתמש")}>
        <input
          dir="ltr"
          className={publicInputClass}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
        />
      </PublicField>
      <PublicField label={t("auth.password", "סיסמה")}>
        <PasswordInput
          dir="ltr"
          className={publicInputClass}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </PublicField>
      <FormError message={error} />
      <button type="submit" disabled={busy} className={primaryButtonClass}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {t("auth.login", "התחברות")}
      </button>
      {/* fixes75 §7 */}
      <p className="text-center text-sm">
        <Link href="/forgot-password" className="text-primary hover:underline">
          {t("auth.forgot_password", "שכחת סיסמה?")}
        </Link>
      </p>
      {googleClientId && (
        <>
          <Divider />
          <GoogleSignInButton onCredential={onGoogle} onError={setError} />
        </>
      )}
    </form>
  );
}
