"""GET /radio/default-flood-scope (companion CMD_GET_DEFAULT_FLOOD_SCOPE 64)."""

from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from meshcore import EventType

import app.routers.radio as radio_router
from app.routers.radio import get_default_flood_scope


@pytest.fixture
def fake_manager(monkeypatch):
    mgr = MagicMock()
    mgr.require_connected = MagicMock()
    mc = MagicMock()

    @asynccontextmanager
    async def _op(name, **kwargs):
        yield mc

    mgr.radio_operation = _op
    monkeypatch.setattr(radio_router, "radio_manager", mgr)
    return mgr, mc


def _event(event_type, payload):
    return SimpleNamespace(type=event_type, payload=payload)


class TestDefaultFloodScope:
    @pytest.mark.asyncio
    async def test_returns_configured_scope(self, fake_manager):
        mgr, mc = fake_manager
        mc.commands.get_default_flood_scope = AsyncMock(
            return_value=_event(
                EventType.DEFAULT_FLOOD_SCOPE,
                {"scope_name": "#nl-gr", "scope_key": "ab" * 16},
            )
        )
        resp = await get_default_flood_scope()
        mgr.require_connected.assert_called_once()
        mc.commands.get_default_flood_scope.assert_awaited_once()
        assert resp.supported is True
        assert resp.scope_name == "#nl-gr"
        assert resp.scope_key == "ab" * 16

    @pytest.mark.asyncio
    async def test_no_default_set_is_reported_as_none(self, fake_manager):
        _mgr, mc = fake_manager
        # Firmware sends a bare response code; the parser dispatches an empty payload.
        mc.commands.get_default_flood_scope = AsyncMock(
            return_value=_event(EventType.DEFAULT_FLOOD_SCOPE, {})
        )
        resp = await get_default_flood_scope()
        assert resp.supported is True
        assert resp.scope_name is None
        assert resp.scope_key is None

    @pytest.mark.asyncio
    async def test_error_means_unsupported(self, fake_manager):
        _mgr, mc = fake_manager
        mc.commands.get_default_flood_scope = AsyncMock(
            return_value=_event(EventType.ERROR, {"reason": "unknown command"})
        )
        resp = await get_default_flood_scope()
        assert resp.supported is False
        assert resp.scope_name is None

    @pytest.mark.asyncio
    async def test_requires_connected_radio(self, fake_manager):
        mgr, mc = fake_manager
        mgr.require_connected.side_effect = HTTPException(status_code=409, detail="not connected")
        mc.commands.get_default_flood_scope = AsyncMock()
        with pytest.raises(HTTPException) as exc:
            await get_default_flood_scope()
        assert exc.value.status_code == 409
        mc.commands.get_default_flood_scope.assert_not_awaited()
