"""Plan 16 case (a): find a name for a full public key that has none locally.

Order of sources, cheapest and most private first:

1. The locally synced analyzer directory (``external_map_nodes``, plan 04's
   external map sync). No network, nothing leaves the host.
2. The ``analyzer_resolved_names`` cache: a fresh positive answer is reused
   for :data:`POSITIVE_TTL_SECONDS`, a fresh miss for
   :data:`NEGATIVE_TTL_SECONDS`.
3. The configured analyzer sites that opted in to name resolution
   (``AnalyzerSite.resolution_enabled`` with a ``node_api_url_template``):
   one GET per site with ``{pubkey}`` substituted, first name wins. The
   public key of the contact being resolved is the only thing sent.

Case (b), asking an analyzer about short hop hashes RTFM-EV has never seen a
full key for, is deliberately not built here (plan 16 section 4.4).
"""

from __future__ import annotations

import logging
import time
from collections.abc import Iterable
from dataclasses import dataclass

import httpx

from app.models import AnalyzerSite
from app.repository.analyzer_names import AnalyzerResolvedNameRepository
from app.repository.external_map import ExternalMapRepository
from app.repository.settings import AppSettingsRepository

logger = logging.getLogger(__name__)

POSITIVE_TTL_SECONDS = 7 * 86400
NEGATIVE_TTL_SECONDS = 86400
FETCH_TIMEOUT_SECONDS = 10.0

EXTERNAL_MAP_SOURCE = "external_map"

_NAME_KEYS = ("name", "Name", "node_name", "nodeName")
_NESTED_KEYS = ("stat", "node", "data", "result", "detail")
_MAX_NESTING = 2


@dataclass(frozen=True)
class NameResolution:
    """Outcome of one lookup. ``name`` is ``None`` for "asked, no name"."""

    name: str | None
    source: str
    cached: bool


def extract_name(payload: object, depth: int = 0) -> str | None:
    """Pull a node name out of an analyzer's JSON, whatever the envelope.

    Accepts a top-level ``name`` (or ``Name`` / ``node_name`` / ``nodeName``)
    and looks two levels into common wrapper objects (``stat`` as cornmeister's
    ``/api/nodes/{id}/detail`` uses, ``node``, ``data``, ``result``,
    ``detail``). Blank names count as absent.
    """
    if not isinstance(payload, dict):
        return None
    for key in _NAME_KEYS:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    if depth >= _MAX_NESTING:
        return None
    for key in _NESTED_KEYS:
        found = extract_name(payload.get(key), depth + 1)
        if found:
            return found
    return None


def resolution_sites(sites: Iterable[AnalyzerSite]) -> list[AnalyzerSite]:
    """The sites allowed to be asked: opted in and carrying a node API template."""
    return [s for s in sites if s.resolution_enabled and s.node_api_url_template]


async def _fetch_name_from_site(site: AnalyzerSite, pubkey: str) -> str | None:
    template = site.node_api_url_template or ""
    url = template.replace("{pubkey}", pubkey)
    try:
        async with httpx.AsyncClient(
            timeout=FETCH_TIMEOUT_SECONDS, follow_redirects=True
        ) as client:
            response = await client.get(url)
    except httpx.HTTPError as exc:
        logger.info("Analyzer %s unreachable for name resolution: %s", site.name, exc)
        return None
    if response.status_code != 200:
        logger.info(
            "Analyzer %s answered %s for name resolution of %s",
            site.name,
            response.status_code,
            pubkey[:12],
        )
        return None
    try:
        payload = response.json()
    except ValueError:
        logger.info("Analyzer %s returned non-JSON for name resolution", site.name)
        return None
    return extract_name(payload)


async def resolve_pubkey_name(
    pubkey: str, *, force: bool = False, now: int | None = None
) -> NameResolution | None:
    """Resolve a name for ``pubkey`` (64-hex) through the sources listed above.

    Returns ``None`` when there was nowhere to ask: no directory entry, no
    cached answer and no analyzer site opted in. ``force`` skips a fresh cache
    entry and asks the network again.
    """
    key = pubkey.lower()
    timestamp = now if now is not None else int(time.time())

    directory_node = await ExternalMapRepository.get(key)
    if directory_node is not None and directory_node.name.strip():
        return NameResolution(directory_node.name.strip(), EXTERNAL_MAP_SOURCE, False)

    cached = await AnalyzerResolvedNameRepository.get(key)
    if cached is not None and not force:
        ttl = POSITIVE_TTL_SECONDS if cached.resolved_name else NEGATIVE_TTL_SECONDS
        if timestamp - cached.resolved_at < ttl:
            return NameResolution(cached.resolved_name, cached.source_site, True)

    sites = resolution_sites((await AppSettingsRepository.get()).analyzer_sites)
    if not sites:
        if cached is None:
            return None
        return NameResolution(cached.resolved_name, cached.source_site, True)

    for site in sites:
        name = await _fetch_name_from_site(site, key)
        if name:
            await AnalyzerResolvedNameRepository.upsert(key, name, site.name, timestamp)
            return NameResolution(name, site.name, False)

    last = sites[-1].name
    await AnalyzerResolvedNameRepository.upsert(key, None, last, timestamp)
    return NameResolution(None, last, False)
