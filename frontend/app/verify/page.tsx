"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { resendVerification, verifyEmail } from "@/lib/api";

type State = "verifying" | "success" | "error";

function VerifyInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token");
  const [state, setState] = useState<State>("verifying");
  const [message, setMessage] = useState("");
  const [resendEmail, setResendEmail] = useState("");

  useEffect(() => {
    if (!token) {
      setState("error");
      setMessage("קישור האימות חסר או שגוי.");
      return;
    }
    verifyEmail(token)
      .then(() => {
        setState("success");
        setTimeout(() => router.replace("/"), 3000);
      })
      .catch((err) => {
        setState("error");
        setMessage(
          err instanceof Error ? err.message : "אימות האימייל נכשל.",
        );
      });
  }, [token, router]);

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white rounded-xl shadow-md p-8 space-y-4 text-center">
        <h1 className="text-2xl font-bold">אימות אימייל</h1>

        {state === "verifying" && <p className="text-gray-500">מאמת…</p>}

        {state === "success" && (
          <>
            <p className="text-status-green">החשבון אומת בהצלחה! ✓</p>
            <p className="text-sm text-gray-500">מעבירים אותך להתחברות…</p>
            <Link href="/" className="text-status-magenta hover:underline text-sm">
              להתחברות עכשיו
            </Link>
          </>
        )}

        {state === "error" && (
          <>
            <p className="text-status-darkred">{message}</p>
            <div className="space-y-2 pt-2">
              <input
                type="email"
                dir="ltr"
                placeholder="האימייל שלך"
                value={resendEmail}
                onChange={(e) => setResendEmail(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <button
                onClick={() => resendEmail && resendVerification(resendEmail)}
                className="w-full rounded-md bg-status-magenta text-white py-2 text-sm font-medium hover:opacity-90"
              >
                שליחת קישור אימות חדש
              </button>
            </div>
            <Link href="/" className="text-gray-500 hover:underline text-sm">
              חזרה להתחברות
            </Link>
          </>
        )}
      </div>
    </main>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-400">טוען…</div>}>
      <VerifyInner />
    </Suspense>
  );
}
