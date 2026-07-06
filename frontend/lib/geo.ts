// Point-in-polygon check for the building geofence guardrail (fixes7 §7B).

/** Parse a stored GeoJSON Polygon string into its outer ring of [lng, lat]. */
export function polygonRing(geojson: string | null | undefined): number[][] | null {
  if (!geojson) return null;
  try {
    const obj = JSON.parse(geojson);
    const ring = obj?.coordinates?.[0];
    if (!Array.isArray(ring) || ring.length < 3) return null;
    return ring as number[][];
  } catch {
    return null;
  }
}

/**
 * Ray-casting point-in-polygon test against a GeoJSON Polygon string.
 * Returns null when the check can't run (no polygon / no coordinates), so
 * callers can distinguish "outside" from "unknown".
 */
export function pointInPolygon(
  lat: number | null | undefined,
  lng: number | null | undefined,
  geojson: string | null | undefined,
): boolean | null {
  if (lat == null || lng == null) return null;
  const ring = polygonRing(geojson);
  if (!ring) return null;

  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; // [lng, lat]
    const [xj, yj] = ring[j];
    const intersects =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}
