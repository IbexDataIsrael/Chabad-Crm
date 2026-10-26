"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Mail, XCircle } from "lucide-react";
import { Suspense, useEffect, useState } from "react";

import { resendVerification, verifyEmail } from "@/lib/api";
import { useLocalization } from "@/lib/localization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type State = "verifying" | "success" | "error";

function VerifyInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { t } = useLocalization();
  const token = params.get("token");
  const [state, setState] = useState<State>("verifying");
  const [message, setMessage] = useState("");
  const [resendEmail, setResendEmail] = useState("");

  useEffect(() => {
    if (!token) {
      setState("error");
      setMessage(t("verify.link_missing", "קישור האימות חסר או שגוי."));
      return;
    }
    verifyEmail(token)
      .then(() => {
        setState("success");
        setTimeout(() => router.replace("/"), 3000);
      })
      .catch(() => {
        setState("error");
        // fixes75 §8: never the backend's raw (English) text.
        setMessage(t("verify.failed", "אימות האימייל נכשל."));
      });
  }, [token, router]);

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="glass-card w-full max-w-sm space-y-4 p-8 text-center">
        <div
          className={`mx-auto flex h-12 w-12 items-center justify-center rounded-xl ${
            state === "success"
              ? "bg-success/10 text-success"
              : state === "error"
                ? "bg-destructive/10 text-destructive"
                : "bg-primary/10 text-primary"
          }`}
        >
          {state === "success" ? (
            <CheckCircle2 className="h-6 w-6" />
          ) : state === "error" ? (
            <XCircle className="h-6 w-6" />
          ) : (
            <Mail className="h-6 w-6" />
          )}
        </div>
        <h1 className="text-2xl font-bold">{t("verify.title", "אימות אימייל")}</h1>

        {state === "verifying" && (
          <p className="text-muted-foreground">{t("verify.verifying", "מאמת…")}</p>
        )}

        {state === "success" && (
          <>
            <p className="text-success">{t("verify.success", "החשבון אומת בהצלחה! ✓")}</p>
            <p className="text-sm text-muted-foreground">
              {t("verify.redirecting_login", "מעבירים אותך להתחברות…")}
            </p>
            <Link href="/" className="text-primary hover:underline text-sm">
              {t("verify.login_now", "להתחברות עכשיו")}
            </Link>
          </>
        )}

        {state === "error" && (
          <>
            <p className="text-destructive">{message}</p>
            <div className="space-y-2 pt-2">
              <Input
                type="email"
                dir="ltr"
                placeholder={t("auth.your_email", "האימייל שלך")}
                value={resendEmail}
                onChange={(e) => setResendEmail(e.target.value)}
              />
              <Button
                className="w-full"
                onClick={() => resendEmail && resendVerification(resendEmail)}
              >
                {t("verify.resend_new", "שליחת קישור אימות חדש")}
              </Button>
            </div>
            <Link href="/" className="text-muted-foreground hover:underline text-sm">
              {t("verify.back_to_login", "חזרה להתחברות")}
            </Link>
          </>
        )}
      </div>
    </main>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-muted-foreground">…</div>}>
      <VerifyInner />
    </Suspense>
  );
}
