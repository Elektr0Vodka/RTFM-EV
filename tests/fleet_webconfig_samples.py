"""Answers of a DMC observer's web config, for the plan 32 Phase 4 tests.

Hand-built from the firmware source (``src/helpers/esp32/WebConfigServer.cpp``
on ``dmc-observer-dev`` at ``923fc428``: ``handleStatus``, ``handleConfigGet``,
``handleConfigResult``). No value here comes from a real device.
"""

import copy
import json
from typing import Any

import httpx

from tests.fleet_device_cli_samples import PUBLIC_KEY

SENTINEL = "********"


def status(public_key: str = PUBLIC_KEY, mode: str = "lan") -> dict[str, Any]:
    return {
        "mode": mode,
        "auth": False,
        "needs_setup": False,
        "name": "NL-TST-OBS",
        "node_id": public_key[:16],
        "fw": "v1.14.1-dmc-observer",
        "build_date": "26-Sep-2026",
        "role": "repeater",
        "board": "Heltec V4",
        "uptime_s": 1234,
        "runtime_slots": 6,
        "max_slots": 6,
        "active_slots": 2,
        "max_cmds": 24,
    }


def _slot(**fields: Any) -> dict[str, Any]:
    return {
        "preset": "none",
        "server": "",
        "port": 0,
        "username": "",
        "password": "",
        "token": "",
        "topic": "",
        "audience": "",
        "filter": "all",
        **fields,
    }


_CONFIG: dict[str, Any] = {
    "radio": {
        "freq": 869.618,
        "bw": 62.5,
        "sf": 7,
        "cr": 5,
        "tx": 22,
        "af": 1.0,
        "rxdelay": 0.0,
        "txdelay": 0.5,
        "cad": False,
        "rxgain": True,
        "repeat": True,
        "flood_max": 64,
        "flood_max_advert": 8,
        "flood_max_unscoped": 64,
        "loop_detect": "off",
        "name": "NL-TST-OBS",
        "lat": 52.3740312,
        "lon": 4.8896881,
        "advert_interval": 120,
        "flood_advert_interval": 12,
    },
    "wifi": {"ssid": "MeshNet", "pwd": SENTINEL, "powersave": "none"},
    "mqtt": {
        "origin": "NL-TST-OBS",
        "iata": "AMS",
        "status": True,
        "packets": True,
        "raw": False,
        "tx": "advert",
        "rx": True,
        "interval": 5,
        "neighbors": False,
        "neighbors_interval": 24,
        "timezone": "Europe/Amsterdam",
        "timezone_offset": 0,
        "ntp": "",
        "owner": "ab" * 32,
        "email": "ops@example.org",
        "snmp": True,
        "snmp_community": "mesh-readonly",
        "slots": [
            _slot(
                preset="custom",
                server="mqtt.example.org",
                port=8883,
                username="observer",
                password=SENTINEL,
                topic="meshcore/test",
                filter="2,4,5",
            ),
            _slot(preset="dutchmeshcore-1"),
            _slot(),
            _slot(),
            _slot(),
            _slot(),
        ],
    },
}


def config() -> dict[str, Any]:
    """``GET /api/config`` of a configured observer."""
    return copy.deepcopy(_CONFIG)


def result(key: str, reply: str = "OK", *, all_ok: bool = True) -> dict[str, Any]:
    """``GET /api/config/result`` once a one-key save is done."""
    return {
        "state": "done",
        "reboot": False,
        "all_ok": all_ok,
        "reqid": "0123456789abcdef",
        "results": [{"key": key, "reply": reply}],
    }


class FakeObserver:
    """An observer's web config as httpx sees it (``httpx.MockTransport(fake.handler)``).

    Answers as ``WebConfigServer.cpp`` does: a login sets the ``wcs`` cookie,
    every other call needs it, a save answers 202 and its result is polled.
    A save changes the answered config for the keys in ``_PATHS`` unless
    ``apply_saves`` is off (to see a read-back that differs).
    """

    PASSWORD = "admin-pw"
    TOKEN = "0123456789abcdef0123456789abcdef"
    _PATHS = {
        "tx": ("radio", "tx", int),
        "name": ("radio", "name", str),
        "mqtt.status": ("mqtt", "status", lambda text: text == "on"),
    }

    def __init__(self, *, pending_polls: int = 1, mode: str = "lan", public_key: str = PUBLIC_KEY):
        self.requests: list[httpx.Request] = []
        self.pending_polls = pending_polls
        self.mode = mode
        self.public_key = public_key
        self.saved: list[dict[str, Any]] = []
        self.login_status = 200
        self.save_status = 202
        self.running = True
        self.apply_saves = True
        self.reply = "OK"
        self.config = config()

    def _apply(self, key: str, value: str) -> None:
        if not self.apply_saves:
            return
        if key == "mqtt1.topic":
            self.config["mqtt"]["slots"][0]["topic"] = value
            return
        if key in self._PATHS:
            section, field, cast = self._PATHS[key]
            self.config[section][field] = cast(value)

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if not self.running:
            return httpx.Response(503)
        path = request.url.path
        authed = f"wcs={self.TOKEN}" in request.headers.get("cookie", "")
        if path == "/api/status":
            return httpx.Response(200, json=status(self.public_key, self.mode))
        if path == "/api/login":
            if self.login_status != 200:
                error = "wrong password" if self.login_status == 401 else "locked, retry in 30s"
                return httpx.Response(self.login_status, json={"error": error})
            if json.loads(request.content).get("password") != self.PASSWORD:
                return httpx.Response(401, json={"error": "wrong password"})
            return httpx.Response(
                200,
                json={"ok": True},
                headers={"set-cookie": f"wcs={self.TOKEN}; HttpOnly; SameSite=Lax; Path=/"},
            )
        if not authed:
            return httpx.Response(401, json={"error": "auth"})
        if path == "/api/logout":
            return httpx.Response(200, json={"ok": True})
        if path == "/api/config/result":
            if self.pending_polls > 0:
                self.pending_polls -= 1
                return httpx.Response(200, json={"state": "pending", "reqid": "x"})
            key = next(iter(self.saved[-1]["set"]))
            return httpx.Response(200, json=result(key, self.reply, all_ok=self.reply == "OK"))
        if path == "/api/config" and request.method == "GET":
            return httpx.Response(200, json=copy.deepcopy(self.config))
        if path == "/api/config" and request.method == "POST":
            if self.save_status != 202:
                return httpx.Response(self.save_status, json={"error": "busy", "reqid": "y"})
            body = json.loads(request.content)
            self.saved.append(body)
            for key, value in body["set"].items():
                self._apply(key, value)
            return httpx.Response(
                202, json={"state": "pending", "count": len(body["set"]), "reqid": body["reqid"]}
            )
        return httpx.Response(404, json={"error": "not found"})
