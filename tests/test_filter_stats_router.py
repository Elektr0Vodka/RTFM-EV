"""GET /api/filter-stats and the reads behind it."""

import json
import threading

import pytest

from app.bot_lists.format import BotEntry
from app.repository import ChannelRepository, MessageRepository
from app.repository import filter_stats as repository_module
from app.repository.filter_stats import FilterStatsRepository
from app.services.bot_lists import bot_lists

NOW = 1_800_000_000
PUBLIC = "8B3387E9C5CDEA6AC9E5EDBAA115CD72"
FAMILY = "EE" * 16


async def message(text: str, offset: int, *, sender: str = "Alice", channel: str = PUBLIC, **extra):
    message_id = await MessageRepository.create(
        msg_type="CHAN",
        text=f"{sender}: {text}",
        received_at=NOW + offset,
        conversation_key=channel,
        sender_timestamp=NOW + offset,
        sender_name=sender,
        path="27b1",
        path_len=2,
        **extra,
    )
    assert message_id is not None
    return message_id


async def seed() -> dict[str, int]:
    await ChannelRepository.upsert(key=PUBLIC, name="Public")
    await ChannelRepository.upsert(key=FAMILY, name="Family")
    ids = {
        "plain": await message("hello", 10),
        "spam": await message("buy now", 20, sender="UD6DWREK"),
        "junk": await message("x", 30, malformed=True, malformed_reason="clock"),
        "bot": await message("ping", 40, sender="PingBot", bot=True),
        "family": await message("dinner", 50, channel=FAMILY),
    }
    await MessageRepository.set_spam([ids["spam"]])
    await MessageRepository.set_spam_outcomes([(ids["spam"], "stopped", "campaign", True)])
    # Rows the statistics must leave out.
    await MessageRepository.create(
        msg_type="CHAN",
        text="me: out",
        received_at=NOW + 60,
        conversation_key=PUBLIC,
        outgoing=True,
    )
    await MessageRepository.create(
        msg_type="PRIV", text="dm", received_at=NOW + 70, conversation_key="ab" * 32
    )
    await MessageRepository.create(
        msg_type="CHAN",
        text="Alice: [image]",
        received_at=NOW + 80,
        conversation_key=PUBLIC,
        sender_name="Alice",
        txt_type=3,
    )
    state = await bot_lists.create_local("Mine")
    await bot_lists.update(state["created_id"], enabled=True)
    await bot_lists.add_entry(state["created_id"], BotEntry(name="PingBot", public_key="ab" * 32))
    await bot_lists.add_entry(state["created_id"], BotEntry(name="Excused"))
    await bot_lists.set_exceptions(["Excused"])
    return ids


class TestRepository:
    @pytest.mark.asyncio
    async def test_window_rows_are_incoming_channel_text_messages_in_the_window(self, test_db):
        ids = await seed()
        rows = await FilterStatsRepository.window_rows(NOW, NOW + 100)
        assert [row.id for row in rows] == [
            ids["plain"],
            ids["spam"],
            ids["junk"],
            ids["bot"],
            ids["family"],
        ]
        spam = rows[1]
        assert (spam.spam, spam.spam_outcome, spam.spam_block, spam.spam_enforced) == (
            True,
            "stopped",
            "campaign",
            True,
        )
        assert (spam.first_hop, spam.sender_name, spam.channel) == ("27", "UD6DWREK", PUBLIC)
        assert rows[0].spam_enforced is None
        assert (rows[2].malformed, rows[2].malformed_reason) == (True, "clock")
        assert rows[3].bot is True

        assert [r.id for r in await FilterStatsRepository.window_rows(NOW + 20, NOW + 40)] == [
            ids["spam"],
            ids["junk"],
        ]
        only = await FilterStatsRepository.window_rows(NOW, NOW + 100, FAMILY)
        assert [row.id for row in only] == [ids["family"]]

    @pytest.mark.asyncio
    async def test_bot_attribution_leaves_exceptions_and_disabled_lists_out(self, test_db):
        await seed()
        other = await bot_lists.create_local("Off")
        await bot_lists.add_entry(other["created_id"], BotEntry(name="Sleeper"))
        names, keys = await FilterStatsRepository.bot_attribution()
        assert names == {"PingBot": ["Mine"]}
        assert keys == {"ab" * 32: ["Mine"]}

    @pytest.mark.asyncio
    async def test_channel_names(self, test_db):
        await seed()
        names = await FilterStatsRepository.channel_names()
        # A fresh database also holds the channels the schema creates itself.
        assert (names[PUBLIC], names[FAMILY]) == ("Public", "Family")

    @pytest.mark.asyncio
    async def test_policy_rules_are_counted_per_action_and_rule(self, test_db):
        for offset, action, rule in (
            (1, "drop", "spam:text:1"),
            (2, "drop", "spam:text:1"),
            (3, "drop", None),
            (4, None, None),
            (500, "drop", "spam:text:1"),
        ):
            await test_db.conn.execute(
                "INSERT INTO raw_packets (timestamp, data, policy_action, policy_rule) "
                "VALUES (?, ?, ?, ?)",
                (NOW + offset, bytes([offset % 250]), action, rule),
            )
        await test_db.conn.commit()
        assert await FilterStatsRepository.policy_rules(NOW, NOW + 100) == [
            {"action": "drop", "rule": "spam:text:1", "packets": 2},
            {"action": "drop", "rule": None, "packets": 1},
        ]


