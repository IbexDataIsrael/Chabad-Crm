"use client";

import { useEffect, useMemo, useRef } from "react";

import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { loadGoogleMaps, mapsKey, useMapsLang } from "@/lib/maps";
import type { Area } from "@/lib/types";

// Sheepshead Bay fallback when the org has no default center configured.
const DEFAULT_CENTER = { lat: 40.5862, lng: -73.9442 };

// A small qualitative palette so adjacent zones are tellable apart.
export const ZONE_COLORS = ["#d6249f", "#1faa00", "#ff7a00", "#2563eb", "#8b0000", "#f2c200"];

// Standard Google Maps "dark" style — the classic dark JSON (dark roads/water/
// landscape, labels kept readable) so embedded maps match the app's dark
// glassy theme instead of rendering the default light tiles.
export const DARK_MAP_STYLES: object[] = [
  { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#263c3f" }] },
  { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#6b9a76" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#38414e" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#212a37" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9ca5b3" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#746855" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#1f2835" }] },
  { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#f3d19c" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#2f3948" }] },
  { featureType: "transit.station", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#515c6d" }] },
  { featureType: "water", elementType: "labels.text.stroke", stylers: [{ color: "#17263c" }] },
];

// Dark chrome for InfoWindow content (the container itself is always white, so
// the content div carries the dark background and bleeds over the padding).
const INFO_WINDOW_STYLE = "font-size:13px;line-height:1.4;background:#1c2130;color:#e6eaf2;padding:12px 16px;margin:-12px -14px;border-radius:8px";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Parse a GeoJSON Polygon string into a {lat,lng}[] ring (drops the closing point). */
export function geoJSONToPath(geojson: string): { lat: number; lng: number }[] | null {
  try {
    const obj = JSON.parse(geojson);
    const ring = obj?.coordinates?.[0];
    if (!Array.isArray(ring) || ring.length < 3) return null;
    const pts = ring.map((c: number[]) => ({ lat: c[1], lng: c[0] }));
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (a.lat === b.lat && a.lng === b.lng) pts.pop();
    return pts;
  } catch {
    return null;
  }
}

/**
 * One map rendering the complete spatial geometry of ALL the org's zones
 * (fixes7 §7A). Clicking a polygon opens an info window linking to the area.
 */
export function AreasMap({ areas }: { areas: Area[] }) {
  const { user } = useAuth();
  const { t, loading: locLoading } = useLocalization();
  const mapsLang = useMapsLang();
  const ref = useRef<HTMLDivElement>(null);

  const zones = useMemo(
    () =>
      areas
        .map((a) => ({ area: a, path: a.area_polygon ? geoJSONToPath(a.area_polygon) : null }))
        .filter((z) => z.path && z.path.length >= 3),
    [areas],
  );
  const signature = zones.map((z) => `${z.area.id}:${z.path!.length}`).join("|");

  useEffect(() => {
    if (!mapsKey || !ref.current || zones.length === 0) return;
    loadGoogleMaps(mapsLang)
      .then(() => {
        if (!ref.current) return;
        const g = (window as any).google;
        const org = user?.organization;
        const map = new g.maps.Map(ref.current, {
          center:
            org?.default_lat != null && org?.default_lng != null
              ? { lat: org.default_lat, lng: org.default_lng }
              : DEFAULT_CENTER,
          zoom: org?.default_zoom ?? 13,
          mapTypeControl: false,
          streetViewControl: false,
          clickableIcons: false,
          gestureHandling: "cooperative",
          styles: DARK_MAP_STYLES,
        });
        const info = new g.maps.InfoWindow();
        const bounds = new g.maps.LatLngBounds();
        zones.forEach((z, i) => {
          const color = ZONE_COLORS[i % ZONE_COLORS.length];
          const polygon = new g.maps.Polygon({
            paths: z.path,
            map,
            fillColor: color,
            fillOpacity: 0.15,
            strokeColor: color,
            strokeWeight: 2,
          });
          z.path!.forEach((p) => bounds.extend(p));
          polygon.addListener("click", (e: any) => {
            info.setContent(
              `<div style="${INFO_WINDOW_STYLE}">` +
                `<strong>${z.area.area_name.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)}</strong>` +
                `<br/><a href="/dashboard/areas/${z.area.id}" style="color:#ff8ad2;text-decoration:none">` +
                `${t("areas.view_area", "הצג אזור »")}</a>` +
                `</div>`,
            );
            info.setPosition(e.latLng);
            info.open({ map });
          });
        });
        map.fitBounds(bounds, 32);
      })
      .catch(() => {
        /* leave the container empty on load failure */
      });
    // fixes18 §loc: the info-window content captures `t` at build time — rebuild
    // when the localization data or language changes so the "view area" label
    // renders localized instead of its pre-load fallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, mapsLang, locLoading]);

  if (!mapsKey) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("map.set_key", "להצגת מפה הגדר מפתח Google Maps.")}
      </p>
    );
  }
  if (zones.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t("page.area_no_boundary", "ללא תחום")}</p>
    );
  }

  return <div ref={ref} className="w-full h-96 rounded-md border border-border" />;
}
