"""Spam Guard runtime: ingest hook, chat flag, persistence, settings and rule application."""

import json
import time
from types import SimpleNamespace

import pytest

from app.repository import AppSettingsRepository, ChannelRepository, MessageRepository
from app.repository.spam import (
    SpamEvidenceRepository,
    SpamGuardConfigRepository,
    SpamGuardStateRepository,
)
from app.routers.settings import AppSettingsUpdate, update_settings
from app.services import spam_guard as spam_guard_module
from app.services.host_repeater import HostRepeaterRuntime, _lifetime_rule_key
from app.services.messages import (
    create_fallback_channel_message,
    create_message_from_decrypted,
)
from app.services.retention_pruner import prune_once
from app.services.spam_backend_host import HostBackend
from app.services.spam_guard import SpamGuardRuntime, default_config, split_path
from app.spam.settings import SpamConfig

PUBLIC = "8B3387E9C5CDEA6AC9E5EDBAA115CD72"
OTHER = "EE" * 16
SPAM = "Amazing offer cheap radios available now at the usual place come quickly"
LONG = "Selling brand new radios at half price visit the shop on the corner today"
GENERATED = ["UD6DWREK", "QK3ZP9XV", "ZX8CV2BN"]
NOW = 1_800_000_000


class Clock:
    def __init__(self) -> None:
        self.now = float(NOW)

    def __call__(self) -> float:
        return self.now


class Feed:
    """A runtime wired into message ingest, with broadcasts captured."""

    def __init__(self, runtime: SpamGuardRuntime, clock: Clock, events: list) -> None:
        self.runtime = runtime
        self.clock = clock
        self.events = events
        self._packet = 0

    async def say(self, sender, text, *, channel=PUBLIC, path="27b1", hops=2, realtime=True):
        self.clock.now += 5
        self._packet += 1
        return await create_message_from_decrypted(
            packet_id=self._packet,
            channel_key=channel,
            sender=sender,
            message_text=text,
            timestamp=int(self.clock.now),
            received_at=int(self.clock.now),
            path=path,
            path_len=hops,
            realtime=realtime,
            packet_len=80,
            broadcast_fn=lambda event, data, **_: self.events.append((event, data)),
        )

    def of(self, event_type: str) -> list[dict]:
        return [data for name, data in self.events if name == event_type]

    async def spam_flags(self, channel=PUBLIC) -> dict[int, bool]:
        return {m.id: m.spam for m in await MessageRepository.get_all(conversation_key=channel)}


@pytest.fixture
async def feed(test_db, monkeypatch):
    clock = Clock()
    runtime = SpamGuardRuntime(clock=clock)
    runtime.host = HostBackend(HostRepeaterRuntime())
    events: list = []
    monkeypatch.setattr(spam_guard_module, "spam_guard", runtime)
    monkeypatch.setattr(
        spam_guard_module, "broadcast_event", lambda event, data, **_: events.append((event, data))
    )
    await ChannelRepository.upsert(key=PUBLIC, name="Public")
    await ChannelRepository.upsert(key=OTHER, name="#other")
    await runtime.load()
    await runtime.set_enabled(True)
    yield Feed(runtime, clock, events)
    await runtime.stop()


async def protect(feed: Feed, **overrides) -> None:
    config = SpamConfig(
        mode="protect", channels=[{"key": PUBLIC, "name": "Public"}], overrides=overrides
    )
    assert await feed.runtime.save_config(feed.runtime.version, config) is not None


def test_split_path():
    assert split_path("27b1", 2) == ["27", "B1"]
    assert split_path("27ab01cd", 2) == ["27AB", "01CD"]
    assert split_path("27ab01", 1) == ["27AB01"]
    assert split_path("27b1", None) == ["27", "B1"]
    assert split_path("27b1c2", 2) == ["27", "B1", "C2"]  # width does not divide: 1 byte hops
    assert split_path(None, None) == []
    assert split_path("", 0) == []
    assert split_path("zz", 1) == []


def test_default_config_reads_public_in_monitor_mode():
    config = default_config()
    assert config.mode == "monitor"
    assert [channel.key for channel in config.channels] == [PUBLIC]


def test_lifetime_stats_bucket_spam_rule_ids():
    assert _lifetime_rule_key("spam:text:0123456789") == "spam:text"
    assert _lifetime_rule_key("spam:hop:27:8B33") == "spam:hop"
    assert _lifetime_rule_key("my-own-rule") == "my-own-rule"


