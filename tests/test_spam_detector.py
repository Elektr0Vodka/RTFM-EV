"""Spam Guard detector scenarios, driven by an injected clock."""

import json
import pathlib
import time

import pytest

from app.spam.detector import LOCKDOWN_KEY, STATE_VERSION, SettledOutcome, SpamDetector
from app.spam.rules import render
from app.spam.settings import SpamConfig

PUBLIC = "8B3387E9C5CDEA6AC9E5EDBAA115CD72"
OTHER = "AA" * 16
TWO_CHANNELS = [{"key": PUBLIC, "name": "Public"}, {"key": OTHER, "name": "#other"}]
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

    def test_a_message_another_block_stopped_gets_no_duplicate_block(self):
        det, clock = make()
        key = det.action("block_text", text="brand new radios", channel=PUBLIC)["key"]
        assert say(det, clock, "Dave", LONG).matched == key
        det.decide()
        assert list(det.blocks) == [key]

    def test_a_message_an_observing_block_matched_still_gets_one(self):
        det, clock = make()
        key = det.action("block_text", text="brand new radios", channel=PUBLIC)["key"]
        det.action("block_action", key=key, observe=True)
        say(det, clock, "Dave", LONG)
        det.decide()
        assert sorted(b.source for b in det.blocks.values()) == ["dedupe", "manual"]

    def test_copies_keep_renewing_their_duplicate_block(self):
        det, clock = make()
        say(det, clock, "Dave", LONG)
        det.decide()
        (block,) = det.blocks.values()
        first_expiry = block.expires
        clock.tick(300)
        assert say(det, clock, "Sarah", LONG).matched == block.key
        det.decide()
        assert block.expires > first_expiry

    def test_a_caught_copy_is_reported_as_a_duplicate_once(self):
        det, clock = make()
        say(det, clock, "Dave", LONG, message_id=1)
        assert det.decide().duplicate == set()
        say(det, clock, "Sarah", LONG, message_id=2)
        assert det.decide().duplicate == {2}
        assert det.decide().duplicate == set()


class TestDuplicateRestart:
    """A duplicate block that is gone starts again with the next message."""

    @pytest.mark.parametrize("scope", ["others", "same", "everyone"])
    def test_a_block_removed_by_hand_is_made_again_by_the_next_message(self, scope):
        det, clock = make(overrides={"dedupe_scope": scope})
        say(det, clock, "Dave", LONG)
        det.decide()
        (key,) = det.blocks
        det.action("unblock", key=key)
        det.decide()
        assert not det.blocks and not det.suppressed
        # The copies seen so far are forgiven: the next one counts as a first copy.
        again = say(det, clock, "Dave", LONG)
        det.decide()
        assert again.matched is None
        assert len(det.blocks) == 1
        repeat = say(det, clock, "Sarah" if scope == "others" else "Dave", LONG)
        assert repeat.duplicate

    @pytest.mark.parametrize("scope", ["others", "same", "everyone"])
    def test_a_block_removed_by_hand_does_not_come_straight_back(self, scope):
        det, clock = make(overrides={"dedupe_scope": scope})
        say(det, clock, "Dave", LONG)
        say(det, clock, "Dave", LONG)
        det.decide()
        (key,) = det.blocks
        det.action("unblock", key=key)
        clock.tick(30)
        det.decide()
        assert not det.blocks

    def test_removing_the_block_of_one_name_leaves_the_other_name_alone(self):
        det, clock = make(overrides={"dedupe_scope": "same"})
        say(det, clock, "Dave", LONG)
        say(det, clock, "Sarah", LONG)
        det.decide()
        dave = next(key for key, b in det.blocks.items() if b.sender == "Dave")
        det.action("unblock", key=dave)
        clock.tick(400)
        assert say(det, clock, "Sarah", LONG).duplicate
        det.decide()
        (block,) = det.blocks.values()
        # Her own copies still renew her block.
        assert block.sender == "Sarah" and block.expires == clock.now + 900

    def test_clearing_the_automatic_blocks_lets_duplicates_start_again(self):
        det, clock = make(overrides={"dedupe_scope": "same"})
        say(det, clock, "Dave", LONG)
        det.decide()
        det.action("clear_auto")
        det.decide()
        assert not det.blocks and not det.suppressed
        say(det, clock, "Dave", LONG)
        det.decide()
        assert say(det, clock, "Dave", LONG).duplicate

    @pytest.mark.parametrize("scope", ["others", "same", "everyone"])
    def test_an_expired_block_is_made_again_by_the_next_message(self, scope):
        det, clock = make(overrides={"dedupe_scope": scope})
        say(det, clock, "Dave", LONG)
        det.decide()
        clock.tick(901)
        det.decide()
        assert not det.blocks
        say(det, clock, "Dave", LONG)
        det.decide()
        assert len(det.blocks) == 1
        assert say(det, clock, "Sarah" if scope == "others" else "Dave", LONG).duplicate


class TestShortDuplicates:
    def test_a_five_character_message_can_be_deduplicated(self):
        det, clock = make(overrides={"dedupe_scope": "same", "dedupe_min_chars": 5})
        say(det, clock, "Dave", "test1")
        det.decide()
        (block,) = det.blocks.values()
        assert block.value == "test1"
        assert say(det, clock, "Dave", "test1").duplicate

    def test_the_text_rule_length_does_not_hold_back_a_duplicate_rule(self):
        """``min_rule_chars`` is for campaign text rules; duplicates have their own lengths."""
        det, clock = make(overrides={"dedupe_min_chars": 10, "min_rule_chars": 30})
        say(det, clock, "Dave", "Morgghu meshworld")
        det.decide()
        assert [b.value for b in det.blocks.values()] == ["Morgghu meshworld"]

    @pytest.mark.parametrize("chars", [5, 6, 8, 10, 12])
    @pytest.mark.parametrize(
        "text",
        [
            "Is dat weer nieuw een bot die alle berichten herhaalt.",
            "Dit is een test voor mij 1",
            "Morgghu meshworld",
        ],
    )
    def test_a_short_piece_still_gives_a_rule(self, chars, text):
        det, clock = make(
            overrides={"dedupe_scope": "same", "dedupe_min_chars": 5, "text_rule_chars": chars}
        )
        say(det, clock, "Dave", text)
        det.decide()
        (block,) = det.blocks.values()
        assert block.value in text
        assert len(block.value) >= 5
        assert block.value == block.value.strip()
        assert say(det, clock, "Dave", text).duplicate

    def test_marking_a_message_as_spam_works_with_a_short_piece(self):
        det, _ = make(overrides={"text_rule_chars": 5})
        text = det.action("mark_spam", text="Dit is een test voor mij 1", channel=PUBLIC)["text"]
        # A block you make takes at least 12 characters, whatever the duplicate length.
        assert len(text) >= 12


