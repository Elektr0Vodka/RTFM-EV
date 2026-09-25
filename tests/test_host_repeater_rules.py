"""Host repeater policy rule extensions (regex, prob, throttle, new fields, saved airtime).

Modelled on the jhuebert/MeshCore repeater packet filter (FILTER.md): rules may
match sender/text with a regex, decide only a percentage of their matches
(``prob``, deterministic per packet), or rate-gate their matches (``throttle``,
one free pass per N seconds); a rule that steps aside lets the next rule decide.
"""

import random
import time

import pytest
from pydantic import ValidationError

from app.services.host_repeater import HostRepeaterRuntime, LifetimeStats
from app.services.host_repeater_engine import ForwardingEngine, RadioParams, RxFacts
from app.services.host_repeater_policy import PolicyState, evaluate_policy
from app.services.host_repeater_settings import (
    HostRepeaterSettings,
    PolicyConfig,
    PolicyRule,
)

OUR_KEY = bytes([0xAB, 0xCD, 0xEF]) + bytes(range(29))
RADIO = RadioParams(freq_mhz=869.618, bw_khz=62.5, sf=8, cr=8)
NOW = 1000.0
FLOOD, TFLOOD, DIRECT = 1, 0, 2
TXT, GRP_TXT = 0x02, 0x05


def frame(
    route: int, ptype: int, path_byte: int, path: bytes, payload: bytes, codes: bytes = b""
) -> bytes:
    return bytes([(ptype << 2) | route]) + codes + bytes([path_byte]) + path + payload


def grp_payload(n: int = 0) -> bytes:
    return bytes([0x42, 0x01, 0x02]) + bytes([n]) * 16


def rule(rid: str, cond: dict, action: str = "drop", **then) -> PolicyRule:
    """Build one rule through PolicyConfig so the condition validator runs."""
    data = {"id": rid, "if": cond, "then": {"action": action, **then}}
    return PolicyConfig.model_validate({"enabled": True, "rules": [data]}).rules[0]


def policy(*rules: PolicyRule, **kw) -> PolicyConfig:
    return PolicyConfig(enabled=True, rules=list(rules), **kw)


def engine(**overrides) -> ForwardingEngine:
    return ForwardingEngine(HostRepeaterSettings(**overrides), OUR_KEY, RADIO, rng=random.Random(1))


def decide(eng: ForwardingEngine, raw: bytes, now: float = NOW, **facts):
    return eng.decide(raw, RxFacts(**facts), now, wall_now=time.time())


# ── settings model ──────────────────────────────────────────────────────


def test_new_policy_fields_are_accepted():
    for field in ("channel_name", "region", "path_first", "path_last", "path_string"):
        rule("r", {"field": field, "op": "equals", "value": "x"})


def test_matches_operator_requires_a_valid_bounded_regex():
    rule("ok", {"field": "channel_sender", "op": "matches", "value": r"^Bot\d+$"})
    with pytest.raises(ValidationError, match="regex"):
        rule("bad", {"field": "channel_sender", "op": "matches", "value": "(unclosed"})
    with pytest.raises(ValidationError, match="regex"):
        rule("long", {"field": "channel_sender", "op": "matches", "value": "a" * 129})
    with pytest.raises(ValidationError, match="regex"):
        rule("list", {"field": "channel_sender", "op": "matches", "value": ["a", "b"]})


def test_then_prob_and_throttle_are_range_checked():
    r = rule("r", {"field": "hop_count", "op": "equals", "value": 1}, prob=50, throttle_seconds=60)
    assert (r.then.prob, r.then.throttle_seconds, r.then.throttle_key) == (50, 60, "rule")
    assert rule("d", {"field": "hop_count", "op": "equals", "value": 1}).then.prob is None
    for bad in ({"prob": 0}, {"prob": 101}, {"throttle_seconds": 0}, {"throttle_seconds": 65536}):
        with pytest.raises(ValidationError):
            rule("x", {"field": "hop_count", "op": "equals", "value": 1}, **bad)
    with pytest.raises(ValidationError):
        rule("k", {"field": "hop_count", "op": "equals", "value": 1}, throttle_key="nope")
    # throttle_key without throttle_seconds is meaningless
    with pytest.raises(ValidationError, match="throttle_key"):
        rule("k2", {"field": "hop_count", "op": "equals", "value": 1}, throttle_key="sender")