class TestIngest:
    @pytest.mark.asyncio
    async def test_campaign_is_flagged_and_earlier_copies_follow(self, feed):
        ids = [await feed.say(name, SPAM) for name in GENERATED]
        assert all(ids)
        assert await feed.spam_flags() == dict.fromkeys(ids, True)
        # The third copy confirmed the campaign: it arrives flagged ...
        assert [m["spam"] for m in feed.of("message")] == [False, False, True]
        # ... and the two already in chat are flagged after the fact.
        assert feed.of("message_spam") == [{"message_ids": ids[:2], "spam": True}]

        later = await feed.say("Dave", SPAM + " again")
        assert feed.of("message")[-1]["spam"] is True
        assert (await feed.spam_flags())[later] is True

    @pytest.mark.asyncio
    async def test_ordinary_chat_is_not_flagged(self, feed):
        ids = [await feed.say("Dave", "evening all"), await feed.say("Sarah", "evening Dave")]
        assert await feed.spam_flags() == dict.fromkeys(ids, False)
        assert feed.of("message_spam") == []

    @pytest.mark.asyncio
    async def test_only_protected_channels_are_read(self, feed):
        for name in GENERATED:
            await feed.say(name, SPAM, channel=OTHER)
        assert not any((await feed.spam_flags(OTHER)).values())
        assert not feed.runtime.detector.events

    @pytest.mark.asyncio
    async def test_historical_decryption_is_not_analysed(self, feed):
        for name in GENERATED:
            await feed.say(name, SPAM, realtime=False)
        assert not feed.runtime.detector.events

    @pytest.mark.asyncio
    async def test_switched_off(self, feed):
        await feed.runtime.set_enabled(False)
        for name in GENERATED:
            await feed.say(name, SPAM)
        assert not any((await feed.spam_flags()).values())
        assert not feed.runtime.detector.events

    @pytest.mark.asyncio
    async def test_path_reaches_the_detector_as_hops(self, feed):
        await feed.say("Dave", "evening all", path="27ab01cd", hops=2)
        assert feed.runtime.detector.events[-1].path == ("27AB", "01CD")

    @pytest.mark.asyncio
    async def test_a_detector_failure_does_not_cost_the_message(self, feed, monkeypatch):
        def boom(**_):
            raise RuntimeError("detector broke")

        monkeypatch.setattr(feed.runtime.detector, "ingest", boom)
        message_id = await feed.say("Dave", "evening all")
        assert message_id is not None
        assert feed.of("message")[-1]["spam"] is False

    @pytest.mark.asyncio
    async def test_a_caught_repeat_gets_the_duplicate_marker_not_the_spam_flag(self, feed):
        first = await feed.say("Dave", LONG)
        copy = await feed.say("Sarah", LONG)
        marks = {
            m.id: (m.spam, m.duplicate)
            for m in await MessageRepository.get_all(conversation_key=PUBLIC)
        }
        assert marks == {first: (False, False), copy: (False, True)}
        assert [(m["spam"], m["duplicate"]) for m in feed.of("message")] == [
            (False, False),
            (False, True),
        ]

    @pytest.mark.asyncio
    async def test_not_spam_takes_the_duplicate_marker_off(self, feed):
        await feed.say("Dave", LONG)
        copy = await feed.say("Sarah", LONG)
        await feed.runtime.action("not_spam", {"sender": "Sarah"}, message_id=copy)
        stored = await MessageRepository.get_by_id(copy)
        assert stored is not None and stored.duplicate is False
        assert feed.of("message_spam")[-1] == {
            "message_ids": [copy],
            "spam": False,
            "duplicate": False,
        }

    @pytest.mark.asyncio
    async def test_same_name_scope_on_the_host_lets_the_first_copy_through(self, feed):
        await protect(feed, dedupe_scope="same", enable_hop_rules=False)
        await feed.say("Dave", LONG)
        assert feed.runtime.host.status()["rules_present"] == 0
        await feed.say("Dave", LONG)
        assert feed.of("message")[-1]["duplicate"] is True
        assert feed.runtime.host.status()["rules_present"] == 1

    @pytest.mark.asyncio
    async def test_malformed_signal_flags_a_malformed_message(self, feed):
        await protect(feed, malformed_signal=True, dedupe_enabled=False, enable_hop_rules=False)
        # No ASCII letter or digit, two scripts mixed: the chat filter's gibberish rule.
        await feed.say("Dave", "привет שלום")
        assert feed.of("message")[-1]["malformed"] is True
        assert feed.of("message")[-1]["spam"] is True

    @pytest.mark.asyncio
    async def test_malformed_is_only_a_chat_flag_while_the_signal_is_off(self, feed):
        await feed.say("Dave", "привет שלום")
        assert feed.of("message")[-1]["malformed"] is True
        assert feed.of("message")[-1]["spam"] is False


