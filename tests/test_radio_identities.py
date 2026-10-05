"""Radio identity registry (plan 18 Phase 1): connect registration, legacy history
adoption, replacement links, read-time lineage, and transactional rollback."""

import pytest

from app.repository import radio_identities as radio_identities_module
from app.repository.airtime_history import AirtimeHistoryRepository
from app.repository.battery_history import BatteryHistoryRepository
from app.repository.noise_floor import NoiseFloorRepository
from app.repository.radio_identities import (
    RadioIdentityConflict,
    RadioIdentityNotFound,
    RadioIdentityRepository,
    StatScope,
)

KEY_A = "aa" * 32
KEY_B = "bb" * 32
KEY_C = "cc" * 32


@pytest.fixture
async def db(test_db):
    return test_db


async def _unassigned_count(db, table: str) -> int:
    async with db.readonly() as conn:
        async with conn.execute(
            f"SELECT COUNT(*) FROM {table} WHERE radio_identity_id IS NULL"
        ) as cur:
            row = await cur.fetchone()
    return row[0]


async def _seed_legacy_samples():
    await BatteryHistoryRepository.insert(100, 4000)
    await NoiseFloorRepository.insert(100, -110)
    await AirtimeHistoryRepository.insert(100, 1, 2)


async def _record_own_channel_message(db, sender_key: str):
    async with db.tx() as conn:
        async with conn.execute(
            "INSERT INTO messages (type, conversation_key, text, received_at, outgoing, "
            "sender_key) VALUES ('CHAN', 'CHANKEY', ?, 50, 1, ?)",
            (f"hi from {sender_key[:4]}", sender_key),
        ):
            pass


async def _record_traffic_observation(db, observer: str):
    async with db.tx() as conn:
        async with conn.execute(
            "INSERT INTO link_signal (observer_pubkey, subject_pubkey, source, snr, "
            "observed_at) VALUES (?, ?, 'traffic', 5.0, 60)",
            (observer, KEY_C),
        ):
            pass


class TestConnectRegistration:
    @pytest.mark.asyncio
    async def test_first_radio_with_no_history_is_confirmed_silently(self, db):
        identity = await RadioIdentityRepository.register_connect(KEY_A, "Alpha", 1000)

        assert identity.public_key == KEY_A
        assert identity.name == "Alpha"
        assert identity.status == "confirmed"
        assert identity.pending_reason is None
        assert identity.is_active
        assert identity.first_connected == 1000

    @pytest.mark.asyncio
    async def test_key_is_normalized_to_lowercase(self, db):
        identity = await RadioIdentityRepository.register_connect(KEY_A.upper(), "Alpha", 1000)
        assert identity.public_key == KEY_A

    @pytest.mark.asyncio
    async def test_known_radio_reconnect_updates_last_connected_only(self, db):
        await RadioIdentityRepository.register_connect(KEY_A, "Alpha", 1000)
        identity = await RadioIdentityRepository.register_connect(KEY_A, "Alpha 2", 2000)

        assert identity.first_connected == 1000
        assert identity.last_connected == 2000
        assert identity.name == "Alpha 2"
        assert len(await RadioIdentityRepository.list_all()) == 1

    @pytest.mark.asyncio
    async def test_legacy_history_adopted_when_evidence_matches(self, db):
        await _seed_legacy_samples()
        await _record_own_channel_message(db, KEY_A)
        await _record_traffic_observation(db, KEY_A)

        identity = await RadioIdentityRepository.register_connect(KEY_A, "Alpha", 1000)

        assert identity.status == "confirmed"
        for table in ("battery_history", "noise_floor_samples", "airtime_history"):
            assert await _unassigned_count(db, table) == 0

    @pytest.mark.asyncio
    async def test_self_placeholder_observer_is_not_evidence(self, db):
        # link_signal stores the literal "self" when key export is disabled.
        await _seed_legacy_samples()
        await _record_traffic_observation(db, "self")
        await _record_own_channel_message(db, KEY_A)

        identity = await RadioIdentityRepository.register_connect(KEY_A, "Alpha", 1000)

        assert identity.status == "confirmed"
        assert await _unassigned_count(db, "battery_history") == 0

    @pytest.mark.asyncio
    async def test_legacy_history_pending_when_no_evidence(self, db):
        await _seed_legacy_samples()

        identity = await RadioIdentityRepository.register_connect(KEY_A, "Alpha", 1000)

        assert identity.status == "pending"
        assert identity.pending_reason == "legacy_history"
        assert await _unassigned_count(db, "battery_history") == 1

    @pytest.mark.asyncio
    async def test_legacy_history_pending_when_evidence_conflicts(self, db):
        await _seed_legacy_samples()
        await _record_own_channel_message(db, KEY_A)
        await _record_own_channel_message(db, KEY_B)

        identity = await RadioIdentityRepository.register_connect(KEY_A, "Alpha", 1000)

        assert identity.status == "pending"
        assert identity.pending_reason == "legacy_history"
        assert await _unassigned_count(db, "noise_floor_samples") == 1

    @pytest.mark.asyncio
    async def test_unknown_radio_after_first_is_pending_new_key(self, db):
        await RadioIdentityRepository.register_connect(KEY_A, "Alpha", 1000)
        identity = await RadioIdentityRepository.register_connect(KEY_B, "Bravo", 2000)

        assert identity.status == "pending"
        assert identity.pending_reason == "new_key"
        assert identity.is_active
        rows = {r.public_key: r for r in await RadioIdentityRepository.list_all()}
        assert not rows[KEY_A].is_active

    @pytest.mark.asyncio
    async def test_pending_radio_stays_pending_on_reconnect(self, db):
        await RadioIdentityRepository.register_connect(KEY_A, "Alpha", 1000)
        await RadioIdentityRepository.register_connect(KEY_B, "Bravo", 2000)
        identity = await RadioIdentityRepository.register_connect(KEY_B, "Bravo", 3000)

        assert identity.status == "pending"
        assert identity.pending_reason == "new_key"

    @pytest.mark.asyncio
    async def test_blank_key_is_rejected(self, db):
        with pytest.raises(ValueError):
            await RadioIdentityRepository.register_connect("", "x", 1000)

    @pytest.mark.asyncio
    async def test_adoption_failure_rolls_back_everything(self, db, monkeypatch):
        await _seed_legacy_samples()
        await _record_own_channel_message(db, KEY_A)

        original = radio_identities_module._adopt_unassigned

        async def failing(conn, identity_id):
            await original(conn, identity_id)
            raise RuntimeError("boom")

        monkeypatch.setattr(radio_identities_module, "_adopt_unassigned", failing)

        with pytest.raises(RuntimeError):
            await RadioIdentityRepository.register_connect(KEY_A, "Alpha", 1000)

        assert await RadioIdentityRepository.list_all() == []
        assert await _unassigned_count(db, "battery_history") == 1


