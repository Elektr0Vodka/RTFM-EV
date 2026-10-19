"""Shared helpers for the wardrive API tests: radios, signed challenges,
accounts and sample obs/track messages."""

from __future__ import annotations

from typing import Any

import httpx
from fastapi import FastAPI
from nacl.signing import SigningKey

from app.validation_errors import install_validation_error_handler

PASSWORD = "correct horse"


def make_radio() -> tuple[SigningKey, str]:
    key = SigningKey.generate()
    return key, key.verify_key.encode().hex().upper()


def wardrive_app(*routers) -> FastAPI:
    app = FastAPI()
    install_validation_error_handler(app)
    for router in routers:
        app.include_router(router, prefix="/api")
    return app


def client_for(app: FastAPI) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://test")


async def signed(client: httpx.AsyncClient, key: SigningKey, pk: str) -> dict[str, str]:
    r = await client.post("/api/wardrive/challenge", json={"public_key": pk})
    assert r.status_code == 200
    body = r.json()
    signature = key.sign(bytes.fromhex(body["message_hex"])).signature.hex()
    return {"public_key": pk, "nonce": body["nonce"], "signature": signature}


async def register(
    client: httpx.AsyncClient,
    username: str = "mike",
    password: str = PASSWORD,
    radio: tuple[SigningKey, str] | None = None,
) -> httpx.Response:
    key, pk = radio or make_radio()
    body = await signed(client, key, pk)
    return await client.post(
        "/api/wardrive/register",
        json={"username": username, "password": password, "radio_name": "car", **body},
    )


def obs(origin_id: str, rx_at: str = "2026-10-19T10:00:00.000Z", **over: Any) -> dict[str, Any]:
    """An obs message in core-hunter's wardrive.js shape."""
    msg: dict[str, Any] = {
        "v": 1,
        "origin_id": origin_id,
        "rx_at": rx_at,
        "pub_at": "2026-10-19T10:00:01.000Z",
        "hash": "0123456789abcdef",
        "raw": "1500aabbccdd",
        "len": 6,
        "packet_type": 5,
        "route": "F",
        "payload_len": 4,
        "path": ["a1", "b2"],
        "RSSI": -92,
        "SNR": 6.5,
        "pos": {"lat": 52.1, "lon": 5.1, "accuracy": 4.0, "src": "phone"},
    }
    msg.update(over)
    return msg


def track(origin_id: str, t0: str = "2026-10-19T10:00:00.000Z", **over: Any) -> dict[str, Any]:
    """A track message in core-hunter's wardrive.js shape."""
    msg: dict[str, Any] = {
        "v": 1,
        "origin_id": origin_id,
        "t0": t0,
        "t1": "2026-10-19T10:00:10.000Z",
        "lat": 52.1,
        "lon": 5.1,
        "accuracy": 4.0,
        "rx_count": 3,
        "listening": True,
        "src": "phone",
    }
    msg.update(over)
    return msg
