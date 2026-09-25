"""Per-route DM outcome recording and persistence (plan 28 item 1.15, display only).

Nothing here touches a radio: the send helpers are the mocked ones from
``test_dm_failed_retry`` and the outcome hooks are driven directly.
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from meshcore import EventType

import app.services.message_send as message_send_service
from app.models import SendDirectMessageRequest
from app.radio import radio_manager
from app.repository import ContactPathOutcomeRepository, ContactRepository
from app.routers.messages import send_direct_message
from app.services import dm_ack_tracker, dm_path_outcomes
from app.services.dm_ack_apply import apply_dm_ack_code
from app.services.path_scoring import score_paths

PUB_KEY = "d2" * 32


@pytest.fixture(autouse=True)
def _reset_state():
    prev = radio_manager._meshcore
    prev_lock = radio_manager._operation_lock
    saved = {
        name: getattr(dm_ack_tracker, name).copy()
        for name in ("_pending_acks", "_buffered_acks", "_failed_acks")
    }
    dm_path_outcomes._attempts.clear()
    yield
    radio_manager._meshcore = prev
    radio_manager._operation_lock = prev_lock
    for name, value in saved.items():
        store = getattr(dm_ack_tracker, name)
        store.clear()
        store.update(value)
    dm_path_outcomes._attempts.clear()


async def _insert_contact(public_key=PUB_KEY):
    await ContactRepository.upsert(
        {
            "public_key": public_key,
            "name": "Bob",
            "type": 0,
            "flags": 0,
            "direct_path": None,
            "direct_path_len": -1,
            "direct_path_hash_mode": -1,
            "last_advert": None,
            "lat": None,
            "lon": None,
            "last_seen": None,
            "on_radio": False,
            "last_contacted": None,
        }
    )


def _result(payload=None, event_type=EventType.MSG_SENT):
    result = MagicMock()
    result.type = event_type
    result.payload = payload or {}
    return result


def _mc(radio_contact):
    mc = MagicMock()
    mc.self_info = {"name": "TestNode"}
    mc.commands = MagicMock()
    mc.commands.add_contact = AsyncMock(return_value=_result())
    mc.commands.reset_path = AsyncMock(return_value=_result(event_type=EventType.OK))
    mc.get_contact_by_key_prefix = MagicMock(return_value=radio_contact)
    return mc


# ── route extraction ────────────────────────────────────────────────────


def test_route_from_radio_contact_handles_bytes_hex_and_flood():
    r = dm_path_outcomes.route_from_radio_contact({"out_path": b"\x11\x22", "out_path_len": 2})
    assert (r.path_hex, r.path_len, r.is_flood) == ("1122", 2, False)
    r = dm_path_outcomes.route_from_radio_contact({"out_path": "AB", "out_path_len": 1})
    assert (r.path_hex, r.path_len) == ("ab", 1)
    r = dm_path_outcomes.route_from_radio_contact({"out_path": "", "out_path_len": 0})
    assert (r.path_hex, r.path_len) == ("", 0)  # direct neighbour
    assert dm_path_outcomes.route_from_radio_contact({"out_path_len": -1}).is_flood
    assert dm_path_outcomes.route_from_radio_contact(None).is_flood


# ── repository ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_repository_upserts_counts_weights_and_trips(test_db):
    await _insert_contact()
    repo = ContactPathOutcomeRepository
    await repo.record_attempt(PUB_KEY, "11", 1, 100)
    await repo.record_attempt(PUB_KEY, "11", 1, 110)
    await repo.record_success(PUB_KEY, "11", 1, 111, 900)
    await repo.record_success(PUB_KEY, "11", 1, 120, 600)
    await repo.record_failure(PUB_KEY, "", -1, 130)
    rows = await repo.get_for_contact(PUB_KEY)
    assert [(r.path, r.path_len) for r in rows] == [("", -1), ("11", 1)]  # newest first
    flood, direct = rows
    assert (direct.attempt_count, direct.success_count, direct.failure_count) == (2, 2, 0)
    assert direct.route_weight == 2.0 and direct.last_trip_ms == 600 and direct.best_trip_ms == 600
    assert direct.last_success == 120 and direct.next_hop is not None
    assert (flood.attempt_count, flood.failure_count, flood.route_weight) == (1, 1, 0.5)
    # Weight floors at 0.1 and caps at 5.0.
    for _ in range(5):
        await repo.record_failure(PUB_KEY, "", -1, 131)
    for _ in range(10):
        await repo.record_success(PUB_KEY, "11", 1, 140, 500)
    rows = {r.path_len: r for r in await repo.get_for_contact(PUB_KEY)}
    assert rows[-1].route_weight == pytest.approx(0.1) and rows[1].route_weight == 5.0
    assert rows[1].best_trip_ms == 500


@pytest.mark.asyncio
async def test_repository_keeps_only_the_newest_hundred_routes(test_db):
    await _insert_contact()
    for i in range(105):
        await ContactPathOutcomeRepository.record_attempt(PUB_KEY, f"{i:02x}", 1, 1000 + i)
    rows = await ContactPathOutcomeRepository.get_for_contact(PUB_KEY)
    assert len(rows) == 100 and rows[0].path == "68" and rows[-1].path == "05"


@pytest.mark.asyncio
async def test_rows_follow_the_contact_on_delete(test_db):
    await _insert_contact()
    await ContactPathOutcomeRepository.record_attempt(PUB_KEY, "11", 1, 100)
    await ContactRepository.delete(PUB_KEY)
    assert await ContactPathOutcomeRepository.get_for_contact(PUB_KEY) == []


# ── attempt / ack / failed state machine ────────────────────────────────


@pytest.mark.asyncio
async def test_ack_credits_the_last_attempt_with_trip_time(test_db):
    await _insert_contact()
    await dm_path_outcomes.record_attempt(7, PUB_KEY, {"out_path": "aa", "out_path_len": 1}, 100.0)
    await dm_path_outcomes.record_attempt(7, PUB_KEY, {"out_path_len": -1}, 105.0)
    assert dm_path_outcomes.pending_attempts(7) == 2
    assert await dm_path_outcomes.record_ack(7, now=106.25)
    assert dm_path_outcomes.pending_attempts(7) == 0
    rows = {r.path_len: r for r in await ContactPathOutcomeRepository.get_for_contact(PUB_KEY)}
    assert rows[-1].success_count == 1 and rows[-1].last_trip_ms == 1250
    assert rows[1].success_count == 0 and rows[1].attempt_count == 1
    assert not await dm_path_outcomes.record_ack(7)  # nothing left to credit


@pytest.mark.asyncio
async def test_failed_marks_each_distinct_route_once(test_db):
    await _insert_contact()
    for started in (1.0, 2.0, 3.0):
        await dm_path_outcomes.record_attempt(
            8, PUB_KEY, {"out_path": "aa", "out_path_len": 1}, started
        )
    await dm_path_outcomes.record_attempt(8, PUB_KEY, {"out_path_len": -1}, 4.0)
    assert await dm_path_outcomes.record_failed(8)
    rows = {r.path_len: r for r in await ContactPathOutcomeRepository.get_for_contact(PUB_KEY)}
    assert rows[1].failure_count == 1 and rows[1].attempt_count == 3
    assert rows[-1].failure_count == 1 and rows[-1].attempt_count == 1
    assert rows[1].route_weight == 0.5


@pytest.mark.asyncio
async def test_recording_errors_never_raise(test_db):
    # No contact row: the FK rejects the insert, the send path must not notice.
    await dm_path_outcomes.record_attempt(9, "ee" * 32, {"out_path_len": -1})
    assert await dm_path_outcomes.record_ack(9)


# ── end to end through the DM send + ACK path ───────────────────────────


@pytest.mark.asyncio
async def test_send_and_ack_record_the_firmware_route(test_db):
    await _insert_contact()
    radio_contact = {"public_key": PUB_KEY, "out_path": b"\x11", "out_path_len": 1}
    mc = _mc(radio_contact)
    mc.commands.send_msg = AsyncMock(
        return_value=_result({"expected_ack": b"\x00\x00\x00\x09", "suggested_timeout": 5000})
    )
    broadcasts: list = []
    with (
        patch.object(message_send_service, "DM_SEND_MAX_ATTEMPTS", 1),
        patch("app.routers.messages.radio_manager.require_connected", return_value=mc),
        patch.object(radio_manager, "_meshcore", mc),
        patch(
            "app.routers.messages.broadcast_event",
            side_effect=lambda t, d, **_kw: broadcasts.append((t, d)),
        ),
    ):
        message = await send_direct_message(
            SendDirectMessageRequest(destination=PUB_KEY, text="hi")
        )
    assert dm_path_outcomes.pending_attempts(message.id) == 1
    rows = await ContactPathOutcomeRepository.get_for_contact(PUB_KEY)
    assert [(r.path, r.path_len, r.attempt_count, r.success_count) for r in rows] == [
        ("11", 1, 1, 0)
    ]

    await asyncio.sleep(0.01)
    assert await apply_dm_ack_code("00000009", broadcast_fn=lambda *_a, **_k: None)
    rows = await ContactPathOutcomeRepository.get_for_contact(PUB_KEY)
    assert rows[0].success_count == 1 and rows[0].last_trip_ms is not None
    assert rows[0].last_trip_ms >= 10
    assert dm_path_outcomes.pending_attempts(message.id) == 0
    ranked = score_paths(rows)
    assert ranked[0].score > 0.5 and ranked[0].reliability == pytest.approx(2 / 3, abs=1e-4)
