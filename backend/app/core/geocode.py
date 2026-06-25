"""Server-side geocoding via the Google Geocoding API.

Used as a fallback to fill a contact's latitude/longitude when an address is
provided without coordinates (e.g. typed manually instead of picking a Places
suggestion). No-op when no key is configured.
"""
import json
import logging
import urllib.parse
import urllib.request
from typing import Optional

from app.config import settings

logger = logging.getLogger("app.geocode")


def geocode_address(address: Optional[str]) -> Optional[tuple[float, float]]:
    """Return (lat, lng) for an address, or None if unavailable."""
    key = settings.geocoding_api_key
    if not key or not address:
        return None
    params = urllib.parse.urlencode({"address": address, "key": key})
    url = f"https://maps.googleapis.com/maps/api/geocode/json?{params}"
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:  # network / parse errors are non-fatal
        logger.warning("geocode request failed for %r: %s", address, exc)
        return None

    if data.get("status") == "OK" and data.get("results"):
        loc = data["results"][0]["geometry"]["location"]
        return float(loc["lat"]), float(loc["lng"])
    logger.warning("geocode status=%s for %r", data.get("status"), address)
    return None
