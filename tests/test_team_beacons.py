"""GET /api/messages/beacons: MeshCore TEAM beacons and waypoints for the map and contact history."""

import base64
import struct

import pytest

from app.repository import AppSettingsRepository, ContactRepository, MessageRepository
from app.routers.messages import list_team_beacons
from app.services.team_beacons import collect_team_beacons

CHAN = "8B3387E9C5CDEA6AC9E5EDBAA115CD72"
OTHER_CHAN = "11" * 16
ALICE = "aa" * 32
BOB = "bb" * 32


def _tel(lat, lon, radio=210, phone=177, fwd=1) -> str:
    raw = struct.pack(">ii", round(lat * 1e7), round(lon * 1e7)) + bytes([radio, phone, fwd])
    return "#TEL:" + base64.b64encode(raw).decode().rstrip("=")


def _topology(lat, lon, node_count=10, bitmap=bytes([0x09, 0x02])) -> str:
    raw = struct.pack(">ii", round(lat * 1e7), round(lon * 1e7)) + bytes([210, 177, node_count])
    return "#T:" + base64.b64encode(raw + bitmap).decode().rstrip("=")


async def _msg(text, received, *, msg_type="CHAN", key=CHAN, outgoing=False, sender_key=None):
    return await MessageRepository.create(
        msg_type=msg_type,
        text=text,
        conversation_key=key,
        sender_timestamp=received - 2,
        received_at=received,
        outgoing=outgoing,
        sender_key=sender_key,
    )


async def _call(since=None, until=None, latest_per_sender=True, sender_key=None):
    return await list_team_beacons(
        since=since, until=until, latest_per_sender=latest_per_sender, sender_key=sender_key
    )


@pytest.mark.asyncio
async def test_beacons_newest_first_with_decoded_fields(test_db):
    tel_id = await _msg(f"Alice: {_tel(52.0907, 5.1214, fwd=6)}", 1000, sender_key=ALICE)
    topology_id = await _msg(f"Bob: {_topology(52.2, 5.2)}", 1010)
    await _msg("Carol: just chatting", 1020)
    await _msg("Carol: #CAP:1:0b", 1030)

    result = await _call()

    assert [b.message_id for b in result.beacons] == [topology_id, tel_id]
    topology, tel = result.beacons
    assert (topology.kind, topology.node_count, topology.neighbor_count) == ("topology", 10, 3)
    assert topology.sender_name == "Bob"
    assert (tel.kind, tel.source, tel.lat, tel.lon) == ("tel", "team", 52.0907, 5.1214)
    assert (tel.radio_battery_mv, tel.phone_battery_mv) == (3998, 3800)
    assert (tel.needs_forwarding, tel.max_path_observed) == (True, 2)
    assert tel.sender_key == ALICE
    assert tel.conversation_key == CHAN
    assert result.waypoints == []
    assert result.scanned == 2
    assert result.truncated is False


@pytest.mark.asyncio
async def test_direct_messages_are_ignored(test_db):
    await _msg(_tel(52.0, 5.0), 1000, msg_type="PRIV", key=ALICE)

    assert (await _call()).beacons == []


@pytest.mark.asyncio
async def test_beacon_without_a_fix_is_skipped(test_db):
    await _msg(f"Alice: {_tel(0.0, 0.0)}", 1000)

    assert (await _call()).beacons == []


@pytest.mark.asyncio
async def test_latest_per_sender(test_db):
    await _msg(f"Alice: {_tel(52.0, 5.0)}", 1000)
    newest_alice = await _msg(f"Alice: {_tel(52.1, 5.1)}", 1010)
    bob = await _msg(f"Bob: {_tel(52.2, 5.2)}", 1005)

    latest = await _call()
    assert [b.message_id for b in latest.beacons] == [newest_alice, bob]

    everything = await _call(latest_per_sender=False)
    assert len(everything.beacons) == 3


@pytest.mark.asyncio
async def test_window_is_exclusive_below_and_inclusive_above(test_db):
    await _msg(f"A: {_tel(52.0, 5.0)}", 1000)
    inside = await _msg(f"B: {_tel(52.1, 5.1)}", 1010)
    await _msg(f"C: {_tel(52.2, 5.2)}", 1020)

    result = await _call(since=1000, until=1010)

    assert [b.message_id for b in result.beacons] == [inside]


@pytest.mark.asyncio
async def test_blocked_senders_are_skipped(test_db):
    await _msg(f"Alice: {_tel(52.0, 5.0)}", 1000, sender_key=ALICE)
    await AppSettingsRepository.toggle_blocked_key(ALICE)

    assert (await _call()).beacons == []


@pytest.mark.asyncio
async def test_sender_key_filter_returns_that_nodes_history(test_db):
    first = await _msg(f"Alice: {_tel(52.0, 5.0)}", 1000, sender_key=ALICE)
    second = await _msg(f"Alice: {_tel(52.1, 5.1)}", 1010, sender_key=ALICE)
    await _msg(f"Bob: {_tel(52.2, 5.2)}", 1020, sender_key=BOB)

    result = await _call(latest_per_sender=False, sender_key=ALICE.upper())

    assert [b.message_id for b in result.beacons] == [second, first]


