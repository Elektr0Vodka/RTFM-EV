"""SensorPushRepository (MeshCore 1.18 sensor telemetry push subscriptions)."""

import pytest

from app.repository.sensor_push import SensorPushRepository

KEY = "ac" * 32
THRESHOLDS = [{"channel": 1, "type_name": "temperature", "min_delta": 0.5}]


@pytest.mark.asyncio
async def test_config_enable_grant_and_lookup(test_db):
    await SensorPushRepository.save_config(KEY, THRESHOLDS, now=100)
    await SensorPushRepository.set_enabled(KEY, True, now=101)
    await SensorPushRepository.mark_attempt(KEY, "0a0b0c0d", now=102)
    await SensorPushRepository.set_granted(
        KEY, "0a0b0c0d", granted_until=65637, scope_name="nl", now=102
    )

    row = await SensorPushRepository.get(KEY)
    assert row is not None
    assert row["thresholds"] == THRESHOLDS
    assert row["enabled"] is True
    assert row["scope_name"] == "nl"
    assert row["granted_until"] == 65637
    assert row["last_error"] is None
    found = await SensorPushRepository.find_enabled_by_tag("0a0b0c0d")
    assert found is not None
    assert found["public_key"] == KEY
    assert [r["public_key"] for r in await SensorPushRepository.list_enabled()] == [KEY]


@pytest.mark.asyncio
async def test_disabled_subscription_is_not_found_by_tag(test_db):
    await SensorPushRepository.save_config(KEY, THRESHOLDS, now=100)
    await SensorPushRepository.mark_attempt(KEY, "01020304", now=101)
    await SensorPushRepository.set_enabled(KEY, False, now=102)

    assert await SensorPushRepository.find_enabled_by_tag("01020304") is None


@pytest.mark.asyncio
async def test_save_config_keeps_state(test_db):
    await SensorPushRepository.save_config(KEY, THRESHOLDS, now=100)
    await SensorPushRepository.set_enabled(KEY, True, now=101)
    await SensorPushRepository.save_config(KEY, [], now=102)

    row = await SensorPushRepository.get(KEY)
    assert row is not None
    assert row["enabled"] is True
    assert row["thresholds"] == []


@pytest.mark.asyncio
async def test_error_and_push_bookkeeping(test_db):
    await SensorPushRepository.set_enabled(KEY, True, now=100)
    await SensorPushRepository.set_error(KEY, "no_reply", now=110)
    await SensorPushRepository.record_push(KEY, now=120)

    row = await SensorPushRepository.get(KEY)
    assert row is not None
    assert row["last_error"] == "no_reply"
    assert row["last_attempt_at"] == 110
    assert row["last_push_at"] == 120


@pytest.mark.asyncio
async def test_disabling_clears_the_grant(test_db):
    await SensorPushRepository.set_enabled(KEY, True, now=100)
    await SensorPushRepository.set_granted(
        KEY, "01020304", granted_until=500, scope_name="nl", now=100
    )
    await SensorPushRepository.set_enabled(KEY, False, now=200)

    row = await SensorPushRepository.get(KEY)
    assert row is not None
    assert row["granted_until"] is None


@pytest.mark.asyncio
async def test_get_unknown_returns_none(test_db):
    assert await SensorPushRepository.get(KEY) is None