class TestResolve:
    @pytest.mark.asyncio
    async def test_confirm_new(self, db):
        await RadioIdentityRepository.register_connect(KEY_A, "Alpha", 1000)
        b = await RadioIdentityRepository.register_connect(KEY_B, "Bravo", 2000)

        resolved = await RadioIdentityRepository.confirm_new(b.id)

        assert resolved.status == "confirmed"
        assert resolved.pending_reason is None

    @pytest.mark.asyncio
    async def test_confirm_new_twice_conflicts(self, db):
        await RadioIdentityRepository.register_connect(KEY_A, "Alpha", 1000)
        b = await RadioIdentityRepository.register_connect(KEY_B, "Bravo", 2000)
        await RadioIdentityRepository.confirm_new(b.id)

        with pytest.raises(RadioIdentityConflict):
            await RadioIdentityRepository.confirm_new(b.id)

    @pytest.mark.asyncio
    async def test_confirm_new_rejects_legacy_prompt(self, db):
        await _seed_legacy_samples()
        a = await RadioIdentityRepository.register_connect(KEY_A, "Alpha", 1000)

        with pytest.raises(RadioIdentityConflict):
            await RadioIdentityRepository.confirm_new(a.id)

    @pytest.mark.asyncio
    async def test_unknown_id_not_found(self, db):
        with pytest.raises(RadioIdentityNotFound):
            await RadioIdentityRepository.confirm_new(999)

    @pytest.mark.asyncio
    async def test_resolve_legacy_yes_adopts(self, db):
        await _seed_legacy_samples()
        a = await RadioIdentityRepository.register_connect(KEY_A, "Alpha", 1000)

        resolved = await RadioIdentityRepository.resolve_legacy(a.id, adopt=True)

        assert resolved.status == "confirmed"
        assert await _unassigned_count(db, "airtime_history") == 0
        with pytest.raises(RadioIdentityConflict):
            await RadioIdentityRepository.resolve_legacy(a.id, adopt=True)

    @pytest.mark.asyncio
    async def test_resolve_legacy_no_leaves_rows_unassigned(self, db):
        await _seed_legacy_samples()
        a = await RadioIdentityRepository.register_connect(KEY_A, "Alpha", 1000)

        resolved = await RadioIdentityRepository.resolve_legacy(a.id, adopt=False)

        assert resolved.status == "confirmed"
        assert await _unassigned_count(db, "battery_history") == 1
        assert await RadioIdentityRepository.has_unassigned_history()


