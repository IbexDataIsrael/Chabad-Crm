"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { resendVerification, signup } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import {
  checkPassword,
  isMediumPassword,
  isValidPhone,
  PASSWORD_HINT,
  PHONE_HINT,
} from "@/lib/validation";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

export default function SignupPage() {
  const { signUpWithGoogle } = useAuth();
  const router = useRouter();
  const [done, setDone] = useState(false);
  const [email, setEmail] = useState("");
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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setError("כתובת אימייל לא תקינה");
      return;
    }
    if (!isValidPhone(form.phone)) {
      setError(PHONE_HINT);
      return;
    }
    if (!isMediumPassword(form.password)) {
      setError(PASSWORD_HINT);
      return;
    }
    if (form.password !== form.verify_password) {
      setError("הסיסמאות אינן תואמות");
      return;
    }
    setBusy(true);
    try {
      await signup({
        organization_name: form.organization_name,
        first_name: form.first_name,
        last_name: form.last_name,
        email,
        phone: form.phone,
        username: form.username,
        password: form.password,
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ההרשמה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function onGoogleCredential(credential: string) {
    setError("");
    if (!form.organization_name.trim()) {
      setError("יש למלא שם ארגון לפני ההרשמה עם Google");
      return;
    }
    setBusy(true);
    try {
      await signUpWithGoogle(credential, form.organization_name.trim());
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "ההרשמה עם Google נכשלה");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-white rounded-xl shadow-md p-8 space-y-4 text-center">
          <h1 className="text-2xl font-bold">בדוק את האימייל שלך</h1>
          <p className="text-sm text-gray-600">
            שלחנו קישור אימות אל <span className="font-medium">{email}</span>. יש ללחוץ
            על הקישור כדי להפעיל את חשבון הארגון.
          </p>
          <button
            onClick={() => resendVerification(email)}
            className="text-sm text-status-magenta hover:underline"
          >
            שליחת הקישור מחדש
          </button>
          <p className="text-sm text-gray-500">
            <Link href="/" className="text-status-magenta hover:underline">
              חזרה להתחברות
            </Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md bg-white rounded-xl shadow-md p-8 space-y-4"
      >
        <div className="text-center">
          <h1 className="text-2xl font-bold">פתיחת חשבון ארגון</h1>
          <p className="mt-1 text-sm text-gray-500">צור ארגון חדש ב-CRM</p>
        </div>

        <Field label="שם הארגון">
          <input
            className={inputClass}
            value={form.organization_name}
            onChange={(e) => set("organization_name", e.target.value)}
            required
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="שם פרטי">
            <input
              className={inputClass}
              value={form.first_name}
              onChange={(e) => set("first_name", e.target.value)}
              required
            />
          </Field>
          <Field label="שם משפחה">
            <input
              className={inputClass}
              value={form.last_name}
              onChange={(e) => set("last_name", e.target.value)}
              required
            />
          </Field>
        </div>

        <Field label="אימייל">
          <input
            type="email"
            className={inputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            dir="ltr"
            required
          />
        </Field>

        <Field label="טלפון">
          <input
            type="tel"
            className={inputClass}
            value={form.phone}
            onChange={(e) => set("phone", e.target.value)}
            dir="ltr"
            required
          />
          {form.phone && !isValidPhone(form.phone) ? (
            <span className="text-xs text-status-darkred">{PHONE_HINT}</span>
          ) : (
            <span className="text-xs text-gray-400">{PHONE_HINT}</span>
          )}
        </Field>

        <Field label="שם משתמש">
          <input
            className={inputClass}
            value={form.username}
            onChange={(e) => set("username", e.target.value)}
            autoComplete="username"
            required
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="סיסמה">
            <input
              type="password"
              className={inputClass}
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              autoComplete="new-password"
              required
            />
          </Field>
          <Field label="אימות סיסמה">
            <input
              type="password"
              className={inputClass}
              value={form.verify_password}
              onChange={(e) => set("verify_password", e.target.value)}
              autoComplete="new-password"
              required
            />
          </Field>
        </div>

        <PasswordRequirements password={form.password} />

        {error && (
          <p className="text-sm text-status-darkred bg-red-50 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-status-magenta text-white py-2 font-medium hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "נרשם…" : "צור חשבון"}
        </button>

        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span className="h-px flex-1 bg-gray-200" />
          או
          <span className="h-px flex-1 bg-gray-200" />
        </div>

        <p className="text-center text-xs text-gray-500">
          הרשמה מהירה עם Google — די למלא <span className="font-medium">שם ארגון</span> בלבד.
        </p>
        <GoogleSignInButton onCredential={onGoogleCredential} onError={setError} />

        <p className="text-center text-sm text-gray-500">
          כבר יש לך חשבון?{" "}
          <Link href="/" className="text-status-magenta hover:underline">
            התחברות
          </Link>
        </p>
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
  const c = checkPassword(password);
  const rules: [boolean, string][] = [
    [c.length, "לפחות 8 תווים"],
    [c.upper, "אות גדולה (A-Z)"],
    [c.lower, "אות קטנה (a-z)"],
    [c.digit, "מספר (0-9)"],
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