class TestDuplicateScope:
    def test_same_holds_back_the_same_name_only(self):
        det, clock = make(overrides={"dedupe_scope": "same"})
        say(det, clock, "Dave", LONG)
        det.decide()
        (block,) = det.blocks.values()
        assert (block.sender, block.sender_only) == ("Dave", True)
        assert say(det, clock, "Sarah", LONG).matched is None
        assert say(det, clock, "Dave", LONG).matched == block.key

    def test_same_keeps_one_block_per_name(self):
        det, clock = make(overrides={"dedupe_scope": "same"})
        say(det, clock, "Dave", LONG)
        say(det, clock, "Sarah", LONG)
        det.decide()
        assert sorted(b.sender for b in det.blocks.values()) == ["Dave", "Sarah"]
        assert len(det.blocks) == 2

    def test_everyone_holds_back_the_first_sender_too(self):
        det, clock = make(overrides={"dedupe_scope": "everyone"})
        say(det, clock, "Dave", LONG)
        det.decide()
        (block,) = det.blocks.values()
        assert block.sender is None
        assert say(det, clock, "Sarah", LONG).matched == block.key
        assert say(det, clock, "Dave", LONG).matched == block.key

    @pytest.mark.parametrize("scope", ["same", "everyone"])
    def test_the_message_being_judged_does_not_block_itself(self, scope):
        """Host repeater: the rules made by this call judge this very message."""
        det, clock = make(overrides={"dedupe_scope": scope})
        first = say(det, clock, "Dave", LONG)
        det.decide(rematch=first)
        assert not det.blocks and first.matched is None
        repeat = say(det, clock, "Dave", LONG)
        det.decide(rematch=repeat)
        assert repeat.matched is not None and repeat.duplicate
        assert first.matched is None

    @pytest.mark.parametrize("scope", ["same", "everyone"])
    def test_a_message_too_young_to_have_been_judged_does_not_block_itself(self, scope):
        """Host repeater: a tick right after ingest must not get ahead of the engine."""
        det, clock = make(overrides={"dedupe_scope": scope})
        say(det, clock, "Dave", LONG)
        clock.tick(1)
        det.decide(fresh_seconds=3.0)
        assert not det.blocks
        clock.tick(3)
        det.decide(fresh_seconds=3.0)
        assert len(det.blocks) == 1

    def test_others_still_blocks_from_the_first_copy_on_the_host(self):
        det, clock = make()
        first = say(det, clock, "Dave", LONG)
        det.decide(rematch=first)
        assert len(det.blocks) == 1 and first.matched is None

    def test_same_blocks_one_name_rewording_its_own_message(self):
        det, clock = make(overrides={"dedupe_scope": "same"})
        say(det, clock, "Dave", LONG + " 1")
        say(det, clock, "Dave", LONG + " 2")
        det.decide()
        assert det.blocks
        assert all(b.sender == "Dave" and b.sender_only for b in det.blocks.values())
        assert say(det, clock, "Sarah", LONG + " 3").matched is None
        assert say(det, clock, "Dave", LONG + " 3").matched is not None

    def test_changing_the_scope_drops_the_old_duplicate_blocks(self):
        det, clock = make()
        say(det, clock, "Dave", LONG)
        det.decide()
        manual = det.action("block_text", text="something else entirely", channel=PUBLIC)["key"]
        det.configure(
            SpamConfig(
                channels=[{"key": PUBLIC, "name": "Public"}], overrides={"dedupe_scope": "same"}
            )
        )
        assert list(det.blocks) == [manual]
        assert det.decide().changed


