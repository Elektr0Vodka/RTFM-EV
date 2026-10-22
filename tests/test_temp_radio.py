"""Temporary radio settings session: start, restore, expiry, reconcile (spec 5.2)."""

from unittest.mock import AsyncMock, patch

import pytest

from app.models import (
    RadioStamp,
    RadioStampInput,
    TempRadioOptIns,
    TempRadioStartRequest,
)
from app.repository import AppSettingsRepository
from app.services.temp_radio import TempRadioService, TempRadioUnavailableError

HOME = RadioStamp(freq=869.618, bw=62.5, sf=7, cr=8)
AWAY = RadioStampInput(freq=869.618, bw=62.5, sf=8, cr=8)
OTHER = RadioStamp(freq=869.525, bw=250.0, sf=11, cr=5)
KEY = "ab" * 32


class FakeRadio:
    """Stands in for the companion: holds its settings, repeat flag and key."""

    def __init__(self):
        self.stamp: RadioStamp | None = HOME
        self.repeat: bool | None = True
        self.key: str | None = KEY
        self.connected = True
        self.applied: list[tuple[RadioStamp, bool | None]] = []
        self.regions: list[str | None] = []

    async def apply(self, stamp, repeat):
        if not self.connected:
            raise RuntimeError("radio disconnected")
        self.applied.append((RadioStamp(**stamp.model_dump()), repeat))
        self.stamp = RadioStamp(**stamp.model_dump())
        if repeat is not None:
            self.repeat = repeat

    async def apply_region(self, region):
        self.regions.append(region)


@pytest.fixture
def radio():
    return FakeRadio()


@pytest.fixture
def clock():
    return {"now": 1_000.0}


@pytest.fixture
def broadcasts():
    return []


@pytest.fixture
def svc(test_db, radio, clock, broadcasts):
    service = TempRadioService()
    service.clock = lambda: clock["now"]
    service.broadcast = lambda event, data: broadcasts.append((event, data))
    service._apply_radio = radio.apply
    service._apply_region = radio.apply_region
    service._current = lambda: radio.stamp
    service._client_repeat = lambda: radio.repeat
    service._connected_key = lambda: radio.key if radio.connected else None
    service._schedule = lambda: None
    return service


def _req(duration=1800, **kw) -> TempRadioStartRequest:
    return TempRadioStartRequest(radio=AWAY, duration_secs=duration, **kw)


@pytest.mark.asyncio
async def test_start_saves_original_and_applies_temp(svc, radio, broadcasts):
    state = await svc.start(_req())
    assert state.active
    assert state.original == HOME
    assert state.temp == RadioStamp(**AWAY.model_dump())
    assert state.expires_at == 1_000 + 1800
    assert state.companion_key == KEY
    assert radio.stamp.sf == 8
    stored = await AppSettingsRepository.get_temp_radio_state()
    assert stored is not None and stored.original == HOME
    assert broadcasts[-1][0] == "temp_radio_state"


@pytest.mark.asyncio
async def test_start_without_radio_settings_raises(svc, radio):
    radio.stamp = None
    with pytest.raises(TempRadioUnavailableError):
        await svc.start(_req())
    assert (await svc.get_state()).active is False


@pytest.mark.asyncio
async def test_start_failure_with_radio_gone_keeps_pending_session(svc, radio):
    # Whether set_radio reached the radio is unknown, so the session is kept
    # with a restore pending; reconcile clears it when the radio is on normal.
    radio.connected = False
    svc._connected_key = lambda: KEY
    with pytest.raises(RuntimeError):
        await svc.start(_req())
    state = await svc.get_state()
    assert state.active is True and state.restore_pending is True
    radio.connected = True
    await svc.reconcile_on_connect()
    assert (await svc.get_state()).active is False
    assert await AppSettingsRepository.get_temp_radio_state() is None


@pytest.mark.asyncio
async def test_start_while_active_keeps_original(svc, radio, clock):
    await svc.start(_req())
    clock["now"] = 1_100.0
    second = RadioStampInput(freq=869.525, bw=250.0, sf=11, cr=5)
    state = await svc.start(TempRadioStartRequest(radio=second, duration_secs=600))
    assert state.original == HOME
    assert state.temp.sf == 11
    assert state.expires_at == 1_700
    assert state.original_repeat is True


