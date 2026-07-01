"use client";

import { useEffect, useMemo, useRef } from "react";

import { loadGoogleMaps, mapsKey } from "@/lib/maps";
import { useLocalization } from "@/lib/localization";
import type { Building } from "@/lib/types";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string),
  );
}

/**
 * A Google map plotting every building that has coordinates, with a marker per
 * building (click → name/address + link to its detail page). Fits the view to
 * all markers. Degrades to a message when no Maps key or no located buildings.
 */
export function BuildingsMap({ buildings }: { buildings: Building[] }) {
  const { t } = useLocalization();
  const ref = useRef<HTMLDivElement>(null);

  const located = useMemo(
    () => buildings.filter((b) => b.latitude != null && b.longitude != null),
    [buildings],
  );
  // Stable dependency so the map only rebuilds when the located set changes.
  const signature = located
    .map((b) => `${b.id}:${b.latitude},${b.longitude}`)
    .join("|");

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
        located.forEach((b) => {
          const pos = { lat: b.latitude as number, lng: b.longitude as number };
          const marker = new g.maps.Marker({ position: pos, map, title: b.building_name });
          marker.addListener("click", () => {
            info.setContent(
              `<div style="font-size:13px;line-height:1.4">` +
                `<strong>${escapeHtml(b.building_name)}</strong>` +
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
      <p className="text-sm text-gray-400">
        {t("map.set_key", "להצגת מפה הגדר מפתח Google Maps.")}
      </p>
    );
  }
  if (located.length === 0) {
    return (
      <p className="text-sm text-gray-400">
        {t("buildings.none_located", "אין בניינים עם קואורדינטות להצגה על המפה.")}
      </p>
    );
  }

  return <div ref={ref} className="w-full h-96 rounded-md border border-gray-200" />;
}
