"use client";

import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { loadGoogleMaps, mapsKey } from "@/lib/maps";

export interface PlaceResult {
  address: string;
  lat: number | null;
  lng: number | null;
}

interface Suggestion {
  id: string;
  label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prediction: any;
}

/**
 * Address input with Google Places autocomplete using the **new** Places API
 * (`AutocompleteSuggestion`), with a custom dropdown. The legacy
 * `places.Autocomplete` widget is not available to new Google Cloud projects.
 * Without an API key (or on load failure) it's a plain text input.
 */
export function AddressAutocomplete({
  value,
  onChange,
  onPlace,
  className,
  required,
}: {
  value: string;
  onChange: (address: string) => void;
  onPlace: (place: PlaceResult) => void;
  className?: string;
  required?: boolean;
}) {
  const { user } = useAuth();
  const { t } = useLocalization();
  const language = user?.organization?.map_in_english ? "en" : "he";
  const region = user?.organization?.map_in_english ? "us" : "il";

  const ready = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tokenRef = useRef<any>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!mapsKey) return;
    loadGoogleMaps()
      .then(() => {
        ready.current = true;
      })
      .catch(() => {
        /* plain input */
      });
  }, []);

  async function fetchSuggestions(input: string) {
    if (!ready.current || !input.trim()) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const places = (window as any).google?.maps?.places;
    if (!places?.AutocompleteSuggestion) return;
    try {
      if (!tokenRef.current) {
        tokenRef.current = new places.AutocompleteSessionToken();
      }
      const { suggestions: raw } =
        await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input,
          sessionToken: tokenRef.current,
          language,
          region,
        });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const list: Suggestion[] = (raw ?? [])
        .map((s: any, i: number) => ({
          id: s.placePrediction?.placeId ?? `s${i}`,
          label: s.placePrediction?.text?.text ?? "",
          prediction: s.placePrediction,
        }))
        .filter((x: Suggestion) => x.label);
      setSuggestions(list);
      setOpen(list.length > 0);
    } catch {
      setSuggestions([]);
      setOpen(false);
    }
  }

  function handleInput(v: string) {
    onChange(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(v), 250);
  }

  async function select(s: Suggestion) {
    setOpen(false);
    setSuggestions([]);
    try {
      const place = s.prediction.toPlace();
      await place.fetchFields({ fields: ["formattedAddress", "location"] });
      const address: string = place.formattedAddress ?? s.label;
      const loc = place.location;
      const lat = loc ? (typeof loc.lat === "function" ? loc.lat() : loc.lat) : null;
      const lng = loc ? (typeof loc.lng === "function" ? loc.lng() : loc.lng) : null;
      onPlace({ address, lat, lng });
    } catch {
      onPlace({ address: s.label, lat: null, lng: null });
    }
    tokenRef.current = null; // new session after a selection
  }

  return (
    <div className="relative">
      <input
        className={className}
        value={value}
        required={required}
        onChange={(e) => handleInput(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={mapsKey ? t("addr.start_typing", "התחל להקליד כתובת…") : t("contacts.address", "כתובת")}
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full bg-card border border-border rounded-md shadow-lg max-h-56 overflow-auto text-sm">
          {suggestions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(s)}
                className="w-full text-right px-3 py-2 hover:bg-accent"
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