@pytest.mark.asyncio
async def test_sender_key_filter_matches_by_name_when_message_has_no_key(test_db):
    await ContactRepository.upsert({"public_key": ALICE, "name": "Alice"})
    unkeyed = await _msg(f"Alice: {_tel(52.0, 5.0)}", 1000)
    await _msg(f"Alice: {_tel(52.3, 5.3)}", 1005, sender_key=BOB)
    await _msg(f"Bob: {_tel(52.2, 5.2)}", 1010)

    result = await _call(latest_per_sender=False, sender_key=ALICE)

    assert [b.message_id for b in result.beacons] == [unkeyed]


@pytest.mark.asyncio
async def test_waypoint(test_db):
    waypoint_id = await _msg(
        "Alice: #WAY:ab12|Camp|52.0907|5.1214|@C:FFF44336Base camp|CAMP|", 1000, sender_key=ALICE
    )

    result = await _call()

    assert result.beacons == []
    assert len(result.waypoints) == 1
    waypoint = result.waypoints[0]
    assert waypoint.message_id == waypoint_id
    assert (waypoint.mesh_id, waypoint.name, waypoint.waypoint_type) == ("ab12", "Camp", "CAMP")
    assert (waypoint.lat, waypoint.lon) == (52.0907, 5.1214)
    assert (waypoint.description, waypoint.color) == ("Base camp", "#f44336")
    assert waypoint.route == []
    assert waypoint.route_complete is True
    assert waypoint.sender_name == "Alice"


@pytest.mark.asyncio
async def test_resent_waypoint_keeps_the_newest(test_db):
    await _msg("Alice: #WAY:ab12|Camp|52.0|5.0||CAMP|", 1000)
    newest = await _msg("Alice: #WAY:ab12|Camp moved|52.1|5.1||CAMP|", 1010)
    other = await _msg("Alice: #WAY:cd34|Water|52.2|5.2||WATER|", 1005)

    result = await _call()

    assert [w.message_id for w in result.waypoints] == [newest, other]


@pytest.mark.asyncio
async def test_single_message_route(test_db):
    await _msg("Alice: #WAY:ab12|Trail|52.0|5.0||ROUTE|52.000000,5.000000~52.100000,5.100000", 1000)

    waypoint = (await _call()).waypoints[0]

    assert waypoint.route == [(52.0, 5.0), (52.1, 5.1)]
    assert waypoint.route_complete is True


@pytest.mark.asyncio
async def test_multi_part_route_is_reassembled(test_db):
    await _msg("Alice: #WAY:ab12|Trail|52.0|5.0||ROUTE|52.0,5.0~52.1,5.1~|1/3", 1000)
    await _msg("Alice: #WRC:ab12|52.3,5.3|3/3", 1002)
    await _msg("Alice: #WRC:ab12|52.2,5.2~|2/3", 1001)
    # Same mesh id from someone else, or in another channel, is a different route.
    await _msg("Bob: #WRC:ab12|10.0,10.0~|2/3", 1003)
    await _msg("Alice: #WRC:ab12|20.0,20.0~|2/3", 1004, key=OTHER_CHAN)

    result = await _call()

    assert len(result.waypoints) == 1
    assert result.waypoints[0].route == [(52.0, 5.0), (52.1, 5.1), (52.2, 5.2), (52.3, 5.3)]
    assert result.waypoints[0].route_complete is True


@pytest.mark.asyncio
async def test_incomplete_route_has_no_line(test_db):
    await _msg("Alice: #WAY:ab12|Trail|52.0|5.0||ROUTE|52.0,5.0~52.1,5.1~|1/3", 1000)
    await _msg("Alice: #WRC:ab12|52.3,5.3|3/3", 1002)

    waypoint = (await _call()).waypoints[0]

    assert waypoint.route == []
    assert waypoint.route_complete is False


@pytest.mark.asyncio
async def test_absurd_part_count_is_incomplete(test_db):
    await _msg("Alice: #WAY:ab12|Trail|52.0|5.0||ROUTE|52.0,5.0~|1/999999999999", 1000)

    waypoint = (await _call()).waypoints[0]

    assert waypoint.route_complete is False


@pytest.mark.asyncio
async def test_scan_limit_reports_truncation(test_db):
    for i in range(5):
        await _msg(f"S{i}: {_tel(52.0 + i / 10, 5.0)}", 1000 + i)

    result = await collect_team_beacons(
        since=None, until=None, latest_per_sender=False, scan_limit=3
    )

    assert result.scanned == 3
    assert result.truncated is True
    assert len(result.beacons) == 3


@pytest.mark.asyncio
async def test_http_route(test_db, client):
    await _msg(f"Alice: {_tel(52.0907, 5.1214)}", 1000, sender_key=ALICE)
    await _msg("Alice: #WAY:ab12|Camp|52.1|5.1||CAMP|", 1010, sender_key=ALICE)

    response = await client.get(
        f"/api/messages/beacons?since=0&latest_per_sender=false&sender_key={ALICE}"
    )

    assert response.status_code == 200
    body = response.json()
    assert [b["kind"] for b in body["beacons"]] == ["tel"]
    assert body["beacons"][0]["lat"] == 52.0907
    assert [w["name"] for w in body["waypoints"]] == ["Camp"]