# ── evaluate_policy: regex ──────────────────────────────────────────────


def test_matches_is_a_search_with_anchors_and_inline_flags():
    p = policy(
        rule("bot", {"field": "channel_sender", "op": "matches", "value": r"^Bot\d+$"}),
        rule("ci", {"field": "channel_message_body", "op": "matches", "value": "(?i)beacon"}),
    )
    assert evaluate_policy(p, {"channel_sender": "Bot42"}).rule_id == "bot"
    assert not evaluate_policy(p, {"channel_sender": "MyBot42"}).matched
    assert evaluate_policy(p, {"channel_message_body": "a BEACON here"}).rule_id == "ci"
    assert not evaluate_policy(p, {"channel_sender": None}).matched
    assert not evaluate_policy(p, {"channel_sender": 5}).matched


# ── evaluate_policy: prob ───────────────────────────────────────────────


def test_prob_is_deterministic_per_packet_and_steps_aside_on_a_failed_roll():
    p = policy(
        rule("dose", {"field": "hop_count", "op": "equals", "value": 1}, prob=50),
        rule("floor", {"field": "hop_count", "op": "equals", "value": 1}, action="log_only"),
    )
    verdicts = {}
    for i in range(200):
        h = f"{i:064x}"
        first = evaluate_policy(p, {"hop_count": 1}, packet_hash=h)
        again = evaluate_policy(p, {"hop_count": 1}, packet_hash=h)
        assert first == again
        assert first.rule_id in ("dose", "floor")
        verdicts[first.rule_id] = verdicts.get(first.rule_id, 0) + 1
    # roughly half decided by the dosed rule, the rest fell through to the floor
    assert 60 <= verdicts["dose"] <= 140 and verdicts["floor"] == 200 - verdicts["dose"]


def test_prob_100_or_none_always_decides():
    p = policy(rule("all", {"field": "hop_count", "op": "equals", "value": 1}, prob=100))
    assert all(
        evaluate_policy(p, {"hop_count": 1}, packet_hash=f"{i:064x}").rule_id == "all"
        for i in range(50)
    )


# ── evaluate_policy: throttle ───────────────────────────────────────────


def test_throttle_lets_one_match_per_window_slip_and_decides_the_excess():
    p = policy(
        rule(
            "slow", {"field": "channel_sender", "op": "equals", "value": "bob"}, throttle_seconds=60
        )
    )
    state = PolicyState()
    f = {"channel_sender": "bob"}
    first = evaluate_policy(p, f, now=NOW, state=state)
    assert not first.matched and first.passes == ("slow",)
    second = evaluate_policy(p, f, now=NOW + 1, state=state)
    assert second.rule_id == "slow" and second.action == "drop" and second.passes == ()
    # over-rate firings do not extend the window: exactly one pass per 60 s
    assert evaluate_policy(p, f, now=NOW + 59.9, state=state).rule_id == "slow"
    assert evaluate_policy(p, f, now=NOW + 60, state=state).passes == ("slow",)
    # without state (no throttling possible) the rule always decides
    assert evaluate_policy(p, f, now=NOW).rule_id == "slow"


def test_throttle_key_gives_each_sender_its_own_budget():
    p = policy(
        rule(
            "per-sender",
            {"field": "channel_name", "op": "equals", "value": "#test"},
            throttle_seconds=60,
            throttle_key="sender",
        )
    )
    state = PolicyState()
    alice = {"channel_name": "#test", "channel_sender": "alice"}
    bob = {"channel_name": "#test", "channel_sender": "bob"}
    assert evaluate_policy(p, alice, now=NOW, state=state).passes == ("per-sender",)
    assert evaluate_policy(p, bob, now=NOW, state=state).passes == ("per-sender",)
    assert evaluate_policy(p, alice, now=NOW + 1, state=state).rule_id == "per-sender"
    assert evaluate_policy(p, bob, now=NOW + 1, state=state).rule_id == "per-sender"