class TestMalformedSignal:
    def test_off_by_default(self):
        det, clock = make()
        clock.tick(5)
        event = det.ingest(
            ts=clock.now, path=("27",), sender="Dave", text="hello", channel=PUBLIC, malformed=True
        )
        assert event.malformed is True and event.random is False
        assert det.decide().flag == set()

    def test_on_counts_as_a_made_up_sender_and_is_flagged(self):
        det, clock = make(overrides={"malformed_signal": True})
        clock.tick(5)
        event = det.ingest(
            ts=clock.now,
            path=("27",),
            sender="Dave",
            text="hello",
            channel=PUBLIC,
            message_id=7,
            malformed=True,
        )
        assert event.random is True
        assert det.decide().flag == {7}

    def test_a_trusted_name_is_left_alone(self):
        det, clock = make(overrides={"malformed_signal": True}, allow_senders=["Dave"])
        clock.tick(5)
        event = det.ingest(
            ts=clock.now,
            path=("27",),
            sender="Dave",
            text="hello",
            channel=PUBLIC,
            message_id=7,
            malformed=True,
        )
        assert event.random is False
        assert det.decide().flag == set()


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
        det, clock = make(overrides={"known_min_msgs": 1})
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
        det, clock = make(overrides={"known_min_msgs": 1})
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
        det, clock = make(overrides={"known_min_msgs": 1})
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
        det, clock = make(overrides={"known_min_msgs": 1})
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
        det, clock = make(overrides={"dedupe_enabled": False, "enable_hop_rules": False})
        for name in GENERATED:
            say(det, clock, name, SPAM)
        det.decide()
        key = next(key for key, block in det.blocks.items() if block.source == "campaign")
        det.action("unblock", key=key)
        assert key not in det.blocks
        say(det, clock, "PL7MNB4C", SPAM)
        det.decide()
        assert key not in det.blocks
        clock.tick(86401)
        for name in GENERATED:
            say(det, clock, name, SPAM)
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

    def test_cleared_automatic_blocks_do_not_come_straight_back(self):
        det, clock = make()
        for name in GENERATED:
            say(det, clock, name, SPAM)
        det.decide()
        cleared = set(det.blocks)
        assert {det.blocks[key].source for key in cleared} >= {"campaign", "hop", "dedupe"}
        lasting = {key for key in cleared if det.blocks[key].source != "dedupe"}
        det.action("clear_auto")
        clock.tick(30)
        det.decide()
        assert not det.blocks
        # A duplicate block is held off for as long as it would have lasted, the
        # others for as long as a block removed by hand.
        clock.tick(det.tunables.dedupe_seconds)
        det.decide()
        assert set(det.suppressed) == lasting
        det.action("clear_suppressed")
        for name in GENERATED:
            say(det, clock, name, SPAM)
        det.decide()
        assert lasting <= set(det.blocks)

    def test_block_hop_on_one_channel(self):
        det, clock = make(channels=TWO_CHANNELS)
        det.action("block_hop", hop="27", match="contains", channel=OTHER.lower())
        assert det.blocks["hop:27"].channel == OTHER
        assert say(det, clock, "Dave", "hello").matched is None
        clock.tick(5)
        there = det.ingest(ts=clock.now, path=("27",), sender="Dave", text="hello", channel=OTHER)
        assert there.matched == "hop:27"
        # Blocking it again without a channel widens it to every protected channel.
        det.action("block_hop", hop="27", match="contains")
        assert det.blocks["hop:27"].channel is None
        assert say(det, clock, "Dave", "hello").matched == "hop:27"

    def test_block_hop_refuses_a_channel_that_is_not_protected(self):
        det, _ = make()
        with pytest.raises(ValueError):
            det.action("block_hop", hop="27", channel=OTHER)
        with pytest.raises(ValueError):
            det.action("block_hop", hop="27", channel="not a key")
        assert not det.blocks

    def test_exact_paths_of_a_one_channel_block_are_learnt_on_that_channel(self):
        det, clock = make(channels=TWO_CHANNELS)
        det.action("block_hop", hop="27", match="exact_paths", channel=OTHER)
        say(det, clock, "Dave", "hello", path=("27", "B1"))
        clock.tick(5)
        det.ingest(ts=clock.now, path=("27", "C3"), sender="Dave", text="hello", channel=OTHER)
        det.decide()
        assert det.blocks["hop:27"].paths == ["27>C3"]

    def test_clear_held(self):
        det, clock = make()
        det.action("lockdown", minutes=60)
        say(det, clock, "Newcomer", "hello everyone")
        assert len(det.held) == 1
        det.action("clear_held")
        assert not det.held
        assert "lockdown" in det.blocks

    def test_forget_source(self):
        det, clock = make(overrides={"dedupe_enabled": False})
        for name in GENERATED:
            say(det, clock, name, SPAM)
        for name in GENERATED:
            say(det, clock, name, SPAM, path=("44",))
        settle(det, clock)
        assert {s["hop"] for s in det.metrics()["sources"]} == {"27", "44"}
        det.action("forget_source", hop="27")
        metrics = det.metrics()
        assert [s["hop"] for s in metrics["sources"]] == ["44"]
        # Only the row goes: the totals and the block stay.
        assert metrics["d1"]["spam"] == 6
        assert "hop:27" in det.blocks
        # New spam through it puts it back on the list.
        say(det, clock, "PL4MN8QR", SPAM)
        settle(det, clock)
        assert {s["hop"] for s in det.metrics()["sources"]} == {"27", "44"}

    def test_clear_messages_hides_them_but_keeps_the_evidence(self):
        det, clock = make(overrides={"dedupe_enabled": False, "enable_hop_rules": False})
        for name in GENERATED[:2]:
            say(det, clock, name, SPAM)
        det.decide()
        assert len(det.visible_events()) == 2
        det.action("clear_messages")
        assert det.visible_events() == []
        assert len(det.events) == 2
        # The hidden copies still count: the third name completes the campaign.
        third = say(det, clock, GENERATED[2], SPAM)
        det.decide()
        assert det.visible_events() == [third]
        assert "campaign" in {b.source for b in det.blocks.values()}

    def test_clear_messages_with_nothing_read_yet(self):
        det, clock = make()
        det.action("clear_messages")
        first = say(det, clock, "Dave", "hello")
        assert det.visible_events() == [first]

    def test_reset_learned(self):
        det, clock = make(allow_senders=["Sue"])
        for text in ("evening all", "anyone on tonight", "back in a bit"):
            say(det, clock, "Dave", text, path=("44",))
        for name in GENERATED:
            say(det, clock, name, SPAM)
        settle(det, clock)
        det.action("block_hop", hop="55")
        det.action("unblock", key="hop:55")
        det.action("lockdown", minutes=30)
        say(det, clock, "Newcomer", "hello everyone")
        assert det.blocks and det.suppressed and det.held and det.events and det.hours
        assert det.is_known("Dave")
        det.action("reset_learned")
        assert not (det.blocks or det.suppressed or det.held or det.events or det.hours)
        assert not (det.known or det.routes or det.relays or det.senders or det.campaigns)
        assert det.metrics()["sources"] == []
        assert [a["event"] for a in det.activity] == ["reset_learned"]
        # Settings are not learnt: the trusted name stays.
        assert det.exceptions()["allow_senders"] == ["Sue"]
        assert det.is_known("Sue") and not det.is_known("Dave")


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
        det, clock = make(overrides={"known_min_msgs": 1})
        say(det, clock, "Dave", "evening all")
        settle(det, clock)
        det.action("block_hop", hop="27")
        state = json.loads(json.dumps(det.dump()))
        other = SpamDetector(
            SpamConfig(
                channels=[{"key": PUBLIC, "name": "Public"}], overrides={"known_min_msgs": 1}
            ),
            clock=clock,
        )
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

    def test_state_written_before_known_after_three_keeps_known_people(self):
        # Before STATE_VERSION 2 a name was known after one genuine message.
        det, clock = make()
        det.load({"known": {"Dave": [clock.now, clock.now, 1]}})
        assert det.tunables.known_min_msgs == 3
        assert det.is_known("Dave")
        assert det.dump()["version"] == STATE_VERSION

    def test_current_state_is_not_bumped(self):
        det, clock = make()
        det.load({"version": STATE_VERSION, "known": {"Dave": [clock.now, clock.now, 1]}})
        assert not det.is_known("Dave")

    def test_a_name_is_known_after_three_genuine_messages(self):
        det, clock = make()
        for count in range(1, 4):
            say(det, clock, "Dave", f"evening all, message {count}")
            settle(det, clock)
            assert det.is_known("Dave") is (count == 3)


