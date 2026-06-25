// Google Maps JS API loader (Places library). The key is public/client-side.
// When the key is absent, the app degrades gracefully (plain address input, no map).

export const mapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";

let loadPromise: Promise<void> | null = null;

export function loadGoogleMaps(): Promise<void> {
  if (!mapsKey) return Promise.reject(new Error("Google Maps API key not set"));
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).google?.maps?.places) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    // Resolve from Google's callback — with `loading=async` the script's `onload`
    // fires before `google.maps` and the requested libraries are ready, so using
    // the API there (e.g. `new google.maps.Map`, `google.maps.drawing`) throws.
    // The callback fires only once the core API *and* `libraries` have loaded.
    const cbName = "__gmapsReady";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any)[cbName] = () => resolve();

    const script = document.createElement("script");
    // v=weekly exposes the new Places API classes (AutocompleteSuggestion, Place).
    // `drawing` enables the polygon drawing tool used on the Areas page.
    script.src = `https://maps.googleapis.com/maps/api/js?key=${mapsKey}&libraries=places,drawing&language=he&region=IL&v=weekly&loading=async&callback=${cbName}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(script);
  });
  return loadPromise;
}
