"""Dutch Antenneregister sync for the map's antenna layer.

Source: the public WFS behind antenneregister.nl (run by the Antennebureau, part
of the RDI). Its capabilities state ``Fees: none`` and ``AccessConstraints:
none``. Two feature types are used:

* ``Antennes_Groepen``: one row per antenna with ``FREQUENTIE`` (a string such as
  ``"816 MHz"`` or ``"925-934.8 MHz"``), ``SAT_CODE``, height, bearing and power
  in dBW. Its geometry is a placeholder, so position comes from the site.
* ``Antennes``: one row per site with RD New ``X``/``Y`` and ``ANT_IDS``, a
  comma-separated list of the ``AI_ID`` values of the antennas on it.

Only antennas in the bands next to the two LoRa mesh bands are kept (see
:data:`BANDS`): the 700/800/900 MHz mobile downlinks either side of 868 MHz, and
400-470 MHz (PAMR and base stations) around 433 MHz. Nothing in the register
transmits inside 863-870 or 433.05-434.79 MHz: those bands are licence-exempt
and unregistered. Licensed amateur stations (70 cm is 430-440 MHz) are listed
as sites without any antenna rows, so their band and power are unknown; they
are kept as sites with the :data:`AMATEUR` band and no transmitters. The
service only serves RD New (EPSG:28992), so positions are converted with
:mod:`app.rd_new`.

A sync pages through both types (about 80 + 19 pages of 2000) and takes a few
minutes, so it runs as a background task; callers poll :func:`get_sync_state`.
There is no periodic sync: it only runs when the user asks.
"""

import asyncio
import logging
import re
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import NamedTuple

import httpx

from app.models import AntennaRegisterSite, AntennaRegisterTransmitter
from app.rd_new import rd_to_wgs84
from app.repository.antenna_register import AntennaRegisterRepository, SiteRow
from app.version_info import user_agent

logger = logging.getLogger(__name__)

WFS_URL = "https://antenneregister.nl/mapserver/wfs/"
PAGE_SIZE = 2000  # The server caps a page at 2000 features.
# Guard against a runaway feed: 400 pages = 800k rows (today: ~160k antennas
# match the frequency filter, ~38k sites in total).
MAX_PAGES = 400
_FETCH_TIMEOUT = 120.0

# (label, low MHz, high MHz): registered bands next to the mesh bands. An antenna
# is kept when its registered frequency (or range) overlaps one of these. The
# map groups 700/800/900 as "near 868 MHz" and 450 as "near 433 MHz".
BANDS: tuple[tuple[str, float, float], ...] = (
    ("450", 400.0, 470.0),  # PAMR (421-425, 462.65 MHz) and base stations
    ("700", 758.0, 788.0),  # 5G NR n28 downlink
    ("800", 791.0, 821.0),  # LTE band 20 downlink
    ("900", 925.0, 960.0),  # GSM / UMTS / LTE 900 downlink
)
# Band label for a licensed amateur station: the register lists the site but no
# antenna rows, so frequency and power are unknown.
AMATEUR = "amateur"

# Server-side pre-filter so only 4xx/7xx/8xx/9xx MHz antennas are transferred.
# It is deliberately loose (also matches e.g. "9200-9500 MHz"); BANDS decides.
_FREQ_FILTER = (
    "<Filter><Or>"
    + "".join(
        "<PropertyIsLike wildCard='*' singleChar='#' escapeChar='!'>"
        f"<ValueReference>FREQUENTIE</ValueReference><Literal>{lead}##*MHz</Literal>"
        "</PropertyIsLike>"
        for lead in "4789"
    )
    + "</Or></Filter>"
)

_FREQ_RE = re.compile(r"^\s*([\d.,]+)\s*(?:-\s*([\d.,]+))?\s*MHz\s*$", re.IGNORECASE)

# Rough RD New extent of the Netherlands; anything outside is a placeholder.
_RD_X = (-7_000.0, 300_000.0)
_RD_Y = (289_000.0, 629_000.0)


class AntennaRegisterSyncError(Exception):
    """Raised when an antenna-register sync cannot complete."""


@dataclass
class SyncState:
    running: bool = False
    phase: str | None = None  # "antennas" | "sites"
    fetched: int = 0
    error: str | None = None


_state = SyncState()
_task: asyncio.Task | None = None


def get_sync_state() -> SyncState:
    return _state


def parse_frequency_mhz(value: object) -> tuple[float, float] | None:
    """``"816 MHz"`` -> (816, 816); ``"925-934.8 MHz"`` -> (925, 934.8)."""
    if not isinstance(value, str):
        return None
    m = _FREQ_RE.match(value)
    if not m:
        return None
    try:
        a = float(m.group(1).replace(",", "."))
        b = float(m.group(2).replace(",", ".")) if m.group(2) else a
    except ValueError:
        return None
    return min(a, b), max(a, b)


def band_for(value: object) -> str | None:
    """The :data:`BANDS` label a registered frequency falls in, or ``None``."""
    rng = parse_frequency_mhz(value)
    if rng is None:
        return None
    lo, hi = rng
    for label, band_lo, band_hi in BANDS:
        if lo <= band_hi and hi >= band_lo:
            return label
    return None


