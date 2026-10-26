"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, KeyRound, Loader2 } from "lucide-react";
import { Suspense, useState, type FormEvent } from "react";

import { apiFetch } from "@/lib/api";
import { authErrorText } from "@/lib/authErrors";
import { useLocalization } from "@/lib/localization";
import { isMediumPassword, PASSWORD_HINT } from "@/lib/validation";
import { LanguageToggle } from "@/components/LanguageToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/PasswordInput";

/** fixes75 §7: choose a new password from the emailed reset link. */
function ResetInner() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const { t } = useLocalization();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!isMediumPassword(password)) {
      setError(t("validation.password_hint", PASSWORD_HINT));
      return;
    }
    if (password !== confirm) {
      setError(t("auth.passwords_mismatch", "הסיסמאות אינן תואמות"));
      return;
    }
    setBusy(true);
    try {
      await apiFetch("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, new_password: password }),
      });
      setDone(true);
    } catch (err) {
      setError(authErrorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        className="glass-card w-full max-w-sm space-y-5 p-8"
      >
        <div className="flex justify-end">
          <LanguageToggle />
        </div>
        <div className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {done ? <CheckCircle2 className="h-6 w-6" /> : <KeyRound className="h-6 w-6" />}
          </div>
          <h1 className="text-2xl font-bold">{t("auth.reset_title", "בחירת סיסמה חדשה")}</h1>
        </div>

        {!token ? (
          <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
            {t("auth.error.reset_link_invalid", "הקישור לאיפוס הסיסמה אינו תקף או שפג תוקפו.")}
          </p>
        ) : done ? (
          <p className="text-sm bg-success/10 text-success rounded-md px-3 py-2">
            {t("auth.reset_done", "הסיסמה עודכנה. אפשר להתחבר עם הסיסמה החדשה.")}
          </p>
        ) : (
          <>
            <div className="space-y-1">
              <Label htmlFor="new-password">{t("auth.new_password", "סיסמה חדשה")}</Label>
              <PasswordInput
                id="new-password"
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
                className="h-11"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="confirm-password">{t("auth.confirm_password", "אימות סיסמה")}</Label>
              <PasswordInput
                id="confirm-password"
                dir="ltr"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
                className="h-11"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {t("validation.password_hint", PASSWORD_HINT)}
            </p>
            {error && (
              <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy} className="w-full h-11 font-medium">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("auth.reset_save", "שמירת הסיסמה")}
            </Button>
          </>
        )}

        <p className="text-center text-sm">
          <Link href="/" className="text-primary hover:underline">
            {t("auth.back_to_login", "חזרה להתחברות")}
          </Link>
        </p>
      </form>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetInner />
    </Suspense>
  );
}
