"""Check suggested routes against an external analyzer's observed link graph.

Two read-only endpoints of the EU MeshCore Analyzer software are used, on the
host of the configured external map sync URL (``external_map_sync_url``):

- ``GET /api/nodes/{pubkey}/reach``: the contact's neighbours with a packet count
  per direction. Read from the contact's side, ``weHear`` counts packets the
  contact heard from the neighbour and ``theyHear`` packets the neighbour heard
  from the contact. Sending to the contact needs the first of the two.
- ``POST /api/paths/inspect`` (``{"prefixes": [...]}``, at most 8): the most
  plausible full-key chain for the hop prefixes, flagged ``speculative`` when a
  hop-to-hop link was never observed.

This sends the contact's public key and the hop prefixes to that host, so it
only runs when the user asks for it. Validation only: a verdict never changes
the ranking and never builds a route we did not hear ourselves. The analyzer
sees what its MQTT observers hear; a missing link is not proof the link is dead.
"""

from __future__ import annotations

import logging
from typing import Any, Literal
from urllib.parse import urlsplit

import httpx

from app.models import ContactRouteSuggestion, ContactRouteValidation
from app.services.external_map import DEFAULT_EXTERNAL_MAP_URL

logger = logging.getLogger(__name__)

FETCH_TIMEOUT_SECONDS = 10.0
# The analyzer refuses longer inputs (pathInspectMaxPrefixes).
MAX_INSPECT_HOPS = 8

ChainVerdict = Literal["observed", "speculative", "unknown", "not_checked"]
LastHopVerdict = Literal["two_way", "contact_hears_hop", "hop_hears_contact", "not_seen"]
Status = Literal["confirmed", "partial", "unconfirmed"]

_FORWARD_OK = ("two_way", "contact_hears_hop")


class AnalyzerCheckError(Exception):
    """Raised when the analyzer cannot be asked or answers unusably."""


def analyzer_base_url(sync_url: str | None) -> str:
    """``scheme://host`` of the external map sync URL (the default feed when unusable)."""
    for candidate in (sync_url, DEFAULT_EXTERNAL_MAP_URL):
        parts = urlsplit((candidate or "").strip())
        if parts.scheme in ("http", "https") and parts.netloc:
            return f"{parts.scheme}://{parts.netloc}"
    raise AnalyzerCheckError("No analyzer URL configured")


def _count(value: object) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def last_hop_verdict(neighbours: list[Any], hop_prefix: str) -> LastHopVerdict:
    """How the analyzer saw the link between the contact and the hop next to it."""
    prefix = hop_prefix.lower()
    heard_from_hop = heard_by_hop = 0
    for entry in neighbours:
        if not isinstance(entry, dict):
            continue
        pubkey = entry.get("pubkey")
        if not isinstance(pubkey, str) or not pubkey.lower().startswith(prefix):
            continue
        heard_from_hop += _count(entry.get("weHear"))
        heard_by_hop += _count(entry.get("theyHear"))
    if heard_from_hop and heard_by_hop:
        return "two_way"
    if heard_from_hop:
        return "contact_hears_hop"
    if heard_by_hop:
        return "hop_hears_contact"
    return "not_seen"


def chain_verdict(payload: object, hop_count: int) -> tuple[ChainVerdict, list[str], int]:
    """``(chain, hop_names, ambiguous_hops)`` from a ``/api/paths/inspect`` answer."""
    candidates = payload.get("candidates") if isinstance(payload, dict) else None
    top = candidates[0] if isinstance(candidates, list) and candidates else None
    if not isinstance(top, dict):
        return "unknown", [], 0
    path = top.get("path")
    if not isinstance(path, list) or len(path) != hop_count:
        return "unknown", [], 0
    names = [n if isinstance(n, str) else "" for n in top.get("names") or []]
    evidence = top.get("evidence")
    per_hop = evidence.get("perHop") if isinstance(evidence, dict) else None
    ambiguous = sum(
        1
        for hop in per_hop or []
        if isinstance(hop, dict) and _count(hop.get("candidatesConsidered")) > 1
    )
    return ("speculative" if top.get("speculative") else "observed"), names, ambiguous


def overall_status(chain: ChainVerdict, last_hop: LastHopVerdict) -> Status:
    """Confirmed needs every link seen, including hop to contact in the send direction."""
    if chain in ("observed", "not_checked") and last_hop in _FORWARD_OK:
        return "confirmed"
    if chain == "observed" or last_hop != "not_seen":
        return "partial"
    return "unconfirmed"


def _not_checked() -> ContactRouteValidation:
    return ContactRouteValidation(status="not_checked", chain="not_checked", last_hop="not_checked")


async def _get_json(client: httpx.AsyncClient, method: str, url: str, **kwargs: Any) -> Any:
    try:
        response = await client.request(method, url, **kwargs)
    except httpx.HTTPError as exc:
        raise AnalyzerCheckError(f"Could not reach analyzer: {exc}") from exc
    if response.status_code == 404:
        return None
    if response.status_code != 200:
        raise AnalyzerCheckError(f"Analyzer returned HTTP {response.status_code}")
    try:
        return response.json()
    except ValueError as exc:
        raise AnalyzerCheckError("Analyzer returned unexpected format (not JSON)") from exc


async def validate_suggestions(
    base_url: str, contact_key: str, suggestions: list[ContactRouteSuggestion]
) -> list[ContactRouteValidation]:
    """One verdict per suggestion, in order. Raises AnalyzerCheckError when asking fails.

    A direct (0-hop) route and a route longer than the analyzer accepts come back
    ``not_checked``. A contact the analyzer does not know (404) has no neighbours.
    """
    verdicts: list[ContactRouteValidation] = []
    async with httpx.AsyncClient(timeout=FETCH_TIMEOUT_SECONDS, follow_redirects=True) as client:
        reach = await _get_json(client, "GET", f"{base_url}/api/nodes/{contact_key.lower()}/reach")
        neighbours = reach.get("neighbourList") if isinstance(reach, dict) else None
        if not isinstance(neighbours, list):
            neighbours = []

        for suggestion in suggestions:
            hops = suggestion.route.split(",") if suggestion.path_len > 0 else []
            if not hops or len(hops) > MAX_INSPECT_HOPS:
                verdicts.append(_not_checked())
                continue
            chain: ChainVerdict = "not_checked"
            names: list[str] = []
            ambiguous = 0
            if len(hops) > 1:
                payload = await _get_json(
                    client, "POST", f"{base_url}/api/paths/inspect", json={"prefixes": hops}
                )
                chain, names, ambiguous = chain_verdict(payload, len(hops))
            last_hop = last_hop_verdict(neighbours, hops[-1])
            verdicts.append(
                ContactRouteValidation(
                    status=overall_status(chain, last_hop),
                    chain=chain,
                    last_hop=last_hop,
                    hop_names=names,
                    ambiguous_hops=ambiguous,
                )
            )
    return verdicts
