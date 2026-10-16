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
NOT_OWN_SEND = {"field": "local_transmission", "op": "not_equals", "value": True}
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
                "name": f"spam:{key} (yours)",
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

    def test_duplicate_block_for_the_same_name_only(self):
        det, clock = make(overrides={"dedupe_scope": "same"})
        say(det, clock, "Dave", LONG)
        det.decide()
        (rule,) = render(det, "openhop").before
        assert rule["if"]["all"][-2] == {
            "field": "channel_sender",
            "op": "equals",
            "value": "Dave",
        }
        assert rule["if"]["all"][-1] == NOT_OWN_SEND

    def test_duplicate_block_for_everyone_names_no_sender(self):
        det, clock = make(overrides={"dedupe_scope": "everyone"})
        say(det, clock, "Dave", LONG)
        det.decide()
        (rule,) = render(det, "host").before
        assert [c["field"] for c in rule["if"]["all"]] == [
            "payload_type",
            "channel_hash",
            "channel_message_body",
        ]

    @pytest.mark.parametrize("scope", ["others", "same", "everyone"])
    @pytest.mark.parametrize("sender", ["Dave", "Sarah"])
    def test_duplicate_rules_agree_with_the_detector(self, scope, sender):
        det, clock = make(overrides={"dedupe_scope": scope})
        say(det, clock, "Dave", LONG)
        det.decide()
        event = say(det, clock, sender, LONG)
        assert (host_verdict(det, event) == "drop") == (event.matched is not None)

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
        assert rule["name"] == "spam:hop:27:27>B1 (auto)"
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
        assert names(rules.after) == [
            f"spam:known-people:{PUBLIC}",
            f"spam:hop:27:{PUBLIC} (yours)",
        ]
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
        lockdown = next(r for r in after if r["name"] == f"spam:lockdown:{PUBLIC} (yours)")
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
        assert names(after)[-2:] == [
            "spam:suffix:B1>7E:allow:C9 (auto)",
            "spam:suffix:B1>7E (auto)",
        ]
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

    @pytest.mark.parametrize("dialect", ["host", "openhop"])
    def test_the_rule_cap_holds_for_blocks_that_let_known_people_through(self, dialect):
        """Repeater blocks that let known people through make one rule per channel.

        Reported from an attack: with five channels the node got 740 rules while
        the cap was 170, because these rules were never counted.
        """
        channels = [{"key": f"{n:02X}" * 16, "name": f"#c{n}"} for n in range(1, 6)]
        det, clock = make(channels=channels, overrides={"max_total_rules": 20})
        for n in range(40):
            clock.tick(1)
            det.action("block_hop", hop=f"{n + 16:02X}")
        rules = render(det, dialect)
        assert len(rules.rules) <= 20
        assert rules.truncated is True
        # Five known-people rules, then whole blocks of five: three fit.
        hop_names = [name for name in names(rules.after) if ":hop:" in name]
        assert len(hop_names) == 15
        # The newest blocks are kept, as the detector checks them first.
        assert {name.split(":")[2] for name in hop_names} == {"35", "36", "37"}

    def test_the_rule_cap_counts_the_rules_before_the_gated_ones(self):
        det, clock = make(overrides={"max_total_rules": 20})
        for n in range(18):
            det.action("block_text", text=f"manual text number {n:02d}", channel=PUBLIC)
        clock.tick(1)
        det.action("block_hop", hop="27")
        clock.tick(1)
        det.action("block_hop", hop="28")
        rules = render(det, "host")
        assert len(rules.before) == 18
        # The known-people rule and one block fill the last two places.
        assert names(rules.after) == [
            f"spam:known-people:{PUBLIC}",
            f"spam:hop:28:{PUBLIC} (yours)",
        ]
        assert rules.truncated is True

    def test_gated_rules_under_the_cap_are_all_rendered(self):
        det, clock = make(overrides={"max_total_rules": 20})
        det.action("block_hop", hop="27")
        clock.tick(1)
        det.action("block_hop", hop="28")
        rules = render(det, "host")
        assert len(rules.after) == 3
        assert rules.truncated is False

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

    def test_drop_rules_leave_the_nodes_own_sends_alone(self):
        det, _ = TestRulesAgreeWithTheDetector().build()
        det.action("lockdown", minutes=30)
        rules = render(det, "openhop", bot_senders=BOTS).rules
        drops = [r for r in rules if r["then"]["action"] == "drop"]
        allows = [r for r in rules if r["then"]["action"] == "allow"]
        assert drops and allows
        assert all(r["if"]["all"][-1] == NOT_OWN_SEND for r in drops)
        assert all(NOT_OWN_SEND not in r["if"]["all"] for r in allows)

    def test_host_rules_have_no_own_send_condition(self):
        det, _ = TestRulesAgreeWithTheDetector().build()
        rules = render(det, "host", bot_senders=BOTS).rules
        assert rules
        assert all(NOT_OWN_SEND not in r["if"]["all"] for r in rules)

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


