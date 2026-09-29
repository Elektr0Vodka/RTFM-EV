"""Radio identity service (plan 18 Phase 1): connect hook, per-sample attribution,
chart scope resolution, and the health payload view."""

from types import SimpleNamespace

import pytest

from app.repository.radio_identities import RadioIdentityRepository, StatScope
from app.services import radio_identity, radio_stats

KEY_A = "aa" * 32
KEY_B = "bb" * 32


@pytest.fixture(autouse=True)
def _reset_service():
    radio_identity.reset_state()
    yield
    radio_identity.reset_state()


def _mc(key: str | None, name: str = "Radio"):
    return SimpleNamespace(self_info={"public_key": key, "name": name} if key else {})


class TestConnectHook:
    @pytest.mark.asyncio
    async def test_registers_and_caches_active_radio(self, test_db):
        identity = await radio_identity.register_connected_radio(_mc(KEY_A, "Alpha"))

        assert identity is not None
        assert identity.public_key == KEY_A
        assert radio_identity.sample_identity(KEY_A) == (True, identity.id)

    @pytest.mark.asyncio
    async def test_missing_self_key_registers_nothing(self, test_db):
        assert await radio_identity.register_connected_radio(_mc(None)) is None
        assert await RadioIdentityRepository.list_all() == []

    @pytest.mark.asyncio
    async def test_db_failure_is_swallowed(self, test_db, monkeypatch):
        async def boom(*args, **kwargs):
            raise RuntimeError("db down")

        monkeypatch.setattr(RadioIdentityRepository, "register_connect", staticmethod(boom))
        assert await radio_identity.register_connected_radio(_mc(KEY_A)) is None

    @pytest.mark.asyncio
    async def test_switching_radio_clears_in_memory_buffers(self, test_db):
        await radio_identity.register_connected_radio(_mc(KEY_A))
        radio_stats._battery_samples.append((1, 4000))
        radio_stats._noise_floor_samples.append((1, -110))

        # Same radio reconnecting keeps the buffers.
        await radio_identity.register_connected_radio(_mc(KEY_A))
        assert len(radio_stats._battery_samples) == 1

        await radio_identity.register_connected_radio(_mc(KEY_B))
        assert len(radio_stats._battery_samples) == 0
        assert len(radio_stats._noise_floor_samples) == 0


class TestSampleIdentity:
    def test_nothing_registered_persists_unassigned(self):
        assert radio_identity.sample_identity(KEY_A) == (True, None)

    @pytest.mark.asyncio
    async def test_other_radio_than_registered_is_skipped(self, test_db):
        await radio_identity.register_connected_radio(_mc(KEY_A))
        assert radio_identity.sample_identity(KEY_B) == (False, None)
        assert radio_identity.sample_identity(None) == (False, None)

    @pytest.mark.asyncio
    async def test_key_match_is_case_insensitive(self, test_db):
        identity = await radio_identity.register_connected_radio(_mc(KEY_A))
        assert identity is not None
        assert radio_identity.sample_identity(KEY_A.upper()) == (True, identity.id)


class TestStatScope:
    @pytest.mark.asyncio
    async def test_empty_registry_reads_everything(self, test_db):
        assert await radio_identity.resolve_stat_scope(None, False) == StatScope()

    @pytest.mark.asyncio
    async def test_default_is_active_radio_lineage(self, test_db):
        a = await radio_identity.register_connected_radio(_mc(KEY_A))
        b = await radio_identity.register_connected_radio(_mc(KEY_B))
        assert a is not None and b is not None
        await RadioIdentityRepository.link_replacement(
            b.id, a.id, carry_stats=True, carry_owned=False, carry_note=False
        )

        assert await radio_identity.resolve_stat_scope(None, False) == StatScope(ids=[b.id, a.id])
        assert await radio_identity.resolve_stat_scope(a.id, False) == StatScope(ids=[a.id])

    @pytest.mark.asyncio
    async def test_unassigned(self, test_db):
        assert await radio_identity.resolve_stat_scope(None, True) == StatScope(unassigned=True)

    @pytest.mark.asyncio
    async def test_unknown_radio_id_raises(self, test_db):
        from app.repository.radio_identities import RadioIdentityNotFound

        with pytest.raises(RadioIdentityNotFound):
            await radio_identity.resolve_stat_scope(999, False)


class TestHealthView:
    @pytest.mark.asyncio
    async def test_none_before_any_radio(self, test_db):
        assert await radio_identity.health_view() is None

    @pytest.mark.asyncio
    async def test_active_radio_with_owned_lineage(self, test_db):
        a = await radio_identity.register_connected_radio(_mc(KEY_A, "Alpha"))
        b = await radio_identity.register_connected_radio(_mc(KEY_B, "Bravo"))
        assert a is not None and b is not None

        view = await radio_identity.health_view()
        assert view is not None
        assert view["id"] == b.id
        assert view["status"] == "pending"
        assert view["pending_reason"] == "new_key"
        assert view["owned_keys"] == [KEY_B]

        await RadioIdentityRepository.link_replacement(
            b.id, a.id, carry_stats=False, carry_owned=True, carry_note=False
        )
        view = await radio_identity.health_view()
        assert view is not None
        assert view["status"] == "confirmed"
        assert view["owned_keys"] == [KEY_B, KEY_A]


class TestSamplerAttribution:
    @pytest.mark.asyncio
    async def test_persist_tags_registered_radio_and_skips_unregistered(self, test_db, monkeypatch):
        from app.repository.battery_history import BatteryHistoryRepository

        a = await radio_identity.register_connected_radio(_mc(KEY_A))
        assert a is not None

        live = SimpleNamespace(self_info={"public_key": KEY_A})
        monkeypatch.setattr(radio_stats, "radio_manager", SimpleNamespace(meshcore=live))

        await radio_stats._persist_samples({"timestamp": 100, "battery_mv": 4000})
        live.self_info = {"public_key": KEY_B}  # swapped, not registered yet
        await radio_stats._persist_samples({"timestamp": 200, "battery_mv": 3000})

        assert await BatteryHistoryRepository.get_range(0, 1000) == [
            {"timestamp": 100, "battery_mv": 4000}
        ]
        assert await BatteryHistoryRepository.get_range(0, 1000, StatScope(ids=[a.id])) == [
            {"timestamp": 100, "battery_mv": 4000}
        ]