class TestRules:
    @pytest.mark.asyncio
    async def test_monitor_applies_no_rules(self, feed):
        for name in GENERATED:
            await feed.say(name, SPAM)
        assert feed.runtime.detector.blocks
        assert feed.runtime.host.status()["rules_present"] == 0

    @pytest.mark.asyncio
    async def test_protect_applies_rules_and_off_clears_them(self, feed):
        await protect(feed)
        for name in GENERATED:
            await feed.say(name, SPAM)
        assert feed.runtime.host.status()["rules_present"] > 0
        await feed.runtime.set_enabled(False)
        assert feed.runtime.host.status()["rules_present"] == 0
        await feed.runtime.set_enabled(True)
        assert feed.runtime.host.status()["rules_present"] > 0

    @pytest.mark.asyncio
    async def test_the_message_that_confirms_a_block_counts_as_caught(self, feed):
        await protect(feed, dedupe_enabled=False, enable_hop_rules=False)
        for name in GENERATED:
            await feed.say(name, SPAM)
        # The host engine judges a frame after ingest, with the rule already in place.
        assert feed.runtime.detector.events[-1].matched is not None
        assert feed.runtime.detector.events[0].matched is None

    @pytest.mark.asyncio
    async def test_openhop_radio_gets_no_host_rules(self, feed, monkeypatch):
        await protect(feed, dedupe_enabled=False, enable_hop_rules=False)
        monkeypatch.setattr(feed.runtime, "backend_name", lambda: "openhop")
        for name in GENERATED:
            await feed.say(name, SPAM)
        assert feed.runtime.detector.blocks
        assert feed.runtime.host.status()["rules_present"] == 0
        # An OpenHop node forwarded this frame before any rule could reach it.
        assert feed.runtime.detector.events[-1].matched is None


class TestPersistence:
    @pytest.mark.asyncio
    async def test_real_blocks_are_saved_at_once_and_restored(self, feed):
        for name in GENERATED:
            await feed.say(name, SPAM)
        await feed.say("Dave", "evening all")
        stored = await SpamGuardStateRepository.get()
        assert stored is not None and stored["blocks"]

        again = SpamGuardRuntime(clock=feed.clock)
        again.host = HostBackend(HostRepeaterRuntime())
        await again.load()
        assert set(again.detector.blocks) == set(feed.runtime.detector.blocks)
        await again.stop()

    @pytest.mark.asyncio
    async def test_duplicate_blocks_wait_for_the_lazy_flush(self, feed):
        await protect(feed, enable_hop_rules=False)
        await feed.say("UD6DWREK", LONG)
        assert feed.runtime.detector.blocks
        stored = await SpamGuardStateRepository.get()
        assert not (stored or {}).get("blocks")
        feed.clock.now += 301
        await feed.runtime.tick()
        stored = await SpamGuardStateRepository.get()
        assert stored is not None and stored["blocks"]

    @pytest.mark.asyncio
    async def test_stop_saves_everything(self, feed):
        await feed.say("UD6DWREK", LONG)
        await feed.runtime.stop()
        stored = await SpamGuardStateRepository.get()
        assert stored is not None and stored["blocks"]

    @pytest.mark.asyncio
    async def test_invalid_stored_settings_fall_back_to_defaults(self, feed):
        await SpamGuardConfigRepository.save(feed.runtime.version, {"mode": "nonsense"})
        again = SpamGuardRuntime(clock=feed.clock)
        again.host = HostBackend(HostRepeaterRuntime())
        await again.load()
        assert again.config.mode == "monitor"
        assert again.load_error
        # The reason can quote stored values, so it is not part of the payload.
        again.enabled = True
        health = again.health()
        assert "settings_invalid" in health["warnings"]
        assert "nonsense" not in json.dumps(health)
        await again.stop()

    @pytest.mark.asyncio
    async def test_stored_ceiling_above_the_new_bound_is_brought_down(self, feed):
        stored = feed.runtime.config.model_dump(mode="json")
        stored["overrides"] = {"max_total_rules": 2000}
        stored["sensitivity"] = "strict"
        await SpamGuardConfigRepository.save(feed.runtime.version, stored)
        again = SpamGuardRuntime(clock=feed.clock)
        again.host = HostBackend(HostRepeaterRuntime())
        await again.load()
        assert again.load_error is None
        assert again.config.sensitivity == "strict"
        assert again.config.channels == feed.runtime.config.channels
        assert again.detector.tunables.max_total_rules == 500
        await again.stop()


class TestFreshStartSeed:
    @staticmethod
    async def store(sender, at, *, channel=PUBLIC, outgoing=False, spam=False):
        message_id = await MessageRepository.create(
            msg_type="CHAN",
            text=f"chat from {sender} at {at}",
            received_at=at,
            conversation_key=channel,
            sender_timestamp=at,
            outgoing=outgoing,
            sender_name=sender,
        )
        if spam:
            await MessageRepository.set_spam([message_id])

    @staticmethod
    async def fresh_runtime(monkeypatch) -> SpamGuardRuntime:
        runtime = SpamGuardRuntime(clock=Clock())
        runtime.host = HostBackend(HostRepeaterRuntime())
        monkeypatch.setattr(spam_guard_module, "broadcast_event", lambda *args, **kwargs: None)
        await runtime.load()
        return runtime

    @pytest.mark.asyncio
    async def test_first_load_learns_regulars_from_stored_messages(self, test_db, monkeypatch):
        await ChannelRepository.upsert(key=PUBLIC, name="Public")
        for offset in range(4):
            await self.store("Dave", NOW - 3600 + offset)
        await self.store("Sue", NOW - 1000, spam=True)
        await self.store("Me", NOW - 900, outgoing=True)
        await self.store("Olga", NOW - 800, channel=OTHER)
        await self.store("Piet", NOW - 2 * 86400)
        for offset in range(3):
            await self.store("UD6DWREK", NOW - 500 + offset)
        runtime = await self.fresh_runtime(monkeypatch)
        assert runtime.detector.known == {"Dave": [NOW - 3600, NOW - 3597, 4]}
        await runtime.stop()

    @pytest.mark.asyncio
    async def test_stored_state_is_not_seeded_again(self, test_db, monkeypatch):
        await ChannelRepository.upsert(key=PUBLIC, name="Public")
        await SpamGuardStateRepository.save({"version": 2})
        for offset in range(4):
            await self.store("Dave", NOW - 3600 + offset)
        runtime = await self.fresh_runtime(monkeypatch)
        assert runtime.detector.known == {}
        await runtime.stop()

    @pytest.mark.asyncio
    async def test_reset_learned_seeds_again(self, test_db, monkeypatch):
        await ChannelRepository.upsert(key=PUBLIC, name="Public")
        runtime = await self.fresh_runtime(monkeypatch)
        for offset in range(4):
            await self.store("Dave", NOW - 3600 + offset)
        await runtime.action("reset_learned", {})
        assert runtime.detector.is_known("Dave")
        await runtime.stop()


