"""Periodic MeshCore TEAM #TEL: beacon: settings validation and the send decision.

Nothing here touches a radio: the radio state and the channel send are fakes.
"""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.channel_constants import PUBLIC_CHANNEL_KEY
from app.models import TeamBeaconSettings
from app.repository import AppSettingsRepository, ChannelRepository
from app.routers.settings import AppSettingsUpdate, update_settings
from app.services import team_beacon_sender
from app.team_payloads import TeamBeacon, parse_team_payload

PRIVATE = "7A" * 16
HASHTAG = "5B" * 16


class FakeRadio:
    def __init__(self, *, connected=True, lat=52.0907, lon=5.1214):
        self.is_connected = connected
        self.meshcore = SimpleNamespace(self_info={"adv_lat": lat, "adv_lon": lon})


@pytest.fixture
def sent(monkeypatch):
    """Capture channel sends instead of transmitting."""
    calls: list[dict] = []

    async def fake_send(**kwargs):
        calls.append(kwargs)

    monkeypatch.setattr(team_beacon_sender, "send_channel_message_to_channel", fake_send)
    monkeypatch.setattr(team_beacon_sender, "radio_manager", FakeRadio())
    monkeypatch.setattr(team_beacon_sender, "latest_battery_mv", lambda: 3998)
    team_beacon_sender.reset_schedule()
    return calls


async def _enable(channel_key=PRIVATE, interval=240):
    await ChannelRepository.upsert(key=PRIVATE, name="team-tracking")
    await AppSettingsRepository.update(
        team_beacon=TeamBeaconSettings(
            enabled=True, channel_key=channel_key, interval_seconds=interval
        )
    )


class TestSettings:
    @pytest.mark.asyncio
    async def test_defaults_to_off(self, test_db):
        result = await update_settings(AppSettingsUpdate())

        assert result.team_beacon.enabled is False
        assert result.team_beacon.channel_key == ""
        assert result.team_beacon.interval_seconds == 240

    @pytest.mark.asyncio
    async def test_round_trip(self, test_db):
        await ChannelRepository.upsert(key=PRIVATE, name="team-tracking")

        result = await update_settings(
            AppSettingsUpdate(
                team_beacon=TeamBeaconSettings(
                    enabled=True, channel_key=PRIVATE.lower(), interval_seconds=120
                )
            )
        )

        assert result.team_beacon.enabled is True
        assert result.team_beacon.channel_key == PRIVATE
        fresh = await AppSettingsRepository.get()
        assert fresh.team_beacon.interval_seconds == 120

    @pytest.mark.asyncio
    async def test_enabling_needs_a_known_channel(self, test_db):
        with pytest.raises(HTTPException) as exc:
            await update_settings(
                AppSettingsUpdate(team_beacon=TeamBeaconSettings(enabled=True, channel_key=PRIVATE))
            )
        assert exc.value.status_code == 400

        with pytest.raises(HTTPException):
            await update_settings(AppSettingsUpdate(team_beacon=TeamBeaconSettings(enabled=True)))

    @pytest.mark.asyncio
    async def test_public_and_hashtag_channels_are_refused(self, test_db):
        await ChannelRepository.upsert(key=PUBLIC_CHANNEL_KEY, name="Public")
        await ChannelRepository.upsert(key=HASHTAG, name="#test", is_hashtag=True)

        for key in (PUBLIC_CHANNEL_KEY, HASHTAG):
            with pytest.raises(HTTPException) as exc:
                await update_settings(
                    AppSettingsUpdate(team_beacon=TeamBeaconSettings(enabled=True, channel_key=key))
                )
            assert exc.value.status_code == 400

    def test_interval_bounds(self):
        with pytest.raises(ValidationError):
            TeamBeaconSettings(interval_seconds=59)
        with pytest.raises(ValidationError):
            TeamBeaconSettings(interval_seconds=3601)


class TestSendDecision:
    @pytest.mark.asyncio
    async def test_off_by_default_sends_nothing(self, test_db, sent):
        assert await team_beacon_sender.send_team_beacon_if_due(now=1000.0) is False
        assert sent == []

    @pytest.mark.asyncio
    async def test_sends_a_tel_beacon_with_our_position(self, test_db, sent):
        await _enable()

        assert await team_beacon_sender.send_team_beacon_if_due(now=1000.0) is True

        assert len(sent) == 1
        call = sent[0]
        assert call["channel_key_upper"] == PRIVATE
        assert call["key_bytes"] == bytes.fromhex(PRIVATE)
        beacon = parse_team_payload(call["text"])
        assert isinstance(beacon, TeamBeacon)
        assert (beacon.kind, beacon.source) == ("tel", "team")
        assert (beacon.lat, beacon.lon) == (52.0907, 5.1214)
        assert beacon.radio_battery_mv == 3998
        assert beacon.phone_battery_mv is None
        assert beacon.autonomous is False
        assert beacon.needs_forwarding is False

    @pytest.mark.asyncio
    async def test_waits_for_the_interval(self, test_db, sent):
        await _enable(interval=240)

        assert await team_beacon_sender.send_team_beacon_if_due(now=1000.0) is True
        assert await team_beacon_sender.send_team_beacon_if_due(now=1239.0) is False
        assert await team_beacon_sender.send_team_beacon_if_due(now=1240.0) is True
        assert len(sent) == 2

    @pytest.mark.asyncio
    async def test_no_send_while_the_radio_is_disconnected(self, test_db, sent, monkeypatch):
        await _enable()
        monkeypatch.setattr(team_beacon_sender, "radio_manager", FakeRadio(connected=False))

        assert await team_beacon_sender.send_team_beacon_if_due(now=1000.0) is False
        assert sent == []

    @pytest.mark.asyncio
    async def test_no_send_without_a_position(self, test_db, sent, monkeypatch):
        await _enable()
        monkeypatch.setattr(team_beacon_sender, "radio_manager", FakeRadio(lat=0.0, lon=0.0))

        assert await team_beacon_sender.send_team_beacon_if_due(now=1000.0) is False
        assert sent == []

    @pytest.mark.asyncio
    async def test_public_or_hashtag_channel_is_never_used(self, test_db, sent):
        # Defence in depth: even if such a key ends up stored, nothing is sent.
        await ChannelRepository.upsert(key=PUBLIC_CHANNEL_KEY, name="Public")
        await ChannelRepository.upsert(key=HASHTAG, name="#test", is_hashtag=True)
        for key in (PUBLIC_CHANNEL_KEY, HASHTAG, "00" * 16):
            await AppSettingsRepository.update(
                team_beacon=TeamBeaconSettings(enabled=True, channel_key=key)
            )
            assert await team_beacon_sender.send_team_beacon_if_due(now=1000.0) is False
        assert sent == []

    @pytest.mark.asyncio
    async def test_a_failed_send_is_retried_at_the_next_check(self, test_db, sent, monkeypatch):
        await _enable()

        async def failing_send(**kwargs):
            raise RuntimeError("radio busy")

        monkeypatch.setattr(team_beacon_sender, "send_channel_message_to_channel", failing_send)
        assert await team_beacon_sender.send_team_beacon_if_due(now=1000.0) is False

        async def working_send(**kwargs):
            sent.append(kwargs)

        monkeypatch.setattr(team_beacon_sender, "send_channel_message_to_channel", working_send)
        assert await team_beacon_sender.send_team_beacon_if_due(now=1015.0) is True