@pytest.mark.asyncio
async def test_temp_repeat_off_unless_opted_in(svc, radio):
    await svc.start(_req())
    assert radio.applied[-1][1] is False
    await svc.restore()
    assert radio.applied[-1][1] is True
    await svc.start(_req(opt_ins=TempRadioOptIns(client_repeat=True)))
    assert radio.applied[-1][1] is True


@pytest.mark.asyncio
async def test_restore_applies_original_and_clears(svc, radio, broadcasts):
    await svc.start(_req())
    state = await svc.restore()
    assert state.active is False
    assert radio.stamp == HOME
    assert await AppSettingsRepository.get_temp_radio_state() is None
    assert broadcasts[-1][1]["active"] is False


@pytest.mark.asyncio
async def test_expiry_restores(svc, radio, clock):
    await svc.start(_req(duration=60))
    clock["now"] = 1_061.0
    await svc.handle_expiry()
    assert radio.stamp == HOME
    assert (await svc.get_state()).active is False


@pytest.mark.asyncio
async def test_expiry_while_disconnected_keeps_pending(svc, radio, clock):
    await svc.start(_req(duration=60))
    radio.connected = False
    clock["now"] = 1_061.0
    await svc.handle_expiry()
    state = await svc.get_state()
    assert state.active is True
    assert state.restore_pending is True
    stored = await AppSettingsRepository.get_temp_radio_state()
    assert stored is not None and stored.restore_pending is True


@pytest.mark.asyncio
async def test_reconcile_temp_not_expired_reschedules(svc, radio, clock):
    await svc.start(_req(duration=600))
    scheduled = []
    svc._schedule = lambda: scheduled.append(True)
    # Backend restarted: a fresh service loads the stored state.
    fresh = TempRadioService()
    fresh.clock = svc.clock
    fresh.broadcast = svc.broadcast
    fresh._apply_radio = radio.apply
    fresh._apply_region = radio.apply_region
    fresh._current = lambda: radio.stamp
    fresh._client_repeat = lambda: radio.repeat
    fresh._connected_key = lambda: radio.key
    fresh._schedule = lambda: scheduled.append(True)
    await fresh.load()
    clock["now"] = 1_300.0
    await fresh.reconcile_on_connect()
    assert scheduled == [True]
    assert (await fresh.get_state()).active is True
    assert radio.stamp.sf == 8


@pytest.mark.asyncio
async def test_reconcile_temp_expired_restores(svc, radio, clock):
    await svc.start(_req(duration=60))
    clock["now"] = 2_000.0
    await svc.reconcile_on_connect()
    assert radio.stamp == HOME
    assert (await svc.get_state()).active is False


@pytest.mark.asyncio
async def test_reconcile_original_clears(svc, radio):
    await svc.start(_req())
    radio.stamp = HOME
    await svc.reconcile_on_connect()
    assert (await svc.get_state()).active is False
    assert len(radio.applied) == 1


@pytest.mark.asyncio
async def test_reconcile_changed_elsewhere_drops_state(svc, radio, broadcasts):
    await svc.start(_req())
    radio.stamp = OTHER
    await svc.reconcile_on_connect()
    assert (await svc.get_state()).active is False
    assert radio.stamp == OTHER
    assert any(event == "temp_radio_dropped" for event, _ in broadcasts)


@pytest.mark.asyncio
async def test_reconcile_other_companion_ignored(svc, radio, clock):
    await svc.start(_req(duration=60))
    radio.key = "cd" * 32
    radio.stamp = OTHER
    clock["now"] = 5_000.0
    await svc.reconcile_on_connect()
    state = await svc.get_state()
    assert state.active is True
    assert radio.stamp == OTHER
    assert len(radio.applied) == 1


@pytest.mark.asyncio
async def test_session_region_applied_and_restored(svc, radio):
    await svc.start(_req(region="be"))
    assert svc.session_region() == "#be"
    assert radio.regions == ["#be"]
    await svc.restore()
    assert svc.session_region() is None
    assert radio.regions == ["#be", None]


@pytest.mark.asyncio
async def test_blank_region_leaves_scope_alone(svc, radio):
    await svc.start(_req(region=""))
    assert svc.session_region() is None
    await svc.restore()
    assert radio.regions == []