class TestSettingsAndActions:
    @pytest.mark.asyncio
    async def test_save_config_is_versioned(self, feed):
        version = feed.runtime.version
        config = SpamConfig(mode="protect", channels=[{"key": OTHER, "name": "#other"}])
        new_version = await feed.runtime.save_config(version, config)
        assert new_version == version + 1
        assert await feed.runtime.save_config(version, config) is None
        assert feed.runtime.public_state()["mode"] == "protect"
        # The protected channel list took effect.
        await feed.say("Dave", "evening all")
        assert not feed.runtime.detector.events
        await feed.say("Dave", "evening all", channel=OTHER)
        assert len(feed.runtime.detector.events) == 1

    @pytest.mark.asyncio
    async def test_action_that_changes_an_exception_list_is_stored(self, feed):
        version = feed.runtime.version
        await feed.runtime.action("allow_sender", {"sender": "Sue"})
        assert feed.runtime.config.allow_senders == ["Sue"]
        assert feed.runtime.version == version + 1
        stored = await SpamGuardConfigRepository.get()
        assert stored is not None and stored[1]["allow_senders"] == ["Sue"]

    @pytest.mark.asyncio
    async def test_action_applies_rules_and_saves(self, feed):
        await protect(feed)
        await feed.runtime.action("block_hop", {"hop": "27", "match": "contains"})
        assert feed.runtime.host.status()["rules_present"] == 1
        stored = await SpamGuardStateRepository.get()
        assert stored is not None and "hop:27" in stored["blocks"]

    @pytest.mark.asyncio
    async def test_bad_action_is_a_value_error(self, feed):
        with pytest.raises(ValueError):
            await feed.runtime.action("block_sender", {"sender": "Dave"})

    @pytest.mark.asyncio
    async def test_reset_settings_goes_back_to_a_fresh_install(self, feed):
        await protect(feed, dedupe_enabled=False)
        await feed.runtime.action("allow_sender", {"sender": "Sue"})
        await feed.runtime.action("block_hop", {"hop": "27", "match": "contains"})
        assert feed.runtime.host.status()["rules_present"] == 1
        version = feed.runtime.version
        await feed.runtime.action("reset_settings", {})
        assert feed.runtime.config == default_config()
        assert feed.runtime.version == version + 1
        stored = await SpamGuardConfigRepository.get()
        assert stored is not None
        assert (stored[1]["mode"], stored[1]["allow_senders"]) == ("monitor", [])
        assert feed.runtime.detector.exceptions()["allow_senders"] == []
        # What was learnt stays, but Monitor mode applies no rules.
        assert "hop:27" in feed.runtime.detector.blocks
        assert feed.runtime.host.status()["rules_present"] == 0
        with pytest.raises(ValueError):
            await feed.runtime.action("reset_settings", {"mode": "protect"})

    @pytest.mark.asyncio
    async def test_reset_learned_is_saved_and_takes_the_rules_away(self, feed):
        await protect(feed)
        await feed.runtime.action("block_hop", {"hop": "27", "match": "contains"})
        await feed.runtime.action("reset_learned", {})
        assert feed.runtime.host.status()["rules_present"] == 0
        stored = await SpamGuardStateRepository.get()
        assert stored is not None and stored["blocks"] == {}
        # The settings are not learnt.
        assert feed.runtime.config.mode == "protect"

    @pytest.mark.asyncio
    async def test_cleared_recent_messages_stay_off_the_page(self, feed):
        await feed.say("Dave", "evening all")
        assert len(feed.runtime.snapshot()["messages"]) == 1
        await feed.runtime.action("clear_messages", {})
        assert feed.runtime.snapshot()["messages"] == []
        assert len(feed.runtime.detector.events) == 1
        await feed.say("Dave", "still here")
        assert [m["text"] for m in feed.runtime.snapshot()["messages"]] == ["still here"]

    @pytest.mark.asyncio
    async def test_repeater_block_on_one_channel_applies_rules_for_that_channel(self, feed):
        config = SpamConfig(
            mode="protect",
            channels=[{"key": PUBLIC, "name": "Public"}, {"key": OTHER, "name": "#other"}],
        )
        assert await feed.runtime.save_config(feed.runtime.version, config) is not None
        await feed.runtime.action("block_hop", {"hop": "27"})
        assert feed.runtime.host.status()["rules_present"] == 4
        await feed.runtime.action("block_hop", {"hop": "27", "channel": OTHER})
        assert feed.runtime.host.status()["rules_present"] == 2
        assert feed.runtime.snapshot()["block_list"][0]["channel"] == OTHER

    @pytest.mark.asyncio
    async def test_set_message_spam_broadcasts_only_real_changes(self, feed):
        message_id = await feed.say("Dave", "evening all")
        await feed.runtime.set_message_spam(message_id, True)
        await feed.runtime.set_message_spam(message_id, True)
        assert feed.of("message_spam") == [{"message_ids": [message_id], "spam": True}]
        assert (await feed.spam_flags())[message_id] is True
        await feed.runtime.set_message_spam(message_id, False)
        assert (await feed.spam_flags())[message_id] is False

    @pytest.mark.asyncio
    async def test_master_switch_through_the_settings_route(self, feed):
        result = await update_settings(AppSettingsUpdate(spam_guard_enabled=False, hide_spam=True))
        assert (result.spam_guard_enabled, result.hide_spam) == (False, True)
        assert feed.runtime.enabled is False
        result = await update_settings(AppSettingsUpdate(spam_guard_enabled=True))
        assert result.spam_guard_enabled is True and result.hide_spam is True
        assert feed.runtime.enabled is True
        assert (await AppSettingsRepository.get()).spam_guard_enabled is True


