"use client";

import { useEffect, useRef, useState } from "react";

import { loadGoogleMaps, mapsKey, useMapsLang } from "@/lib/maps";
import { useLocalization } from "@/lib/localization";

import { DARK_MAP_STYLES } from "./AreasMap";

// Sheepshead Bay, Brooklyn — fallback when no point is set yet.
const DEFAULT_CENTER = { lat: 40.5862, lng: -73.9442 };

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Pick a single point by clicking or dragging a marker on a Google Map. Clicking
 * anywhere moves the marker; dragging fine-tunes it. Emits the chosen lat/lng
 * (and the map's zoom). Degrades to a short note when no Maps key is configured.
 */
export function MapPointPicker({
  lat,
  lng,
  zoom,
  onChange,
  onZoomChange,
}: {
  lat: number | null;
  lng: number | null;
  zoom: number;
  onChange: (lat: number, lng: number) => void;
  onZoomChange?: (zoom: number) => void;
}) {
  const { t } = useLocalization();
  const mapsLang = useMapsLang();
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);

  const [loadError, setLoadError] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready">("loading");

  // Keep latest callbacks without re-running the map setup effect.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;

  // Initial center/zoom captured once (subsequent prop changes move the marker
  // via the sync effect below, not by re-centering the map under the user).
  const initial = useRef({
    center: lat != null && lng != null ? { lat, lng } : DEFAULT_CENTER,
    zoom: zoom || 13,
    hasPoint: lat != null && lng != null,
  });

  function placeMarker(g: any, map: any, pos: { lat: number; lng: number }) {
    if (markerRef.current) {
      markerRef.current.setPosition(pos);
      return;
    }
    const marker = new g.maps.Marker({ position: pos, map, draggable: true });
    marker.addListener("dragend", (e: any) =>
      onChangeRef.current(e.latLng.lat(), e.latLng.lng()),
    );
    markerRef.current = marker;
  }

  useEffect(() => {
    if (!mapsKey || !ref.current) return;
    let cancelled = false;

    loadGoogleMaps(mapsLang)
      .then(() => {
        if (cancelled || !ref.current) return;
        const g = (window as any).google;
        const map = new g.maps.Map(ref.current, {
          center: initial.current.center,
          zoom: initial.current.zoom,
          mapTypeControl: false,
          streetViewControl: false,
          clickableIcons: false,
          styles: DARK_MAP_STYLES,
        });
        mapRef.current = map;

        if (initial.current.hasPoint) {
          placeMarker(g, map, initial.current.center);
        }

        map.addListener("click", (e: any) => {
          const p = { lat: e.latLng.lat(), lng: e.latLng.lng() };
          placeMarker(g, map, p);
          onChangeRef.current(p.lat, p.lng);
        });
        if (onZoomChangeRef.current) {
          map.addListener("zoom_changed", () =>
            onZoomChangeRef.current?.(map.getZoom()),
          );
        }

        g.maps.event.addListenerOnce(map, "idle", () => {
          if (!cancelled) setStatus("ready");
        });
        setTimeout(() => {
          if (!cancelled) setStatus("ready");
        }, 1500);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("MapPointPicker: Google Maps failed to load", err);
          setLoadError(true);
        }
      });

    return () => {
      cancelled = true;
      if (markerRef.current) markerRef.current.setMap(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Move the marker when lat/lng change from the numeric inputs or an address
  // search (no feedback loop: skip when the marker is already at that position).
  // Also re-centers the map — a typed search result can be far outside the
  // current viewport, unlike a click or drag which is already on-screen.
  useEffect(() => {
    const g = (window as any).google;
    const map = mapRef.current;
    if (!g || !map || lat == null || lng == null) return;
    const cur = markerRef.current?.getPosition?.();
    if (cur && Math.abs(cur.lat() - lat) < 1e-9 && Math.abs(cur.lng() - lng) < 1e-9) {
      return;
    }
    placeMarker(g, map, { lat, lng });
    map.panTo({ lat, lng });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  if (!mapsKey) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("settings.map_no_key", "להגדרת מרכז המפה בלחיצה, הגדר מפתח Google Maps.")}
      </p>
    );
  }
  if (loadError) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("settings.map_load_failed", "טעינת מפת Google נכשלה — בדוק את מפתח ה-API.")}
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <div className="relative w-full h-72 rounded-md border border-border bg-muted overflow-hidden">
        <div ref={ref} className="absolute inset-0" style={{ minHeight: 288 }} />
        {status === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground pointer-events-none">
            {t("apm.loading_map", "טוען מפה…")}
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {t(
          "settings.map_pick_hint",
          "לחץ על המפה כדי לבחור את מרכז ברירת המחדל, או גרור את הסמן לכוונון.",
        )}
      </p>
    </div>
  );
}