class TestOneChannelRepeaterBlock:
    """A repeater block the user made for one channel only renders rules for that channel."""

    ON_OTHER = {"field": "channel_hash", "op": "equals", "value": channel_hash_byte(OTHER)}

    def make(self, **config):
        return make(
            channels=[{"key": PUBLIC, "name": "Public"}, {"key": OTHER, "name": "#o"}], **config
        )

    def test_block_that_lets_known_people_through(self):
        det, _ = self.make(allow_senders=["Sue"])
        det.action("block_hop", hop="27", channel=OTHER)
        rules = render(det, "host")
        assert rules.before == []
        assert names(rules.after) == [
            f"spam:known-people:{OTHER}",
            f"spam:hop:27:{OTHER} (yours)",
        ]

    def test_block_on_every_channel_is_unchanged(self):
        det, _ = self.make()
        det.action("block_hop", hop="27")
        assert names(render(det, "host").after) == [
            f"spam:known-people:{PUBLIC}",
            f"spam:known-people:{OTHER}",
            f"spam:hop:27:{PUBLIC} (yours)",
            f"spam:hop:27:{OTHER} (yours)",
        ]

    def test_known_people_rule_for_every_channel_once_one_block_needs_it(self):
        det, _ = self.make()
        det.action("block_hop", hop="27", channel=OTHER)
        det.action("lockdown", minutes=30)
        after = names(render(det, "host").after)
        assert after[:2] == [f"spam:known-people:{PUBLIC}", f"spam:known-people:{OTHER}"]
        assert f"spam:hop:27:{OTHER} (yours)" in after
        assert f"spam:hop:27:{PUBLIC} (yours)" not in after

    @pytest.mark.parametrize("match", ["contains", "starts_at"])
    def test_plain_modes_carry_the_channel(self, match):
        det, _ = self.make()
        det.action("block_hop", hop="27", match=match, channel=OTHER)
        (rule,) = render(det, "host").before
        assert rule["if"]["all"][:2] == [GRP, self.ON_OTHER]
        assert len(rule["if"]["all"]) == 3

    def test_learnt_routes_carry_the_channel(self):
        det, clock = self.make()
        det.action("block_hop", hop="27", match="exact_paths", channel=OTHER)
        say(det, clock, "Dave", "hello", path=("27", "C3"), channel=OTHER)
        det.decide()
        (rule,) = (r for r in render(det, "host").before if ":hop:" in r["name"])
        assert rule["if"]["all"] == [
            GRP,
            self.ON_OTHER,
            {"field": "path_hashes", "op": "equals", "value": ["27", "C3"]},
        ]

    @pytest.mark.parametrize("match", ["contains_known", "contains", "starts_at", "exact_paths"])
    @pytest.mark.parametrize("channel", [PUBLIC, OTHER])
    @pytest.mark.parametrize("sender", ["Sue", "Stranger"])
    def test_rules_agree_with_the_detector(self, match, channel, sender):
        det, clock = self.make(allow_senders=["Sue"], overrides={"dedupe_enabled": False})
        det.action("block_hop", hop="27", match=match, channel=OTHER)
        say(det, clock, "Other", "first of the route", path=("27", "B1"), channel=OTHER)
        det.decide()
        event = say(det, clock, sender, "hello there", path=("27", "B1"), channel=channel)
        assert (host_verdict(det, event) == "drop") == (event.matched is not None)
        if channel == PUBLIC:
            assert event.matched is None

    def test_left_out_when_its_channel_may_not_be_named(self):
        det, _ = self.make()
        det.action("block_hop", hop="27", match="contains", channel=OTHER)
        assert render(det, "openhop", channels={PUBLIC}).rules == []
        assert len(render(det, "openhop", channels={PUBLIC, OTHER}).rules) == 1


