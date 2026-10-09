"""Spam Guard detector scenarios, driven by an injected clock."""

import json
import pathlib
import time

import pytest

from app.spam.detector import SpamDetector
from app.spam.settings import SpamConfig

PUBLIC = "8B3387E9C5CDEA6AC9E5EDBAA115CD72"
LONG = "Selling brand new radios at half price visit the shop on the corner today"
SPAM = "Amazing offer cheap radios available now at the usual place come quickly"
GENERATED = ["UD6DWREK", "QK3ZP9XV", "ZX8CV2BN"]


class Clock:
    def __init__(self, start: float = 1_800_000_000.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def tick(self, seconds: float) -> None:
        self.now += seconds


def make(**config):
    clock = Clock()
    config.setdefault("channels", [{"key": PUBLIC, "name": "Public"}])
    return SpamDetector(SpamConfig(**config), clock=clock), clock


def say(det, clock, sender, text, path=("27", "B1"), message_id=None, step=5.0):
    clock.tick(step)
    return det.ingest(
        ts=clock.now,
        path=path,
        sender=sender,
        text=text,
        channel=PUBLIC,
        length=60,
        message_id=message_id,
    )


def settle(det, clock):
    """Let events age past the settling delay, then decide."""
    clock.tick(130)
    return det.decide()


class TestIngest:
    def test_event_facts(self):
        det, clock = make()
        e = say(det, clock, "UD6DWREK", "hello", path=("27", "b1"))
        assert e.first_hop == "27"
        assert e.path == ("27", "B1")
        assert e.random is True
        assert e.matched is None

    def test_direct_message_has_direct_first_hop(self):
        det, clock = make()
        assert say(det, clock, "Dave", "hello", path=()).first_hop == "DIRECT"

    def test_trusted_name_is_never_random(self):
        det, clock = make(allow_senders=["UD6DWREK"])
        assert say(det, clock, "UD6DWREK", "hello").random is False

    def test_disguised_text_makes_the_sender_random(self):
        det, clock = make()
        assert say(det, clock, "Dave", "pаypal offer").random is True

    def test_allowed_text_is_exempt(self):
        det, clock = make(allow_texts=["net check-in"])
        assert say(det, clock, "Dave", "Weekly NET CHECK-IN from Dave").exempt is True

    def test_trusted_name_from_a_new_place_is_noted(self):
        det, clock = make(allow_senders=["Sue"])
        say(det, clock, "Sue", "hello", path=("44",))
        say(det, clock, "Sue", "hello again", path=("44", "B1"))
        assert not [a for a in det.activity if a["event"] == "trusted_new_place"]
        say(det, clock, "Sue", "and again", path=("99",))
        assert [a for a in det.activity if a["event"] == "trusted_new_place"]


class TestDuplicateSuppression:
    def test_first_copy_passes_second_from_other_name_is_caught(self):
        det, clock = make()
        first = say(det, clock, "Dave", LONG)
        assert det.decide().changed
        assert first.matched is None
        copy = say(det, clock, "Sarah", LONG)
        assert copy.matched is not None
        assert det.blocks[copy.matched].source == "dedupe"

    def test_original_sender_may_resend(self):
        det, clock = make()
        say(det, clock, "Dave", LONG)
        det.decide()
        assert say(det, clock, "Dave", LONG).matched is None

    def test_short_messages_are_never_deduplicated(self):
        det, clock = make()
        say(det, clock, "Dave", "Morning all")
        det.decide()
        assert say(det, clock, "Sarah", "Morning all").matched is None
        assert not det.blocks

    def test_duplicate_block_expires(self):
        det, clock = make()
        say(det, clock, "Dave", LONG)
        det.decide()
        clock.tick(901)
        assert det.decide().changed
        assert not det.blocks
        assert say(det, clock, "Sarah", LONG).matched is None

    def test_duplicate_blocks_are_not_worth_an_immediate_save(self):
        det, clock = make(overrides={"enable_hop_rules": False})
        # A made-up name, so settling does not also add a newly known person.
        say(det, clock, "UD6DWREK", LONG)
        result = det.decide()
        assert (result.changed, result.important) == (True, False)
        clock.tick(901)
        result = det.decide()
        assert (result.changed, result.important) == (True, False)
        det.action("block_hop", hop="27")
        assert det.decide().important is True
        assert det.decide().important is False

    def test_duplicate_is_not_flagged_as_spam(self):
        det, clock = make()
        say(det, clock, "Dave", LONG, message_id=1)
        det.decide()
        say(det, clock, "Sarah", LONG, message_id=2)
        assert det.decide().flag == set()

    def test_disabled(self):
        det, clock = make(overrides={"dedupe_enabled": False})
        say(det, clock, "Dave", LONG)
        det.decide()
        assert not det.blocks


class TestCampaigns:
    def test_three_generated_names_same_text_blocks_it(self):
        det, clock = make(overrides={"dedupe_enabled": False})
        for i, name in enumerate(GENERATED):
            say(det, clock, name, f"{SPAM} {i}", message_id=100 + i)
        result = det.decide()
        assert result.changed
        assert [b for b in det.blocks.values() if b.source == "campaign"]
        assert result.flag == {100, 101, 102}
        assert say(det, clock, "Dave", SPAM + " again", message_id=103).matched is not None
        assert det.decide().flag == {103}

    def test_each_message_is_flagged_once(self):
        det, clock = make(overrides={"dedupe_enabled": False})
        for i, name in enumerate(GENERATED):
            say(det, clock, name, SPAM, message_id=100 + i)
        assert det.decide().flag == {100, 101, 102}
        assert det.decide().flag == set()

    def test_regulars_saying_the_same_thing_is_not_a_campaign(self):
        det, clock = make(overrides={"dedupe_enabled": False})
        for name in ["Dave", "Sarah", "Richard"]:
            for _ in range(3):
                say(det, clock, name, "just checking in on the repeater")
        for name in ["Dave", "Sarah", "Richard"]:
            say(det, clock, name, "Good evening everyone hope you are all well tonight")
        det.decide()
        assert not det.blocks

    def test_two_names_do_not_reach_the_balanced_threshold(self):
        det, clock = make(overrides={"dedupe_enabled": False})
        say(det, clock, "UD6DWREK", SPAM)
        say(det, clock, "QK3ZP9XV", SPAM)
        det.decide()
        assert not det.blocks

    def test_strong_campaign_text_is_remembered_for_days(self):
        det, clock = make(overrides={"dedupe_enabled": False})
        for name in GENERATED:
            say(det, clock, name, SPAM)
        det.decide()
        block = next(b for b in det.blocks.values() if b.source == "campaign")
        assert block.expires - clock.now > 6 * 86400

    def test_reworded_copies_are_blocked_by_shared_words(self):
        det, clock = make(overrides={"dedupe_enabled": False, "enable_hop_rules": False})
        say(
            det, clock, "UD6DWREK", "Amazing \U0001f525 bargain radios \U0001f4b0 available tonight"
        )
        say(
            det, clock, "QK3ZP9XV", "Amazing bargain \U0001f680 radios available \U0001f525 tonight"
        )
        say(
            det, clock, "ZX8CV2BN", "Amazing bargain radios \U0001f4a5 available tonight \U0001f525"
        )
        det.decide()
        assert [b for b in det.blocks.values() if b.kind == "words"]
        caught = say(
            det, clock, "Dave", "Amazing \U0001f44d bargain \U0001f44d radios available tonight"
        )
        assert caught.matched is not None

    def test_mention_replies_are_not_grouped(self):
        det, clock = make(overrides={"dedupe_enabled": False, "enable_hop_rules": False})
        for name in ["Alpha1x9", "Bravo2y8", "Charl3z7"]:
            say(det, clock, name, "@[Rob-M0YNW] yes")
        det.decide()
        assert not det.blocks

    def test_exempt_text_never_forms_a_campaign(self):
        det, clock = make(
            allow_texts=["cheap radios"],
            overrides={"dedupe_enabled": False, "enable_hop_rules": False},
        )
        for name in GENERATED:
            say(det, clock, name, SPAM)
        det.decide()
        assert not det.blocks

    def test_text_block_is_per_channel(self):
        det, clock = make(overrides={"dedupe_enabled": False, "enable_hop_rules": False})
        for name in GENERATED:
            say(det, clock, name, SPAM)
        det.decide()
        clock.tick(5)
        other = det.ingest(ts=clock.now, path=("27",), sender="Dave", text=SPAM, channel="AA" * 16)
        assert other.matched is None


class TestKnownPeople:
    def test_genuine_sender_becomes_known_after_settling(self):
        det, clock = make()
        say(det, clock, "Dave", "evening all")
        det.decide()
        assert not det.is_known("Dave")
        assert settle(det, clock).changed
        assert det.is_known("Dave")
        assert det.known_names() == ["Dave"]

    def test_generated_name_never_becomes_known(self):
        det, clock = make()
        say(det, clock, "UD6DWREK", "evening all")
        settle(det, clock)
        assert not det.is_known("UD6DWREK")

    def test_trusted_is_always_known(self):
        det, _ = make(allow_senders=["Sue"])
        assert det.is_known("Sue")
        assert det.known_names() == ["Sue"]

    def test_needs_the_configured_number_of_messages(self):
        det, clock = make(overrides={"known_min_msgs": 2})
        say(det, clock, "Dave", "evening all")
        settle(det, clock)
        assert not det.is_known("Dave")
        say(det, clock, "Dave", "still here")
        settle(det, clock)
        assert det.is_known("Dave")

    def test_forgotten_after_known_days(self):
        det, clock = make()
        say(det, clock, "Dave", "evening all")
        settle(det, clock)
        clock.tick(31 * 86400)
        det.decide()
        assert not det.is_known("Dave")


class TestRepeaterBlocks:
    def flood(self, det, clock, hop="27"):
        for name in GENERATED:
            say(det, clock, name, f"unique text number {name} for this one", path=(hop, "B1"))
        return det.decide()

    def test_three_generated_names_block_the_first_hop(self):
        det, clock = make()
        self.flood(det, clock)
        assert "hop:27" in det.blocks
        assert det.blocks["hop:27"].expires - clock.now == 7200
        assert det.blocks["hop:27"].reason == "hop_random"

    def test_known_people_pass_a_default_repeater_block(self):
        det, clock = make()
        say(det, clock, "Dave", "evening all", path=("44",))
        settle(det, clock)
        self.flood(det, clock)
        assert say(det, clock, "Dave", "still here", path=("27", "B1")).matched is None
        held = say(det, clock, "Newcomer", "hello from a new person", path=("27", "B1"))
        assert held.matched == "hop:27"
        assert det.held[-1]["sender"] == "Newcomer"

    def test_generated_name_caught_by_a_repeater_block_is_flagged(self):
        det, clock = make()
        self.flood(det, clock)
        say(det, clock, "PL4MN8QR", "something else entirely", message_id=7)
        say(det, clock, "Newcomer", "hello from a new person", message_id=8)
        assert det.decide().flag == {7}

    def test_passing_through_a_blocked_repeater_still_counts_towards_known(self):
        det, clock = make()
        self.flood(det, clock)
        say(det, clock, "Newcomer", "hello from a new person", path=("44", "27"))
        settle(det, clock)
        assert det.is_known("Newcomer")

    def test_starting_at_a_blocked_repeater_never_counts_towards_known(self):
        det, clock = make()
        self.flood(det, clock)
        say(det, clock, "Newcomer", "hello from a new person", path=("27", "44"))
        settle(det, clock)
        assert not det.is_known("Newcomer")

    def test_never_block_repeater(self):
        det, clock = make(allow_hops=["27"])
        self.flood(det, clock)
        assert "hop:27" not in det.blocks

    def test_direct_traffic_is_never_a_repeater_block(self):
        det, clock = make()
        for name in GENERATED:
            say(det, clock, name, f"unique text {name} here", path=())
        det.decide()
        assert not [b for b in det.blocks.values() if b.kind == "hop"]

    def test_brand_new_names_block_a_repeater(self):
        det, clock = make()
        for name in ["Anna", "Bert", "Cees", "Dirk", "Emma", "Fred"]:
            say(det, clock, name, f"hi this is {name}", path=("31",))
        det.decide()
        assert det.blocks["hop:31"].reason == "hop_new"

    def test_starts_at_mode_only_matches_first_hop(self):
        det, clock = make(overrides={"hop_match_mode": "starts_at"})
        self.flood(det, clock)
        assert (
            say(det, clock, "Newcomer", "passing through only", path=("99", "27")).matched is None
        )
        assert say(det, clock, "Other", "starting there", path=("27", "99")).matched == "hop:27"

    def test_exact_paths_mode_learns_routes(self):
        det, clock = make(overrides={"hop_match_mode": "exact_paths"})
        self.flood(det, clock)
        assert det.blocks["hop:27"].paths == ["27>B1"]
        assert say(det, clock, "Other", "same route", path=("27", "B1")).matched == "hop:27"
        assert say(det, clock, "Other", "new route", path=("27", "C2")).matched is None

    def test_disabled(self):
        det, clock = make(overrides={"enable_hop_rules": False})
        self.flood(det, clock)
        assert "hop:27" not in det.blocks


class TestLinksAndLockdown:
    def test_links_held_during_a_campaign(self):
        det, clock = make(overrides={"dedupe_enabled": False, "enable_hop_rules": False})
        for name in GENERATED:
            say(det, clock, name, SPAM)
        det.decide()
        assert "links:new" in det.blocks
        assert say(det, clock, "Stranger", "look at http://example.org").matched == "links:new"
        assert say(det, clock, "Stranger", "no link here").matched is None

    def test_links_not_held_without_a_campaign(self):
        det, clock = make()
        say(det, clock, "Dave", "evening all")
        det.decide()
        assert "links:new" not in det.blocks

    def test_links_always(self):
        det, _ = make(overrides={"hold_links": "always"})
        det.decide()
        assert "links:new" in det.blocks

    def test_links_setting_change_restarts_the_block(self):
        det, _ = make(overrides={"hold_links": "always"})
        det.decide()
        det.configure(SpamConfig(overrides={"hold_links": "off"}))
        det.decide()
        assert "links:new" not in det.blocks

    def test_lockdown_holds_strangers_and_ends(self):
        det, clock = make()
        say(det, clock, "Dave", "evening all")
        settle(det, clock)
        det.action("lockdown", minutes=30)
        assert say(det, clock, "Stranger", "hello").matched == "lockdown"
        assert say(det, clock, "Dave", "hello again").matched is None
        clock.tick(31 * 60)
        det.decide()
        assert "lockdown" not in det.blocks

    def test_lockdown_limits(self):
        det, _ = make()
        with pytest.raises(ValueError):
            det.action("lockdown", minutes=24 * 60 + 1)
        det.action("lockdown", minutes=30)
        det.action("lockdown", minutes=0)
        assert "lockdown" not in det.blocks


class TestRotation:
    quiet = {"enable_hop_rules": False, "dedupe_enabled": False}

    def spam_via(self, det, clock, hops=("A1", "A2", "A3")):
        for hop, name in zip(hops, GENERATED, strict=False):
            say(det, clock, name, f"text {name} unique here", path=(hop, "B1", "7E"))
        return det.decide()

    def test_unknown_first_hops_on_one_route_trigger_a_suffix_block(self):
        det, clock = make(overrides=self.quiet)
        self.spam_via(det, clock)
        assert "suffix:B1>7E" in det.blocks
        caught = say(det, clock, "PL4MN8QR", "another one", path=("A4", "B1", "7E"))
        assert caught.matched == "suffix:B1>7E"
        assert say(det, clock, "PL4MN8QR", "other length", path=("A4", "B1")).matched is None

    def test_known_origin_on_that_route_is_let_through(self):
        det, clock = make(overrides=self.quiet)
        for _ in range(2):
            say(det, clock, "Dave", "regular chat from home", path=("C9", "B1", "7E"))
        settle(det, clock)
        self.spam_via(det, clock)
        block = det.blocks["suffix:B1>7E"]
        assert "C9" in det.allowed_origins(block)
        assert say(det, clock, "Newbie", "hi", path=("C9", "B1", "7E")).matched is None

    def test_ordinary_traffic_from_new_repeaters_does_not_trigger(self):
        det, clock = make(overrides=self.quiet)
        for hop, name in [("A1", "Dave"), ("A2", "Sarah"), ("A3", "Richard")]:
            say(det, clock, name, f"hello from {name}", path=(hop, "B1", "7E"))
        det.decide()
        assert not det.blocks

    def test_trusted_sender_opens_their_repeater(self):
        det, clock = make(allow_senders=["Sue"], overrides=self.quiet)
        self.spam_via(det, clock)
        say(det, clock, "Sue", "it is really me", path=("D4", "B1", "7E"))
        det.decide()
        assert "D4" in det.blocks["suffix:B1>7E"].user_allowed

    def test_disabled(self):
        det, clock = make(overrides={**self.quiet, "enable_rotation_guard": False})
        self.spam_via(det, clock)
        assert not det.blocks


class TestActions:
    def test_unblock_suppresses_recreation(self):
        det, clock = make()
        say(det, clock, "Dave", LONG)
        det.decide()
        key = next(iter(det.blocks))
        det.action("unblock", key=key)
        assert key not in det.blocks
        say(det, clock, "Dave", LONG)
        det.decide()
        assert key not in det.blocks
        clock.tick(86401)
        say(det, clock, "Dave", LONG)
        det.decide()
        assert key in det.blocks

    def test_mark_spam_creates_a_manual_text_block(self):
        det, clock = make(overrides={"dedupe_enabled": False})
        det.action("mark_spam", text=LONG, channel=PUBLIC)
        block = next(iter(det.blocks.values()))
        assert block.source == "manual" and block.kind == "text"
        caught = say(det, clock, "Anyone", LONG, message_id=5)
        assert caught.matched == block.key
        assert det.decide().flag == {5}

    def test_block_text_needs_five_characters(self):
        det, _ = make()
        with pytest.raises(ValueError):
            det.action("block_text", text="abc", channel=PUBLIC)

    def test_not_spam_trusts_sender_and_removes_text_block(self):
        det, clock = make()
        say(det, clock, "Dave", LONG)
        det.decide()
        caught = say(det, clock, "Sarah", LONG)
        det.action("not_spam", sender="Sarah", matched=caught.matched)
        assert det.is_known("Sarah")
        assert caught.matched not in det.blocks
        assert det.exceptions()["allow_senders"] == ["Sarah"]

    def test_block_hop_validates_and_blocks(self):
        det, clock = make()
        with pytest.raises(ValueError):
            det.action("block_hop", hop="2")
        det.action("block_hop", hop="0x27", match="contains")
        assert det.blocks["hop:27"].source == "manual"
        assert say(det, clock, "Dave", "hello", path=("44", "27")).matched == "hop:27"

    def test_allow_hop_removes_related_blocks(self):
        det, _ = make()
        det.action("block_hop", hop="27AB")
        det.action("allow_hop", hop="27")
        assert "hop:27AB" not in det.blocks
        assert det.exceptions()["allow_hops"] == ["27"]
        det.action("unallow_hop", hop="27")
        assert det.exceptions()["allow_hops"] == []

    def test_allow_text_removes_matching_text_blocks(self):
        det, _ = make()
        det.action("block_text", text="cheap radios today", channel=PUBLIC)
        det.action("allow_text", text="Cheap Radios")
        assert not det.blocks

    def test_extend_and_keep(self):
        det, clock = make()
        det.action("block_hop", hop="27")
        before = det.blocks["hop:27"].expires
        det.action("extend", key="hop:27", seconds=3600)
        assert det.blocks["hop:27"].expires == before + 3600
        det.action("extend", key="hop:27", permanent=True)
        assert det.blocks["hop:27"].expires - clock.now > 9 * 365 * 86400

    def test_observe_only_block(self):
        det, _ = make()
        det.action("block_hop", hop="27")
        det.action("block_action", key="hop:27", observe=True)
        assert det.blocks["hop:27"].observe is True

    def test_hop_mode_per_block(self):
        det, _ = make()
        det.action("block_hop", hop="27")
        det.action("hop_mode", key="hop:27", match="starts_at")
        assert det.hop_mode(det.blocks["hop:27"]) == "starts_at"
        assert not det.gated(det.blocks["hop:27"])
        with pytest.raises(ValueError):
            det.action("hop_mode", key="hop:27", match="sideways")

    def test_missing_block_is_an_error(self):
        det, _ = make()
        with pytest.raises(ValueError):
            det.action("extend", key="hop:99")

    def test_no_block_by_sender_name(self):
        det, _ = make()
        with pytest.raises(ValueError):
            det.action("block_sender", sender="Dave")

    def test_clear_auto_keeps_manual(self):
        det, clock = make()
        det.action("block_hop", hop="27")
        say(det, clock, "Dave", LONG)
        det.decide()
        det.action("clear_auto")
        assert list(det.blocks) == ["hop:27"]


class TestMetricsAndState:
    def test_metrics_count_stopped_and_let_through(self):
        det, clock = make(mode="protect", overrides={"dedupe_enabled": False})
        for name in GENERATED:
            say(det, clock, name, SPAM)
        det.decide()
        say(det, clock, "PL4MN8QR", SPAM)
        settle(det, clock)
        metrics = det.metrics()
        day = metrics["d1"]
        assert day["messages"] == 4
        assert day["stopped"] == 1
        assert day["let_through"] == 3
        assert day["spam"] == 4
        assert day["stop_rate"] == 25
        assert day["spam_share"] == 100
        assert metrics["sources"][0]["hop"] == "27"
        assert metrics["sources"][0]["d7"] == 4
        assert len(metrics["hourly"]) == 24
        assert len(metrics["daily"]) == 7
        assert sum(metrics["by_hour"]) == 4
        # Hour of day is reported in UTC, whatever the server's time zone.
        assert metrics["by_hour"][time.gmtime(clock.now).tm_hour] == 4
        # A source's "last seen" is the time of its latest spam, not the hour it fell in.
        assert metrics["sources"][0]["last"] == clock.now - 130

    def test_genuine_held_is_counted_apart(self):
        det, clock = make()
        det.action("lockdown", minutes=60)
        say(det, clock, "Newcomer", "hello everyone")
        settle(det, clock)
        day = det.metrics()["d1"]
        assert day["held_genuine"] == 1
        assert day["stopped"] == 0

    def test_dump_is_json_safe_and_round_trips(self):
        det, clock = make()
        say(det, clock, "Dave", "evening all")
        settle(det, clock)
        det.action("block_hop", hop="27")
        state = json.loads(json.dumps(det.dump()))
        other = SpamDetector(SpamConfig(channels=[{"key": PUBLIC, "name": "Public"}]), clock=clock)
        other.load(state)
        assert other.is_known("Dave")
        assert "hop:27" in other.blocks
        assert other.blocks["hop:27"].source == "manual"
        assert other.metrics()["d1"]["messages"] == 1

    def test_load_drops_expired_blocks_and_tolerates_garbage(self):
        det, clock = make()
        det.action("block_hop", hop="27")
        state = det.dump()
        clock.tick(7 * 3600)
        other = SpamDetector(SpamConfig(), clock=clock)
        other.load(state)
        assert not other.blocks
        other.load({"blocks": "nonsense", "known": 5, "hist": [1, 2]})
        assert not other.blocks
        other.load({"blocks": {"hop:27": {"kind": "hop"}}})
        assert not other.blocks


def test_spam_package_does_not_import_the_radio():
    banned = ("app.radio", "app.services.radio", "app.services.host_repeater_tx", "meshcore")
    for path in pathlib.Path("app/spam").glob("*.py"):
        source = path.read_text(encoding="utf-8")
        for name in banned:
            assert f"import {name}" not in source and f"from {name}" not in source, (path, name)