@pytest.mark.asyncio
async def test_end_as_new_normal_keeps_radio(svc, radio):
    await svc.start(_req(region="be"))
    await svc.end_as_new_normal()
    assert (await svc.get_state()).active is False
    assert radio.stamp.sf == 8
    assert radio.regions == ["#be", None]


@pytest.mark.asyncio
async def test_opt_ins(svc):
    assert svc.session_active() is False
    assert svc.opted_in("adverts") is True
    assert svc.fanout_allowed("abc") is True
    await svc.start(_req(opt_ins=TempRadioOptIns(team_beacon=True, fanout_ids=["abc"])))
    assert svc.opted_in("adverts") is False
    assert svc.opted_in("team_beacon") is True
    assert svc.fanout_allowed("abc") is True
    assert svc.fanout_allowed("def") is False


class TestRouter:
    @pytest.mark.asyncio
    async def test_validation_ranges(self, test_db, client):
        bad_sf = {"radio": {"freq": 869.6, "bw": 62.5, "sf": 4, "cr": 8}, "duration_secs": 60}
        assert (await client.post("/api/radio/temp", json=bad_sf)).status_code == 422
        bad_dur = {"radio": {"freq": 869.6, "bw": 62.5, "sf": 8, "cr": 8}, "duration_secs": 0}
        assert (await client.post("/api/radio/temp", json=bad_dur)).status_code == 422

    @pytest.mark.asyncio
    async def test_get_state_inactive(self, test_db, client):
        resp = await client.get("/api/radio/temp")
        assert resp.status_code == 200
        assert resp.json()["active"] is False

    @pytest.mark.asyncio
    async def test_start_unavailable_maps_to_503(self, test_db, client):
        from app.services import temp_radio as temp_radio_module

        body = {"radio": {"freq": 869.6, "bw": 62.5, "sf": 8, "cr": 8}, "duration_secs": 60}
        with patch.object(
            temp_radio_module.temp_radio,
            "start",
            AsyncMock(side_effect=TempRadioUnavailableError("no radio")),
        ):
            resp = await client.post("/api/radio/temp", json=body)
        assert resp.status_code == 503


class TestPatchConfigInteraction:
    @pytest.mark.asyncio
    async def test_radio_change_ends_session(self, svc):
        from app.services.temp_radio import radio_change_ends_session

        await svc.start(_req())
        new = RadioStamp(freq=869.525, bw=250.0, sf=11, cr=5)
        assert radio_change_ends_session(svc, new, current=RadioStamp(**AWAY.model_dump()))

    @pytest.mark.asyncio
    async def test_rename_keeps_session(self, svc):
        from app.services.temp_radio import radio_change_ends_session

        await svc.start(_req())
        current = RadioStamp(**AWAY.model_dump())
        assert not radio_change_ends_session(svc, None, current=current)
        assert not radio_change_ends_session(svc, current, current=current)


@pytest.mark.asyncio
async def test_effective_flood_scope(svc, radio):
    assert svc.effective_flood_scope("#nl") == "#nl"
    await svc.start(_req(region="be"))
    assert svc.effective_flood_scope("#nl") == "#be"
    await svc.start(_req(region="*"))
    assert svc.effective_flood_scope("#nl") == ""
    radio.key = "cd" * 32
    assert svc.effective_flood_scope("#nl") == "#nl"


@pytest.mark.asyncio
async def test_reconcile_drop_puts_saved_region_back(svc, radio):
    await svc.start(_req(region="be"))
    radio.stamp = OTHER
    await svc.reconcile_on_connect()
    assert radio.regions == ["#be", None]


@pytest.mark.asyncio
async def test_reconcile_already_restored_puts_saved_region_back(svc, radio):
    await svc.start(_req(region="be"))
    radio.stamp = HOME
    await svc.reconcile_on_connect()
    assert radio.regions == ["#be", None]


@pytest.mark.asyncio
async def test_extend_to_moves_expiry_forward_only(svc, radio):
    await svc.start(_req(duration=60))
    await svc.extend_to(2_000.0)
    assert (await svc.get_state()).expires_at == 2_000.0
    await svc.extend_to(1_500.0)
    assert (await svc.get_state()).expires_at == 2_000.0
    stored = await AppSettingsRepository.get_temp_radio_state()
    assert stored is not None and stored.expires_at == 2_000.0
