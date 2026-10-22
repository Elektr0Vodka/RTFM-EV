"""Scan lists: cycle the companion through user-made radio settings (spec 4.7)."""

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from app.models import (
    RadioScanEntry,
    RadioScanListRequest,
    RadioScanState,
    RadioStampInput,
    TempRadioOptIns,
    TempRadioState,
)
from app.repository.radio_scan_lists import RadioScanListsRepository
from app.services.radio_scan import RadioScanService

A = RadioStampInput(freq=869.618, bw=62.5, sf=8, cr=8)
B = RadioStampInput(freq=869.525, bw=250.0, sf=11, cr=5)


class FakeTemp:
    """Records what the scanner asks of the temporary-session service."""

    def __init__(self):
        self.calls: list[tuple] = []
        self.active = False
        self.on_session_end = None

    async def start(self, req, *, scan=None):
        self.active = True
        self.calls.append(("start", req.radio.sf, req.region, scan.entry_index if scan else None))
        return TempRadioState(active=True)

    async def restore(self):
        self.active = False
        self.calls.append(("restore",))
        if self.on_session_end is not None:
            self.on_session_end()
        return TempRadioState()

    async def extend_to(self, expires_at):
        self.calls.append(("extend", expires_at))

    def source_kind(self):
        return "scan" if self.active else None


def _list(**kw) -> RadioScanListRequest:
    body = {
        "name": "border",
        "entries": [
            RadioScanEntry(radio=A, region="be", dwell_secs=60),
            RadioScanEntry(radio=B, region=None, dwell_secs=30),
        ],
        "rounds": 2,
    }
    body.update(kw)
    return RadioScanListRequest(**body)


def _scanner(temp: FakeTemp, clock: dict, on_wait=None) -> RadioScanService:
    svc = RadioScanService(temp=temp)
    svc.clock = lambda: clock["now"]

    async def sleep_until(target):
        if on_wait is not None:
            on_wait(svc, target)
        clock["now"] = max(clock["now"], target)

    svc._sleep_until = sleep_until
    svc.broadcast = lambda event, data: None
    return svc


@pytest.fixture
def clock():
    return {"now": 1_000.0}


class TestRun:
    @pytest.mark.asyncio
    async def test_two_entries_two_rounds_end_on_normal(self, clock):
        temp = FakeTemp()
        svc = _scanner(temp, clock)
        await svc._run(1, _list())
        starts = [c for c in temp.calls if c[0] == "start"]
        assert [(c[1], c[3]) for c in starts] == [(8, 0), (11, 1), (8, 0), (11, 1)]
        assert temp.calls[-1] == ("restore",)
        assert clock["now"] == 1_000 + 2 * (60 + 30)
        assert svc.state().running is False

    @pytest.mark.asyncio
    async def test_rounds_zero_loops_until_stopped(self, clock):
        temp = FakeTemp()
        waits = {"n": 0}

        def on_wait(svc, target):
            waits["n"] += 1
            if waits["n"] == 5:
                svc._stop_requested = True

        svc = _scanner(temp, clock, on_wait)
        await svc._run(1, _list(rounds=0))
        assert len([c for c in temp.calls if c[0] == "start"]) == 5
        assert temp.calls[-1] == ("restore",)

    @pytest.mark.asyncio
    async def test_normal_between_inserts_restore_steps(self, clock):
        temp = FakeTemp()
        svc = _scanner(temp, clock)
        await svc._run(1, _list(rounds=1, normal_between_secs=20))
        kinds = [c[0] for c in temp.calls]
        assert kinds == ["start", "restore", "start", "restore"]
        assert clock["now"] == 1_000 + 60 + 20 + 30

    @pytest.mark.asyncio
    async def test_activity_extends_current_entry(self, clock):
        temp = FakeTemp()
        hits = {"n": 0}

        def on_wait(svc, target):
            # One packet arrives 50 s into the first entry.
            if hits["n"] == 0:
                hits["n"] += 1
                clock["now"] = 1_050.0
                svc.on_activity()

        svc = _scanner(temp, clock, on_wait)
        await svc._run(1, _list(rounds=1, hold_on_activity_secs=40))
        await asyncio.sleep(0)  # the session extension is a scheduled task
        # Entry 1 ran until 1050 + 40 instead of 1060; entry 2 then 30 s.
        assert clock["now"] == 1_090 + 30
        assert any(c[0] == "extend" for c in temp.calls)

    @pytest.mark.asyncio
    async def test_outside_session_end_stops_scan(self, clock):
        temp = FakeTemp()

        def on_wait(svc, target):
            if temp.on_session_end is not None and len(temp.calls) == 1:
                # The user pressed Restore now (or the session expired).
                temp.on_session_end()

        svc = _scanner(temp, clock, on_wait)
        temp.on_session_end = svc._on_session_end
        await svc._run(1, _list(rounds=0))
        assert len([c for c in temp.calls if c[0] == "start"]) == 1

    @pytest.mark.asyncio
    async def test_stop_for_other_switch(self, clock):
        temp = FakeTemp()
        svc = _scanner(temp, clock)
        assert await svc.stop_for_other_switch() is False


