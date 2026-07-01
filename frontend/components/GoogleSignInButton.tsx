"use client";

import { useEffect, useRef } from "react";

import { googleClientId, loadGoogleIdentity } from "@/lib/google";
import { useLocalization } from "@/lib/localization";

/**
 * Renders the official "Sign in with Google" button (GIS token flow). On success
 * it hands the Google ID token (credential) to `onCredential`. Renders nothing
 * when no client id is configured.
 */
export function GoogleSignInButton({
  onCredential,
  onError,
}: {
  onCredential: (credential: string) => void;
  onError?: (message: string) => void;
}) {
  const { t } = useLocalization();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!googleClientId) return;
    let cancelled = false;
    loadGoogleIdentity()
      .then(() => {
        if (cancelled || !ref.current) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const id = (window as any).google.accounts.id;
        id.initialize({
          client_id: googleClientId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          callback: (resp: any) => {
            if (resp?.credential) onCredential(resp.credential);
          },
        });
        id.renderButton(ref.current, {
          theme: "outline",
          size: "large",
          width: 320,
          text: "signin_with",
          locale: "he",
        });
      })
      .catch(() => onError?.(t("auth.google_load_failed", "טעינת ההתחברות עם Google נכשלה")));
    return () => {
      cancelled = true;
    };
  }, [onCredential, onError]);

  if (!googleClientId) return null;
  return <div className="flex justify-center" ref={ref} />;
}