def _num(value: object) -> float | None:
    return float(value) if isinstance(value, (int, float)) else None


class Sector(NamedTuple):
    """One ``Antennes_Groepen`` row, kept compact while the sync pages through
    ~170k of them."""

    system: str
    band: str
    frequency: str
    height_m: float | None
    bearing_deg: float | None
    power_dbw: float | None
    directional: bool


def parse_sector(props: dict) -> tuple[int, Sector] | None:
    """``(AI_ID, sector)`` for an in-band ``Antennes_Groepen`` row, else None.

    ``AI_ID`` is one installation (system) on a site; each row under it is one
    antenna, usually a sector with its own bearing.
    """
    ai_id = props.get("AI_ID")
    if not isinstance(ai_id, int):
        return None
    band = band_for(props.get("FREQUENTIE"))
    if band is None:
        return None
    return ai_id, Sector(
        # Interned: a few dozen distinct values repeated ~170k times.
        system=sys.intern(str(props.get("SAT_CODE") or "")),
        band=band,
        frequency=sys.intern(str(props.get("FREQUENTIE") or "")),
        height_m=_num(props.get("HOOGTE")),
        bearing_deg=_num(props.get("HOOFDSTRAALRICHTING")),
        power_dbw=_num(props.get("ZENDVERMOGEN")),
        directional=props.get("DIR_NONDIR") == "D",
    )


def _max(values: list[float | None]) -> float | None:
    present = [v for v in values if v is not None]
    return max(present) if present else None


def fold_sectors(sectors: list[Sector]) -> list[AntennaRegisterTransmitter]:
    """One transmitter per system + frequency, ordered by band then system."""
    order = [label for label, _, _ in BANDS]
    groups: dict[tuple[str, str, str], list[Sector]] = {}
    for sector in sectors:
        groups.setdefault((sector.band, sector.system, sector.frequency), []).append(sector)
    out = [
        AntennaRegisterTransmitter(
            system=system,
            band=band,
            frequency=frequency,
            sectors=len(group),
            bearings_deg=sorted(
                {s.bearing_deg for s in group if s.directional and s.bearing_deg is not None}
            ),
            omni=any(not s.directional for s in group),
            height_m=_max([s.height_m for s in group]),
            power_dbw=_max([s.power_dbw for s in group]),
        )
        for (band, system, frequency), group in groups.items()
    ]
    out.sort(
        key=lambda t: (
            order.index(t.band),
            t.system,
            parse_frequency_mhz(t.frequency) or (0.0, 0.0),
        )
    )
    return out


def _ant_ids(props: dict) -> list[int]:
    return [int(raw) for raw in str(props.get("ANT_IDS") or "").split(",") if raw.strip().isdigit()]


def _is_amateur(props: dict) -> bool:
    return bool(props.get("ZENDAMATEURS")) or "ZENDAMATEURS" in str(props.get("HOOFDSOORT") or "")


def collect_site_feature(
    merged: dict[int, dict], feature: dict, sectors: dict[int, list[Sector]]
) -> None:
    """Add an ``Antennes`` feature to ``merged`` (by site ID) if it has in-band
    antennas or is a licensed amateur station.

    The register lists some sites more than once (same ID and position, one
    feature per antenna group, e.g. a mobile group and a microwave-link group),
    so features are merged on ID before :func:`build_site`; keeping only the last
    one would drop transmitters.
    """
    props = feature.get("properties") or {}
    site_id = props.get("ID")
    if not isinstance(site_id, int):
        return
    if not _is_amateur(props) and not any(a in sectors for a in _ant_ids(props)):
        return
    existing = merged.get(site_id)
    if existing is None:
        merged[site_id] = {"properties": dict(props), "geometry": feature.get("geometry")}
        return
    into = existing["properties"]
    into["ANT_IDS"] = f"{into.get('ANT_IDS') or ''}, {props.get('ANT_IDS') or ''}"
    kinds = f"{into.get('HOOFDSOORT') or ''}, {props.get('HOOFDSOORT') or ''}".split(", ")
    into["HOOFDSOORT"] = ", ".join(dict.fromkeys(k for k in kinds if k))
    if _is_amateur(props):
        into["ZENDAMATEURS"] = 1.0


