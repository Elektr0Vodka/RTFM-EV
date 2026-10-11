"""In-memory stand-ins for the channel API of a radio worker (gateway tests, plan 30).

Each app keeps its own channel list and follows the same rules as
``app/routers/channels.py`` for how a key and the hashtag flag come about:
a ``#name`` derives its key from the name, a plain name takes the given key,
and an imported line always becomes a hashtag channel with the given key.
"""

from __future__ import annotations

from hashlib import sha256
from typing import Annotated

import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel


class _Create(BaseModel):
    name: str
    key: str | None = None


def hashtag_key(name: str) -> str:
    return sha256(name.encode("utf-8")).digest()[:16].hex().upper()


def channel(name: str, key: str | None = None, *, is_hashtag: bool | None = None) -> dict:
    hashtag = name.startswith("#") if is_hashtag is None else is_hashtag
    return {"key": (key or hashtag_key(name)).upper(), "name": name, "is_hashtag": hashtag}


def make_channel_worker(
    *channels: dict, fail_delete: bool = False, refuse_create: bool = False
) -> FastAPI:
    app = FastAPI()
    app.state.channels = {c["key"]: dict(c) for c in channels}
    app.state.calls = []

    @app.get("/api/channels")
    async def list_channels():
        return list(app.state.channels.values())

    @app.post("/api/channels")
    async def create(body: _Create):
        app.state.calls.append(("create", body.name, body.key))
        if refuse_create:
            raise HTTPException(status_code=500, detail="refused")
        if body.name.startswith("#"):
            created = channel(body.name)
        else:
            created = channel(body.name, body.key, is_hashtag=False)
        app.state.channels[created["key"]] = created
        return created

    @app.post("/api/channels/import")
    async def import_channels(file: Annotated[UploadFile, File()]):
        text = (await file.read()).decode("utf-8")
        app.state.calls.append(("import", text))
        if refuse_create:
            raise HTTPException(status_code=500, detail="refused")
        for line in text.splitlines():
            name, sep, key = line.strip().rpartition(" - ")
            if not sep:
                continue
            name = name if name.startswith("#") else f"#{name}"
            app.state.channels[key.upper()] = channel(name, key, is_hashtag=True)
        return {"message": "ok"}

    @app.delete("/api/channels/{key}")
    async def delete(key: str):
        app.state.calls.append(("delete", key.upper()))
        if fail_delete:
            raise HTTPException(status_code=500, detail="database is locked")
        app.state.channels.pop(key.upper(), None)
        return {"status": "ok"}

    return app


class PortRouter(httpx.AsyncBaseTransport):
    """Send a request to the fake worker that 'listens' on its port."""

    def __init__(self, apps: dict[int, FastAPI]) -> None:
        self._transports = {port: httpx.ASGITransport(app=app) for port, app in apps.items()}

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        return await self._transports[request.url.port].handle_async_request(request)
