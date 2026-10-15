"""Sensor nodes use the login, telemetry, ACL and MMA routes."""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.models import CONTACT_TYPE_SENSOR, Contact
from app.routers.repeaters import _require_repeater_or_sensor
from app.routers.sensor_push import sensor_mma

KEY = "ab" * 32


def _op(mc):
    @asynccontextmanager
    async def _ctx(*_a, **_k):
        yield mc

    return _ctx


def test_guard_accepts_repeater_and_sensor_only():
    _require_repeater_or_sensor(Contact(public_key=KEY, type=2))
    _require_repeater_or_sensor(Contact(public_key=KEY, type=4))
    with pytest.raises(HTTPException):
        _require_repeater_or_sensor(Contact(public_key=KEY, type=1))


@pytest.mark.asyncio
async def test_mma_route_maps_entries():
    contact = Contact(public_key=KEY, type=CONTACT_TYPE_SENSOR)
    mc = MagicMock()
    mc.commands.req_mma_sync = AsyncMock(
        return_value=[{"channel": 1, "type": "temperature", "min": 10.5, "max": 21.0, "avg": 15.2}]
    )
    with (
        patch("app.routers.sensor_push.radio_manager") as rm,
        patch("app.routers.sensor_push._resolve_contact_or_404", AsyncMock(return_value=contact)),
        patch("app.routers.sensor_push._ensure_on_radio", AsyncMock()),
    ):
        rm.require_connected = MagicMock()
        rm.radio_operation = _op(mc)
        response = await sensor_mma(KEY, hours=24)

    start, end = mc.commands.req_mma_sync.await_args.args[1:3]
    assert (start, end) == (24 * 3600, 0)
    assert response.entries[0].type_name == "temperature"
    assert response.entries[0].avg == 15.2


@pytest.mark.asyncio
async def test_mma_route_504_without_reply():
    contact = Contact(public_key=KEY, type=CONTACT_TYPE_SENSOR)
    mc = MagicMock()
    mc.commands.req_mma_sync = AsyncMock(return_value=None)
    with (
        patch("app.routers.sensor_push.radio_manager") as rm,
        patch("app.routers.sensor_push._resolve_contact_or_404", AsyncMock(return_value=contact)),
        patch("app.routers.sensor_push._ensure_on_radio", AsyncMock()),
    ):
        rm.require_connected = MagicMock()
        rm.radio_operation = _op(mc)
        with pytest.raises(HTTPException) as exc:
            await sensor_mma(KEY, hours=24)

    assert exc.value.status_code == 504
