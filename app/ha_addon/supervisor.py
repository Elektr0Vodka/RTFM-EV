"""A small client for the Home Assistant Supervisor API (add-on mode only).

The Supervisor gives every add-on with ``hassio_api: true`` a token in
``SUPERVISOR_TOKEN`` and answers on ``http://supervisor``. Replies are
``{"result": "ok"|"error", "data": ..., "message": ...}``.

Endpoint paths and fields are from the Supervisor docs; the backup layout was
probed on a real install (docs/plans/2026-11-19-ha-addon/ha-backup-layout.md).
"""

from __future__ import annotations

import os
from typing import Any

import httpx

DEFAULT_BASE_URL = "http://supervisor"
_TIMEOUT = 30.0
# A partial backup of an add-on includes its image, so this can take minutes.
_BACKUP_TIMEOUT = 600.0


class SupervisorUnavailable(Exception):
    """The Supervisor cannot be reached, refused, or there is no token."""


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
            raise SupervisorUnavailable(message or f"Supervisor answered {response.status_code}")
        return body.get("data") or {}

    async def self_info(self) -> dict:
        data = await self._call("GET", "/addons/self/info")
        return data if isinstance(data, dict) else {}

    async def list_addons(self) -> list[dict]:
        data = await self._call("GET", "/addons")
        addons = data.get("addons") if isinstance(data, dict) else None
        return [a for a in addons if isinstance(a, dict)] if isinstance(addons, list) else []

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