class TestUnreadCountsSpamFilter:
    @pytest.mark.asyncio
    async def test_spam_messages_excluded(self, test_db):
        now = int(time.time())
        await ChannelRepository.upsert(key=OTHER, name="#other")
        await ChannelRepository.update_last_read_at(OTHER, 0)

        async def msg(text, ts, **kwargs):
            return await MessageRepository.create(
                msg_type="CHAN",
                text=text,
                received_at=ts,
                conversation_key=OTHER,
                sender_timestamp=ts,
                **kwargs,
            )

        # Oldest unread is a flagged message that also mentions us.
        first = await msg("UD6DWREK: @[Me] cheap radios", now)
        visible = await msg("Friend: hoi", now + 1)
        last = await msg("QK3ZP9XV: cheap radios", now + 2)
        mine = await msg("Me: cheap radios", now + 3, outgoing=True)
        assert await MessageRepository.set_spam([first, last, mine]) == [first, last, mine]
        assert await MessageRepository.set_spam([first]) == []

        key = f"channel-{OTHER}"
        unfiltered = await MessageRepository.get_unread_counts("Me")
        assert unfiltered["counts"][key] == 3
        assert unfiltered["mentions"].get(key) is True

        filtered = await MessageRepository.get_unread_counts("Me", hide_spam=True)
        assert filtered["counts"][key] == 1
        assert key not in filtered["mentions"]
        assert filtered["first_unread_ids"][key] == visible
        # Our own message is never hidden, flagged or not.
        assert filtered["last_message_times"][key] == now + 3


class TestRawPacketPipeline:
    """A real GroupText heard on #public over the air, through the whole ingest path."""

    RAW_PACKET_HEX = (
        "147EC900004CD89C8B1ACCE5F1E47E5765D5A0CFAEEDBB73ED34F1BCF1D06678F426CE9F599ED4093C38"
        "50C05E392A3298F52D3F70D860DE06AB2055A7DA1B777C"
    )
    PUBLIC_HASHTAG_KEY = "8B4B705B080C0D943B1C80F6B3EF6B6D"  # sha256("#public")[:16]
    HEARD_AT = 1791221050

    @pytest.mark.asyncio
    async def test_packet_reaches_the_detector_with_sender_path_and_length(self, feed):
        from unittest.mock import patch

        from app.decoder import parse_packet
        from app.packet_processor import process_raw_packet

        raw = bytes.fromhex(self.RAW_PACKET_HEX)
        feed.clock.now = float(self.HEARD_AT)  # the detector only keeps recent messages
        await ChannelRepository.upsert(key=self.PUBLIC_HASHTAG_KEY, name="#public", is_hashtag=True)
        config = SpamConfig(channels=[{"key": self.PUBLIC_HASHTAG_KEY, "name": "#public"}])
        await feed.runtime.save_config(feed.runtime.version, config)

        with patch("app.packet_processor.broadcast_event", lambda *args, **kwargs: None):
            result = await process_raw_packet(raw, timestamp=self.HEARD_AT)

        assert result is not None and result.get("decrypted") is True
        (event,) = feed.runtime.detector.events
        info = parse_packet(raw)
        assert info is not None
        assert event.sender == "Ed186-a1vtn"
        assert event.channel == self.PUBLIC_HASHTAG_KEY
        assert event.length == len(raw)
        assert len(event.path) == info.path_length
        assert "".join(event.path).lower() == info.path.hex()
        assert event.message_id == result["message_id"]