class TestRepository:
    @pytest.mark.asyncio
    async def test_crud(self, test_db):
        created = await RadioScanListsRepository.create(
            _list(opt_ins=TempRadioOptIns(adverts=True))
        )
        assert created.id > 0 and len(created.entries) == 2
        got = await RadioScanListsRepository.get(created.id)
        assert got is not None and got.opt_ins.adverts is True
        assert got.entries[0].region == "#be"
        updated = await RadioScanListsRepository.update(created.id, _list(name="other"))
        assert updated is not None and updated.name == "other"
        assert [x.id for x in await RadioScanListsRepository.list_all()] == [created.id]
        assert await RadioScanListsRepository.delete(created.id) is True
        assert await RadioScanListsRepository.get(created.id) is None


class TestApi:
    @pytest.mark.asyncio
    async def test_create_list_and_validation(self, test_db, client):
        body = {
            "name": "border",
            "entries": [
                {"radio": {"freq": 869.618, "bw": 62.5, "sf": 8, "cr": 8}, "dwell_secs": 60}
            ],
        }
        resp = await client.post("/api/radio/scan-lists", json=body)
        assert resp.status_code == 200
        list_id = resp.json()["id"]
        assert (await client.get("/api/radio/scan-lists")).json()[0]["id"] == list_id
        empty = {**body, "entries": []}
        assert (await client.post("/api/radio/scan-lists", json=empty)).status_code == 422
        put = await client.put(f"/api/radio/scan-lists/{list_id}", json={**body, "name": "x"})
        assert put.json()["name"] == "x"
        assert (await client.delete(f"/api/radio/scan-lists/{list_id}")).status_code == 200

    @pytest.mark.asyncio
    async def test_run_unknown_list_404(self, test_db, client):
        assert (await client.post("/api/radio/scan-lists/999/run")).status_code == 404

    @pytest.mark.asyncio
    async def test_run_and_stop(self, test_db, client):
        from app.services import radio_scan as radio_scan_module

        body = {
            "name": "border",
            "entries": [
                {"radio": {"freq": 869.618, "bw": 62.5, "sf": 8, "cr": 8}, "dwell_secs": 60}
            ],
        }
        list_id = (await client.post("/api/radio/scan-lists", json=body)).json()["id"]
        with (
            patch("app.routers.radio.radio_manager.require_connected"),
            patch.object(
                radio_scan_module.radio_scan,
                "start_task",
                AsyncMock(return_value=RadioScanState(running=True, list_id=list_id)),
            ) as start_task,
            patch.object(
                radio_scan_module.radio_scan, "stop", AsyncMock(return_value=RadioScanState())
            ) as stop,
        ):
            assert (await client.post(f"/api/radio/scan-lists/{list_id}/run")).status_code == 200
            assert (await client.post("/api/radio/scan/stop")).status_code == 200
        start_task.assert_awaited_once()
        stop.assert_awaited_once()


class TestStopWithoutRestore:
    @pytest.mark.asyncio
    async def test_stop_for_other_switch_leaves_radio(self, clock):
        import asyncio

        temp = FakeTemp()
        svc = RadioScanService(temp=temp)
        svc.broadcast = lambda event, data: None
        svc.clock = lambda: clock["now"]

        async def never(target):
            await asyncio.sleep(3600)

        svc._sleep_until = never
        from app.models import RadioScanList

        saved = RadioScanList(id=1, created_at=0, updated_at=0, **_list().model_dump())
        await svc.start_task(saved)
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert await svc.stop_for_other_switch() is True
        assert ("restore",) not in temp.calls
        assert svc.state().running is False


class TestActivityHook:
    @pytest.mark.asyncio
    async def test_packet_notifies_scanner(self, test_db, captured_broadcasts):
        from app.packet_processor import process_raw_packet
        from app.services import radio_scan as radio_scan_module

        _, mock_broadcast = captured_broadcasts
        with (
            patch("app.packet_processor.broadcast_event", mock_broadcast),
            patch.object(radio_scan_module.radio_scan, "on_activity") as on_activity,
        ):
            await process_raw_packet(bytes.fromhex("0100aa"), timestamp=1_700_000_000)
        on_activity.assert_called_once()
