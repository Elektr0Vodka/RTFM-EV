"""Spam Guard airtime saved over a time window (share card 5c)."""

import pytest

from app.repository import ChannelRepository
from app.routers import spam as router_module
from app.services import spam_guard as spam_guard_module
from app.services.host_repeater import HostRepeaterRuntime
from app.services.spam_backend_host import HostBackend
from app.services.spam_guard import SpamGuardRuntime
from app.spam.detector import HISTORY_HOURS

PUBLIC = "8B3387E9C5CDEA6AC9E5EDBAA115CD72"
NOW = 1_800_000_000


@pytest.fixture
async def runtime(test_db, monkeypatch):
    rt = SpamGuardRuntime()
    rt.host = HostBackend(HostRepeaterRuntime())
    monkeypatch.setattr(router_module, "spam_guard", rt)
    monkeypatch.setattr(spam_guard_module, "spam_guard", rt)
    monkeypatch.setattr(spam_guard_module, "broadcast_event", lambda *args, **kwargs: None)
    await ChannelRepository.upsert(key=PUBLIC, name="Public")
    await rt.load()
    rt.detector._clock = lambda: NOW
    yield rt
    await rt.stop()


class TestAirtimeWindow:
    @pytest.mark.asyncio
    async def test_sums_the_hours_inside_the_window(self, runtime):
        d = runtime.detector
        d.add_airtime(NOW - 3 * 3600 + 10, 100.0)
        d.add_airtime(NOW - 2 * 3600 + 10, 250.0)
        d.add_airtime(NOW - 30, 50.0)
        body = d.airtime_window(NOW - 2 * 3600 - 60, NOW)
        # The hour that starts before the window start (NOW - 3h) is left out;
        # the hour holding NOW - 2h + 10 starts after the window start.
        assert body["airtime_ms"] == 300.0
        assert body["partial"] is False
        assert body["from_ts"] == NOW - 2 * 3600 - 60
        assert body["to_ts"] == NOW

    @pytest.mark.asyncio
    async def test_flags_a_window_older_than_the_kept_history(self, runtime):
        d = runtime.detector
        d.add_airtime(NOW - 30, 40.0)
        start = NOW - (HISTORY_HOURS + 24) * 3600
        body = d.airtime_window(start, NOW)
        assert body["airtime_ms"] == 40.0
        assert body["partial"] is True
        assert body["from_ts"] == NOW - HISTORY_HOURS * 3600

    @pytest.mark.asyncio
    async def test_route_returns_the_window(self, runtime):
        runtime.detector.add_airtime(NOW - 30, 12.5)
        body = await router_module.get_spam_guard_airtime(start_ts=NOW - 3600, end_ts=NOW)
        assert body["airtime_ms"] == 12.5

    @pytest.mark.asyncio
    async def test_route_rejects_a_bad_window(self, test_db, client):
        resp = await client.get("/api/spam-guard/airtime?start_ts=10&end_ts=5")
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_never_counts_hours_before_from_ts(self, runtime):
        # A quiet node keeps its last 192 hour entries, which can be older than
        # 8 days; the sum must still start at from_ts, as the label says.
        d = runtime.detector
        d.add_airtime(NOW - (HISTORY_HOURS + 10) * 3600, 999.0)
        d.add_airtime(NOW - 30, 1.0)
        body = d.airtime_window(NOW - (HISTORY_HOURS + 24) * 3600, NOW)
        assert body["partial"] is True
        assert body["airtime_ms"] == 1.0
