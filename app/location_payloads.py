"""Recognize location shares sent as ordinary mesh text.

Used by the map's shared-locations layer (``GET /api/messages/locations``).
The MGRS rule mirrors ``frontend/src/utils/mgrsText.ts`` so the layer and the
chat agree on what an MGRS reference is. Formats, first match wins:

- ``marker``: meshcore-open ``m:<lat>,<lon>|<label>|<flags>`` (whole body; same
  regex as ``parseMarker`` in ``frontend/src/utils/meshcoreOpenPayloads.ts``).
- ``mgrs``: an MGRS reference such as ``31U FT 45332 73249`` (upper case, 2-5
  digits per half, so 1 m to 1 km precision). The pin is the centre of the grid
  square. Upper case only: lower case would also match short hex strings.
- ``decimal``: a ``lat, lon`` pair with at least 4 decimals on both numbers
  (MeshCore One and meshcore-open send 6). The 4-decimal floor keeps text such
  as "1.5, 2.5" off the map; the chat's own coordinate cards are unaffected.

Exact ``(0, 0)`` and out-of-range values are rejected, like ``isValidLocation``.
"""

import re
from dataclasses import dataclass
from typing import Literal

from app.mgrs import mgrs_to_point

LocationFormat = Literal["marker", "mgrs", "decimal"]

_MARKER = re.compile(r"^m:(-?[0-9.]+),(-?[0-9.]+)\|([^|]*)\|([^\n]*)$")
_DECIMAL = re.compile(r"(?<![\d.])(-?\d{1,3}\.\d{4,})\s*,\s*(-?\d{1,3}\.\d{4,})(?![\d.])")
_MGRS = re.compile(
    r"(?<![A-Za-z0-9])(\d{1,2})([C-HJ-NP-X])\s?([A-HJ-NP-Z][A-HJ-NP-V])\s?"
    r"(?:(\d{2,5})\s+(\d{2,5})|(\d{4,10}))(?![A-Za-z0-9])"
)


@dataclass(frozen=True)
class LocationShare:
    lat: float
    lon: float
    format: LocationFormat
    raw: str  # the matched text
    label: str = ""
    flags: str = ""
    precision_m: float | None = None  # MGRS grid-square size; None for exact points


def _valid(lat: float, lon: float) -> bool:
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return False
    return not (lat == 0 and lon == 0)


def _parse_marker(body: str) -> LocationShare | None:
    match = _MARKER.match(body.strip())
    if match is None:
        return None
    try:
        lat, lon = float(match.group(1)), float(match.group(2))
    except ValueError:
        return None
    if not _valid(lat, lon):
        return None
    return LocationShare(
        lat=lat,
        lon=lon,
        format="marker",
        raw=body.strip(),
        label=match.group(3).strip(),
        flags=match.group(4).strip(),
    )


def _parse_mgrs(body: str) -> LocationShare | None:
    for match in _MGRS.finditer(body):
        east, north, compact = match.group(4), match.group(5), match.group(6)
        if east is not None and len(east) != len(north):
            continue
        if compact is not None and len(compact) % 2 != 0:
            continue
        digits = compact if compact is not None else f"{east}{north}"
        reference = f"{match.group(1)}{match.group(2)}{match.group(3)}{digits}"
        try:
            point = mgrs_to_point(reference)
        except ValueError:
            continue
        if not _valid(point.lat, point.lon):
            continue
        return LocationShare(
            lat=point.lat,
            lon=point.lon,
            format="mgrs",
            raw=match.group(0),
            precision_m=point.precision_m,
        )
    return None


def _parse_decimal(body: str) -> LocationShare | None:
    for match in _DECIMAL.finditer(body):
        lat, lon = float(match.group(1)), float(match.group(2))
        if _valid(lat, lon):
            return LocationShare(lat=lat, lon=lon, format="decimal", raw=match.group(0))
    return None


def parse_location_share(body: str) -> LocationShare | None:
    """The location a message body shares, or None. ``body`` excludes the channel sender prefix."""
    return _parse_marker(body) or _parse_mgrs(body) or _parse_decimal(body)
