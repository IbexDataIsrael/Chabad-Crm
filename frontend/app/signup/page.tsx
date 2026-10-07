"use client";

import Link from "next/link";
import { Building2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { googleSignup, signup } from "@/lib/api";
import { useLocalization } from "@/lib/localization";
import { EmailInput } from "@/components/EmailInput";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { LogoUpload } from "@/components/LogoUpload";
import { PhoneInput } from "@/components/PhoneInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import {
  checkPassword,
  isMediumPassword,
  isValidEmail,
  isValidPhone,
  PASSWORD_HINT,
  PHONE_HINT,
} from "@/lib/validation";

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
        <div className="w-full max-w-sm bg-card rounded-xl shadow-md p-8 space-y-4 text-center">
          <div className="text-4xl">📨</div>
          <h1 className="text-2xl font-bold">{t("signup.received_title", "בקשתך התקבלה")}</h1>
          <p className="text-sm text-muted-foreground">
            {t(
              "signup.received_body",
              "בקשתך נשלחה והיא נבחנת. אנו נחזור אליך בהקדם האפשרי.",
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            <Link href="/" className="text-primary hover:underline">
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
        <div className="w-full max-w-md bg-card rounded-xl shadow-md p-8 space-y-5">
          <div className="text-center">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Building2 className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-bold">{t("signup.title", "פתיחת חשבון ארגון")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("signup.choose_method", "בחר דרך הרשמה")}</p>
          </div>
          <Button type="button" className="w-full h-11 font-medium" onClick={() => setMethod("password")}>
            {t("signup.with_password", "הרשמה עם אימייל וסיסמה")}
          </Button>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            {t("common.or", "או")}
            <span className="h-px flex-1 bg-border" />
          </div>
          <GoogleSignInButton
            onCredential={(cred) => {
              setGoogleCredential(cred);
              setMethod("google");
            }}
            onError={setError}
          />
          {error && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
          )}
          <p className="text-center text-sm text-muted-foreground">
            {t("auth.have_account", "כבר יש לך חשבון?")}{" "}
            <Link href="/" className="text-primary hover:underline">
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
        <form onSubmit={onGoogleFinish} className="w-full max-w-md bg-card rounded-xl shadow-md p-8 space-y-4">
          <div className="text-center">
            <h1 className="text-2xl font-bold">{t("signup.almost_done", "כמעט סיימנו")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("signup.google_verified_fill", "התחברת עם Google. השלם את פרטי הארגון:")}
            </p>
          </div>
          <Field label={t("signup.org_name", "שם הארגון")}>
            <Input
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
            <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
          )}
          <Button type="submit" disabled={busy || logoUploading} className="w-full font-medium">
            {busy ? t("signup.creating", "שולח…") : t("signup.submit_request", "שלח בקשה")}
          </Button>
          <Button type="button" variant="ghost" onClick={reset} className="w-full text-muted-foreground">
            {t("action.back", "← חזרה")}
          </Button>
        </form>
      </main>
    );
  }

  // --- Email + password path ---------------------------------------------
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={onSubmit} className="w-full max-w-md bg-card rounded-xl shadow-md p-8 space-y-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold">{t("signup.title", "פתיחת חשבון ארגון")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("signup.subtitle", "צור ארגון חדש ב-CRM")}</p>
        </div>
        <Field label={t("signup.org_name", "שם הארגון")}>
          <Input
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
            <Input value={form.first_name} onChange={(e) => set("first_name", e.target.value)} required />
          </Field>
          <Field label={t("contacts.last_name", "שם משפחה")}>
            <Input value={form.last_name} onChange={(e) => set("last_name", e.target.value)} required />
          </Field>
        </div>
        <Field label={t("contacts.email", "אימייל")}>
          <EmailInput value={email} onChange={setEmail} required />
        </Field>
        <Field label={t("contacts.phone", "טלפון")}>
          <PhoneInput value={form.phone} onChange={(v) => set("phone", v)} required />
        </Field>
        <Field label={t("auth.username", "שם משתמש")}>
          <Input value={form.username} onChange={(e) => set("username", e.target.value)} autoComplete="username" required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("auth.password", "סיסמה")}>
            <PasswordInput value={form.password} onChange={(e) => set("password", e.target.value)} autoComplete="new-password" required />
          </Field>
          <Field label={t("signup.verify_password", "אימות סיסמה")}>
            <PasswordInput value={form.verify_password} onChange={(e) => set("verify_password", e.target.value)} autoComplete="new-password" required />
          </Field>
        </div>
        <PasswordRequirements password={form.password} />
        {error && (
          <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
        )}
        <Button type="submit" disabled={busy || logoUploading} className="w-full font-medium">
          {busy ? t("signup.creating", "שולח…") : t("signup.submit_request", "שלח בקשה")}
        </Button>
        <Button type="button" variant="ghost" onClick={reset} className="w-full text-muted-foreground">
          {t("action.back", "← חזרה")}
        </Button>
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
        <li key={label} className={ok ? "text-success" : "text-muted-foreground"}>
          {ok ? "✓" : "○"} {label}
        </li>
      ))}
    </ul>
  );
}
