"""Spam Guard rule rendering, and that rendered rules agree with the detector."""

import pytest

from app.services.host_repeater import HostRepeaterRuntime
from app.services.host_repeater_policy import evaluate_layers
from app.services.host_repeater_settings import PolicyConfig, PolicyRule
from app.services.spam_backend_host import HostBackend
from app.spam.detector import SpamDetector
from app.spam.rules import (
    HOST_PREFIX,
    OPENHOP_ID_BASE,
    OPENHOP_PREFIX,
    channel_hash_byte,
    render,
)
from app.spam.settings import SpamConfig

PUBLIC = "8B3387E9C5CDEA6AC9E5EDBAA115CD72"
PUBLIC_HASH = "11"
OTHER = "AA" * 16
LONG = "Selling brand new radios at half price visit the shop on the corner today"
SPAM = "Amazing offer cheap radios available now at the usual place come quickly"
GENERATED = ["UD6DWREK", "QK3ZP9XV", "ZX8CV2BN"]
DISTINCT = ["weather is nice today", "anyone seen my antenna", "testing one two three"]
GRP = {"field": "payload_type", "op": "equals", "value": 5}
ON_PUBLIC = {"field": "channel_hash", "op": "equals", "value": PUBLIC_HASH}


class Clock:
    def __init__(self) -> None:
        self.now = 1_800_000_000.0

    def __call__(self) -> float:
        return self.now

    def tick(self, seconds: float) -> None:
        self.now += seconds


def make(mode="protect", **config):
    clock = Clock()
    config.setdefault("channels", [{"key": PUBLIC, "name": "Public"}])
    return SpamDetector(SpamConfig(mode=mode, **config), clock=clock), clock


def say(det, clock, sender, text, path=("27", "B1"), channel=PUBLIC):
    clock.tick(5)
    return det.ingest(ts=clock.now, path=path, sender=sender, text=text, channel=channel)


def fields(event) -> dict:
    """The policy fields the host engine builds for this message."""
    path = [hop.lower() for hop in event.path]
    return {
        "payload_type": 5,
        "channel_hash": channel_hash_byte(event.channel),
        "channel_sender": event.sender,
        "channel_message_body": event.text,
        "path_hashes": path,
        "hop_count": len(path),
        "path_first": path[0] if path else None,
    }


def host_verdict(det, event) -> str:
    rules = render(det, "host")
    before = [PolicyRule.model_validate(r) for r in rules.before]
    after = [PolicyRule.model_validate(r) for r in rules.after]
    return evaluate_layers(before, PolicyConfig(), after, fields(event)).action


def names(rules: list[dict]) -> list[str]:
    return [r["name"] for r in rules]


def test_public_channel_hash():
    assert channel_hash_byte(PUBLIC) == PUBLIC_HASH
    assert channel_hash_byte(PUBLIC + "00" * 16) == PUBLIC_HASH


class TestWhenNothingIsRendered:
    def blocked(self, **config):
        det, _ = make(**config)
        det.action("block_hop", hop="27", match="contains")
        return det

    def test_monitor(self):
        assert render(self.blocked(mode="monitor"), "host").rules == []
        assert render(self.blocked(mode="monitor"), "openhop").rules == []

    def test_paused(self):
        assert render(self.blocked(paused=True), "host").rules == []

    def test_protect(self):
        assert len(render(self.blocked(), "host").rules) == 1

    def test_observe_only_block_is_left_out(self):
        det = self.blocked()
        det.action("block_action", key="hop:27", observe=True)
        assert render(det, "host").rules == []