def test_throttle_state_is_bounded():
    p = policy(
        rule(
            "k",
            {"field": "hop_count", "op": "equals", "value": 1},
            throttle_seconds=60,
            throttle_key="sender",
        )
    )
    state = PolicyState(max_entries=10)
    for i in range(50):
        evaluate_policy(p, {"hop_count": 1, "channel_sender": f"s{i}"}, now=NOW + i, state=state)
    assert len(state) <= 10


def test_prob_filters_what_throttle_meters():
    """A failed roll never touches the throttle budget (fork semantics)."""
    p = policy(
        rule(
            "both", {"field": "hop_count", "op": "equals", "value": 1}, prob=50, throttle_seconds=60
        )
    )
    state = PolicyState()
    probe = policy(rule("both", {"field": "hop_count", "op": "equals", "value": 1}, prob=50))
    passing = [
        h
        for h in (f"{i:064x}" for i in range(100))
        if evaluate_policy(probe, {"hop_count": 1}, packet_hash=h).matched
    ]
    failing = [h for h in (f"{i:064x}" for i in range(100)) if h not in passing]
    # failed rolls: no pass recorded, no decision
    d = evaluate_policy(p, {"hop_count": 1}, packet_hash=failing[0], now=NOW, state=state)
    assert not d.matched and d.passes == ()
    # first roll that passes gets the free pass, the next one is decided
    assert evaluate_policy(
        p, {"hop_count": 1}, packet_hash=passing[0], now=NOW, state=state
    ).passes == ("both",)
    assert (
        evaluate_policy(
            p, {"hop_count": 1}, packet_hash=passing[1], now=NOW + 1, state=state
        ).rule_id
        == "both"
    )


# ── engine: new fields ──────────────────────────────────────────────────


def test_channel_name_field_comes_from_the_decrypt_result():
    p = policy(rule("memes", {"field": "channel_name", "op": "equals", "value": "#memes"}))
    eng = engine(policy=p)
    raw = frame(FLOOD, GRP_TXT, 0x01, b"\x11", grp_payload())
    d = decide(eng, raw, channel_decryptable=True, channel_name="#memes")
    assert d.reason == "policy_drop" and d.policy_rule_id == "memes"
    eng.reset_state()
    assert decide(eng, raw, channel_decryptable=True, channel_name="#other").forward


def test_region_field_is_the_resolved_name_or_unscoped():
    p = policy(
        rule("plain", {"field": "region", "op": "equals", "value": "unscoped"}),
        rule("foo", {"field": "region", "op": "equals", "value": "Foo"}),
    )
    eng = engine(policy=p)
    assert decide(eng, frame(FLOOD, TXT, 0x01, b"\x11", bytes(20))).policy_rule_id == "plain"
    scoped = frame(TFLOOD, TXT, 0x01, b"\x11", bytes(20), codes=b"\x01\x02\x03\x04")
    assert decide(eng, scoped, region="Foo").policy_rule_id == "foo"
    assert decide(eng, scoped, region="Bar").policy_rule_id is None
    # direct packets have no region and match neither
    assert decide(eng, frame(DIRECT, TXT, 0x01, b"\xab", bytes(20))).policy_rule_id is None


def test_path_first_last_and_string_fields():
    path = bytes([0x10, 0xA1, 0xB2, 0x30])
    raw = frame(FLOOD, TXT, 0x04, path, bytes(20))
    fields = engine()._policy_fields(
        __import__("app.path_utils", fromlist=["x"]).parse_packet_envelope(raw), RxFacts()
    )
    assert fields["path_first"] == "10" and fields["path_last"] == "30"
    assert fields["path_string"] == "10>a1>b2>30"
    empty = engine()._policy_fields(
        __import__("app.path_utils", fromlist=["x"]).parse_packet_envelope(
            frame(FLOOD, TXT, 0x00, b"", bytes(20))
        ),
        RxFacts(),
    )
    assert empty["path_first"] is None and empty["path_last"] is None and empty["path_string"] == ""