REPEAT = "anyone want my old radio"  # under dedupe_min_chars: duplicate suppression leaves it


class TestRepeatGuard:
    def repeat(self, det, clock, times, sender="Bobby", step=60.0):
        return [say(det, clock, sender, REPEAT, step=step) for _ in range(times)]

    def repeat_blocks(self, det):
        return [b for b in det.blocks.values() if b.source == "repeat"]

    def test_four_copies_stop_further_copies_from_that_name_only(self):
        det, clock = make()
        self.repeat(det, clock, 4)
        det.decide()
        (block,) = self.repeat_blocks(det)
        assert block.key.startswith("repeat:")
        assert block.sender == "Bobby" and block.sender_only
        assert block.reason == "repeat" and block.detail == {"count": 4}
        assert block.expires == clock.now + 3600
        mine = say(det, clock, "Bobby", REPEAT)
        assert mine.matched == block.key
        assert mine.duplicate is True and mine.spam is False
        theirs = say(det, clock, "Sue", REPEAT)
        assert theirs.matched != block.key
        other = say(det, clock, "Bobby", "something else entirely")
        assert other.matched is None

    def test_three_copies_are_fine(self):
        det, clock = make()
        self.repeat(det, clock, 3)
        det.decide()
        assert not self.repeat_blocks(det)

    def test_copies_spread_over_more_than_the_window_are_fine(self):
        det, clock = make()
        self.repeat(det, clock, 6, step=300.0)
        det.decide()
        assert not self.repeat_blocks(det)

    def test_trusted_names_and_allowed_texts_are_left_alone(self):
        det, clock = make(allow_senders=["Bobby"], allow_texts=["my old radio"])
        self.repeat(det, clock, 5)
        self.repeat(det, clock, 5, sender="Carol")
        det.decide()
        assert not self.repeat_blocks(det)

    def test_short_messages_are_left_alone(self):
        det, clock = make()
        for _ in range(6):
            say(det, clock, "Bobby", "@[Sue] ok ok", step=60.0)
        det.decide()
        assert not self.repeat_blocks(det)

    def test_can_be_switched_off(self):
        det, clock = make(overrides={"repeat_guard": False})
        self.repeat(det, clock, 6)
        det.decide()
        assert not self.repeat_blocks(det)

    def test_removing_it_forgives_the_copies_without_a_hold_off(self):
        det, clock = make()
        self.repeat(det, clock, 4)
        det.decide()
        (block,) = self.repeat_blocks(det)
        det.action("unblock", key=block.key)
        assert block.key not in det.suppressed
        det.decide()
        assert not self.repeat_blocks(det)
        self.repeat(det, clock, 4)
        det.decide()
        assert len(self.repeat_blocks(det)) == 1


class TestNewerFloods:
    def test_unreadable_text_from_a_new_name_is_made_up(self):
        det, clock = make()
        assert say(det, clock, "Dave", "Ж☙ᦐ").random is True
        assert say(det, clock, "Dave", "evening all").random is False

    def test_unreadable_text_from_a_known_name_is_not(self):
        det, clock = make(overrides={"known_min_msgs": 1})
        say(det, clock, "Dave", "evening all")
        settle(det, clock)
        assert say(det, clock, "Dave", "Ж☙ᦐ").random is False

    def test_unreadable_can_be_switched_off(self):
        det, clock = make(overrides={"detect_unreadable": False})
        event = say(det, clock, "Dave", "Ж☙ᦐ")
        assert event.random is False and event.unreadable is False

    def test_tagged_name_is_made_up_until_known(self):
        det, clock = make(overrides={"known_min_msgs": 1})
        assert say(det, clock, "Marco-7fq2k", "hello").random is True
        trusted, _ = make(allow_senders=["Marco-7fq2k"])
        assert say(trusted, clock, "Marco-7fq2k", "hello").random is False

    def test_a_call_sign_name_is_not_made_up(self):
        det, clock = make()
        assert say(det, clock, "Jan-pd0abc", "evening all").random is False


class TestSeedKnown:
    def test_only_normal_names_are_learnt(self):
        det, clock = make()
        added = det.seed_known(
            [
                ("Dave", 4, clock.now - 3600, clock.now - 60),
                ("UD6DWREK", 9, clock.now - 3600, clock.now - 60),
                ("Marco-7fq2k", 5, clock.now - 3600, clock.now - 60),
                ("?", 3, clock.now - 3600, clock.now - 60),
                ("", 3, clock.now - 3600, clock.now - 60),
                ("Unknown", 3, clock.now - 3600, clock.now - 60),
                ("pаypal", 3, clock.now - 3600, clock.now - 60),
            ]
        )
        assert added == 1
        assert det.known == {"Dave": [clock.now - 3600, clock.now - 60, 4]}
        assert det.is_known("Dave")
        assert det.activity[-1]["event"] == "known_seeded"

    def test_an_existing_entry_is_kept(self):
        det, clock = make()
        det.known["Dave"] = [1.0, 2.0, 7]
        assert det.seed_known([("Dave", 3, clock.now - 60, clock.now)]) == 0
        assert det.known["Dave"] == [1.0, 2.0, 7]


