"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";

/** Redirects to the login page when there is no authenticated user, carrying
 *  the requested URL so login can deep-link back to it (fixes8 §3). */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const { t } = useLocalization();
  const router = useRouter();

  useEffect(() => {
    if (loading || user) return;
    // window.location (not useSearchParams) — no Suspense boundary needed.
    const target = window.location.pathname + window.location.search;
    router.replace(`/?redirect=${encodeURIComponent(target)}`);
  }, [loading, user, router]);

  if (loading || !user) {
    return <div className="p-8 text-center text-muted-foreground">{t("action.loading", "טוען…")}</div>;
  }
  return <>{children}</>;
}
