"""Radio identity HTTP surface (plan 18 Phase 1): /api/radio-identities, the
per-radio statistics filters, and the health payload field."""

import pytest

from app.repository.airtime_history import AirtimeHistoryRepository
from app.repository.battery_history import BatteryHistoryRepository
from app.repository.noise_floor import NoiseFloorRepository
from app.repository.radio_identities import RadioIdentityRepository
from app.services import radio_identity

KEY_A = "aa" * 32
KEY_B = "bb" * 32


@pytest.fixture(autouse=True)
def _reset_service():
    radio_identity.reset_state()
    yield
    radio_identity.reset_state()


@pytest.fixture(autouse=True)
def _no_broadcast(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(
        "app.routers.radio_identities.broadcast_health",
        lambda *args, **kwargs: calls.append("health"),
    )
    return calls


async def _two_radios():
    a = await RadioIdentityRepository.register_connect(KEY_A, "Alpha", 1000)
    b = await RadioIdentityRepository.register_connect(KEY_B, "Bravo", 2000)
    return a, b


class TestRegistryEndpoints:
    @pytest.mark.asyncio
    async def test_list(self, test_db, client):
        await _two_radios()
        await BatteryHistoryRepository.insert(10, 4000)  # unassigned

        resp = await client.get("/api/radio-identities")

        assert resp.status_code == 200
        body = resp.json()
        assert [r["public_key"] for r in body["radios"]] == [KEY_B, KEY_A]
        assert body["has_unassigned_history"] is True

    @pytest.mark.asyncio
    async def test_confirm_new_broadcasts_health(self, test_db, client, _no_broadcast):
        _, b = await _two_radios()

        resp = await client.post(f"/api/radio-identities/{b.id}/confirm-new")

        assert resp.status_code == 200
        assert resp.json()["status"] == "confirmed"
        assert _no_broadcast == ["health"]

    @pytest.mark.asyncio
    async def test_confirm_new_twice_is_409(self, test_db, client):
        _, b = await _two_radios()
        await client.post(f"/api/radio-identities/{b.id}/confirm-new")
        resp = await client.post(f"/api/radio-identities/{b.id}/confirm-new")
        assert resp.status_code == 409

    @pytest.mark.asyncio
    async def test_unknown_id_is_404(self, test_db, client):
        resp = await client.post("/api/radio-identities/999/confirm-new")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_replace_and_edit_link(self, test_db, client):
        a, b = await _two_radios()

        resp = await client.post(
            f"/api/radio-identities/{b.id}/replace",
            json={"old_id": a.id, "carry_stats": True, "carry_owned": False, "carry_note": True},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "confirmed"

        resp = await client.patch(
            f"/api/radio-identities/{a.id}/link", json={"carry_stats": False, "carry_owned": True}
        )
        assert resp.status_code == 200
        assert resp.json()["carry_owned"] is True

        resp = await client.delete(f"/api/radio-identities/{a.id}/link")
        assert resp.status_code == 200
        assert resp.json()["replaced_by"] is None

        resp = await client.delete(f"/api/radio-identities/{a.id}/link")
        assert resp.status_code == 409

    @pytest.mark.asyncio
    async def test_replace_self_is_409(self, test_db, client):
        _, b = await _two_radios()
        resp = await client.post(
            f"/api/radio-identities/{b.id}/replace",
            json={"old_id": b.id, "carry_stats": True, "carry_owned": True, "carry_note": True},
        )
        assert resp.status_code == 409

    @pytest.mark.asyncio
    async def test_legacy_history_answer(self, test_db, client):
        await BatteryHistoryRepository.insert(10, 4000)
        a = await RadioIdentityRepository.register_connect(KEY_A, "Alpha", 1000)

        resp = await client.post(
            f"/api/radio-identities/{a.id}/legacy-history", json={"adopt": True}
        )

        assert resp.status_code == 200
        assert resp.json()["status"] == "confirmed"
        assert await RadioIdentityRepository.has_unassigned_history() is False

    @pytest.mark.asyncio
    async def test_notes(self, test_db, client):
        a, _ = await _two_radios()
        resp = await client.patch(f"/api/radio-identities/{a.id}", json={"notes": "  lost  "})
        assert resp.status_code == 200
        assert resp.json()["notes"] == "lost"

    @pytest.mark.asyncio
    async def test_delete_keeps_stats_by_default(self, test_db, client, _no_broadcast):
        a, b = await _two_radios()
        await BatteryHistoryRepository.insert(100, 3900, a.id)

        resp = await client.delete(f"/api/radio-identities/{a.id}")

        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}
        assert _no_broadcast == ["health"]
        listing = (await client.get("/api/radio-identities")).json()
        assert [r["id"] for r in listing["radios"]] == [b.id]
        assert listing["has_unassigned_history"] is True

    @pytest.mark.asyncio
    async def test_delete_with_stats(self, test_db, client):
        a, _ = await _two_radios()
        await BatteryHistoryRepository.insert(100, 3900, a.id)

        resp = await client.delete(f"/api/radio-identities/{a.id}?delete_stats=true")

        assert resp.status_code == 200
        listing = (await client.get("/api/radio-identities")).json()
        assert listing["has_unassigned_history"] is False

    @pytest.mark.asyncio
    async def test_delete_current_radio_is_409(self, test_db, client, _no_broadcast):
        _, b = await _two_radios()

        resp = await client.delete(f"/api/radio-identities/{b.id}")

        assert resp.status_code == 409
        assert _no_broadcast == []

    @pytest.mark.asyncio
    async def test_delete_unknown_radio_is_404(self, test_db, client):
        resp = await client.delete("/api/radio-identities/999")
        assert resp.status_code == 404


class TestScopedStatistics:
    @pytest.mark.asyncio
    async def test_ranges_default_to_active_radio(self, test_db, client):
        a, b = await _two_radios()  # b is active
        await BatteryHistoryRepository.insert(100, 3900, a.id)
        await BatteryHistoryRepository.insert(200, 4000, b.id)
        await NoiseFloorRepository.insert(100, -110, a.id)
        await NoiseFloorRepository.insert(200, -100, b.id)

        resp = await client.get("/api/statistics/battery/range?start_ts=0&end_ts=1000")
        assert resp.json() == [{"timestamp": 200, "battery_mv": 4000}]

        resp = await client.get(
            f"/api/statistics/battery/range?start_ts=0&end_ts=1000&radio_id={a.id}"
        )
        assert resp.json() == [{"timestamp": 100, "battery_mv": 3900}]

        resp = await client.get("/api/statistics/noise-floor?start_ts=0&end_ts=1000")
        assert resp.json() == [{"timestamp": 200, "noise_floor_dbm": -100}]

    @pytest.mark.asyncio
    async def test_carried_stats_join_the_series(self, test_db, client):
        a, b = await _two_radios()
        await RadioIdentityRepository.link_replacement(
            b.id, a.id, carry_stats=True, carry_owned=False, carry_note=False
        )
        await BatteryHistoryRepository.insert(100, 3900, a.id)
        await BatteryHistoryRepository.insert(200, 4000, b.id)

        resp = await client.get("/api/statistics/battery/range?start_ts=0&end_ts=1000")
        assert [s["battery_mv"] for s in resp.json()] == [3900, 4000]

    @pytest.mark.asyncio
    async def test_unassigned_filter(self, test_db, client):
        await _two_radios()
        await BatteryHistoryRepository.insert(50, 3700)

        resp = await client.get(
            "/api/statistics/battery/range?start_ts=0&end_ts=1000&unassigned=true"
        )
        assert resp.json() == [{"timestamp": 50, "battery_mv": 3700}]

    @pytest.mark.asyncio
    async def test_unknown_radio_is_404(self, test_db, client):
        resp = await client.get("/api/statistics/battery/range?start_ts=0&end_ts=1&radio_id=999")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_airtime_scoped(self, test_db, client):
        a, b = await _two_radios()
        await AirtimeHistoryRepository.insert(0, 0, 0, radio_identity_id=a.id)
        await AirtimeHistoryRepository.insert(60, 30, 6, radio_identity_id=a.id)

        resp = await client.get("/api/statistics/airtime/range?start_ts=0&end_ts=60&bin_count=1")
        assert resp.json() == []  # active radio b has no samples

        resp = await client.get(
            f"/api/statistics/airtime/range?start_ts=0&end_ts=60&bin_count=1&radio_id={a.id}"
        )
        assert resp.json()[0]["tx_pct"] == 50.0

    @pytest.mark.asyncio
    async def test_battery_24h_skips_memory_for_other_radio(self, test_db, client):
        import time

        from app.services import radio_stats

        a, _ = await _two_radios()
        now = int(time.time())
        radio_stats._battery_samples.append((now - 5, 4200))  # belongs to active radio

        resp = await client.get(f"/api/statistics/battery?radio_id={a.id}")
        assert resp.json()["samples"] == []

        resp = await client.get("/api/statistics/battery")
        assert {"timestamp": now - 5, "battery_mv": 4200} in resp.json()["samples"]


class TestHealthField:
    @pytest.mark.asyncio
    async def test_health_carries_pending_radio(self, test_db, client):
        _, b = await _two_radios()

        resp = await client.get("/api/health")

        assert resp.status_code == 200
        ident = resp.json()["radio_identity"]
        assert ident["id"] == b.id
        assert ident["status"] == "pending"
        assert ident["pending_reason"] == "new_key"
        assert ident["owned_keys"] == [KEY_B]