class TestEvidenceLog:
    async def rows(self) -> list[dict]:
        return await SpamEvidenceRepository.list_since(0)

    @pytest.mark.asyncio
    async def test_nothing_is_kept_while_the_log_is_off(self, feed):
        await feed.say("Dave", "evening all")
        assert await self.rows() == []

    @pytest.mark.asyncio
    async def test_every_analysed_message_is_kept_while_it_is_on(self, feed):
        await protect(feed, evidence_log=True, dedupe_enabled=False, enable_hop_rules=False)
        for name in GENERATED:
            await feed.say(name, SPAM)
        await feed.say("Dave", "not on a protected channel", channel=OTHER)
        rows = await self.rows()
        assert [row["type"] for row in rows] == ["msg", "msg", "msg"]
        assert [row["sender"] for row in rows] == GENERATED
        assert rows[0]["path"] == ["27", "B1"]
        assert rows[0]["channel_name"] == "Public"
        assert rows[0]["length"] == 80
        # The copy that confirmed the campaign was caught by its own block.
        assert [bool(row["matched"]) for row in rows] == [False, False, True]
        assert PUBLIC.lower() not in str(rows).lower()

    @pytest.mark.asyncio
    async def test_the_users_verdicts_are_kept_as_labels(self, feed):
        await protect(feed, evidence_log=True, dedupe_enabled=False, enable_hop_rules=False)
        spam = await feed.say("UD6DWREK", SPAM)
        fine = await feed.say("Dave", "evening all")
        await feed.runtime.action("mark_spam", {"text": SPAM, "channel": PUBLIC}, message_id=spam)
        await feed.runtime.action("not_spam", {"sender": "Dave"}, message_id=fine)
        labels = [row for row in await self.rows() if row["type"] == "label"]
        assert [(row["label"], row["message_id"], row["sender"]) for row in labels] == [
            ("spam", spam, "UD6DWREK"),
            ("genuine", fine, "Dave"),
        ]
        assert labels[0]["text"] == SPAM

    @pytest.mark.asyncio
    async def test_a_verdict_without_a_message_is_not_a_label(self, feed):
        await protect(feed, evidence_log=True)
        await feed.runtime.action("not_spam", {"sender": "Dave"})
        assert await self.rows() == []

    @pytest.mark.asyncio
    async def test_old_evidence_is_pruned_after_evidence_days(self, feed):
        await protect(feed, evidence_log=True, evidence_days=3)
        now = feed.clock.now
        for age_days in (5, 2):
            await SpamEvidenceRepository.add(
                {"type": "msg", "ts": now - age_days * 86400, "sender": "x", "text": "y"}
            )
        result = await prune_once(now=int(now))
        assert result["spam_evidence"] == 1
        assert len(await self.rows()) == 1

    @pytest.mark.asyncio
    async def test_evidence_is_read_back_in_pages(self, feed):
        for index in range(7):
            await SpamEvidenceRepository.add(
                {"type": "msg", "ts": 1000.0 + index, "sender": f"s{index}", "text": "t"}
            )
        seen = [row["sender"] async for row in SpamEvidenceRepository.iter_since(1002, batch=3)]
        assert seen == ["s2", "s3", "s4", "s5", "s6"]
        assert await SpamEvidenceRepository.count() == 7


class TestFallbackMessages:
    """Channel messages the radio hands over without a raw packet (CHANNEL_MSG_RECV)."""

    async def pulled(self, feed, sender, text, *, channel=PUBLIC):
        feed.clock.now += 5
        return await create_fallback_channel_message(
            conversation_key=channel,
            message_text=text,
            sender_timestamp=int(feed.clock.now),
            received_at=int(feed.clock.now),
            path=None,
            path_len=2,
            txt_type=0,
            sender_name=sender,
            channel_name="Public",
            broadcast_fn=lambda event, data, **_: feed.events.append((event, data)),
        )

    @pytest.mark.asyncio
    async def test_they_are_analysed_like_any_other_channel_message(self, feed):
        await protect(feed, dedupe_enabled=False, enable_hop_rules=False, evidence_log=True)
        messages = [await self.pulled(feed, name, SPAM) for name in GENERATED]
        assert all(message is not None for message in messages)
        assert [b for b in feed.runtime.detector.blocks.values() if b.source == "campaign"]
        assert await feed.spam_flags() == {message.id: True for message in messages}
        # No hop hashes come with such a message: it counts as heard directly.
        assert feed.runtime.detector.events[-1].first_hop == "DIRECT"
        assert len(await SpamEvidenceRepository.list_since(0)) == 3

    @pytest.mark.asyncio
    async def test_a_copy_of_blocked_spam_arrives_flagged(self, feed):
        await protect(feed, dedupe_enabled=False, enable_hop_rules=False)
        for name in GENERATED:
            await feed.say(name, SPAM)
        late = await self.pulled(feed, "Dave", SPAM + " again")
        assert late is not None and late.spam is True
        assert feed.of("message")[-1]["spam"] is True

    @pytest.mark.asyncio
    async def test_it_is_never_counted_as_caught_by_the_block_it_confirms(self, feed):
        # The host engine judges raw frames; this message never was one.
        await protect(feed, dedupe_enabled=False, enable_hop_rules=False)
        for name in GENERATED:
            await self.pulled(feed, name, SPAM)
        assert [event.matched for event in feed.runtime.detector.events] == [None, None, None]

    @pytest.mark.asyncio
    async def test_other_channels_and_a_switched_off_guard_are_left_alone(self, feed):
        other = await self.pulled(feed, "UD6DWREK", SPAM, channel=OTHER)
        assert other is not None and other.spam is False
        assert not feed.runtime.detector.events
        await feed.runtime.set_enabled(False)
        await self.pulled(feed, "UD6DWREK", SPAM)
        assert not feed.runtime.detector.events