def regular(det, clock, name="Carol", hop="C9", onward=("B1",), times=6):
    """Someone chatting for over an hour from the same repeater."""
    for index in range(times):
        say(
            det,
            clock,
            name,
            f"{name} chatting about topic {index}",
            path=(hop, *onward),
            step=700.0,
        )
    settle(det, clock)


class TestRegulars:
    def test_home_counts_uncaught_messages_and_is_kept(self):
        det, clock = make()
        for index in range(3):
            say(det, clock, "Carol", f"chat {index} from home", path=("C9", "B1"))
        det.action("lockdown", minutes=60)
        say(det, clock, "Newbie", "hello there", path=("C9", "B1"))
        settle(det, clock)
        assert det.homes == {"Carol": {"C9": 3}}
        other, _ = make()
        other.load(json.loads(json.dumps(det.dump())))
        assert other.homes == {"Carol": {"C9": 3}}

    def test_established_is_known_or_an_hour_of_chat(self):
        det, clock = make(overrides={"known_min_msgs": 20})
        say(det, clock, "Dave", "first words")
        assert not det.established("Dave")
        regular(det, clock)
        assert det.established("Carol") and not det.is_known("Carol")

    @pytest.mark.parametrize("block", ["lockdown", "home_repeater"])
    def test_a_regular_caught_at_home_keeps_learning(self, block):
        det, clock = make(overrides={"known_min_msgs": 20})
        regular(det, clock)
        if block == "lockdown":
            det.action("lockdown", minutes=60)
        else:
            det.action("block_hop", hop="C9")
        before = det.known["Carol"][2]
        caught = say(det, clock, "Carol", "still here at home", path=("C9", "B1"))
        assert caught.matched is not None
        settle(det, clock)
        assert det.known["Carol"][2] == before + 1

    def test_the_same_name_from_elsewhere_does_not(self):
        det, clock = make(overrides={"known_min_msgs": 20})
        regular(det, clock)
        det.action("lockdown", minutes=60)
        before = det.known["Carol"][2]
        assert say(det, clock, "Carol", "it is me, honest", path=("D4", "B1")).matched
        settle(det, clock)
        assert det.known["Carol"][2] == before

    def test_known_people_saying_the_same_greeting_is_no_campaign(self):
        det, clock = make()
        det.seed_known([(name, 5, clock.now - 7200, clock.now - 600) for name in "ABCDE"])
        for name in "ABCDE":
            say(det, clock, name, "good evening mesh, all well here?")
        det.decide()
        assert not any(b.source == "campaign" for b in det.blocks.values())
        new, clock = make()
        for name in ("Anna", "Bert", "Cees", "Dirk", "Eef"):
            say(new, clock, name, "good evening mesh, all well here?")
        new.decide()
        assert any(b.source == "campaign" for b in new.blocks.values())

    def test_an_established_tagged_name_is_not_made_up(self):
        det, clock = make(overrides={"known_min_msgs": 20})
        assert say(det, clock, "Marco-7fq2k", "hello all").random is True
        regular(det, clock, name="Marco-7fq2k")
        assert say(det, clock, "Marco-7fq2k", "hello again").random is False


class TestRotationAndRegulars:
    quiet = {"enable_hop_rules": False, "dedupe_enabled": False, "known_min_msgs": 20}

    def test_an_established_person_from_a_new_hop_is_no_evidence(self):
        det, clock = make(overrides=self.quiet)
        for index in range(6):
            for name in ("Carol", "Dave", "Erik"):
                say(det, clock, name, f"{name} chatting about topic {index}", step=250.0)
        settle(det, clock)
        # Each turns up once from a never-seen first hop, the same onward route,
        # in a suspect campaign: not one spammer changing identity.
        for hop, name in [("A1", "Carol"), ("A2", "Dave"), ("A3", "Erik")]:
            say(det, clock, name, "Amazing offer cheap radios now", path=(hop, "B1", "7E"))
        det.decide()
        assert "suffix:B1>7E" not in det.blocks


