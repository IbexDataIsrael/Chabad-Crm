"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { googleSignup, signup } from "@/lib/api";
import { useLocalization } from "@/lib/localization";
import { EmailInput } from "@/components/EmailInput";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { LogoUpload } from "@/components/LogoUpload";
import { PhoneInput } from "@/components/PhoneInput";
import {
  checkPassword,
  isMediumPassword,
  isValidEmail,
  isValidPhone,
  PASSWORD_HINT,
  PHONE_HINT,
} from "@/lib/validation";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

type Method = null | "password" | "google";

export default function SignupPage() {
  const { t } = useLocalization();
  const [method, setMethod] = useState<Method>(null);
  const [googleCredential, setGoogleCredential] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [email, setEmail] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  // fixes22 §1: block submit while the logo upload is still in flight.
  const [logoUploading, setLogoUploading] = useState(false);
  const [form, setForm] = useState({
    organization_name: "",
    first_name: "",
    last_name: "",
    phone: "",
    username: "",
    password: "",
    verify_password: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function set(key: keyof typeof form, v: string) {
    setForm((prev) => ({ ...prev, [key]: v }));
  }

  function reset() {
    setMethod(null);
    setGoogleCredential(null);
    setError("");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!isValidEmail(email)) return setError(t("msg.invalid_email", "כתובת אימייל לא תקינה"));
    if (!isValidPhone(form.phone)) return setError(t("validation.phone_hint", PHONE_HINT));
    if (!isMediumPassword(form.password)) return setError(t("validation.password_hint", PASSWORD_HINT));
    if (form.password !== form.verify_password)
      return setError(t("signup.passwords_no_match", "הסיסמאות אינן תואמות"));
    setBusy(true);
    try {
      await signup({
        organization_name: form.organization_name,
        organization_logo_url: logoUrl,
        first_name: form.first_name,
        last_name: form.last_name,
        email,
        phone: form.phone,
        username: form.username,
        password: form.password,
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("signup.failed", "ההרשמה נכשלה"));
    } finally {
      setBusy(false);
    }
  }

  async function onGoogleFinish(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!googleCredential) return;
    if (!form.organization_name.trim()) return setError(t("signup.org_required", "יש למלא שם ארגון"));
    setBusy(true);
    try {
      await googleSignup(googleCredential, form.organization_name.trim(), logoUrl);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("signup.google_failed", "ההרשמה עם Google נכשלה"));
    } finally {
      setBusy(false);
    }
  }

  // --- "Request received / under review" screen --------------------------
  if (done) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-white rounded-xl shadow-md p-8 space-y-4 text-center">
          <div className="text-4xl">📨</div>
          <h1 className="text-2xl font-bold">{t("signup.received_title", "בקשתך התקבלה")}</h1>
          <p className="text-sm text-gray-600">
            {t(
              "signup.received_body",
              "בקשתך נשלחה והיא נבחנת. אנו נחזור אליך בהקדם האפשרי.",
            )}
          </p>
          <p className="text-sm text-gray-500">
            <Link href="/" className="text-status-magenta hover:underline">
              {t("signup.back_to_login", "חזרה להתחברות")}
            </Link>
          </p>
        </div>
      </main>
    );
  }

  // --- Method chooser ----------------------------------------------------
  if (!method) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white rounded-xl shadow-md p-8 space-y-5">
          <div className="text-center">
            <h1 className="text-2xl font-bold">{t("signup.title", "פתיחת חשבון ארגון")}</h1>
            <p className="mt-1 text-sm text-gray-500">{t("signup.choose_method", "בחר דרך הרשמה")}</p>
          </div>
          <button
            type="button"
            onClick={() => setMethod("password")}
            className="w-full rounded-md bg-status-magenta text-white py-2.5 font-medium hover:opacity-90"
          >
            {t("signup.with_password", "הרשמה עם אימייל וסיסמה")}
          </button>
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span className="h-px flex-1 bg-gray-200" />
            {t("common.or", "או")}
            <span className="h-px flex-1 bg-gray-200" />
          </div>
          <GoogleSignInButton
            onCredential={(cred) => {
              setGoogleCredential(cred);
              setMethod("google");
            }}
            onError={setError}
          />
          {error && (
            <p className="text-sm text-status-darkred bg-red-50 rounded-md px-3 py-2">{error}</p>
          )}
          <p className="text-center text-sm text-gray-500">
            {t("auth.have_account", "כבר יש לך חשבון?")}{" "}
            <Link href="/" className="text-status-magenta hover:underline">
              {t("auth.login_link", "התחברות")}
            </Link>
          </p>
        </div>
      </main>
    );
  }

  // --- Google path: org name + logo --------------------------------------
  if (method === "google") {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <form onSubmit={onGoogleFinish} className="w-full max-w-md bg-white rounded-xl shadow-md p-8 space-y-4">
          <div className="text-center">
            <h1 className="text-2xl font-bold">{t("signup.almost_done", "כמעט סיימנו")}</h1>
            <p className="mt-1 text-sm text-gray-500">
              {t("signup.google_verified_fill", "התחברת עם Google. השלם את פרטי הארגון:")}
            </p>
          </div>
          <Field label={t("signup.org_name", "שם הארגון")}>
            <input
              className={inputClass}
              value={form.organization_name}
              onChange={(e) => set("organization_name", e.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field label={t("signup.org_logo", "לוגו הארגון")}>
            <LogoUpload value={logoUrl} onChange={setLogoUrl} onUploadingChange={setLogoUploading} />
          </Field>
          {error && (
            <p className="text-sm text-status-darkred bg-red-50 rounded-md px-3 py-2">{error}</p>
          )}
          <button
            type="submit"
            disabled={busy || logoUploading}
            className="w-full rounded-md bg-status-magenta text-white py-2 font-medium hover:opacity-90 disabled:opacity-50"
          >
            {busy ? t("signup.creating", "שולח…") : t("signup.submit_request", "שלח בקשה")}
          </button>
          <button type="button" onClick={reset} className="w-full text-center text-sm text-gray-500 hover:underline">
            {t("action.back", "← חזרה")}
          </button>
        </form>
      </main>
    );
  }

  // --- Email + password path ---------------------------------------------
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={onSubmit} className="w-full max-w-md bg-white rounded-xl shadow-md p-8 space-y-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold">{t("signup.title", "פתיחת חשבון ארגון")}</h1>
          <p className="mt-1 text-sm text-gray-500">{t("signup.subtitle", "צור ארגון חדש ב-CRM")}</p>
        </div>
        <Field label={t("signup.org_name", "שם הארגון")}>
          <input
            className={inputClass}
            value={form.organization_name}
            onChange={(e) => set("organization_name", e.target.value)}
            required
          />
        </Field>
        <Field label={t("signup.org_logo", "לוגו הארגון")}>
          <LogoUpload value={logoUrl} onChange={setLogoUrl} onUploadingChange={setLogoUploading} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("contacts.name", "שם פרטי")}>
            <input className={inputClass} value={form.first_name} onChange={(e) => set("first_name", e.target.value)} required />
          </Field>
          <Field label={t("contacts.last_name", "שם משפחה")}>
            <input className={inputClass} value={form.last_name} onChange={(e) => set("last_name", e.target.value)} required />
          </Field>
        </div>
        <Field label={t("contacts.email", "אימייל")}>
          <EmailInput value={email} onChange={setEmail} required />
        </Field>
        <Field label={t("contacts.phone", "טלפון")}>
          <PhoneInput value={form.phone} onChange={(v) => set("phone", v)} required />
        </Field>
        <Field label={t("auth.username", "שם משתמש")}>
          <input className={inputClass} value={form.username} onChange={(e) => set("username", e.target.value)} autoComplete="username" required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("auth.password", "סיסמה")}>
            <input type="password" className={inputClass} value={form.password} onChange={(e) => set("password", e.target.value)} autoComplete="new-password" required />
          </Field>
          <Field label={t("signup.verify_password", "אימות סיסמה")}>
            <input type="password" className={inputClass} value={form.verify_password} onChange={(e) => set("verify_password", e.target.value)} autoComplete="new-password" required />
          </Field>
        </div>
        <PasswordRequirements password={form.password} />
        {error && (
          <p className="text-sm text-status-darkred bg-red-50 rounded-md px-3 py-2">{error}</p>
        )}
        <button
          type="submit"
          disabled={busy || logoUploading}
          className="w-full rounded-md bg-status-magenta text-white py-2 font-medium hover:opacity-90 disabled:opacity-50"
        >
          {busy ? t("signup.creating", "שולח…") : t("signup.submit_request", "שלח בקשה")}
        </button>
        <button type="button" onClick={reset} className="w-full text-center text-sm text-gray-500 hover:underline">
          {t("action.back", "← חזרה")}
        </button>
      </form>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function PasswordRequirements({ password }: { password: string }) {
  const { t } = useLocalization();
  const c = checkPassword(password);
  const rules: [boolean, string][] = [
    [c.length, t("validation.pw_length", "לפחות 8 תווים")],
    [c.upper, t("validation.pw_upper", "אות גדולה (A-Z)")],
    [c.lower, t("validation.pw_lower", "אות קטנה (a-z)")],
    [c.digit, t("validation.pw_digit", "מספר (0-9)")],
  ];
  return (
    <ul className="text-xs space-y-0.5">
      {rules.map(([ok, label]) => (
        <li key={label} className={ok ? "text-status-green" : "text-gray-400"}>
          {ok ? "✓" : "○"} {label}
        </li>
      ))}
    </ul>
  );
}