class TestBotForward:
    """Names the bot lists hand over: rules on the backend, and the status shown."""

    def managed(self, feed: Feed) -> list[str]:
        engine = feed.runtime.host._runtime.engine
        return [rule.name for rule in (*engine._managed_before, *engine._managed_after)]

    async def test_names_become_a_rule_in_protect(self, feed):
        await protect(feed)
        feed.runtime.set_bot_senders(["[NU]", "PingBot"])
        assert self.managed(feed) == [f"spam:bots:{PUBLIC} (bot list)"]
        feed.runtime.set_bot_senders([])
        assert self.managed(feed) == []

    async def test_names_set_in_monitor_wait_for_protect(self, feed):
        feed.runtime.set_bot_senders(["[NU]"])
        assert self.managed(feed) == []
        await protect(feed)
        assert self.managed(feed) == [f"spam:bots:{PUBLIC} (bot list)"]

    async def test_the_same_names_again_change_nothing(self, feed):
        await protect(feed)
        feed.runtime.set_bot_senders(["[NU]"])
        before = len(feed.of("spam_guard"))
        feed.runtime.set_bot_senders(["[NU]"])
        assert len(feed.of("spam_guard")) == before

    async def test_status_names_the_reason_it_is_waiting(self, feed, monkeypatch):
        runtime = feed.runtime
        runtime.set_bot_senders(["[NU]", "PingBot"])
        assert runtime.bot_forward() == {"state": "monitor", "channels": 0, "names": 2}

        await protect(feed)
        # The host repeater of a test is never armed.
        assert runtime.bot_forward() == {"state": "not_armed", "channels": 0, "names": 2}

        monkeypatch.setattr(type(spam_guard_module.host_repeater), "state", "armed")
        assert runtime.bot_forward() == {"state": "active", "channels": 1, "names": 2}

        paused = SpamConfig(mode="protect", paused=True, channels=[{"key": PUBLIC, "name": "P"}])
        assert await runtime.save_config(runtime.version, paused) is not None
        assert runtime.bot_forward()["state"] == "paused"

        empty = SpamConfig(mode="protect", channels=[])
        assert await runtime.save_config(runtime.version, empty) is not None
        assert runtime.bot_forward() == {"state": "no_channels", "channels": 0, "names": 2}

        await runtime.set_enabled(False)
        assert runtime.bot_forward()["state"] == "off"

    async def test_status_is_in_the_snapshot(self, feed):
        assert feed.runtime.snapshot()["bot_forward"] == {
            "state": "monitor",
            "channels": 0,
            "names": 0,
        }

    async def test_openhop_waits_for_the_sync(self, feed, monkeypatch):
        runtime = feed.runtime
        await protect(feed)
        runtime.set_bot_senders(["[NU]"])
        monkeypatch.setattr(runtime, "backend_name", lambda: "openhop")
        sync = dict(runtime.openhop.status())
        monkeypatch.setattr(runtime.openhop, "status", lambda: {**sync, "state": "pending"})
        assert runtime.bot_forward()["state"] == "not_synced"
        monkeypatch.setattr(runtime.openhop, "status", lambda: {**sync, "state": "synced"})
        assert runtime.bot_forward() == {"state": "active", "channels": 1, "names": 1}

    async def test_names_reach_the_openhop_rule_set(self, feed):
        await protect(feed)
        feed.runtime.set_bot_senders(["[NU]"])
        rules = feed.runtime.openhop_rules()
        assert rules.bot_senders == ["[NU]"]
        assert [r["name"] for r in rules.before] == [f"rtfm-spam:bots:{PUBLIC} (bot list)"]

    async def test_without_names_it_is_not_active(self, feed, monkeypatch):
        await protect(feed)
        monkeypatch.setattr(type(spam_guard_module.host_repeater), "state", "armed")
        assert feed.runtime.bot_forward() == {"state": "no_names", "channels": 0, "names": 0}
        feed.runtime.set_bot_senders(["[NU]"])
        assert feed.runtime.bot_forward()["state"] == "active"

    async def test_failed_rules_are_not_reported_as_active(self, feed, monkeypatch):
        await protect(feed)
        monkeypatch.setattr(type(spam_guard_module.host_repeater), "state", "armed")
        feed.runtime.set_bot_senders(["[NU]"])
        assert feed.runtime.bot_forward()["state"] == "active"
        feed.runtime.last_error = "the engine refused the rules"
        assert feed.runtime.bot_forward() == {"state": "rules_failed", "channels": 0, "names": 1}

    async def test_openhop_says_when_the_channel_key_is_not_shared(self, feed, monkeypatch):
        runtime = feed.runtime
        private = SpamConfig(mode="protect", channels=[{"key": OTHER, "name": "Club"}])
        assert await runtime.save_config(runtime.version, private) is not None
        runtime.set_bot_senders(["[NU]"])
        monkeypatch.setattr(runtime, "backend_name", lambda: "openhop")
        sync = dict(runtime.openhop.status())
        monkeypatch.setattr(runtime.openhop, "status", lambda: {**sync, "state": "synced"})
        assert runtime.bot_forward() == {"state": "key_not_shared", "channels": 0, "names": 1}