class TestSpamNotOpinions:
    WEEK = 7 * 86400

    def known_dave(self):
        det, clock = make(overrides={"known_min_msgs": 1, "dedupe_enabled": False})
        say(det, clock, "Dave", "evening all")
        settle(det, clock)
        return det, clock

    def test_a_text_you_block_stops_only_names_it_does_not_know(self):
        det, clock = self.known_dave()
        det.action("block_text", text="cheap radios today", channel=PUBLIC)
        (block,) = det.blocks.values()
        assert det.gated(block)
        assert say(det, clock, "Dave", "cheap radios today, said Dave").matched is None
        assert say(det, clock, "Stranger", "cheap radios today").matched == block.key

    def test_this_is_spam_also_lets_known_people_through(self):
        det, clock = self.known_dave()
        det.action("mark_spam", text=LONG, channel=PUBLIC)
        (block,) = det.blocks.values()
        assert det.gated(block)
        assert say(det, clock, "Dave", LONG).matched is None

    def test_a_campaign_text_still_stops_everyone(self):
        det, clock = self.known_dave()
        for name in GENERATED:
            say(det, clock, name, SPAM)
        det.decide()
        block = next(b for b in det.blocks.values() if b.source == "campaign")
        assert not det.gated(block)
        assert say(det, clock, "Dave", SPAM).matched == block.key

    def test_block_text_needs_twelve_characters(self):
        det, _ = make()
        with pytest.raises(ValueError, match="12"):
            det.action("block_text", text="cheap radio", channel=PUBLIC)
        det.action("block_text", text="cheap radio!", channel=PUBLIC)

    def test_this_is_spam_needs_twelve_characters(self):
        det, _ = make()
        with pytest.raises(ValueError, match="12"):
            det.action("mark_spam", text="buy now ok", channel=PUBLIC)

    @pytest.mark.parametrize("trusted", [False, True])
    def test_this_is_spam_on_someone_it_knows_is_refused(self, trusted):
        det, clock = self.known_dave()
        if trusted:
            det.action("allow_sender", sender="Sue")
        name = "Sue" if trusted else "Dave"
        with pytest.raises(ValueError, match="repeat guard"):
            det.action("mark_spam", text=LONG, channel=PUBLIC, sender=name)
        assert not det.blocks

    def test_text_blocks_last_at_most_a_week(self):
        det, clock = make(overrides={"spam_text_days": 7, "block_ttl_seconds": 30 * 86400})
        for name in GENERATED:
            say(det, clock, name, SPAM)
        det.decide()
        for block in det.blocks.values():
            if block.kind in ("text", "words"):
                assert block.expires <= clock.now + self.WEEK

    def test_keep_is_refused_for_blocks_that_stop_known_people(self):
        det, clock = make()
        det.action("block_text", text="cheap radios today", channel=PUBLIC)
        det.action("block_hop", hop="27", match="contains")
        for key in ("hop:27", next(k for k in det.blocks if k.startswith("text:"))):
            with pytest.raises(ValueError, match="7 days"):
                det.action("extend", key=key, permanent=True)
            det.action("extend", key=key, seconds=30 * 86400)
            assert det.blocks[key].expires <= clock.now + self.WEEK

    def test_a_repeater_block_that_lets_known_people_through_can_be_kept(self):
        det, clock = make()
        det.action("block_hop", hop="27")
        det.action("extend", key="hop:27", permanent=True)
        assert det.blocks["hop:27"].expires > clock.now + 365 * 86400

    def test_switching_a_kept_repeater_block_to_stop_everyone_caps_it(self):
        det, clock = make()
        det.action("block_hop", hop="27")
        det.action("extend", key="hop:27", permanent=True)
        det.action("hop_mode", key="hop:27", match="contains")
        assert det.blocks["hop:27"].expires <= clock.now + self.WEEK

    def test_stored_permanent_blocks_are_capped_on_load(self):
        det, clock = make()
        det.action("block_hop", hop="27", match="contains")
        det.action("block_hop", hop="44")
        state = det.dump()
        for block in state["blocks"].values():
            block["expires"] = clock.now + 10 * 365 * 86400
        other, _ = make()
        other._clock = clock
        other.load(state)
        assert other.blocks["hop:27"].expires <= clock.now + self.WEEK
        assert other.blocks["hop:44"].expires > clock.now + self.WEEK


MADE_UP_FLOOD = [f"Q{index:02d}ZP9XV" for index in range(14)]


class TestAutoLockdown:
    quiet = {"enable_hop_rules": False, "enable_rotation_guard": False, "dedupe_enabled": False}

    def flood(self, det, clock, names=12, hops=6, step=5.0):
        for index in range(names):
            hop = f"{0xA0 + index % hops:02X}"
            say(
                det,
                clock,
                MADE_UP_FLOOD[index],
                f"junk number {index} here",
                path=(hop, "B1"),
                step=step,
            )
        det.decide()

    def test_a_flood_through_many_repeaters_locks_down_for_15_minutes(self):
        det, clock = make(overrides=self.quiet)
        self.flood(det, clock)
        block = det.blocks[LOCKDOWN_KEY]
        assert block.source == "auto_lockdown" and block.reason == "auto_lockdown"
        assert block.detail == {"count": 12, "origins": 6}
        assert block.expires == clock.now + 900
        rendered = [r["name"] for r in render(det, "openhop", preview=True).rules]
        assert f"rtfm-spam:lockdown:{PUBLIC} (auto)" in rendered

    @pytest.mark.parametrize("names,hops", [(11, 6), (12, 5)])
    def test_a_smaller_flood_does_not(self, names, hops):
        det, clock = make(overrides=self.quiet)
        self.flood(det, clock, names=names, hops=hops)
        assert LOCKDOWN_KEY not in det.blocks

    def test_a_slow_flood_does_not(self):
        det, clock = make(overrides=self.quiet)
        self.flood(det, clock, step=12.0)  # 12 names over more than two minutes
        assert LOCKDOWN_KEY not in det.blocks

    def test_known_names_do_not_count(self):
        det, clock = make(overrides=self.quiet)
        for name in MADE_UP_FLOOD[:2]:
            det.known[name] = [clock.now - 7200, clock.now - 60, 5]
        det.action("allow_sender", sender=MADE_UP_FLOOD[2])
        self.flood(det, clock, names=14)  # 11 names it does not know
        assert LOCKDOWN_KEY not in det.blocks

    def test_never_while_your_own_lockdown_runs(self):
        det, clock = make(overrides=self.quiet)
        det.action("lockdown", minutes=60)
        self.flood(det, clock)
        assert det.blocks[LOCKDOWN_KEY].source == "lockdown"

    @pytest.mark.parametrize("how", ["lockdown", "unblock"])
    def test_ending_it_by_hand_holds_it_off_for_a_day(self, how):
        det, clock = make(overrides=self.quiet)
        self.flood(det, clock)
        if how == "lockdown":
            det.action("lockdown", minutes=0)
        else:
            det.action("unblock", key=LOCKDOWN_KEY)
        self.flood(det, clock)
        assert LOCKDOWN_KEY not in det.blocks
        assert det.suppressed[LOCKDOWN_KEY] >= clock.now + 86000

    def test_ending_your_own_lockdown_does_not_hold_it_off(self):
        det, clock = make(overrides=self.quiet)
        det.action("lockdown", minutes=60)
        det.action("lockdown", minutes=0)
        assert LOCKDOWN_KEY not in det.suppressed
        det.action("lockdown", minutes=60)
        det.action("unblock", key=LOCKDOWN_KEY)
        assert LOCKDOWN_KEY not in det.suppressed

    def test_clearing_automatic_blocks_keeps_your_own_lockdown(self):
        det, clock = make(overrides=self.quiet)
        det.action("lockdown", minutes=60)
        det.action("clear_auto")
        assert det.blocks[LOCKDOWN_KEY].source == "lockdown"

    def test_can_be_switched_off(self):
        det, clock = make(overrides={**self.quiet, "auto_lockdown": False})
        self.flood(det, clock)
        assert LOCKDOWN_KEY not in det.blocks


