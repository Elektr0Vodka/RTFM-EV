"""Recognise a DMC observer's web config page on the LAN.

The DMC observer firmware (repeater and room server, Dutch-MeshCore/MeshCore
``dmc-observer-dev``, ``src/helpers/esp32/WebConfigServer.cpp``) serves a
config page on HTTP port 80 while ``start webconfig`` is running.
``GET /api/status`` answers without a login with the node name, ``node_id``
(the first 8 bytes of the public key, 16 hex), firmware version, build date,
role (``repeater`` / ``room_server``), board and uptime. When the page is
stopped the route answers 503.

One GET per address, no redirects, no proxy, at most ``MAX_BODY_BYTES`` read.
Only a reply that has the observer's status fields counts; any other web
server answers None.
"""

from __future__ import annotations

import json
import re
from typing import Any

import httpx

STATUS_PATH = "/api/status"
CONNECT_TIMEOUT_SECONDS = 1.0
READ_TIMEOUT_SECONDS = 2.0
MAX_BODY_BYTES = 8192
OBSERVER_ROLES = {"repeater": 2, "room_server": 3}
_NODE_ID_RE = re.compile(r"^[0-9a-f]{16}$")
_MAX_TEXT = 80


def _text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    return value.strip()[:_MAX_TEXT] or None


def parse_status(doc: Any) -> dict[str, Any] | None:
    """The fields we keep from an observer's ``/api/status``, or None when the
    document is not one (wrong shape, unknown role or mode, bad node id)."""
    if not isinstance(doc, dict):
        return None
    node_id = doc.get("node_id")
    role = doc.get("role")
    if not isinstance(node_id, str) or not _NODE_ID_RE.match(node_id.lower()):
        return None
    if role not in OBSERVER_ROLES or doc.get("mode") not in ("setup", "lan"):
        return None
    if not isinstance(doc.get("fw"), str):
        return None
    uptime = doc.get("uptime_s")
    return {
        "node_id": node_id.lower(),
        "name": _text(doc.get("name")),
        "role": role,
        "adv_type": OBSERVER_ROLES[role],
        "firmware_version": _text(doc.get("fw")),
        "build_date": _text(doc.get("build_date")),
        "board": _text(doc.get("board")),
        "mode": doc["mode"],
        "needs_setup": doc.get("needs_setup") is True,
        "uptime_secs": uptime if isinstance(uptime, int) and uptime >= 0 else None,
    }


async def probe_webconfig(host: str, port: int) -> dict[str, Any] | None:
    """GET ``/api/status`` on one address. None when nothing answers or the
    answer is not a DMC observer's status."""
    url = f"http://{host}:{port}{STATUS_PATH}"
    timeout = httpx.Timeout(READ_TIMEOUT_SECONDS, connect=CONNECT_TIMEOUT_SECONDS)
    try:
        async with httpx.AsyncClient(
            timeout=timeout, follow_redirects=False, trust_env=False
        ) as client:
            async with client.stream(
                "GET", url, headers={"Accept": "application/json"}
            ) as response:
                if response.status_code != 200:
                    return None
                body = b""
                async for chunk in response.aiter_bytes():
                    body += chunk
                    if len(body) > MAX_BODY_BYTES:
                        return None
    except (httpx.HTTPError, OSError):
        return None
    try:
        doc = json.loads(body.decode("utf-8", errors="strict"))
    except (UnicodeDecodeError, ValueError):
        return None
    return parse_status(doc)
