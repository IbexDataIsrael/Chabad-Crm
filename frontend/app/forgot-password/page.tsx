"use client";

import Link from "next/link";
import { KeyRound, Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { apiFetch } from "@/lib/api";
import { authErrorText } from "@/lib/authErrors";
import { useLocalization } from "@/lib/localization";
import { isValidEmail } from "@/lib/validation";
import { LanguageToggle } from "@/components/LanguageToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** fixes75 §7: ask for a password-reset link by email. The answer is the
 *  same whether or not the address exists (no account enumeration). */
export default function ForgotPasswordPage() {
  const { t } = useLocalization();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!isValidEmail(email.trim())) {
      setError(t("msg.invalid_email", "כתובת אימייל לא תקינה"));
      return;
    }
    setBusy(true);
    try {
      await apiFetch("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
      });
      setSent(true);
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
            <KeyRound className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold">{t("auth.forgot_title", "איפוס סיסמה")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("auth.forgot_subtitle", "נשלח אליך קישור לבחירת סיסמה חדשה.")}
          </p>
        </div>

        {sent ? (
          <p className="text-sm bg-success/10 text-success rounded-md px-3 py-2">
            {t(
              "auth.forgot_sent",
              "אם הכתובת רשומה במערכת, נשלח אליה קישור לאיפוס הסיסמה. הקישור בתוקף לשעה.",
            )}
          </p>
        ) : (
          <>
            <div className="space-y-1">
              <Label htmlFor="email">{t("contacts.email", "אימייל")}</Label>
              <Input
                id="email"
                type="email"
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                className="h-11"
              />
            </div>
            {error && (
              <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy} className="w-full h-11 font-medium">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("auth.forgot_send", "שליחת קישור לאיפוס")}
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
