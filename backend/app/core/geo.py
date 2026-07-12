"""Point-in-polygon test for area geofencing (fixes18 §4.3).

Areas store their boundary as a GeoJSON Polygon string (drawn in
AreaPolygonMap). Only the outer ring is used — holes never occur here.
"""
import json
from typing import Optional


def polygon_ring(geojson: Optional[str]) -> Optional[list[tuple[float, float]]]:
    """The outer ring of a GeoJSON Polygon string as (lng, lat) tuples, or
    None when the value is missing/malformed/too short to enclose anything."""
    if not geojson:
        return None
    try:
        ring = json.loads(geojson)["coordinates"][0]
        points = [(float(p[0]), float(p[1])) for p in ring]
    except (ValueError, TypeError, KeyError, IndexError):
        return None
    return points if len(points) >= 3 else None


def point_in_polygon(
    lng: float, lat: float, ring: list[tuple[float, float]]
) -> bool:
    """Ray casting — does the point fall inside the (open or closed) ring?"""
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat):
            x_cross = (xj - xi) * (lat - yi) / (yj - yi) + xi
            if lng < x_cross:
                inside = not inside
        j = i
    return inside
