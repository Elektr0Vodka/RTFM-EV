"""Sensor telemetry push API routes."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.models import (
    CONTACT_TYPE_SENSOR,
    Contact,
    SensorPushConfigRequest,
    SensorPushThreshold,
)
from app.routers.sensor_push import (
    get_sensor_push,
    put_sensor_push,
    subscribe_sensor_push,
    unsubscribe_sensor_push,
)

KEY = "a2" * 32
SENSOR = Contact(public_key=KEY, type=CONTACT_TYPE_SENSOR)


@pytest.mark.asyncio
async def test_get_defaults_when_never_configured(test_db):
    with patch("app.routers.sensor_push._resolve_contact_or_404", AsyncMock(return_value=SENSOR)):
        state = await get_sensor_push(KEY)
    assert state.enabled is False
    assert state.thresholds == []
    assert state.max_threshold_bytes == 14
    assert state.supported_types["temperature"] == 4
    assert "gps" not in state.supported_types


@pytest.mark.asyncio
async def test_put_rejects_oversized_set(test_db):
    body = SensorPushConfigRequest(
        thresholds=[
            SensorPushThreshold(channel=i, type_name="voltage", min_delta=0.1) for i in range(1, 5)
        ]
    )
    with patch("app.routers.sensor_push._resolve_contact_or_404", AsyncMock(return_value=SENSOR)):
        with pytest.raises(HTTPException) as exc:
            await put_sensor_push(KEY, body)
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_put_then_subscribe(test_db):
    body = SensorPushConfigRequest(
        thresholds=[SensorPushThreshold(channel=1, type_name="temperature", min_delta=0.5)]
    )
    with (
        patch("app.routers.sensor_push._resolve_contact_or_404", AsyncMock(return_value=SENSOR)),
        patch("app.routers.sensor_push.radio_manager") as rm,
        patch("app.routers.sensor_push.sensor_push.subscribe", AsyncMock(return_value={})) as sub,
    ):
        rm.require_connected = MagicMock()
        state = await put_sensor_push(KEY, body)
        assert state.threshold_bytes == 4
        assert state.thresholds[0].type_name == "temperature"
        state = await subscribe_sensor_push(KEY)
    sub.assert_awaited_once_with(KEY)
    assert state.enabled is True


@pytest.mark.asyncio
async def test_subscribe_without_thresholds_is_422_and_stays_off(test_db):
    with (
        patch("app.routers.sensor_push._resolve_contact_or_404", AsyncMock(return_value=SENSOR)),
        patch("app.routers.sensor_push.radio_manager") as rm,
    ):
        rm.require_connected = MagicMock()
        with pytest.raises(HTTPException) as exc:
            await subscribe_sensor_push(KEY)
        state = await get_sensor_push(KEY)
    assert exc.value.status_code == 422
    assert state.enabled is False


@pytest.mark.asyncio
async def test_unsubscribe_route(test_db):
    with (
        patch("app.routers.sensor_push._resolve_contact_or_404", AsyncMock(return_value=SENSOR)),
        patch(
            "app.routers.sensor_push.sensor_push.unsubscribe", AsyncMock(return_value={})
        ) as unsub,
    ):
        await unsubscribe_sensor_push(KEY)
    unsub.assert_awaited_once_with(KEY)


@pytest.mark.asyncio
async def test_non_sensor_rejected(test_db):
    chat = Contact(public_key=KEY, type=1)
    with patch("app.routers.sensor_push._resolve_contact_or_404", AsyncMock(return_value=chat)):
        with pytest.raises(HTTPException) as exc:
            await get_sensor_push(KEY)
    assert exc.value.status_code == 400
