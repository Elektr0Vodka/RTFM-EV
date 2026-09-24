"""GET /api/messages/locations: location shares for the map layer."""

import pytest

from app.repository import AppSettingsRepository, MessageRepository
from app.routers.messages import list_shared_locations
from app.services.shared_locations import collect_shared_locations

CHAN = "8B3387E9C5CDEA6AC9E5EDBAA115CD72"
ALICE = "aa" * 32
BOB = "bb" * 32


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


async def _call(since=None, until=None, latest_per_sender=True):
    return await list_shared_locations(
        since=since, until=until, latest_per_sender=latest_per_sender
    )


@pytest.mark.asyncio
async def test_finds_every_format_newest_first(test_db):
    marker_id = await _msg("Alice: m:52.090700,5.121400|Dom|poi", 1000)
    mgrs_id = await _msg("Bob: at 31U FT 45332 73249", 1010)
    decimal_id = await _msg("52.370200, 4.895200", 1020, msg_type="PRIV", key=ALICE)
    await _msg("Carol: nothing here 1.5, 2.5", 1030)

    result = await _call()

    assert [loc.message_id for loc in result.locations] == [decimal_id, mgrs_id, marker_id]
    assert [loc.format for loc in result.locations] == ["decimal", "mgrs", "marker"]
    marker = result.locations[2]
    assert (marker.lat, marker.lon, marker.label, marker.flags) == (52.0907, 5.1214, "Dom", "poi")
    assert marker.sender_name == "Alice"
    assert result.locations[1].precision_m == 1
    assert result.scanned == 4
    assert result.truncated is False


@pytest.mark.asyncio
async def test_channel_sender_prefix_is_not_parsed_as_coordinates(test_db):
    # The "Sender: " prefix is stripped before parsing, so a name cannot leak in.
    await _msg("52.123456, 5.123456: hello", 1000)
    assert (await _call()).locations == []


@pytest.mark.asyncio
async def test_latest_per_sender(test_db):
    await _msg("Alice: 52.000000, 5.000000", 1000)
    newest_alice = await _msg("Alice: 52.100000, 5.100000", 1010)
    bob = await _msg("Bob: 52.200000, 5.200000", 1005)
    dm_old = await _msg("51.000000, 4.000000", 1001, msg_type="PRIV", key=ALICE)
    dm_new = await _msg("51.100000, 4.100000", 1002, msg_type="PRIV", key=ALICE)
    mine = await _msg("Me: 50.000000, 3.000000", 1003, outgoing=True)

    latest = await _call()
    assert [loc.message_id for loc in latest.locations] == [newest_alice, bob, mine, dm_new]

    everything = await _call(latest_per_sender=False)
    assert len(everything.locations) == 6
    assert dm_old in {loc.message_id for loc in everything.locations}


@pytest.mark.asyncio
async def test_channel_sender_key_groups_across_name_changes(test_db):
    await _msg("Old name: 52.000000, 5.000000", 1000, sender_key=BOB)
    newest = await _msg("New name: 52.100000, 5.100000", 1010, sender_key=BOB)

    result = await _call()

    assert [loc.message_id for loc in result.locations] == [newest]


@pytest.mark.asyncio
async def test_window_is_exclusive_below_and_inclusive_above(test_db):
    await _msg("A: 52.000000, 5.000000", 1000)
    inside = await _msg("B: 52.100000, 5.100000", 1010)
    await _msg("C: 52.200000, 5.200000", 1020)

    result = await _call(since=1000, until=1010)

    assert [loc.message_id for loc in result.locations] == [inside]


@pytest.mark.asyncio
async def test_blocked_senders_are_skipped(test_db):
    await _msg("52.000000, 5.000000", 1000, msg_type="PRIV", key=ALICE)
    await AppSettingsRepository.toggle_blocked_key(ALICE)

    assert (await _call()).locations == []


@pytest.mark.asyncio
async def test_scan_limit_reports_truncation(test_db):
    for i in range(5):
        await _msg(f"S{i}: 52.00000{i}, 5.000000", 1000 + i)

    result = await collect_shared_locations(
        since=None, until=None, latest_per_sender=False, scan_limit=3
    )

    assert result.scanned == 3
    assert result.truncated is True
    assert len(result.locations) == 3


@pytest.mark.asyncio
async def test_http_route(test_db, client):
    await _msg("Alice: m:52.090700,5.121400|Dom|poi", 1000)
    await _msg("Alice: 52.100000, 5.100000", 1010)

    response = await client.get("/api/messages/locations?since=0&latest_per_sender=false")

    assert response.status_code == 200
    body = response.json()
    assert [loc["format"] for loc in body["locations"]] == ["decimal", "marker"]
    assert body["locations"][1]["label"] == "Dom"


@pytest.mark.asyncio
async def test_conversation_name_comes_from_channel_or_contact(test_db):
    from app.repository import ChannelRepository, ContactRepository

    await ChannelRepository.upsert(key=CHAN, name="#dmc", is_hashtag=True)
    await ContactRepository.upsert({"public_key": ALICE, "name": "Alice node"})
    await _msg("Bob: 52.100000, 5.100000", 1000)
    await _msg("52.200000, 5.200000", 1010, msg_type="PRIV", key=ALICE)

    result = await _call()

    assert [loc.conversation_name for loc in result.locations] == ["Alice node", "#dmc"]