class TestRuleNamesSayWhereABlockCameFrom:
    """On a node the rule name is all there is to tell our rules apart."""

    def test_yours_duplicate_and_automatic(self):
        det, clock = make()
        for name in GENERATED:
            say(det, clock, name, SPAM)
        det.decide()
        manual = det.action("block_text", text="cheap radios today", channel=PUBLIC)["key"]
        det.action("lockdown", minutes=30)
        by_source = {b.source: b.key for b in det.blocks.values()}
        rendered = names(render(det, "openhop").rules)
        assert f"{OPENHOP_PREFIX}{manual} (yours)" in rendered
        assert f"{OPENHOP_PREFIX}{by_source['dedupe']} (duplicate)" in rendered
        assert f"{OPENHOP_PREFIX}{by_source['campaign']} (auto)" in rendered
        assert f"{OPENHOP_PREFIX}hop:27:{PUBLIC} (auto)" in rendered
        assert f"{OPENHOP_PREFIX}lockdown:{PUBLIC} (yours)" in rendered
        # Our own helper rule is not a block.
        assert f"{OPENHOP_PREFIX}known-people:{PUBLIC}" in rendered

    def test_rule_id_does_not_follow_the_origin(self):
        det, clock = make()
        say(det, clock, "Dave", LONG)
        det.decide()
        (key,) = det.blocks
        (host_before,) = render(det, "host").before
        (node_before,) = render(det, "openhop").before
        assert host_before["id"] == f"spam:{key}"
        assert host_before["name"] == f"spam:{key} (duplicate)"
        det.action("extend", key=key, permanent=True)  # the user keeps it: now theirs
        (host_after,) = render(det, "host").before
        (node_after,) = render(det, "openhop").before
        assert host_after["name"] == f"spam:{key} (yours)"
        assert (host_after["id"], node_after["id"]) == (host_before["id"], node_before["id"])


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
            f"{OPENHOP_PREFIX}lockdown:{PUBLIC} (yours)",
        ]

    def test_no_channel_left_means_no_gated_rules(self):
        rules = render(self.blocked(), "openhop", channels=set())
        assert rules.after == []
        assert [r["name"] for r in rules.before] == [f"{OPENHOP_PREFIX}hop:27 (yours)"]


BOTS = ["NL-EIN-PA3JH-HA", "[NU]"]  # sorted, as the renderer hands them on
BOT_REF = "@rtfmspam.bot_senders"


