"""Natural (alphanumeric) sort key (fixes17 §3.2, generalized fixes52 §6).
Plain lexicographic ORDER BY puts "10" before "2".

Two flavors, because the fix has to live at two different layers:

- `natural_sort_keys(col, db)` — a SQL ORDER BY key. Only distinguishes
  *whole-value* numeric vs. non-numeric ("2"/"10"/"L" — apartment floor and
  label values, which are always one or the other). It cannot reorder a
  number embedded inside a longer string ("אזור 2" vs. "אזור 10" both read
  as non-numeric and fall back to plain lexicographic order) — a true
  embedded-number natural sort isn't portable SQL across Postgres/SQLite.
  Used for paginated, DB-sorted endpoints (apartments list, contacts list)
  where sorting outside the DB would break LIMIT/OFFSET.
- `natural_sort_key(value)` — a Python sort key, splitting the string into
  alternating digit/non-digit runs and comparing digit runs numerically
  (same behavior as the frontend's `Intl.Collator(..., {numeric: true})`).
  Handles the embedded-number case correctly. Used for endpoints that
  already return their full, unpaginated result set (areas, report numbers)
  — sorting in Python after the query is both correct and cheap there.
"""
import re

from sqlalchemy import case, func
from sqlalchemy.orm import Session

_CHUNK_RE = re.compile(r"\d+|\D+")


def natural_sort_key(value: str) -> tuple:
    """Python natural-sort key: ("", 0) < ("", 1) < ("a", 0) ordering per
    chunk, digits compared as ints so "2" < "10" even mid-string."""
    if not value:
        return ((0, ""),)
    return tuple(
        (1, int(chunk)) if chunk.isdigit() else (0, chunk)
        for chunk in _CHUNK_RE.findall(value)
    )


def natural_sort_keys(col, db: Session):
    if db.get_bind().dialect.name == "postgresql":
        is_numeric = col.op("~")(r"^\d+$")
    else:
        is_numeric = ~col.op("GLOB")("*[^0-9]*")
    # NULL values keep sorting last (the caller wraps keys in nullslast).
    return [
        case((col.is_(None), None), (is_numeric, func.length(col)), else_=0),
        col,
    ]
