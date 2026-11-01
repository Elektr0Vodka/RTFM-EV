"""HTTP calls to an observer's web config on the LAN (plan 32, Phase 4).

Only the calls this app needs: status, login, read the config, save ONE key,
poll its result, logout. It never asks for a reboot, never uses the web
config's command terminal (``/api/cli``) and never sets the admin password.
The address must come from ``fleet_webconfig.lan_address`` (a checked LAN
address, connected to directly). The rules are in ``fleet_webconfig``.

The web config is plain HTTP: the admin password crosses the LAN in the clear,
as it does from the web config's own page.
"""

import asyncio
import ipaddress
import secrets
from types import TracebackType
from typing import Any

import httpx

from app.services.fleet_webconfig import PORT, WebConfigError, new_request_id

_TIMEOUT = httpx.Timeout(8.0, connect=5.0)
_POLL_ATTEMPTS = 40
_POLL_DELAY = 0.5


class WebConfigClient:
    """One session with one observer's web config. Use as ``async with``."""

    def __init__(
        self,
        address: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        poll_delay: float = _POLL_DELAY,
    ) -> None:
        host = f"[{address}]" if ipaddress.ip_address(address).version == 6 else address
        port = "" if PORT == 80 else f":{PORT}"
        self._client = httpx.AsyncClient(
            base_url=f"http://{host}{port}",
            timeout=_TIMEOUT,
            transport=transport,
            follow_redirects=False,
        )
        self._poll_delay = poll_delay

    async def __aenter__(self) -> "WebConfigClient":
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        await self._client.aclose()

    async def _call(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        try:
            response = await self._client.request(method, path, **kwargs)
        except httpx.TimeoutException:
            raise WebConfigError("unreachable", "the web config did not answer in time") from None
        except httpx.HTTPError:
            raise WebConfigError("unreachable", "the web config cannot be reached") from None
        if response.status_code == 503:
            raise WebConfigError("not_running", "the web config is not running on the node")
        return response

    @staticmethod
    def _json(response: httpx.Response) -> dict[str, Any]:
        try:
            body = response.json()
        except ValueError:
            raise WebConfigError("bad_answer", "the web config gave no JSON") from None
        if not isinstance(body, dict):
            raise WebConfigError("bad_answer", "the web config gave no JSON object")
        return body

    async def status(self) -> dict[str, Any]:
        response = await self._call("GET", "/api/status")
        if response.status_code != 200:
            raise WebConfigError("bad_answer", f"status answered {response.status_code}")
        return self._json(response)

    async def login(self, password: str) -> None:
        response = await self._call("POST", "/api/login", json={"password": password})
        if response.status_code == 401:
            raise WebConfigError("wrong_password", "the admin password was not accepted")
        if response.status_code == 429:
            raise WebConfigError("locked", "too many wrong passwords; the node waits 30 s")
        if response.status_code != 200:
            raise WebConfigError("bad_answer", f"login answered {response.status_code}")

    async def get_config(self) -> dict[str, Any]:
        response = await self._call("GET", "/api/config")
        if response.status_code == 401:
            raise WebConfigError("session", "the web config session ended")
        if response.status_code != 200:
            raise WebConfigError("bad_answer", f"config answered {response.status_code}")
        return self._json(response)

    async def save(self, key: str, value: str) -> str:
        """Queue ``set <key> <value>`` on the node; its request id."""
        request_id = new_request_id(secrets.token_hex)
        response = await self._call(
            "POST",
            "/api/config",
            json={"set": {key: value}, "reboot": False, "reqid": request_id},
        )
        if response.status_code == 202:
            return request_id
        if response.status_code == 401:
            raise WebConfigError("session", "the web config session ended")
        if response.status_code == 409:
            raise WebConfigError("busy", "the node is still running another save")
        body = self._json(response) if response.content else {}
        raise WebConfigError("refused", str(body.get("error") or response.status_code))

    async def result(self, request_id: str, *, attempts: int = _POLL_ATTEMPTS) -> dict[str, Any]:
        """The result of a save, once the node has run it."""
        for _attempt in range(attempts):
            response = await self._call("GET", "/api/config/result", params={"reqid": request_id})
            if response.status_code == 401:
                raise WebConfigError("session", "the web config session ended")
            if response.status_code != 200:
                raise WebConfigError("bad_answer", f"result answered {response.status_code}")
            body = self._json(response)
            if body.get("state") == "done":
                return body
            await asyncio.sleep(self._poll_delay)
        raise WebConfigError("no_result", "the node did not report the result in time")

    async def logout(self) -> None:
        try:
            await self._call("POST", "/api/logout")
        except WebConfigError:
            pass