class TestHostDocuments:
    def test_manual_text_block(self):
        det, _ = make()
        key = det.action("block_text", text="cheap radios today", channel=PUBLIC)["key"]
        rules = render(det, "host")
        assert rules.after == []
        assert rules.before == [
            {
                "id": f"spam:{key}",
                "name": f"spam:{key}",
                "enabled": True,
                "if": {
                    "all": [
                        GRP,
                        ON_PUBLIC,
                        {
                            "field": "channel_message_body",
                            "op": "contains",
                            "value": "cheap radios today",
                        },
                    ]
                },
                "then": {"action": "drop"},
            }
        ]

    def test_duplicate_block_exempts_the_original_sender(self):
        det, clock = make()
        say(det, clock, "Dave", LONG)
        det.decide()
        (rule,) = render(det, "host").before
        assert rule["if"]["all"][-1] == {
            "field": "channel_sender",
            "op": "not_equals",
            "value": "Dave",
        }

    def test_words_block_requires_every_word(self):
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
        rule = next(r for r in render(det, "host").before if ":words:" in r["name"])
        bodies = [c["value"] for c in rule["if"]["all"] if c["field"] == "channel_message_body"]
        assert len(bodies) == 4 and all(c["op"] == "contains" for c in rule["if"]["all"][2:])

    def test_repeater_modes(self):
        det, _ = make()
        det.action("block_hop", hop="27AB", match="contains")
        (rule,) = render(det, "host").before
        assert rule["if"]["all"] == [
            GRP,
            {"field": "path_hashes", "op": "contains", "value": "27AB"},
        ]
        det.action("hop_mode", key="hop:27AB", match="starts_at")
        (rule,) = render(det, "host").before
        assert rule["if"]["all"] == [GRP, {"field": "path_first", "op": "equals", "value": "27ab"}]

    def test_exact_paths_is_one_rule_per_learnt_route(self):
        det, clock = make(overrides={"hop_match_mode": "exact_paths", "dedupe_enabled": False})
        for name, text in zip(GENERATED, DISTINCT, strict=True):
            say(det, clock, name, text, path=("27", "B1"))
        det.decide()
        (rule,) = render(det, "host").before
        assert rule["name"] == "spam:hop:27:27>B1"
        assert rule["if"]["all"][1] == {
            "field": "path_hashes",
            "op": "equals",
            "value": ["27", "B1"],
        }

    def test_gated_repeater_block_sits_behind_the_known_people_rule(self):
        det, clock = make(allow_senders=["Sue"])
        det.action("block_hop", hop="27")
        rules = render(det, "host")
        assert rules.before == []
        assert names(rules.after) == [f"spam:known-people:{PUBLIC}", f"spam:hop:27:{PUBLIC}"]
        known, block = rules.after
        assert known["then"] == {"action": "allow"}
        assert known["if"]["all"] == [
            GRP,
            ON_PUBLIC,
            {"field": "channel_sender", "op": "in", "value": ["Sue"]},
        ]
        assert block["if"]["all"] == [
            GRP,
            ON_PUBLIC,
            {"field": "path_hashes", "op": "contains", "value": "27"},
        ]
        assert rules.known_senders == ["Sue"]

    def test_links_and_lockdown_per_channel(self):
        det, _ = make(
            channels=[{"key": PUBLIC, "name": "Public"}, {"key": OTHER, "name": "#test"}],
            overrides={"hold_links": "always"},
        )
        det.decide()
        det.action("lockdown", minutes=30)
        after = render(det, "host").after
        assert sum("known-people" in n for n in names(after)) == 2
        assert sum(":links:new:" in n for n in names(after)) == 4  # 2 markers x 2 channels
        assert sum(n.startswith("spam:lockdown:") for n in names(after)) == 2
        lockdown = next(r for r in after if r["name"] == f"spam:lockdown:{PUBLIC}")
        assert lockdown["if"]["all"] == [GRP, ON_PUBLIC]

    def test_rotation_block_with_allowed_origin_comes_last(self):
        det, clock = make(overrides={"enable_hop_rules": False, "dedupe_enabled": False})
        for _ in range(2):
            say(det, clock, "Dave", "regular chat from home", path=("C9", "B1", "7E"))
        clock.tick(130)
        det.decide()
        for hop, name, text in zip(("A1", "A2", "A3"), GENERATED, DISTINCT, strict=True):
            say(det, clock, name, text, path=(hop, "B1", "7E"))
        det.decide()
        det.action("lockdown", minutes=30)
        after = render(det, "host").after
        assert names(after)[-2:] == ["spam:suffix:B1>7E:allow:C9", "spam:suffix:B1>7E"]
        allow, block = after[-2:]
        assert allow["then"] == {"action": "allow"}
        assert allow["if"]["all"][1] == {
            "field": "path_hashes",
            "op": "equals",
            "value": ["C9", "B1", "7E"],
        }
        assert block["if"]["all"] == [
            GRP,
            {"field": "hop_count", "op": "equals", "value": 3},
            {"field": "path_hashes", "op": "contains", "value": "B1"},
            {"field": "path_hashes", "op": "contains", "value": "7E"},
        ]

    def test_order_and_rule_cap(self):
        det, clock = make(overrides={"max_total_rules": 20})
        say(det, clock, "Dave", LONG)
        det.decide()
        clock.tick(1)
        det.action("block_hop", hop="27", match="contains")
        clock.tick(1)
        det.action("block_text", text="manual text block", channel=PUBLIC)
        before = render(det, "host").before
        assert [n.split(":")[1] for n in names(before)] == ["text", "hop", "text"]
        assert before[0]["if"]["all"][-1]["value"] == "manual text block"

        for i in range(25):
            det.action("block_text", text=f"manual text number {i}", channel=PUBLIC)
        capped = render(det, "host")
        assert len(capped.before) == 20
        assert capped.truncated is True

    def test_rules_fit_the_host_policy_model(self):
        long_key = "CD" * 32
        det, _ = make(channels=[{"key": long_key, "name": "big"}])
        det.action("block_hop", hop="27AB01")
        det.action("lockdown", minutes=30)
        rules = render(det, "host").rules
        ids = [r["id"] for r in rules]
        assert len(set(ids)) == len(ids)
        assert all(rule_id.startswith(HOST_PREFIX) for rule_id in ids)
        for rule in rules:
            PolicyRule.model_validate(rule)


