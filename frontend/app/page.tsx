"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { ApiError, getToken, resendVerification } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";

export default function LoginPage() {
  const { signIn, signInWithGoogle, user } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [unverified, setUnverified] = useState(false);
  const [resendEmail, setResendEmail] = useState("");
  const [busy, setBusy] = useState(false);

  // Already authenticated → go straight to the dashboard.
  useEffect(() => {
    if (getToken() || user) router.replace("/dashboard");
  }, [user, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setUnverified(false);
    setBusy(true);
    try {
      await signIn(username, password);
      router.replace("/dashboard");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setUnverified(true);
        setError("עליך לאמת את כתובת האימייל לפני ההתחברות.");
      } else {
        setError(err instanceof Error ? err.message : "התחברות נכשלה");
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
      await signInWithGoogle(credential);
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "התחברות עם Google נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-white rounded-xl shadow-md p-8 space-y-5"
      >
        <div className="text-center">
          <h1 className="text-2xl font-bold">מיני CRM</h1>
          <p className="mt-1 text-sm text-gray-500">התחברות למערכת</p>
        </div>

        <div className="space-y-1">
          <label htmlFor="username" className="block text-sm font-medium">
            שם משתמש
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
            סיסמה
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
              placeholder="האימייל שלך"
              value={resendEmail}
              onChange={(e) => setResendEmail(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => resendEmail && resendVerification(resendEmail)}
              className="w-full rounded-md border border-status-magenta text-status-magenta py-2 text-sm hover:bg-status-magenta/5"
            >
              שליחת קישור אימות מחדש
            </button>
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-status-magenta text-white py-2 font-medium hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "מתחבר…" : "התחבר"}
        </button>

        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span className="h-px flex-1 bg-gray-200" />
          או
          <span className="h-px flex-1 bg-gray-200" />
        </div>

        <GoogleSignInButton onCredential={onGoogleCredential} onError={setError} />

        <p className="text-center text-sm text-gray-500">
          אין לך חשבון?{" "}
          <Link href="/signup" className="text-status-magenta hover:underline">
            פתיחת חשבון ארגון
          </Link>
        </p>
      </form>
    </main>
  );
}