class TestCampaignsCorrectThemselves:
    REGULARS = [("Carol", "C7"), ("Dave", "C8"), ("Erik", "C9"), ("Fien", "CA")]

    def setup(self, regulars=4):
        det, clock = make(overrides={"dedupe_enabled": False, "enable_hop_rules": False})
        for index in range(3):
            for name, hop in self.REGULARS[:regulars]:
                say(det, clock, name, f"{name} chatting about topic {index}", path=(hop, "B1"))
        settle(det, clock)
        for name in GENERATED:
            say(det, clock, name, SPAM, path=("27", "B1"))
        det.decide()
        key = next(k for k, b in det.blocks.items() if b.source == "campaign" and b.kind == "text")
        return det, clock, key

    def quote(self, det, clock, regulars, home=True):
        for name, hop in regulars:
            event = say(det, clock, name, SPAM, path=(hop if home else "EE", "B1"))
            assert event.matched is not None
        det.decide()

    def test_a_campaign_block_that_catches_three_regulars_at_home_stops(self):
        det, clock, key = self.setup()
        self.quote(det, clock, self.REGULARS[:3])
        assert key not in det.blocks
        assert det.suppressed[key] >= clock.now + 86000
        (entry,) = [a for a in det.activity if a["event"] == "campaign_corrected"]
        assert entry["count"] == 3

    def test_two_regulars_are_not_enough(self):
        det, clock, key = self.setup()
        self.quote(det, clock, self.REGULARS[:2])
        assert key in det.blocks

    def test_names_heard_from_elsewhere_do_not_count(self):
        det, clock, key = self.setup()
        self.quote(det, clock, self.REGULARS[:3], home=False)
        assert key in det.blocks


class TestKnownPeopleAreNotNew:
    NAMES = ["Anouk", "Bram", "Daan", "Femke", "Gert", "Hanna"]

    def test_known_people_do_not_count_as_brand_new_names(self):
        det, clock = make(overrides={"dedupe_enabled": False})
        det.seed_known([(name, 5, clock.now - 7200, clock.now - 600) for name in self.NAMES])
        for name in self.NAMES:
            say(det, clock, name, f"{name} says hello to everyone", path=("44", "B1"))
        det.decide()
        assert "hop:44" not in det.blocks

    def test_brand_new_names_still_do(self):
        det, clock = make(overrides={"dedupe_enabled": False})
        for name in self.NAMES:
            say(det, clock, name, f"{name} says hello to everyone", path=("44", "B1"))
        det.decide()
        assert det.blocks["hop:44"].reason == "hop_new"


class TestKnownList:
    def build(self):
        det, clock = make()
        det.known["Anouk"] = [clock.now - 900, clock.now - 600, 5]
        det.known["Bram"] = [clock.now - 900, clock.now - 60, 1]  # still being learnt
        det.known["Carla"] = [clock.now - 900, clock.now - 300, 9]
        det.action("allow_sender", sender="Zeno")  # trusted, no history
        det.action("allow_sender", sender="Carla")
        return det, clock

    def test_most_recently_heard_first_with_trusted_names(self):
        det, clock = self.build()
        listed = det.known_list()
        assert listed["total"] == 4
        assert [p["name"] for p in listed["people"]] == ["Bram", "Carla", "Anouk", "Zeno"]
        bram = listed["people"][0]
        assert bram == {
            "name": "Bram",
            "genuine": 1,
            "first": clock.now - 900,
            "last": clock.now - 60,
            "known": False,
            "trusted": False,
        }
        assert listed["people"][1]["trusted"] and listed["people"][1]["known"]
        assert listed["people"][3] == {
            "name": "Zeno",
            "genuine": 0,
            "first": None,
            "last": None,
            "known": True,
            "trusted": True,
        }

    def test_search_and_pages(self):
        det, _ = self.build()
        assert [p["name"] for p in det.known_list(q="AN")["people"]] == ["Anouk"]
        page = det.known_list(limit=2, offset=1)
        assert page["total"] == 4
        assert [p["name"] for p in page["people"]] == ["Carla", "Anouk"]

    def test_forget_makes_someone_new_again(self):
        det, clock = self.build()
        det.homes["Carla"] = {"C9": 4}
        det.action("forget_known", name="Carla")
        assert "Carla" not in det.known and "Carla" not in det.homes
        assert "Carla" not in det.allow_senders
        assert not det.is_known("Carla")
        assert any(a["event"] == "known_forgotten" for a in det.activity)
        with pytest.raises(ValueError):
            det.action("forget_known", name="Nobody")


class TestMetricsPerChannel:
    def build(self):
        det, clock = make(channels=TWO_CHANNELS, overrides={"dedupe_enabled": False})
        for name in GENERATED:
            say(det, clock, name, SPAM)  # Public: spam
        for index in range(2):
            clock.tick(5)
            det.ingest(
                ts=clock.now,
                path=("44",),
                sender="Dave",
                text=f"evening on the club channel {index}",
                channel=OTHER,
                length=60,
            )
        settle(det, clock)
        return det, clock

    def test_one_channel_or_all(self):
        det, clock = self.build()
        everything = det.metrics()
        club = det.metrics(channel=OTHER)
        public = det.metrics(channel=PUBLIC)
        total = lambda metrics: sum(p["messages"] for p in metrics["hourly"])  # noqa: E731
        assert (total(everything), total(club), total(public)) == (5, 2, 3)
        assert sum(club["by_hour"]) == 0
        assert sum(public["by_hour"]) == sum(everything["by_hour"]) > 0
        # The number tiles stay "all channels".
        assert club["d1"] == everything["d1"]
        assert club["channel_since"] == public["channel_since"] is not None
        assert everything["channel_since"] is None

    def test_per_channel_counts_survive_a_restart(self):
        det, clock = self.build()
        other, _ = make(channels=TWO_CHANNELS)
        other._clock = clock
        other.load(json.loads(json.dumps(det.dump())))
        assert other.metrics(channel=OTHER)["hourly"] == det.metrics(channel=OTHER)["hourly"]
        assert other.channels_since == det.channels_since


