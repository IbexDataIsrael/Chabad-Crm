"use client";

import { useEffect, useRef, useState } from "react";

import { loadGoogleMaps, mapsKey } from "@/lib/maps";

// Sheepshead Bay, Brooklyn — sensible default center when an area has no polygon yet.
const DEFAULT_CENTER = { lat: 40.5862, lng: -73.9442 };

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Serialize a google.maps path (MVCArray) to a GeoJSON Polygon string (closed ring). */
function pathToGeoJSON(path: any): string | null {
  const coords: number[][] = [];
  path.forEach((p: any) => coords.push([p.lng(), p.lat()]));
  if (coords.length < 3) return null;
  coords.push([coords[0][0], coords[0][1]]); // close the ring
  return JSON.stringify({ type: "Polygon", coordinates: [coords] });
}

/** Parse a GeoJSON Polygon string into a {lat,lng}[] path (drops the closing point). */
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

/**
 * Interactive polygon editor for an area boundary. Implemented directly on the core
 * Google Maps API (no Drawing library): click the map to drop vertices, then finish to
 * get an editable polygon whose vertices can be dragged. Emits a GeoJSON Polygon string.
 * Without an API key — or if Maps fails to load — it degrades to a raw GeoJSON textarea.
 */
export function AreaPolygonMap({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (geojson: string | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const polygonRef = useRef<any>(null); // finalized, editable polygon
  // In-progress drawing state.
  const draftRef = useRef<{ pts: any[]; line: any; markers: any[] } | null>(null);
  const clickListenerRef = useRef<any>(null);

  const [loadError, setLoadError] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [mode, setMode] = useState<"idle" | "drawing">("idle");
  const [draftCount, setDraftCount] = useState(0);
  const [hasPolygon, setHasPolygon] = useState(!!value);

  // Keep the latest onChange without re-running the map setup effect.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const initialRef = useRef(value);

  // Attach edit listeners to a finalized polygon so vertex drags re-emit GeoJSON.
  function attachPolygon(polygon: any) {
    polygonRef.current = polygon;
    setHasPolygon(true);
    const emit = () => onChangeRef.current(pathToGeoJSON(polygon.getPath()));
    const path = polygon.getPath();
    path.addListener("set_at", emit);
    path.addListener("insert_at", emit);
    path.addListener("remove_at", emit);
    emit();
  }

  useEffect(() => {
    if (!mapsKey || !ref.current) return;
    let cancelled = false;

    loadGoogleMaps()
      .then(() => {
        if (cancelled || !ref.current) return;
        const g = (window as any).google;

        const map = new g.maps.Map(ref.current, {
          center: DEFAULT_CENTER,
          zoom: 13,
          mapTypeControl: false,
          streetViewControl: false,
          // Hint that clicking is the interaction; cursor stays a crosshair while drawing.
          clickableIcons: false,
        });
        mapRef.current = map;
        // Tiles can take a beat; flip status once the map has painted its first idle.
        g.maps.event.addListenerOnce(map, "idle", () => {
          if (!cancelled) setStatus("ready");
        });
        // Safety: mark ready shortly even if `idle` is delayed.
        setTimeout(() => {
          if (!cancelled) setStatus("ready");
        }, 1500);

        // Render an existing boundary (and zoom to fit it).
        const existing = initialRef.current && geoJSONToPath(initialRef.current);
        if (existing && existing.length >= 3) {
          const polygon = new g.maps.Polygon({
            paths: existing,
            map,
            fillColor: "#d6249f",
            fillOpacity: 0.15,
            strokeColor: "#d6249f",
            strokeWeight: 2,
            editable: true,
          });
          attachPolygon(polygon);
          const bounds = new g.maps.LatLngBounds();
          existing.forEach((p) => bounds.extend(p));
          map.fitBounds(bounds);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("AreaPolygonMap: Google Maps failed to load", err);
          setLoadError(true);
        }
      });

    return () => {
      cancelled = true;
      teardownDraft();
      if (polygonRef.current) polygonRef.current.setMap(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Remove the in-progress polyline + vertex markers and the map click listener.
  function teardownDraft() {
    const g = (window as any).google;
    if (clickListenerRef.current && g) {
      g.maps.event.removeListener(clickListenerRef.current);
      clickListenerRef.current = null;
    }
    const draft = draftRef.current;
    if (draft) {
      draft.line?.setMap(null);
      draft.markers.forEach((m) => m.setMap(null));
      draftRef.current = null;
    }
    setDraftCount(0);
  }

  function startDrawing() {
    const g = (window as any).google;
    const map = mapRef.current;
    if (!g || !map) return;

    // One boundary per area — clear any existing finalized polygon and old draft.
    if (polygonRef.current) {
      polygonRef.current.setMap(null);
      polygonRef.current = null;
    }
    setHasPolygon(false);
    onChange(null);
    teardownDraft();

    const line = new g.maps.Polyline({
      map,
      path: [],
      strokeColor: "#d6249f",
      strokeWeight: 2,
    });
    draftRef.current = { pts: [], line, markers: [] };
    setMode("drawing");

    clickListenerRef.current = map.addListener("click", (e: any) => {
      const draft = draftRef.current;
      if (!draft) return;

      // Clicking the first vertex (when we already have a triangle) closes the shape.
      if (draft.pts.length >= 3) {
        const first = draft.pts[0];
        const dLat = Math.abs(first.lat() - e.latLng.lat());
        const dLng = Math.abs(first.lng() - e.latLng.lng());
        // ~ proximity threshold relative to the current zoom (rough but effective).
        const tol = 0.0006 * Math.pow(2, 13 - map.getZoom());
        if (dLat < tol && dLng < tol) {
          finishDrawing();
          return;
        }
      }

      draft.pts.push(e.latLng);
      draft.line.setPath(draft.pts);
      const marker = new g.maps.Marker({
        position: e.latLng,
        map,
        icon: {
          path: g.maps.SymbolPath.CIRCLE,
          scale: 5,
          fillColor: "#d6249f",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
      });
      // Clicking the first marker also closes the shape.
      if (draft.pts.length === 1) {
        marker.addListener("click", () => {
          if (draftRef.current && draftRef.current.pts.length >= 3) finishDrawing();
        });
      }
      draft.markers.push(marker);
      setDraftCount(draft.pts.length);
    });
  }

  function finishDrawing() {
    const g = (window as any).google;
    const map = mapRef.current;
    const draft = draftRef.current;
    if (!g || !map || !draft || draft.pts.length < 3) return;

    const polygon = new g.maps.Polygon({
      paths: draft.pts.slice(),
      map,
      fillColor: "#d6249f",
      fillOpacity: 0.15,
      strokeColor: "#d6249f",
      strokeWeight: 2,
      editable: true,
    });
    teardownDraft();
    setMode("idle");
    attachPolygon(polygon);
  }

  function clear() {
    if (polygonRef.current) {
      polygonRef.current.setMap(null);
      polygonRef.current = null;
    }
    teardownDraft();
    setHasPolygon(false);
    setMode("idle");
    onChange(null);
  }

  if (!mapsKey || loadError) {
    // No Maps key (or the map failed to load): let admins paste/inspect raw GeoJSON
    // so the field still works.
    return (
      <div className="space-y-1">
        <textarea
          dir="ltr"
          rows={3}
          className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs"
          placeholder='{"type":"Polygon","coordinates":[[[lng,lat],…]]}'
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
        />
        <p className="text-xs text-gray-400">
          {loadError
            ? "טעינת מפת Google נכשלה — בדוק את מפתח ה-API (הפעלת Maps JavaScript API והרשאת המקור localhost). ניתן להזין GeoJSON ידנית."
            : "לציור פוליגון אינטראקטיבי הגדר מפתח Google Maps."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative w-full h-80 rounded-md border border-gray-200 bg-gray-100 overflow-hidden">
        <div ref={ref} className="absolute inset-0" style={{ minHeight: 320 }} />
        {status === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400 pointer-events-none">
            טוען מפה…
          </div>
        )}
      </div>

      {mode === "drawing" ? (
        <p className="text-xs text-gray-500 leading-relaxed">
          לחץ על המפה כדי להוסיף נקודות ({draftCount}). כשיש לפחות 3 נקודות, לחץ על
          הנקודה הראשונה או על «סיום» כדי לסגור את התחום.
        </p>
      ) : (
        <p className="text-xs text-gray-500 leading-relaxed">
          {hasPolygon
            ? "התחום מוגדר. ניתן לגרור כל נקודה כדי לעדכן את הצורה, או לצייר מחדש."
            : "לחץ «התחל ציור» ואז לחץ על המפה כדי לסמן את גבולות האזור."}
        </p>
      )}

      <div className="flex items-center justify-between text-sm">
        <span className={hasPolygon ? "text-status-green" : "text-gray-500"}>
          {hasPolygon
            ? "✓ תחום מוגדר"
            : mode === "drawing"
              ? "במצב ציור…"
              : "אין תחום"}
        </span>
        <div className="flex items-center gap-3">
          {mode === "drawing" ? (
            <>
              <button
                type="button"
                onClick={finishDrawing}
                disabled={draftCount < 3}
                className="text-status-magenta hover:underline disabled:text-gray-300 disabled:no-underline"
              >
                סיום
              </button>
              <button
                type="button"
                onClick={clear}
                className="text-status-darkred hover:underline"
              >
                ביטול
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={startDrawing}
                className="text-status-magenta hover:underline"
              >
                {hasPolygon ? "צייר תחום מחדש" : "התחל ציור"}
              </button>
              {hasPolygon && (
                <button
                  type="button"
                  onClick={clear}
                  className="text-status-darkred hover:underline"
                >
                  נקה תחום
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