class TestReplacement:
    async def _two_radios(self, notes_a: str | None = "old note"):
        a = await RadioIdentityRepository.register_connect(KEY_A, "Alpha", 1000)
        if notes_a is not None:
            await RadioIdentityRepository.set_notes(a.id, notes_a)
        b = await RadioIdentityRepository.register_connect(KEY_B, "Bravo", 2000)
        return a, b

    @pytest.mark.asyncio
    async def test_replace_links_and_copies_note(self, db):
        a, b = await self._two_radios()

        resolved = await RadioIdentityRepository.link_replacement(
            b.id, a.id, carry_stats=True, carry_owned=True, carry_note=True
        )

        assert resolved.status == "confirmed"
        assert resolved.notes == "old note"
        old = await RadioIdentityRepository.get(a.id)
        assert old is not None
        assert old.replaced_by == b.id
        assert old.carry_stats and old.carry_owned

    @pytest.mark.asyncio
    async def test_replace_without_note(self, db):
        a, b = await self._two_radios()
        resolved = await RadioIdentityRepository.link_replacement(
            b.id, a.id, carry_stats=False, carry_owned=False, carry_note=False
        )
        assert resolved.notes is None

    @pytest.mark.asyncio
    async def test_replace_rejects_self(self, db):
        _, b = await self._two_radios()
        with pytest.raises(RadioIdentityConflict):
            await RadioIdentityRepository.link_replacement(
                b.id, b.id, carry_stats=True, carry_owned=True, carry_note=True
            )

    @pytest.mark.asyncio
    async def test_replace_rejects_already_replaced_radio(self, db):
        a, b = await self._two_radios()
        await RadioIdentityRepository.link_replacement(
            b.id, a.id, carry_stats=True, carry_owned=True, carry_note=True
        )
        c = await RadioIdentityRepository.register_connect(KEY_C, "Charlie", 3000)

        with pytest.raises(RadioIdentityConflict):
            await RadioIdentityRepository.link_replacement(
                c.id, a.id, carry_stats=True, carry_owned=True, carry_note=True
            )

    @pytest.mark.asyncio
    async def test_replace_rejects_second_predecessor(self, db):
        a, b = await self._two_radios()
        await RadioIdentityRepository.link_replacement(
            b.id, a.id, carry_stats=True, carry_owned=True, carry_note=True
        )
        c = await RadioIdentityRepository.register_connect(KEY_C, "Charlie", 3000)
        await RadioIdentityRepository.confirm_new(c.id)

        # b already replaces a; it cannot also replace c (no merging chains).
        with pytest.raises(RadioIdentityConflict):
            await RadioIdentityRepository.link_replacement(
                b.id, c.id, carry_stats=True, carry_owned=True, carry_note=True
            )

    @pytest.mark.asyncio
    async def test_replace_rejects_cycle(self, db):
        a, b = await self._two_radios()
        await RadioIdentityRepository.link_replacement(
            b.id, a.id, carry_stats=True, carry_owned=True, carry_note=True
        )
        with pytest.raises(RadioIdentityConflict):
            await RadioIdentityRepository.link_replacement(
                a.id, b.id, carry_stats=True, carry_owned=True, carry_note=True
            )

    @pytest.mark.asyncio
    async def test_replace_failure_rolls_back(self, db, monkeypatch):
        a, b = await self._two_radios()

        async def failing(conn, old, new):
            raise RuntimeError("boom")

        monkeypatch.setattr(radio_identities_module, "_copy_note", failing)

        with pytest.raises(RuntimeError):
            await RadioIdentityRepository.link_replacement(
                b.id, a.id, carry_stats=True, carry_owned=True, carry_note=True
            )

        old = await RadioIdentityRepository.get(a.id)
        new = await RadioIdentityRepository.get(b.id)
        assert old is not None and new is not None
        assert old.replaced_by is None
        assert new.status == "pending"

    @pytest.mark.asyncio
    async def test_update_and_remove_link(self, db):
        a, b = await self._two_radios()
        await RadioIdentityRepository.link_replacement(
            b.id, a.id, carry_stats=True, carry_owned=True, carry_note=False
        )

        updated = await RadioIdentityRepository.update_link(
            a.id, carry_stats=False, carry_owned=True
        )
        assert not updated.carry_stats and updated.carry_owned

        removed = await RadioIdentityRepository.remove_link(a.id)
        assert removed.replaced_by is None
        assert not removed.carry_stats and not removed.carry_owned

    @pytest.mark.asyncio
    async def test_update_link_without_link_conflicts(self, db):
        a, _ = await self._two_radios()
        with pytest.raises(RadioIdentityConflict):
            await RadioIdentityRepository.update_link(a.id, carry_stats=True, carry_owned=True)