class TestOpenHopDocuments:
    def test_channel_secret_object_reference_and_integer_ids(self):
        det, _ = make(allow_senders=["Sue"])
        det.action("block_hop", hop="27")
        det.action("block_text", text="cheap radios today", channel=PUBLIC)
        rules = render(det, "openhop")
        assert all(r["name"].startswith(OPENHOP_PREFIX) for r in rules.rules)
        ids = [r["id"] for r in rules.rules]
        assert all(isinstance(i, int) and i >= OPENHOP_ID_BASE for i in ids)
        assert len(set(ids)) == len(ids)
        (text,) = rules.before
        assert text["if"]["all"][1] == {
            "field": "channel_hash",
            "op": "equals",
            "value": PUBLIC.lower(),
        }
        known = rules.after[0]
        assert known["if"]["all"][-1] == {
            "field": "channel_sender",
            "op": "in",
            "value": "@rtfmspam.known_senders",
        }
        assert rules.known_senders == ["Sue"]

    def test_ids_are_stable_between_renders(self):
        det, _ = make()
        det.action("block_text", text="cheap radios today", channel=PUBLIC)
        assert render(det, "openhop").rules == render(det, "openhop").rules

    def test_first_hop_mode_is_not_widened(self):
        det, _ = make()
        det.action("block_hop", hop="27", match="starts_at")
        assert render(det, "openhop").rules == []
        assert len(render(det, "host").rules) == 1


