// Google Identity Services (GIS) loader for "Sign in with Google".
// Uses the token flow: the button yields an ID token (credential) we post to the
// backend. Only an Authorized JavaScript origin is needed in the Cloud Console —
// no redirect URI. When the client id is absent, the button simply doesn't render.

export const googleClientId =
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

let gisPromise: Promise<void> | null = null;

export function loadGoogleIdentity(): Promise<void> {
  if (!googleClientId) return Promise.reject(new Error("Google client id not set"));
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).google?.accounts?.id) return Promise.resolve();
  if (gisPromise) return gisPromise;

  gisPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Identity Services"));
    document.head.appendChild(script);
  });
  return gisPromise;
}