class TestBotLists:
    """Forward blocking of listed bots: one drop rule per protected channel."""

    def two_channels(self, **config):
        return make(
            channels=[{"key": PUBLIC, "name": "Public"}, {"key": OTHER, "name": "#o"}], **config
        )

    def test_no_names_no_rule(self):
        det, _ = make()
        assert render(det, "host").rules == []
        assert render(det, "host", bot_senders=[]).bot_senders == []

    def test_host_rule_names_the_bots_inline(self):
        det, _ = make()
        rules = render(det, "host", bot_senders=["NL-EIN-PA3JH-HA", "[NU]", "[NU]", ""])
        assert rules.bot_senders == BOTS
        assert rules.before == [
            {
                "id": f"spam:bots:{PUBLIC}",
                "name": f"spam:bots:{PUBLIC} (bot list)",
                "enabled": True,
                "if": {
                    "all": [
                        GRP,
                        ON_PUBLIC,
                        {"field": "channel_sender", "op": "in", "value": BOTS},
                    ]
                },
                "then": {"action": "drop"},
            }
        ]
        assert [PolicyRule.model_validate(r).id for r in rules.before] == [f"spam:bots:{PUBLIC}"]

    def test_openhop_rule_refers_to_the_object(self):
        det, _ = make()
        rules = render(det, "openhop", bot_senders=BOTS)
        (rule,) = rules.before
        assert rule["name"] == f"{OPENHOP_PREFIX}bots:{PUBLIC} (bot list)"
        assert isinstance(rule["id"], int) and rule["id"] >= OPENHOP_ID_BASE
        assert rule["if"]["all"] == [
            GRP,
            {"field": "channel_hash", "op": "equals", "value": PUBLIC.lower()},
            {"field": "channel_sender", "op": "in", "value": BOT_REF},
            NOT_OWN_SEND,
        ]
        assert rules.bot_senders == BOTS

    def test_one_rule_per_protected_channel_ahead_of_the_blocks(self):
        det, _ = self.two_channels()
        det.action("block_text", text="cheap radios today", channel=PUBLIC)
        before = names(render(det, "host", bot_senders=BOTS).before)
        assert before[:2] == [f"spam:bots:{PUBLIC} (bot list)", f"spam:bots:{OTHER} (bot list)"]
        assert len(before) == 3 and before[2].endswith("(yours)")

    def test_nothing_in_monitor_or_while_paused(self):
        for config in ({"mode": "monitor"}, {"paused": True}):
            det, _ = make(**config)
            for dialect in ("host", "openhop"):
                rules = render(det, dialect, bot_senders=BOTS)
                assert rules.rules == [] and rules.bot_senders == []

    def test_no_protected_channel_no_rule(self):
        det, _ = make(channels=[])
        rules = render(det, "host", bot_senders=BOTS)
        assert rules.rules == [] and rules.bot_senders == []

    def test_openhop_leaves_out_a_channel_that_may_not_be_named(self):
        det, _ = self.two_channels()
        rules = render(det, "openhop", bot_senders=BOTS, channels={PUBLIC})
        assert names(rules.before) == [f"{OPENHOP_PREFIX}bots:{PUBLIC} (bot list)"]
        assert OTHER.lower() not in str(rules.rules)

    def test_the_host_rule_drops_a_bracketed_bot_only(self):
        det, _ = make()
        rules = render(det, "host", bot_senders=BOTS)
        before = [PolicyRule.model_validate(r) for r in rules.before]

        def verdict(sender):
            fields = {"payload_type": 5, "channel_hash": PUBLIC_HASH, "channel_sender": sender}
            return evaluate_layers(before, PolicyConfig(), [], fields).action

        assert verdict("[NU]") == "drop"
        assert verdict("NL-EIN-PA3JH-HA") == "drop"
        assert verdict("[nu]") == "allow"  # exact and case-sensitive
        assert verdict("Dave") == "allow"
        assert verdict(None) == "allow"

    def test_a_bot_that_spam_guard_knows_is_still_dropped(self):
        det, _ = make(allow_senders=["[NU]"])
        det.action("block_hop", hop="27")  # brings the known-people allow rule
        rules = render(det, "host", bot_senders=BOTS)
        assert f"spam:known-people:{PUBLIC}" in names(rules.after)
        before = [PolicyRule.model_validate(r) for r in rules.before]
        after = [PolicyRule.model_validate(r) for r in rules.after]
        fields = {
            "payload_type": 5,
            "channel_hash": PUBLIC_HASH,
            "channel_sender": "[NU]",
            "path_hashes": ["27"],
        }
        decision = evaluate_layers(before, PolicyConfig(), after, fields)
        assert (decision.action, decision.rule_id) == ("drop", f"spam:bots:{PUBLIC}")

    def test_the_rule_cap_cuts_blocks_before_a_bot_rule(self):
        det, _ = make(overrides={"max_total_rules": 20})
        for n in range(20):
            det.action("block_text", text=f"cheap radios today number {n:02d}", channel=PUBLIC)
        rules = render(det, "host", bot_senders=BOTS)
        assert len(rules.before) == 20
        assert names(rules.before)[0] == f"spam:bots:{PUBLIC} (bot list)"
        assert rules.truncated is True

    def test_ids_do_not_change_with_the_names(self):
        det, _ = make()
        first = render(det, "openhop", bot_senders=BOTS).before[0]["id"]
        second = render(det, "openhop", bot_senders=["Other"]).before[0]["id"]
        assert first == second

    def test_the_rule_cap_also_holds_for_the_bot_rules(self):
        channels = [{"key": f"{n:02X}" * 16, "name": f"#c{n}"} for n in range(1, 22)]
        det, _ = make(channels=channels, overrides={"max_total_rules": 20})
        rules = render(det, "host", bot_senders=BOTS)
        assert len(rules.before) == 20 and rules.truncated is True
        assert all(name.endswith("(bot list)") for name in names(rules.before))

    def test_openhop_leaves_out_names_the_node_would_match_differently(self):
        """The node reads "Unknown" for text without a sender, and takes any
        text before the first ": " as the name, colons and length regardless."""
        det, _ = make()
        listed = ["Unknown", "a:b", "x" * 50, "[NU]"]
        node = render(det, "openhop", bot_senders=listed)
        assert node.bot_senders == ["[NU]"]
        host = render(det, "host", bot_senders=listed)
        assert host.bot_senders == sorted(listed)

    def test_openhop_renders_no_rule_when_no_name_is_left(self):
        det, _ = make()
        rules = render(det, "openhop", bot_senders=["Unknown"])
        assert rules.rules == [] and rules.bot_senders == []