def build_site(feature: dict, sectors: dict[int, list[Sector]]) -> AntennaRegisterSite | None:
    """A cached site from an ``Antennes`` feature, or None if it has no in-band
    antennas, is not an amateur station, or has no usable position."""
    props = feature.get("properties") or {}
    site_id = props.get("ID")
    if not isinstance(site_id, int):
        return None
    mine: list[Sector] = []
    for ant_id in _ant_ids(props):
        mine.extend(sectors.get(ant_id, ()))
    amateur = _is_amateur(props)
    if not mine and not amateur:
        return None
    x, y = props.get("X"), props.get("Y")
    if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        coords = (feature.get("geometry") or {}).get("coordinates") or []
        if len(coords) < 2:
            return None
        x, y = coords[0], coords[1]
    if not (_RD_X[0] <= x <= _RD_X[1] and _RD_Y[0] <= y <= _RD_Y[1]):
        return None
    lat, lon = rd_to_wgs84(float(x), float(y))
    transmitters = fold_sectors(mine)
    bands = list(dict.fromkeys(t.band for t in transmitters))
    if amateur:
        bands.append(AMATEUR)
    return AntennaRegisterSite(
        id=site_id,
        lat=round(lat, 6),
        lon=round(lon, 6),
        municipality=str(props.get("GEMEENTE") or ""),
        postcode=str(props.get("POSTCODE") or ""),
        place=str(props.get("WOONPLAATSNAAM") or ""),
        kinds=str(props.get("HOOFDSOORT") or ""),
        bands=bands,
        max_power_dbw=_max([t.power_dbw for t in transmitters]),
        max_height_m=_max([t.height_m for t in transmitters]),
        transmitters=transmitters,
    )


async def _fetch_page(
    client: httpx.AsyncClient, typename: str, start: int, flt: str | None
) -> list[dict]:
    params = {
        "SERVICE": "WFS",
        "VERSION": "2.0.0",
        "REQUEST": "GetFeature",
        "TYPENAMES": typename,
        "OUTPUTFORMAT": "application/json",
        "COUNT": str(PAGE_SIZE),
        "STARTINDEX": str(start),
        "SORTBY": "ID",
    }
    if flt:
        params["FILTER"] = flt
    last_exc: Exception | None = None
    for attempt in range(3):
        try:
            response = await client.get(WFS_URL, params=params)
            if response.status_code == 200:
                features = response.json().get("features")
                if not isinstance(features, list):
                    raise AntennaRegisterSyncError("Antenneregister returned no feature list")
                return features
            last_exc = AntennaRegisterSyncError(
                f"Antenneregister returned HTTP {response.status_code}"
            )
        except httpx.HTTPError as exc:
            last_exc = AntennaRegisterSyncError(f"Could not reach the Antenneregister: {exc}")
        except ValueError as exc:
            raise AntennaRegisterSyncError("Antenneregister returned invalid JSON") from exc
        await asyncio.sleep(2 * (attempt + 1))
    assert last_exc is not None
    raise last_exc


async def _fetch_all(client: httpx.AsyncClient, typename: str, flt: str | None = None):
    for page in range(MAX_PAGES):
        features = await _fetch_page(client, typename, page * PAGE_SIZE, flt)
        _state.fetched += len(features)
        for feature in features:
            yield feature
        if len(features) < PAGE_SIZE:
            return
    raise AntennaRegisterSyncError(f"{typename} exceeded {MAX_PAGES} pages; sync aborted")


async def sync_antenna_register() -> tuple[int, int]:
    """Fetch, filter and cache the register. Returns ``(site_count, synced_at)``."""
    async with httpx.AsyncClient(
        timeout=_FETCH_TIMEOUT, headers={"User-Agent": user_agent()}
    ) as client:
        sectors: dict[int, list[Sector]] = {}
        _state.phase, _state.fetched = "antennas", 0
        async for feature in _fetch_all(client, "Antennes_Groepen", _FREQ_FILTER):
            parsed = parse_sector(feature.get("properties") or {})
            if parsed is not None:
                sectors.setdefault(parsed[0], []).append(parsed[1])

        merged: dict[int, dict] = {}
        _state.phase, _state.fetched = "sites", 0
        async for feature in _fetch_all(client, "Antennes"):
            collect_site_feature(merged, feature, sectors)

    rows: list[SiteRow] = []
    for feature in merged.values():
        site = build_site(feature, sectors)
        if site is not None:
            rows.append(AntennaRegisterRepository.to_row(site))

    if not rows:
        # An empty result almost certainly means the service changed shape;
        # keep the previous cache rather than wiping it.
        raise AntennaRegisterSyncError("Antenneregister returned no matching antenna sites")
    synced_at = int(datetime.now(UTC).timestamp())
    count = await AntennaRegisterRepository.replace_all_rows(rows, synced_at)
    logger.info(
        "Antenna register sync stored %d sites (%d in-band antennas)",
        count,
        sum(len(v) for v in sectors.values()),
    )
    return count, synced_at


async def _run() -> None:
    try:
        await sync_antenna_register()
        _state.error = None
    except asyncio.CancelledError:
        raise
    except AntennaRegisterSyncError as exc:
        logger.warning("Antenna register sync failed: %s", exc)
        _state.error = str(exc)
    except Exception as exc:
        logger.error("Antenna register sync crashed: %s", exc, exc_info=True)
        _state.error = f"Sync failed: {exc}"
    finally:
        _state.running = False
        _state.phase = None


def start_antenna_register_sync() -> bool:
    """Start a sync in the background. False when one is already running."""
    global _task
    if _state.running:
        return False
    _state.running = True
    _state.error = None
    _state.fetched = 0
    _task = asyncio.create_task(_run())
    return True


async def stop_antenna_register_sync() -> None:
    """Cancel a running sync (app shutdown)."""
    global _task
    if _task and not _task.done():
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
    _task = None
