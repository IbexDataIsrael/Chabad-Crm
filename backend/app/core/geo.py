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


def convex_hull(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """fixes60 §5: the smallest polygon (as (lng, lat) tuples, open ring — the
    caller closes it) wrapping every point — Andrew's monotone chain, O(n log
    n), no external geometry dependency. Used to generate an Area's boundary
    from its buildings' coordinates. Overreaches into a neighboring area's
    territory when two areas' buildings interleave rather than sit in
    cleanly separated blocks — a known, accepted tradeoff (see
    docs/fixes60-plan.md decision #4), not something this function tries to
    fix with a tighter concave hull."""
    pts = sorted(set(points))
    if len(pts) <= 2:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower: list[tuple[float, float]] = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper: list[tuple[float, float]] = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def hull_to_geojson(hull: list[tuple[float, float]]) -> str:
    """A closed GeoJSON Polygon string from an open hull ring of (lng, lat)
    tuples — the exact shape `polygon_ring` above (and the frontend's
    `AreaPolygonMap`/`AreasMap`/`BuildingsMap`) already reads."""
    ring = list(hull) + [hull[0]]
    return json.dumps({"type": "Polygon", "coordinates": [[[lng, lat] for lng, lat in ring]]})


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