async def stored_outcome(test_db, message_id: int) -> tuple:
    cursor = await test_db.conn.execute(
        "SELECT spam_outcome, spam_block, spam_enforced, spam_label FROM messages WHERE id = ?",
        (message_id,),
    )
    return tuple(await cursor.fetchone())


async def campaign(feed: Feed) -> list[int]:
    ids = [await feed.say(name, SPAM) for name in GENERATED]
    ids.append(await feed.say("Dave", SPAM + " again"))
    return ids


async def let_settle(feed: Feed) -> None:
    feed.clock.now += 130
    await feed.runtime.tick()


class TestStoredOutcomes:
    @pytest.mark.asyncio
    async def test_outcome_is_written_when_a_message_settles(self, feed, test_db):
        message_id = await feed.say("Dave", "evening all")
        assert await stored_outcome(test_db, message_id) == (None, None, None, None)
        await let_settle(feed)
        assert await stored_outcome(test_db, message_id) == ("clean", None, 0, None)

    @pytest.mark.asyncio
    async def test_outcomes_match_the_overview_numbers(self, feed, test_db):
        ids = await campaign(feed)
        await let_settle(feed)
        rows = [await stored_outcome(test_db, message_id) for message_id in ids]
        outcomes = [row[0] for row in rows]
        day = feed.runtime.detector.metrics()["d1"]
        assert None not in outcomes
        assert outcomes.count("stopped") == day["stopped"]
        assert outcomes.count("let_through") == day["let_through"]
        # The last one arrived flagged, caught by a block that still exists.
        assert rows[-1][0] == "stopped" and rows[-1][1] is not None
        # Monitor mode: nothing was really withheld.
        assert {row[2] for row in rows} == {0}

    @pytest.mark.asyncio
    async def test_enforced_only_while_protect_really_withholds(self, feed, test_db, monkeypatch):
        await protect(feed)
        assert feed.runtime.backend_name() == "host"
        monkeypatch.setattr(
            spam_guard_module, "host_repeater", SimpleNamespace(armed=True, state="armed")
        )
        ids = await campaign(feed)
        await let_settle(feed)
        assert (await stored_outcome(test_db, ids[-1]))[2] == 1

    @pytest.mark.asyncio
    async def test_protect_without_an_armed_host_is_not_enforced(self, feed, test_db):
        await protect(feed)
        ids = await campaign(feed)
        await let_settle(feed)
        assert (await stored_outcome(test_db, ids[-1]))[2] == 0

    @pytest.mark.asyncio
    async def test_a_failing_outcome_write_costs_nothing_else(self, feed, test_db, monkeypatch):
        async def broken(_outcomes) -> None:
            raise RuntimeError("database is locked")

        monkeypatch.setattr(MessageRepository, "set_spam_outcomes", broken)
        ids = await campaign(feed)
        await let_settle(feed)
        # The chat flags were still written, and the next message is still judged.
        assert (await feed.spam_flags())[ids[-1]] is True
        later = await feed.say("Erin", SPAM + " once more")
        assert (await feed.spam_flags())[later] is True

    @pytest.mark.asyncio
    async def test_the_users_answer_is_stored_as_a_label(self, feed, test_db):
        message_id = await feed.say("Dave", "evening all")
        await feed.runtime.set_message_spam(message_id, True)
        assert (await stored_outcome(test_db, message_id))[3] == "spam"
        await feed.runtime.set_message_spam(message_id, False)
        assert (await stored_outcome(test_db, message_id))[3] == "genuine"

    @pytest.mark.asyncio
    async def test_a_failing_label_write_does_not_cost_the_chat_flag(
        self, feed, test_db, monkeypatch
    ):
        async def broken(_message_id, _label) -> None:
            raise RuntimeError("database is locked")

        monkeypatch.setattr(MessageRepository, "set_spam_label", broken)
        message_id = await feed.say("Dave", "evening all")
        await feed.runtime.set_message_spam(message_id, True)
        assert (await feed.spam_flags())[message_id] is True
        assert feed.of("message_spam")[-1] == {"message_ids": [message_id], "spam": True}