class TestEndpoint:
    @pytest.mark.asyncio
    async def test_report(self, test_db, client):
        await seed()
        async with client:
            response = await client.get(
                "/api/filter-stats", params={"start_ts": NOW, "end_ts": NOW + 100, "buckets": 4}
            )
        assert response.status_code == 200
        body = response.json()
        totals = body["totals"]
        assert (totals["messages"], totals["spam"], totals["malformed"]) == (5, 1, 1)
        assert (totals["bot_now"], totals["bot_flagged"], totals["malformed_clock"]) == (1, 1, 1)
        assert len(body["series"]) == 4
        assert [sender["name"] for sender in body["senders"]] == ["Alice", "PingBot", "UD6DWREK"]
        assert {c["name"]: c["public"] for c in body["channels"]} == {
            "Public": True,
            "Family": False,
        }
        assert body["sources"][0]["hop"] == "27"
        assert (body["filters"]["stopped"], body["filters"]["enforced"]) == (1, 1)
        assert body["bot_lists_enabled"] is True
        assert body["spam_guard_enabled"] is False
        assert isinstance(body["app_version"], str) and body["app_version"]
        # A channel key is a secret for a private channel: it is in the report
        # for the channel filter, never a message text.
        assert "buy now" not in json.dumps(body)

    @pytest.mark.asyncio
    async def test_channels_marked_protected_from_spam_guard_settings(
        self, test_db, client, monkeypatch
    ):
        from app.routers import filter_stats as router_module
        from app.services.spam_guard import SpamGuardRuntime
        from app.spam.settings import SpamConfig

        runtime = SpamGuardRuntime()
        runtime.config = SpamConfig(channels=[{"key": FAMILY, "name": "Family"}])
        runtime.loaded = True
        monkeypatch.setattr(router_module, "spam_guard", runtime)
        await seed()
        async with client:
            response = await client.get(
                "/api/filter-stats", params={"start_ts": NOW, "end_ts": NOW + 100}
            )
        assert response.status_code == 200
        assert {c["name"]: c["protected"] for c in response.json()["channels"]} == {
            "Public": False,
            "Family": True,
        }

    @pytest.mark.asyncio
    async def test_channel_filter_is_case_insensitive(self, test_db, client):
        await seed()
        async with client:
            response = await client.get(
                "/api/filter-stats",
                params={"start_ts": NOW, "end_ts": NOW + 100, "channel": FAMILY.lower()},
            )
        body = response.json()
        assert body["totals"]["messages"] == 1
        assert body["window"]["channel"] == FAMILY

    @pytest.mark.asyncio
    async def test_empty_window_and_clamped_parameters(self, test_db, client):
        async with client:
            response = await client.get(
                "/api/filter-stats",
                params={"start_ts": NOW, "end_ts": NOW + 100, "buckets": 5000, "limit": 0},
            )
        assert response.status_code == 200
        body = response.json()
        assert body["totals"]["messages"] == 0
        assert len(body["series"]) == 200
        assert body["bot_lists_enabled"] is False

    @pytest.mark.asyncio
    async def test_end_must_be_after_start(self, test_db, client):
        async with client:
            response = await client.get("/api/filter-stats", params={"start_ts": 5, "end_ts": 5})
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_a_window_longer_than_the_limit_is_refused(self, test_db, client):
        # start_ts=0 would read every stored channel message into memory.
        day = 86400
        async with client:
            ok = await client.get(
                "/api/filter-stats", params={"start_ts": NOW - 92 * day, "end_ts": NOW}
            )
            too_long = await client.get(
                "/api/filter-stats", params={"start_ts": NOW - 92 * day - 1, "end_ts": NOW}
            )
            everything = await client.get(
                "/api/filter-stats", params={"start_ts": 0, "end_ts": NOW}
            )
        assert ok.status_code == 200
        assert too_long.status_code == 400
        assert everything.status_code == 400
        assert "92 days" in too_long.json()["detail"]

    @pytest.mark.asyncio
    async def test_a_rule_name_does_not_carry_a_channel_key(self, test_db, client):
        # Spam Guard names its OpenHop rules after the channel key; for a
        # private channel that key is the secret.
        await ChannelRepository.upsert(key=FAMILY, name="Family")
        await test_db.conn.execute(
            "INSERT INTO raw_packets (timestamp, data, policy_action, policy_rule) "
            "VALUES (?, ?, 'allow', ?)",
            (NOW + 1, b"\x01", f"rtfm-spam:known-people:{FAMILY}"),
        )
        await test_db.conn.commit()
        async with client:
            response = await client.get(
                "/api/filter-stats", params={"start_ts": NOW, "end_ts": NOW + 100}
            )
        rules = response.json()["policy_rules"]
        assert len(rules) == 1 and rules[0]["packets"] == 1
        assert FAMILY not in json.dumps(rules).upper()
        assert rules[0]["rule"].startswith("rtfm-spam:known-people:channel-")


class TestOffTheEventLoop:
    @pytest.mark.asyncio
    async def test_rows_are_built_off_the_event_loop_thread(self, test_db, monkeypatch):
        # Measured: building 100,000 rows takes over a second. On the event
        # loop that would hold up the radio and every WebSocket client.
        await seed()
        on_loop_thread: list[bool] = []
        real = repository_module.first_hop

        def spy(paths):
            on_loop_thread.append(threading.current_thread() is threading.main_thread())
            return real(paths)

        monkeypatch.setattr(repository_module, "first_hop", spy)
        rows = await FilterStatsRepository.window_rows(NOW, NOW + 100)
        assert len(rows) == 5
        assert on_loop_thread and not any(on_loop_thread)
