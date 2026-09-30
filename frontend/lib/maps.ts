// Google Maps JS API loader (Places library). The key is public/client-side.
// When the key is absent, the app degrades gracefully (plain address input, no map).

import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";

export const mapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";

/** fixes85: the ONE language every Maps caller on a page must agree on.
 *  The Maps JS API is a single global instance with its language baked in,
 *  and loadGoogleMaps tears it down whenever a different language is asked
 *  for. AddressAutocomplete used the org's "map in English" setting while the
 *  maps used the UI language, so any page with both (e.g. Settings) reloaded
 *  the API mid-render and the map came up blank. The org setting wins; else
 *  the UI language. */
export function useMapsLang(): "he" | "en" {
  const { user } = useAuth();
  const { lang } = useLocalization();
  return user?.organization?.map_in_english ? "en" : lang;
}

let loadPromise: Promise<void> | null = null;
// The Maps JS API bakes `language` into the script at load time — there's no
// supported way to hot-swap it on an already-loaded instance. Track what's
// currently loaded so a UI language switch (fixes62 §1.3) can drop it and
// load a fresh instance in the new language instead of silently no-op'ing.
let loadedLang: "he" | "en" | null = null;

export function loadGoogleMaps(lang: "he" | "en" = "he"): Promise<void> {
  if (!mapsKey) return Promise.reject(new Error("Google Maps API key not set"));
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));

  if (loadedLang && loadedLang !== lang) {
    document
      .querySelectorAll("script[data-gmaps-loader]")
      .forEach((el) => el.remove());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).google;
    loadPromise = null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).google?.maps?.places) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadedLang = lang;
  loadPromise = new Promise((resolve, reject) => {
    // Resolve from Google's callback — with `loading=async` the script's `onload`
    // fires before `google.maps` and the requested libraries are ready, so using
    // the API there (e.g. `new google.maps.Map`, `google.maps.drawing`) throws.
    // The callback fires only once the core API *and* `libraries` have loaded.
    const cbName = "__gmapsReady";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any)[cbName] = () => resolve();

    const script = document.createElement("script");
    script.dataset.gmapsLoader = "true";
    // v=weekly exposes the new Places API classes (AutocompleteSuggestion, Place).
    // `drawing` enables the polygon drawing tool used on the Areas page.
    script.src = `https://maps.googleapis.com/maps/api/js?key=${mapsKey}&libraries=places,drawing&language=${lang}&region=IL&v=weekly&loading=async&callback=${cbName}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(script);
  });
  return loadPromise;
}