class TestAutoProtectStatus:
    def watching(self, **overrides):
        det, clock = make(overrides={"auto_protect": True, "dedupe_enabled": False, **overrides})
        return det, clock

    def campaign(self, det, clock, rounds=5):
        for index in range(rounds):
            for name in GENERATED:
                say(det, clock, f"{name[:6]}{index:02d}", f"{SPAM} {index}")
            det.decide()
        settle(det, clock)

    def test_off_by_default_and_not_in_protect(self):
        det, _ = make()
        assert det.tunables.auto_protect is False
        assert det.auto_protect_status() is None
        protect, _ = make(mode="protect", overrides={"auto_protect": True})
        assert protect.auto_protect_status() is None

    def test_quiet_switches_after_three_days(self):
        det, clock = self.watching()
        status = det.auto_protect_status()
        assert status["since"] == clock.now
        assert status["due"] == clock.now + 3 * 86400
        assert status["waiting"] is None

    def test_enough_spam_switches_after_a_day(self):
        det, clock = self.watching()
        since = det.auto_protect_status()["since"]
        self.campaign(det, clock)
        status = det.auto_protect_status()
        assert status["spam"] >= 10
        assert status["due"] == since + 86400

    def test_a_genuine_mark_on_something_it_would_block_waits_for_you(self):
        det, clock = self.watching()
        self.campaign(det, clock, rounds=1)
        key = next(k for k, b in det.blocks.items() if b.source == "campaign")
        det.action("not_spam", matched=key)
        assert det.auto_protect_status()["waiting"] == "marked_genuine"
        clock.tick(10)
        det.action("watch_again")
        status = det.auto_protect_status()
        assert status["waiting"] is None and status["since"] == clock.now

    def test_many_held_messages_wait_for_you(self):
        det, clock = self.watching()
        det.action("lockdown", minutes=60)
        for index in range(4):
            say(det, clock, f"Newcomer{index}", "hello from a new person here")
        settle(det, clock)
        assert det.auto_protect_status()["waiting"] == "held"

    def test_paused_waits(self):
        det, _ = make(paused=True, overrides={"auto_protect": True})
        assert det.auto_protect_status()["waiting"] == "paused"

    def test_turning_it_on_starts_the_count(self):
        det, clock = make()
        clock.tick(5000)
        det.configure(
            SpamConfig(
                channels=[{"key": PUBLIC, "name": "Public"}], overrides={"auto_protect": True}
            )
        )
        assert det.auto_protect_status()["since"] == clock.now

    def test_the_count_survives_a_restart(self):
        det, clock = self.watching()
        since = det.auto_protect_status()["since"]
        other, _ = self.watching()
        other._clock = clock
        clock.tick(600)
        other.load(json.loads(json.dumps(det.dump())))
        assert other.auto_protect_status()["since"] == since


def test_spam_package_does_not_import_the_radio():
    banned = ("app.radio", "app.services.radio", "app.services.host_repeater_tx", "meshcore")
    for path in pathlib.Path("app/spam").glob("*.py"):
        source = path.read_text(encoding="utf-8")
        for name in banned:
            assert f"import {name}" not in source and f"from {name}" not in source, (path, name)


class TestSettledOutcomes:
    def campaign(self):
        det, clock = make()
        for index, name in enumerate(GENERATED, start=1):
            say(det, clock, name, SPAM, message_id=index)
            det.decide()
        fourth = say(det, clock, "QQ7XK2MV", SPAM, message_id=4)
        det.decide()
        return det, clock, fourth

    def test_ordinary_message_settles_clean_and_is_reported_once(self):
        det, clock = make()
        say(det, clock, "Dave", "evening all", message_id=1)
        assert det.decide().settled == []  # younger than the settling delay
        assert settle(det, clock).settled == [SettledOutcome(1, "clean", None, False)]
        assert settle(det, clock).settled == []

    def test_campaign_copies_carry_their_outcome_and_block_source(self):
        det, clock, _ = self.campaign()
        result = settle(det, clock)
        assert {s.message_id: (s.outcome, s.block) for s in result.settled} == {
            1: ("let_through", None),
            2: ("stopped", "dedupe"),
            3: ("stopped", "dedupe"),
            4: ("stopped", "campaign"),
        }

    def test_outcomes_agree_with_the_hourly_counters(self):
        det, clock, _ = self.campaign()
        outcomes = [s.outcome for s in settle(det, clock).settled]
        day = det.metrics()["d1"]
        assert day["messages"] == len(outcomes) == 4
        assert day["stopped"] == outcomes.count("stopped") == 3
        assert day["let_through"] == outcomes.count("let_through") == 1
        assert day["held_genuine"] == outcomes.count("held") == 0

    def test_a_block_that_is_gone_leaves_no_source(self):
        # Deleting a campaign block does not work as a setup: the next decide()
        # makes it again. A key that names no block is what an ended block
        # looks like to _settle.
        det, clock = make()
        event = say(det, clock, "Dave", "evening all", message_id=1)
        event.matched = "text:gone"
        assert settle(det, clock).settled == [SettledOutcome(1, "stopped", None, False)]

    def test_enforced_is_carried_from_the_event(self):
        det, clock = make()
        event = say(det, clock, "Dave", "evening all", message_id=1)
        event.enforced = True
        assert settle(det, clock).settled == [SettledOutcome(1, "clean", None, True)]

    def test_a_message_without_an_id_is_not_reported(self):
        det, clock = make()
        say(det, clock, "Dave", "evening all")
        assert settle(det, clock).settled == []