class TestRulesAgreeWithTheDetector:
    """A message the detector says a block caught is one the rules drop, and vice versa."""

    def build(self):
        det, clock = make(allow_senders=["Sue"], overrides={"hop_match_mode": "contains_known"})
        say(det, clock, "Dave", "evening all", path=("44",))
        for _ in range(2):
            say(det, clock, "Carol", "regular chat from home", path=("C9", "B1", "7E"))
        clock.tick(130)
        det.decide()
        for name in GENERATED:
            say(det, clock, name, SPAM, path=("27", "B1"))
        rotating = zip(
            ("A1", "A2", "A3"), ("PL4MN8QR", "WK2JH7TD", "RN5VB3XC"), DISTINCT, strict=True
        )
        for hop, name, text in rotating:
            say(det, clock, name, text, path=(hop, "B1", "7E"))
        det.decide()
        det.action("block_hop", hop="55", match="contains")
        det.action("block_hop", hop="66", match="starts_at")
        det.action("block_text", text="forbidden phrase", channel=PUBLIC)
        assert {b.kind for b in det.blocks.values()} >= {"text", "hop", "suffix", "links"}
        return det, clock

    PROBES = [
        ("Stranger", SPAM, ("99",)),  # campaign text
        ("Stranger", "this has the forbidden phrase in it", ("99",)),  # manual text
        ("Stranger", "look at http://example.org", ("99",)),  # link, unknown name
        ("Dave", "look at http://example.org", ("99",)),  # link, known name
        ("Sue", "look at www.example.org", ("99",)),  # link, trusted name
        ("Stranger", "hello there", ("27", "B1")),  # gated repeater, unknown
        ("Dave", "hello there", ("27", "B1")),  # gated repeater, known
        ("Stranger", "hello there", ("12", "27")),  # gated repeater, passing through
        ("Dave", "hello there", ("12", "55")),  # plain repeater block holds known people too
        ("Stranger", "hello there", ("66", "12")),  # first-hop block, starts there
        ("Stranger", "hello there", ("12", "66")),  # first-hop block, only passing
        ("Stranger", "hello there", ("A4", "B1", "7E")),  # rotation, unknown origin
        ("Stranger", "hello there", ("C9", "B1", "7E")),  # rotation, known origin
        ("Dave", "hello there", ("A4", "B1", "7E")),  # rotation, known name
        ("Stranger", "hello there", ("A4", "B1")),  # rotation, other length
        ("Stranger", "hello there", ("99",)),  # nothing applies
        ("Stranger", "hello there", ()),  # heard directly
    ]

    @pytest.mark.parametrize("sender,text,path", PROBES)
    def test_agree(self, sender, text, path):
        det, clock = self.build()
        event = say(det, clock, sender, text, path=path)
        assert (host_verdict(det, event) == "drop") == (event.matched is not None)

    @pytest.mark.parametrize("sender,text,path", PROBES)
    def test_agree_under_lockdown(self, sender, text, path):
        det, clock = self.build()
        det.action("lockdown", minutes=30)
        event = say(det, clock, sender, text, path=path)
        assert (host_verdict(det, event) == "drop") == (event.matched is not None)

    def test_probes_cover_both_outcomes(self):
        det, clock = self.build()
        outcomes = {say(det, clock, s, t, path=p).matched is not None for s, t, p in self.PROBES}
        assert outcomes == {True, False}

    def test_text_block_does_not_reach_another_channel(self):
        det, clock = self.build()
        event = say(det, clock, "Stranger", SPAM, path=("99",), channel=OTHER)
        assert event.matched is None
        assert host_verdict(det, event) == "allow"


class TestHostBackend:
    def test_apply_and_clear(self):
        runtime = HostRepeaterRuntime()
        backend = HostBackend(runtime)
        assert backend.status() == {
            "backend": "host",
            "state": "off",
            "rules_expected": 0,
            "rules_present": 0,
        }
        det, _ = make()
        det.action("block_hop", hop="27")
        det.action("block_text", text="cheap radios today", channel=PUBLIC)
        backend.apply(render(det, "host"))
        assert backend.status()["rules_expected"] == 3
        assert backend.status()["rules_present"] == 3
        backend.clear()
        assert backend.status()["rules_present"] == 0

    def test_backend_does_not_import_the_radio(self):
        import pathlib

        source = pathlib.Path("app/services/spam_backend_host.py").read_text(encoding="utf-8")
        for banned in ("app.radio", "radio_commands", "host_repeater_tx", "meshcore"):
            assert f"import {banned}" not in source and f"from {banned}" not in source


class TestChannelFilter:
    """An OpenHop rule carries the channel key, so a channel can be left out."""

    def blocked(self):
        det, _ = make(channels=[{"key": PUBLIC, "name": "Public"}, {"key": OTHER, "name": "Club"}])
        det.action("block_text", text="cheap radios today", channel=OTHER)
        det.action("block_text", text="other spam text here", channel=PUBLIC)
        det.action("block_hop", hop="27", match="contains")
        det.action("lockdown", minutes=30)
        return det

    def test_no_filter_renders_every_channel(self):
        rules = render(self.blocked(), "openhop")
        assert OTHER.lower() in str(rules.rules).lower()
        assert len(rules.before) == 3

    def test_a_channel_left_out_appears_in_no_rule(self):
        rules = render(self.blocked(), "openhop", channels={PUBLIC})
        assert OTHER.lower() not in str(rules.rules).lower()
        # The Public text block and the repeater block (no channel in it) stay.
        assert len(rules.before) == 2
        names = [r["name"] for r in rules.after]
        assert names == [
            f"{OPENHOP_PREFIX}known-people:{PUBLIC}",
            f"{OPENHOP_PREFIX}lockdown:{PUBLIC}",
        ]

    def test_no_channel_left_means_no_gated_rules(self):
        rules = render(self.blocked(), "openhop", channels=set())
        assert rules.after == []
        assert [r["name"] for r in rules.before] == [f"{OPENHOP_PREFIX}hop:27"]
