"""Spam Guard runtime: ingest hook, chat flag, persistence, settings and rule application."""

import json
import time

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