class TestLineage:
    @pytest.mark.asyncio
    async def test_lineage_follows_only_carried_links(self, db):
        a = await RadioIdentityRepository.register_connect(KEY_A, "Alpha", 1000)
        b = await RadioIdentityRepository.register_connect(KEY_B, "Bravo", 2000)
        await RadioIdentityRepository.link_replacement(
            b.id, a.id, carry_stats=True, carry_owned=False, carry_note=False
        )
        c = await RadioIdentityRepository.register_connect(KEY_C, "Charlie", 3000)
        await RadioIdentityRepository.link_replacement(
            c.id, b.id, carry_stats=True, carry_owned=True, carry_note=False
        )

        assert await RadioIdentityRepository.lineage_ids(c.id, "stats") == [c.id, b.id, a.id]
        assert await RadioIdentityRepository.lineage_ids(c.id, "owned") == [c.id, b.id]
        assert await RadioIdentityRepository.lineage_ids(b.id, "stats") == [b.id, a.id]
        assert await RadioIdentityRepository.lineage_ids(a.id, "stats") == [a.id]

    @pytest.mark.asyncio
    async def test_lineage_stops_at_uncarried_link(self, db):
        a = await RadioIdentityRepository.register_connect(KEY_A, "Alpha", 1000)
        b = await RadioIdentityRepository.register_connect(KEY_B, "Bravo", 2000)
        await RadioIdentityRepository.link_replacement(
            b.id, a.id, carry_stats=False, carry_owned=False, carry_note=False
        )
        assert await RadioIdentityRepository.lineage_ids(b.id, "stats") == [b.id]

    @pytest.mark.asyncio
    async def test_lineage_keys(self, db):
        a = await RadioIdentityRepository.register_connect(KEY_A, "Alpha", 1000)
        b = await RadioIdentityRepository.register_connect(KEY_B, "Bravo", 2000)
        await RadioIdentityRepository.link_replacement(
            b.id, a.id, carry_stats=False, carry_owned=True, carry_note=False
        )
        assert await RadioIdentityRepository.lineage_keys(b.id, "owned") == [KEY_B, KEY_A]


class TestScopedStatReads:
    @pytest.mark.asyncio
    async def test_stat_ranges_filter_by_scope(self, db):
        await BatteryHistoryRepository.insert(100, 3900)  # unassigned
        await BatteryHistoryRepository.insert(200, 4000, radio_identity_id=1)
        await BatteryHistoryRepository.insert(300, 4100, radio_identity_id=2)

        everything = await BatteryHistoryRepository.get_range(0, 1000)
        assert [s["battery_mv"] for s in everything] == [3900, 4000, 4100]

        only_two = await BatteryHistoryRepository.get_range(0, 1000, StatScope(ids=[2]))
        assert [s["battery_mv"] for s in only_two] == [4100]

        lineage = await BatteryHistoryRepository.get_range(0, 1000, StatScope(ids=[2, 1]))
        assert [s["battery_mv"] for s in lineage] == [4000, 4100]

        legacy = await BatteryHistoryRepository.get_range(0, 1000, StatScope(unassigned=True))
        assert [s["battery_mv"] for s in legacy] == [3900]

    @pytest.mark.asyncio
    async def test_noise_and_airtime_scope(self, db):
        await NoiseFloorRepository.insert(100, -110, radio_identity_id=1)
        await NoiseFloorRepository.insert(200, -100, radio_identity_id=2)
        await AirtimeHistoryRepository.insert(100, 1, 2, radio_identity_id=1)
        await AirtimeHistoryRepository.insert(200, 3, 4, radio_identity_id=2)

        noise = await NoiseFloorRepository.get_range(0, 1000, StatScope(ids=[1]))
        assert [s["noise_floor_dbm"] for s in noise] == [-110]
        air = await AirtimeHistoryRepository.get_range(0, 1000, StatScope(ids=[2]))
        assert [s["tx_air_secs"] for s in air] == [3]
        assert air[0]["radio_identity_id"] == 2