def test_engine_throttle_and_prob_are_stateful_and_reported():
    p = policy(
        rule("slow", {"field": "payload_type", "op": "equals", "value": TXT}, throttle_seconds=60)
    )
    eng = engine(policy=p)
    a = decide(eng, frame(FLOOD, TXT, 0x01, b"\x11", bytes([1]) * 20), now=NOW)
    b = decide(eng, frame(FLOOD, TXT, 0x01, b"\x11", bytes([2]) * 20), now=NOW + 1)
    assert a.forward and a.policy_passes == ("slow",) and a.policy_rule_id is None
    assert b.reason == "policy_drop" and b.policy_rule_id == "slow" and b.policy_passes == ()
    eng.reset_state()
    assert decide(eng, frame(FLOOD, TXT, 0x01, b"\x11", bytes([3]) * 20), now=NOW + 2).forward


# ── engine: saved airtime ───────────────────────────────────────────────


def test_filter_drops_carry_a_saved_airtime_estimate():
    p = policy(rule("r", {"field": "payload_type", "op": "equals", "value": TXT}))
    raw = frame(FLOOD, TXT, 0x01, b"\x11", bytes(20))
    d = decide(engine(policy=p), raw)
    assert d.reason == "policy_drop" and d.saved_airtime_ms is not None and d.saved_airtime_ms > 0
    # the estimate is the airtime of the frame we would have re-sent (one more hash)
    fwd = decide(engine(), raw)
    assert fwd.forward and fwd.airtime_ms == pytest.approx(d.saved_airtime_ms)
    # gates that are not filters (duplicates, malformed) save nothing
    eng = engine()
    decide(eng, raw)
    assert decide(eng, raw).reason == "duplicate" and decide(eng, raw).saved_airtime_ms is None


# ── runtime stats ───────────────────────────────────────────────────────


def _runtime_with(policy_cfg: PolicyConfig) -> HostRepeaterRuntime:
    rt = HostRepeaterRuntime()
    rt.settings = HostRepeaterSettings(shadow_enabled=True, policy=policy_cfg)
    rt.engine = ForwardingEngine(rt.settings, OUR_KEY, RADIO, rng=random.Random(1))
    return rt


def _record(rt: HostRepeaterRuntime, raw: bytes, now: float) -> None:
    from app.path_utils import parse_packet_envelope

    decision = rt.engine.decide(raw, RxFacts(), now, wall_now=time.time())

    class _Radio:
        lock_busy = False
        radio = RADIO

    rt._record(decision, parse_packet_envelope(raw), raw, _Radio(), now, now, 1.0, 0.0)


def test_stats_count_rule_hits_passes_and_saved_airtime():
    rt = _runtime_with(
        policy(
            rule(
                "slow", {"field": "payload_type", "op": "equals", "value": TXT}, throttle_seconds=60
            )
        )
    )
    _record(rt, frame(FLOOD, TXT, 0x01, b"\x11", bytes([1]) * 20), NOW)
    _record(rt, frame(FLOOD, TXT, 0x01, b"\x11", bytes([2]) * 20), NOW + 1)
    _record(rt, frame(FLOOD, TXT, 0x01, b"\x11", bytes([3]) * 20), NOW + 2)
    snap = rt.stats_snapshot(869.618)
    assert snap["policy_matches"] == {"slow": 2}
    assert snap["policy_passes"] == {"slow": 1}
    saved = snap["airtime"]["saved_total_ms"]
    assert saved > 0 and snap["saved_airtime_by_rule"]["slow"] == pytest.approx(saved)
    assert snap["saved_airtime_by_reason"] == {"policy_drop": pytest.approx(saved)}
    life = rt.lifetime.to_dict()
    assert life["policy_passes"] == {"slow": 1} and life["saved_airtime_total_ms"] == pytest.approx(
        saved, abs=0.1
    )
    assert life["saved_airtime_by_rule"]["slow"] == pytest.approx(saved, abs=0.1)
    restored = LifetimeStats.from_row({"since": 1, "runs": 1, "stats": life})
    assert restored.policy_passes == {"slow": 1}
    assert restored.saved_airtime_total_ms == pytest.approx(saved, abs=0.1)
    assert restored.saved_airtime_by_rule["slow"] == pytest.approx(saved, abs=0.1)
