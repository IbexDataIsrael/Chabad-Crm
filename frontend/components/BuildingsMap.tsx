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
          const marker = new g.maps.Marker({ position: pos, map, title: display });
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