class TestDelete:
    async def _count(self, db, table: str, radio_id: int | None) -> int:
        where = "IS NULL" if radio_id is None else "= ?"
        params = () if radio_id is None else (radio_id,)
        async with db.readonly() as conn:
            async with conn.execute(
                f"SELECT COUNT(*) FROM {table} WHERE radio_identity_id {where}", params
            ) as cur:
                row = await cur.fetchone()
        return row[0]

    async def _two_radios_with_samples(self):
        a = await RadioIdentityRepository.register_connect(KEY_A, "Alpha", 1000)
        b = await RadioIdentityRepository.register_connect(KEY_B, "Bravo", 2000)
        for radio in (a, b):
            await BatteryHistoryRepository.insert(100, 4000, radio.id)
            await NoiseFloorRepository.insert(100, -110, radio.id)
            await AirtimeHistoryRepository.insert(100, 1, 2, radio_identity_id=radio.id)
        return a, b

    @pytest.mark.asyncio
    async def test_delete_removes_the_radio(self, db):
        a, b = await self._two_radios_with_samples()

        await RadioIdentityRepository.delete(a.id, delete_stats=False)

        assert [r.id for r in await RadioIdentityRepository.list_all()] == [b.id]

    @pytest.mark.asyncio
    async def test_delete_keeps_samples_as_unassigned(self, db):
        a, b = await self._two_radios_with_samples()

        await RadioIdentityRepository.delete(a.id, delete_stats=False)

        for table in ("battery_history", "noise_floor_samples", "airtime_history"):
            assert await self._count(db, table, a.id) == 0
            assert await self._count(db, table, None) == 1
            assert await self._count(db, table, b.id) == 1

    @pytest.mark.asyncio
    async def test_delete_with_stats_removes_only_that_radios_samples(self, db):
        a, b = await self._two_radios_with_samples()
        await BatteryHistoryRepository.insert(50, 3700)  # recorded before radio tracking

        await RadioIdentityRepository.delete(a.id, delete_stats=True)

        for table in ("battery_history", "noise_floor_samples", "airtime_history"):
            assert await self._count(db, table, a.id) == 0
            assert await self._count(db, table, b.id) == 1
        assert await self._count(db, "battery_history", None) == 1
        assert await self._count(db, "noise_floor_samples", None) == 0

    @pytest.mark.asyncio
    async def test_delete_rejects_the_current_radio(self, db):
        _, b = await self._two_radios_with_samples()

        with pytest.raises(RadioIdentityConflict):
            await RadioIdentityRepository.delete(b.id, delete_stats=True)

        assert await RadioIdentityRepository.get(b.id) is not None
        assert await self._count(db, "battery_history", b.id) == 1

    @pytest.mark.asyncio
    async def test_delete_unknown_id_not_found(self, db):
        with pytest.raises(RadioIdentityNotFound):
            await RadioIdentityRepository.delete(999, delete_stats=False)

    @pytest.mark.asyncio
    async def test_delete_clears_the_link_that_pointed_at_it(self, db):
        a = await RadioIdentityRepository.register_connect(KEY_A, "Alpha", 1000)
        b = await RadioIdentityRepository.register_connect(KEY_B, "Bravo", 2000)
        await RadioIdentityRepository.link_replacement(
            b.id, a.id, carry_stats=True, carry_owned=True, carry_note=False
        )
        c = await RadioIdentityRepository.register_connect(KEY_C, "Charlie", 3000)
        await RadioIdentityRepository.link_replacement(
            c.id, b.id, carry_stats=True, carry_owned=True, carry_note=False
        )

        await RadioIdentityRepository.delete(b.id, delete_stats=False)

        old = await RadioIdentityRepository.get(a.id)
        assert old is not None
        assert old.replaced_by is None
        assert not old.carry_stats and not old.carry_owned
        assert await RadioIdentityRepository.lineage_ids(c.id, "stats") == [c.id]

    @pytest.mark.asyncio
    async def test_delete_failure_rolls_back(self, db, monkeypatch):
        a, _ = await self._two_radios_with_samples()

        async def failing(conn, identity_id, *, delete_stats):
            raise RuntimeError("boom")

        monkeypatch.setattr(radio_identities_module, "_release_samples", failing)

        with pytest.raises(RuntimeError):
            await RadioIdentityRepository.delete(a.id, delete_stats=True)

        assert await RadioIdentityRepository.get(a.id) is not None
        assert await self._count(db, "battery_history", a.id) == 1
