"""A small client for the Home Assistant Supervisor API (add-on mode only).

The Supervisor gives every add-on with ``hassio_api: true`` a token in
``SUPERVISOR_TOKEN`` and answers on ``http://supervisor``. Replies are
``{"result": "ok"|"error", "data": ..., "message": ...}``.

Endpoint paths and fields are from the Supervisor docs; the backup layout was
probed on a real install (docs/plans/2026-11-19-ha-addon/ha-backup-layout.md).
"""

from __future__ import annotations

import hashlib
import os
import re
from typing import Any

import httpx

DEFAULT_BASE_URL = "http://supervisor"
_TIMEOUT = 30.0
# A partial backup of an add-on includes its image, so this can take minutes.
_BACKUP_TIMEOUT = 600.0


# Repositories known to ship the RemoteTerm add-on (slug ``mc_remoteterm``).
# Supervisor names a store add-on ``<sha1(lowercased repo URL)[:8]>_<slug>``
# (supervisor/store/utils.py get_hash_from_repository) and a local one
# ``local_<slug>``. The backup role may not list add-ons (GET /addons), but it
# may read ``/addons/<slug>/info``, so these candidates are probed one by one.
REMOTETERM_REPOSITORIES = ("https://github.com/rajeevan/hassio-meshcore-Remote-Term",)
_REMOTETERM_ADDON = "mc_remoteterm"
_SAFE_SLUG = re.compile(r"^[a-z0-9_]+$")


def remoteterm_slug_candidates() -> list[str]:
    slugs = [
        f"{hashlib.sha1(url.lower().encode()).hexdigest()[:8]}_{_REMOTETERM_ADDON}"
        for url in REMOTETERM_REPOSITORIES
    ]
    slugs.append(f"local_{_REMOTETERM_ADDON}")
    return slugs


class SupervisorUnavailable(Exception):
    """The Supervisor cannot be reached, refused, or there is no token."""


class SupervisorRefused(SupervisorUnavailable):
    """The Supervisor answered, with an error result (not found, not allowed)."""


class SupervisorClient:
    def __init__(
        self,
        token: str | None,
        base_url: str = DEFAULT_BASE_URL,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._token = token or ""
        self._base_url = base_url
        self._transport = transport

    async def _call(
        self, method: str, path: str, *, json: Any = None, timeout: float = _TIMEOUT
    ) -> Any:
        if not self._token:
            raise SupervisorUnavailable("No Supervisor token (not running as an add-on?)")
        try:
            async with httpx.AsyncClient(
                base_url=self._base_url, transport=self._transport, timeout=timeout
            ) as client:
                response = await client.request(
                    method,
                    path,
                    json=json,
                    headers={"Authorization": f"Bearer {self._token}"},
                )
        except httpx.HTTPError as err:
            raise SupervisorUnavailable(f"Supervisor request failed: {err}") from err
        try:
            body = response.json()
        except ValueError as err:
            raise SupervisorUnavailable(
                f"Supervisor answered {response.status_code} without JSON"
            ) from err
        if not isinstance(body, dict) or body.get("result") != "ok":
            message = body.get("message") if isinstance(body, dict) else None
            raise SupervisorRefused(message or f"Supervisor answered {response.status_code}")
        return body.get("data") or {}

    async def self_info(self) -> dict:
        data = await self._call("GET", "/addons/self/info")
        return data if isinstance(data, dict) else {}

    async def addon_info(self, slug: str) -> dict | None:
        """Info for one installed add-on, or None when it is not installed (or not allowed)."""
        if not _SAFE_SLUG.match(slug):
            return None
        try:
            data = await self._call("GET", f"/addons/{slug}/info")
        except SupervisorRefused:
            return None
        return data if isinstance(data, dict) else None

    async def create_partial_backup(self, addon_slug: str, name: str) -> str:
        data = await self._call(
            "POST",
            "/backups/new/partial",
            json={"name": name, "addons": [addon_slug], "homeassistant": False},
            timeout=_BACKUP_TIMEOUT,
        )
        slug = data.get("slug") if isinstance(data, dict) else None
        if not isinstance(slug, str) or not slug:
            raise SupervisorUnavailable("Supervisor did not return a backup id")
        return slug

    async def restart_self(self) -> None:
        await self._call("POST", "/addons/self/restart")


def supervisor_client() -> SupervisorClient:
    return SupervisorClient(os.environ.get("SUPERVISOR_TOKEN"))
