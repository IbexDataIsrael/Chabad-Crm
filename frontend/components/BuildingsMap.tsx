"use client";

import { useEffect, useMemo, useRef } from "react";

import { loadGoogleMaps, mapsKey } from "@/lib/maps";
import { useLocalization } from "@/lib/localization";
import { buildingDisplayName, type Area, type Building } from "@/lib/types";
import { geoJSONToPath, ZONE_COLORS } from "./AreasMap";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string),
  );
}

// fixes60 §5: a distinct marker per building type — a multi-story apartment
// building (blue, the app's own primary) vs a single-family/townhouse glyph
// (orange, one of CLAUDE.md's 5 mandated status colors, chosen for maximum
// contrast against the blue on a map rather than introducing a 6th color).
// Inline SVG data URIs — no binary icon assets exist anywhere in this repo,
// and two small glyphs don't warrant adding any.
const BUILDING_ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="28" height="34" viewBox="0 0 28 34">
  <path d="M14 1 2 8v25h24V8z" fill="#1a76b8" stroke="#0d4d78" stroke-width="1.5"/>
  <g fill="#e5f1f8">
    <rect x="6" y="13" width="4" height="4"/><rect x="12" y="13" width="4" height="4"/><rect x="18" y="13" width="4" height="4"/>
    <rect x="6" y="19" width="4" height="4"/><rect x="12" y="19" width="4" height="4"/><rect x="18" y="19" width="4" height="4"/>
    <rect x="11" y="25" width="6" height="7"/>
  </g>
</svg>`.trim();

const TOWNHOUSE_ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="28" height="34" viewBox="0 0 28 34">
  <path d="M14 2 3 12v20h22V12z" fill="#c2410c" stroke="#7c2d0c" stroke-width="1.5"/>
  <g fill="#faeee5">
    <rect x="7" y="16" width="5" height="5"/><rect x="16" y="16" width="5" height="5"/>
    <rect x="11" y="24" width="6" height="8"/>
  </g>
</svg>`.trim();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function markerIcon(isTownHouse: boolean, g: any) {
  const svg = isTownHouse ? TOWNHOUSE_ICON_SVG : BUILDING_ICON_SVG;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new g.maps.Size(28, 34),
    anchor: new g.maps.Point(14, 34),
  };
}

/**
 * A Google map plotting every building that has coordinates, with a marker per
 * building (click → name/address + link to its detail page). All of the org's
 * geo-fence polygons are overlaid under the markers (fixes11 §2.5). Fits the
 * view to all markers. Degrades to a message when no Maps key or no located
 * buildings.
 */
export function BuildingsMap({
  buildings,
  areas = [],
}: {
  buildings: Building[];
  areas?: Area[];
}) {
  const { t } = useLocalization();
  const ref = useRef<HTMLDivElement>(null);

  const located = useMemo(
    () => buildings.filter((b) => b.latitude != null && b.longitude != null),
    [buildings],
  );
  const zones = useMemo(
    () =>
      areas
        .map((a) => (a.area_polygon ? geoJSONToPath(a.area_polygon) : null))
        .filter((p): p is { lat: number; lng: number }[] => !!p && p.length >= 3),
    [areas],
  );
  // Stable dependency so the map only rebuilds when the plotted set changes.
  const signature =
    located.map((b) => `${b.id}:${b.latitude},${b.longitude}`).join("|") +
    "@" +
    zones.map((z) => z.length).join(",");

  useEffect(() => {
    if (!mapsKey || !ref.current || located.length === 0) return;
    loadGoogleMaps()
      .then(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const g = (window as any).google;
        const map = new g.maps.Map(ref.current, {
          disableDefaultUI: true,
          zoomControl: true,
        });
        const bounds = new g.maps.LatLngBounds();
        const info = new g.maps.InfoWindow();
        // Geo-fence overlays render under the building markers (fixes11 §2.5).
        zones.forEach((path, i) => {
          const color = ZONE_COLORS[i % ZONE_COLORS.length];
          new g.maps.Polygon({
            paths: path,
            map,
            fillColor: color,
            fillOpacity: 0.12,
            strokeColor: color,
            strokeWeight: 2,
            clickable: false,
          });
        });
        located.forEach((b) => {
          const pos = { lat: b.latitude as number, lng: b.longitude as number };
          const display = buildingDisplayName(b);
          const marker = new g.maps.Marker({
            position: pos,
            map,
            title: display,
            icon: markerIcon(!!b.is_town_house, g),
          });
          marker.addListener("click", () => {
            info.setContent(
              `<div style="font-size:13px;line-height:1.4">` +
                `<strong>${escapeHtml(display)}</strong>` +
                (b.building_address ? `<br/>${escapeHtml(b.building_address)}` : "") +
                `<br/><a href="/dashboard/buildings/${b.id}" style="color:#d6249f;text-decoration:none">` +
                `${escapeHtml(t("buildings.view", "הצג בניין »"))}</a>` +
                `</div>`,
            );
            info.open({ anchor: marker, map });
          });
          bounds.extend(pos);
        });
        if (located.length === 1) {
          map.setCenter(bounds.getCenter());
          map.setZoom(15);
        } else {
          map.fitBounds(bounds, 48);
        }
      })
      .catch(() => {
        /* leave the container empty on load failure */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  if (!mapsKey) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("map.set_key", "להצגת מפה הגדר מפתח Google Maps.")}
      </p>
    );
  }
  if (located.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("buildings.none_located", "אין בניינים עם קואורדינטות להצגה על המפה.")}
      </p>
    );
  }

  return <div ref={ref} className="w-full h-96 rounded-md border border-border" />;
}
