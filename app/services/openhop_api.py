"""Thin async client for OpenHop's REST API (Surface B).

Authenticates with an API token sent as X-API-Key (created by the user via
POST /api/auth/tokens on the node). Never stores the admin password. All calls are
opt-in and only invoked when the connected node is detected as OpenHop and the user
has configured a URL + token. Shapes are from the live-verified endpoints
(see docs/plans/20-openhop-integration.md).
"""

from typing import Any

import httpx


class OpenHopClient:
    def __init__(
        self,
        base_url: str,
        token: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout: float = 8.0,
    ) -> None:
        self._base = base_url.rstrip("/")
        self._client = httpx.AsyncClient(
            base_url=self._base,
            headers={"X-API-Key": token},
            timeout=timeout,
            transport=transport,
        )

    async def _get(self, path: str) -> dict[str, Any]:
        r = await self._client.get(path)
        r.raise_for_status()
        return r.json()

    async def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        r = await self._client.post(path, json=body)
        r.raise_for_status()
        return r.json()

    async def get_site_info(self) -> dict[str, Any]:
        return await self._get("/api/site_info")

    async def get_policy(self) -> dict[str, Any]:
        return await self._get("/api/policy")

    async def cli(self, command: str) -> dict[str, Any]:
        return await self._post("/api/cli", {"command": command})

    async def aclose(self) -> None:
        await self._client.aclose()
