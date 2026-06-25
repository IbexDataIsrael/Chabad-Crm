"use client";

import { useEffect, useRef } from "react";

import { loadGoogleMaps, mapsKey } from "@/lib/maps";

/** Renders a Google map with a marker via the Maps JavaScript API (no Embed API). */
export function ContactMap({ lat, lng }: { lat: number; lng: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mapsKey || !ref.current) return;
    loadGoogleMaps()
      .then(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const g = (window as any).google;
        const map = new g.maps.Map(ref.current, {
          center: { lat, lng },
          zoom: 15,
          disableDefaultUI: true,
          zoomControl: true,
        });
        new g.maps.Marker({ position: { lat, lng }, map });
      })
      .catch(() => {
        /* ignore */
      });
  }, [lat, lng]);

  if (!mapsKey) {
    return (
      <a
        href={`https://www.google.com/maps?q=${lat},${lng}`}
        target="_blank"
        rel="noreferrer"
        className="text-sm text-status-magenta hover:underline"
      >
        הצג מיקום במפות גוגל ›
      </a>
    );
  }

  return <div ref={ref} className="w-full h-56 rounded-md border border-gray-200" />;
}
