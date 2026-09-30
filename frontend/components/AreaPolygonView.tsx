"use client";

import { useEffect, useRef, useState } from "react";

import { loadGoogleMaps, mapsKey, useMapsLang } from "@/lib/maps";
import { useLocalization } from "@/lib/localization";

// Sheepshead Bay fallback when an area has no polygon to fit to.
const DEFAULT_CENTER = { lat: 40.5862, lng: -73.9442 };

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Parse a GeoJSON Polygon string into a {lat,lng}[] ring (drops the closing point). */
function geoJSONToPath(geojson: string): { lat: number; lng: number }[] | null {
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

/** Read-only map showing an area's polygon boundary. Degrades to a short note
 *  when there's no boundary, no Maps key, or Maps fails to load. */
export function AreaPolygonView({ polygon }: { polygon: string | null }) {
  const { t } = useLocalization();
  const mapsLang = useMapsLang();
  const ref = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState(false);
  const path = polygon ? geoJSONToPath(polygon) : null;

  useEffect(() => {
    if (!mapsKey || !ref.current || !path || path.length < 3) return;
    let cancelled = false;

    loadGoogleMaps(mapsLang)
      .then(() => {
        if (cancelled || !ref.current) return;
        const g = (window as any).google;
        const map = new g.maps.Map(ref.current, {
          center: DEFAULT_CENTER,
          zoom: 13,
          mapTypeControl: false,
          streetViewControl: false,
          clickableIcons: false,
          gestureHandling: "cooperative",
        });
        const polygonObj = new g.maps.Polygon({
          paths: path,
          map,
          fillColor: "#d6249f",
          fillOpacity: 0.15,
          strokeColor: "#d6249f",
          strokeWeight: 2,
        });
        const bounds = new g.maps.LatLngBounds();
        path.forEach((p) => bounds.extend(p));
        map.fitBounds(bounds);
        return () => polygonObj.setMap(null);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polygon, mapsLang]);

  if (!path || path.length < 3) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("page.area_no_boundary", "ללא תחום")}
      </p>
    );
  }
  if (!mapsKey || loadError) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("apm.no_key_hint", "לציור פוליגון אינטראקטיבי הגדר מפתח Google Maps.")}
      </p>
    );
  }
  return (
    <div
      ref={ref}
      className="w-full h-64 rounded-md border border-border bg-muted"
      style={{ minHeight: 256 }}
    />
  );
}
