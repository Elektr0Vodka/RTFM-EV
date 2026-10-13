"""The packet feed's OpenHop policy verdict: rule evaluation and the cached copy."""

import asyncio
import hashlib
import hmac

import pytest
from Crypto.Cipher import AES

from app.decoder import PacketInfo, PayloadType, RouteType, parse_packet
from app.repository import ChannelRepository
from app.services.policy_verdict import REFRESH_SECONDS, NodePolicy, PolicyVerdicts
from app.spam.rules import render
from tests.test_spam_rules import LONG, make, say

PUBLIC = "8b3387e9c5cdea6ac9e5edbaa115cd72"
OTHER = "aa" * 16


def group_text_frame(
    sender: str,
    text: str,
    *,
    key: str = PUBLIC,
    path: tuple[str, ...] = ("27", "b1"),
    route: RouteType = RouteType.FLOOD,
) -> bytes:
    """A GRP_TXT frame as it arrives."""
    secret = bytes.fromhex(key)
    plain = (1_800_000_000).to_bytes(4, "little") + b"\x00" + f"{sender}: {text}".encode()
    plain += bytes(-len(plain) % 16)
    cipher = AES.new(secret, AES.MODE_ECB).encrypt(plain)
    mac = hmac.new(secret + bytes(16), cipher, hashlib.sha256).digest()[:2]
    payload = hashlib.sha256(secret).digest()[:1] + mac + cipher
    width = len(path[0]) // 2 if path else 1
    raw = bytes([int(route) | (int(PayloadType.GROUP_TEXT) << 2)])
    return raw + bytes([((width - 1) << 6) | len(path)]) + bytes.fromhex("".join(path)) + payload


def group_text(sender: str, text: str, **frame) -> PacketInfo:
    """The same frame, parsed."""
    packet = parse_packet(group_text_frame(sender, text, **frame))
    assert packet is not None and packet.payload_type == PayloadType.GROUP_TEXT
    return packet


def advert() -> PacketInfo:
    raw = bytes([int(RouteType.FLOOD) | (int(PayloadType.ADVERT) << 2), 0]) + bytes(40)
    packet = parse_packet(raw)
    assert packet is not None
    return packet


def rule(name: str, *conditions: dict, action: str = "drop", **extra) -> dict:
    return {"id": 1, "name": name, "if": {"all": list(conditions)}, "then": {"action": action}} | (
        extra
    )


def cond(field: str, op: str, value) -> dict:
    return {"field": field, "op": op, "value": value}


def verdict(rules: list, packet: PacketInfo, **engine) -> dict | None:
    policy = NodePolicy({"enabled": True, "rules": rules, **engine})
    return policy.evaluate(packet, rssi=-90, snr=5.5)


GRP = cond("payload_type", "equals", 5)


class TestEvaluation:
    def test_first_matching_rule_decides(self):
        rules = [
            rule("adverts", cond("payload_type", "equals", 4)),
            rule("T-flood txt-msg", GRP, cond("route_type", "equals", 1)),
            rule("everything", cond("hop_count", "greater_or_equal", 0), action="allow"),
        ]
        assert verdict(rules, group_text("Dave", "hi")) == {
            "action": "drop",
            "rule": "T-flood txt-msg",
        }
        assert verdict(rules, advert()) == {"action": "drop", "rule": "adverts"}

    def test_a_matching_allow_rule_is_reported_too(self):
        rules = [rule("let text through", GRP, action="allow"), rule("drop text", GRP)]
        assert verdict(rules, group_text("Dave", "hi")) == {
            "action": "allow",
            "rule": "let text through",
        }

    def test_nothing_to_show_when_no_rule_matches(self):
        assert (
            verdict([rule("adverts", cond("payload_type", "equals", 4))], group_text("D", "x"))
            is None
        )

    def test_default_drop_is_reported_without_a_rule(self):
        got = verdict([], group_text("Dave", "hi"), default_action="drop")
        assert got == {"action": "drop", "rule": None}

    def test_a_switched_off_policy_gives_nothing(self):
        policy = NodePolicy({"enabled": False, "rules": [rule("text", GRP)]})
        assert policy.evaluate(group_text("Dave", "hi"), rssi=None, snr=None) is None

    def test_disabled_rules_are_skipped(self):
        rules = [rule("off", GRP, enabled=False), rule("on", GRP)]
        assert verdict(rules, group_text("Dave", "hi"))["rule"] == "on"

    def test_no_type_coercion(self):
        """The node compares a string "5" with the number 5 and finds them different."""
        assert verdict([rule("typed wrong", cond("payload_type", "equals", "5"))], advert()) is None
        assert (
            verdict([rule("x", cond("payload_type", "equals", "5"))], group_text("D", "x")) is None
        )

    def test_an_unnamed_rule_is_shown_by_its_id(self):
        rules = [{"id": 42, "if": cond("payload_type", "equals", 5), "then": "drop"}]
        assert verdict(rules, group_text("Dave", "hi")) == {"action": "drop", "rule": "#42"}

    def test_an_unknown_action_is_an_allow(self):
        assert (
            verdict([rule("odd", GRP, action="bounce")], group_text("D", "x"))["action"] == "allow"
        )

    def test_any_branch(self):
        rules = [
            {
                "name": "either",
                "if": {"any": [cond("payload_type", "equals", 4), cond("hop_count", "equals", 2)]},
                "then": {"action": "drop"},
            }
        ]
        assert verdict(rules, group_text("Dave", "hi"))["rule"] == "either"

    def test_path_hashes_ignore_case_and_refuse_mixed_widths(self):
        packet = group_text("Dave", "hi", path=("27", "b1"))
        assert verdict([rule("via B1", cond("path_hashes", "contains", "b1"))], packet)
        assert verdict([rule("exact", cond("path_hashes", "equals", ["27", "B1"]))], packet)
        assert (
            verdict([rule("mixed", cond("path_hashes", "intersects", ["27", "B1C2"]))], packet)
            is None
        )

    def test_signal_fields(self):
        packet = group_text("Dave", "hi")
        assert verdict([rule("weak", cond("rssi", "less_than", -80))], packet)
        assert verdict([rule("clean", cond("snr", "greater_than", 6))], packet) is None

    def test_object_references(self):
        rules = [rule("blocked relays", cond("path_hashes", "intersects", "@relays.bad"))]
        packet = group_text("Dave", "hi")
        assert verdict(rules, packet, objects={"relays": {"bad": ["B1", "C2"]}})
        assert verdict(rules, packet, objects={"relays": {"bad": ["C2"]}}) is None


class TestChannelFields:
    def test_channel_hash_accepts_the_secret_or_the_byte(self):
        packet = group_text("Dave", "hi")
        byte = hashlib.sha256(bytes.fromhex(PUBLIC)).digest()[0]
        assert byte == 0x11
        for value in (PUBLIC, PUBLIC + "00" * 16, "0x11", 0x11, "17"):
            assert verdict([rule("public", cond("channel_hash", "equals", value))], packet), value
        # The node reads a bare all-digit string as decimal: "11" is 0x0B there.
        for value in ("11", OTHER):
            assert verdict([rule("x", cond("channel_hash", "equals", value))], packet) is None

    def test_sender_and_text_need_the_secret_in_the_policy(self):
        packet = group_text("Dave", "cheap radios today")
        text_rule = rule("text", GRP, cond("channel_message_body", "contains", "cheap radios"))
        # Only the hash byte is named: the node cannot read the message.
        assert verdict([text_rule], packet) is None
        on_public = rule(
            "text on public",
            GRP,
            cond("channel_hash", "equals", PUBLIC),
            cond("channel_message_body", "contains", "cheap radios"),
            cond("channel_sender", "not_equals", "Sarah"),
        )
        assert verdict([on_public], packet) == {"action": "drop", "rule": "text on public"}
        assert verdict([on_public], group_text("Sarah", "cheap radios today")) is None

    def test_a_secret_in_the_objects_reads_the_channel_too(self):
        packet = group_text("Dave", "cheap radios today")
        rules = [rule("who", cond("channel_sender", "equals", "Dave"))]
        assert verdict(rules, packet, objects={"channels": {"public": {"secret": PUBLIC}}})
        assert verdict(rules, packet, objects={"channel_hash_groups": {"g": [PUBLIC]}})
        assert verdict(rules, packet, objects={"channels": {"other": OTHER}}) is None

    def test_decryptable(self):
        rules = [
            rule("names public", cond("channel_hash", "in", [PUBLIC])),
            rule("unreadable", GRP, cond("channel_decryptable", "equals", False)),
        ]
        assert verdict(rules[1:], group_text("Dave", "hi"))["rule"] == "unreadable"
        assert verdict(rules, group_text("Dave", "hi", key=OTHER))["rule"] == "unreadable"


class TestFieldsOnlyTheNodeKnows:
    def test_no_verdict_from_a_rule_on_the_node_mode(self):
        rules = [rule("in monitor", GRP, cond("mode", "equals", "monitor")), rule("text", GRP)]
        assert verdict(rules, group_text("Dave", "hi")) is None

    def test_such_a_rule_does_not_matter_when_another_condition_fails(self):
        rules = [
            rule(
                "adverts in monitor",
                cond("mode", "equals", "monitor"),
                cond("payload_type", "equals", 4),
            ),
            rule("text", GRP),
        ]
        assert verdict(rules, group_text("Dave", "hi")) == {"action": "drop", "rule": "text"}

    def test_rules_ahead_of_it_still_decide(self):
        rules = [rule("text", GRP), rule("in monitor", cond("mode", "equals", "monitor"))]
        assert verdict(rules, group_text("Dave", "hi"))["rule"] == "text"

    def test_local_transmission_is_known_to_be_false(self):
        rules = [rule("own traffic", cond("local_transmission", "equals", True)), rule("text", GRP)]
        assert verdict(rules, group_text("Dave", "hi"))["rule"] == "text"


class TestSpamGuardRules:
    """The rules Spam Guard writes to a node are found again by name."""

    @pytest.mark.parametrize("scope", ["others", "same", "everyone"])
    def test_a_duplicate_rule_names_itself(self, scope):
        det, clock = make(overrides={"dedupe_scope": scope})
        say(det, clock, "Dave", LONG)
        det.decide()
        rules = render(det, "openhop").rules
        (ours,) = rules
        assert ours["name"].startswith("rtfm-spam:text:") and ours["name"].endswith("(duplicate)")
        caught = {name: verdict(rules, group_text(name, LONG)) for name in ("Dave", "Sarah")}
        expected = {"others": {"Sarah"}, "same": {"Dave"}, "everyone": {"Dave", "Sarah"}}[scope]
        assert {name for name, got in caught.items() if got} == expected
        for name in expected:
            assert caught[name] == {"action": "drop", "rule": ours["name"]}


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


class TestCachedCopy:
    def make(self, engine, *, openhop=True):
        clock = Clock()
        reads: list[float] = []

        async def fetch():
            reads.append(clock.now)
            if isinstance(engine, Exception):
                raise engine
            return engine

        service = PolicyVerdicts(fetch=fetch, is_openhop=lambda: openhop, clock=clock)
        return service, clock, reads

    ENGINE = {"enabled": True, "rules": [rule("text", GRP)]}

    @pytest.mark.asyncio
    async def test_reads_the_policy_once_and_then_judges(self):
        service, clock, reads = self.make(self.ENGINE)
        packet = group_text("Dave", "hi")
        assert service.verdict_for(packet, rssi=None, snr=None) is None  # nothing read yet
        await asyncio.sleep(0)
        assert service.verdict_for(packet, rssi=None, snr=None) == {
            "action": "drop",
            "rule": "text",
        }
        clock.now += REFRESH_SECONDS - 1
        service.verdict_for(packet, rssi=None, snr=None)
        await asyncio.sleep(0)
        assert len(reads) == 1
        clock.now += 2
        service.verdict_for(packet, rssi=None, snr=None)
        await asyncio.sleep(0)
        assert len(reads) == 2

    @pytest.mark.asyncio
    async def test_no_read_and_no_verdict_on_another_radio(self):
        service, _, reads = self.make(self.ENGINE, openhop=False)
        service.update(self.ENGINE)
        assert service.verdict_for(group_text("Dave", "hi"), rssi=None, snr=None) is None
        await asyncio.sleep(0)
        assert reads == []

    @pytest.mark.asyncio
    async def test_a_failed_read_leaves_no_stale_verdict(self):
        service, clock, reads = self.make(RuntimeError("node away"))
        service.update(self.ENGINE)
        packet = group_text("Dave", "hi")
        assert service.verdict_for(packet, rssi=None, snr=None)
        clock.now += REFRESH_SECONDS + 1
        service.verdict_for(packet, rssi=None, snr=None)
        await asyncio.sleep(0)
        assert len(reads) == 1
        assert service.verdict_for(packet, rssi=None, snr=None) is None

    @pytest.mark.asyncio
    async def test_invalidate_forces_a_new_read(self):
        service, _, reads = self.make(self.ENGINE)
        service.update({"enabled": True, "rules": []})
        packet = group_text("Dave", "hi")
        assert service.verdict_for(packet, rssi=None, snr=None) is None
        service.invalidate()
        service.verdict_for(packet, rssi=None, snr=None)
        await asyncio.sleep(0)
        assert len(reads) == 1
        assert service.verdict_for(packet, rssi=None, snr=None)["rule"] == "text"

    def test_never_raises(self):
        service, _, _ = self.make(self.ENGINE)
        service.update({"enabled": True, "rules": [rule("text", GRP)]})
        assert service.verdict_for(None, rssi=None, snr=None) is None
        service._policy.rules = None  # type: ignore[union-attr]
        assert service.verdict_for(group_text("Dave", "hi"), rssi=None, snr=None) is None


class TestPacketFeedBroadcast:
    """The verdict and the malformed flag travel with the ``raw_packet`` event."""

    async def feed(self, monkeypatch, captured_broadcasts, frame: bytes, *, openhop: bool) -> dict:
        import app.packet_processor as processor

        service = PolicyVerdicts(is_openhop=lambda: openhop)
        service.update(
            {
                "enabled": True,
                "rules": [
                    rule("adverts", cond("payload_type", "equals", 4)),
                    rule("flood text", GRP, cond("route_type", "equals", 1)),
                ],
            }
        )
        broadcasts, mock_broadcast = captured_broadcasts
        monkeypatch.setattr(processor, "policy_verdicts", service)
        monkeypatch.setattr(processor, "broadcast_event", mock_broadcast)
        await ChannelRepository.upsert(key=PUBLIC.upper(), name="Public")
        await processor.process_raw_packet(frame, timestamp=1_800_000_050, rssi=-90, snr=5.0)
        (event,) = [b["data"] for b in broadcasts if b["type"] == "raw_packet"]
        return event

    @pytest.mark.asyncio
    async def test_carries_the_deciding_rule_on_an_openhop_node(
        self, test_db, monkeypatch, captured_broadcasts
    ):
        event = await self.feed(
            monkeypatch, captured_broadcasts, group_text_frame("Dave", "hello there"), openhop=True
        )
        assert event["policy"] == {"action": "drop", "rule": "flood text"}
        assert event["malformed"] is False

    @pytest.mark.asyncio
    async def test_no_verdict_on_another_radio(self, test_db, monkeypatch, captured_broadcasts):
        event = await self.feed(
            monkeypatch, captured_broadcasts, group_text_frame("Dave", "hello there"), openhop=False
        )
        assert event["policy"] is None

    @pytest.mark.asyncio
    async def test_flags_a_malformed_channel_message(
        self, test_db, monkeypatch, captured_broadcasts
    ):
        # No ASCII letter or digit and two scripts mixed: the chat filter's rule.
        frame = group_text_frame("Dave", "привет שלום")
        event = await self.feed(monkeypatch, captured_broadcasts, frame, openhop=False)
        assert event["decrypted"] is True and event["malformed"] is True


class TestStoredWithThePacket:
    """The verdict of the first reception is kept on the raw packet row."""

    @pytest.mark.asyncio
    async def test_the_verdict_is_stored_and_a_later_copy_does_not_replace_it(
        self, test_db, monkeypatch, captured_broadcasts
    ):
        import app.packet_processor as processor

        service = PolicyVerdicts(is_openhop=lambda: True)
        service.update(
            {"enabled": True, "rules": [rule("via B1", cond("path_hashes", "contains", "B1"))]}
        )
        broadcasts, mock_broadcast = captured_broadcasts
        monkeypatch.setattr(processor, "policy_verdicts", service)
        monkeypatch.setattr(processor, "broadcast_event", mock_broadcast)
        await ChannelRepository.upsert(key=PUBLIC.upper(), name="Public")

        # The same message over two paths: one packet row, two receptions.
        await processor.process_raw_packet(
            group_text_frame("Dave", "hello there", path=("27", "b1")), timestamp=1_800_000_050
        )
        await processor.process_raw_packet(
            group_text_frame("Dave", "hello there", path=("27", "c3")), timestamp=1_800_000_051
        )

        async with test_db.readonly() as conn:
            async with conn.execute("SELECT policy_action, policy_rule FROM raw_packets") as cursor:
                stored = [tuple(row) for row in await cursor.fetchall()]
        assert stored == [("drop", "via B1")]
        # Live, each reception still carries its own verdict.
        live = [b["data"]["policy"] for b in broadcasts if b["type"] == "raw_packet"]
        assert live == [{"action": "drop", "rule": "via B1"}, None]

    @pytest.mark.asyncio
    async def test_nothing_is_stored_on_another_radio(
        self, test_db, monkeypatch, captured_broadcasts
    ):
        import app.packet_processor as processor

        service = PolicyVerdicts(is_openhop=lambda: False)
        service.update({"enabled": True, "rules": [rule("text", GRP)]})
        monkeypatch.setattr(processor, "policy_verdicts", service)
        monkeypatch.setattr(processor, "broadcast_event", captured_broadcasts[1])
        await processor.process_raw_packet(group_text_frame("Dave", "hi"), timestamp=1_800_000_050)

        async with test_db.readonly() as conn:
            async with conn.execute("SELECT policy_action, policy_rule FROM raw_packets") as cursor:
                assert [tuple(row) for row in await cursor.fetchall()] == [(None, None)]


class TestBotListRule:
    """The rule a bot list asks for, judged the way the node judges it."""

    def policy(self, bots):
        det, _ = make()
        rules = render(det, "openhop", bot_senders=bots)
        return rules.rules, {"rtfmspam": {"bot_senders": rules.bot_senders}}

    def test_a_listed_bot_is_dropped_brackets_included(self):
        rules, objects = self.policy(["[NU]", "PingBot"])
        for sender in ("[NU]", "PingBot"):
            out = verdict(rules, group_text(sender, "nieuws"), objects=objects)
            assert out is not None and out["action"] == "drop"
            assert out["rule"] == f"rtfm-spam:bots:{PUBLIC.upper()} (bot list)"

    def test_anyone_else_passes(self):
        rules, objects = self.policy(["[NU]"])
        assert verdict(rules, group_text("Dave", "hi"), objects=objects) is None
        assert verdict(rules, group_text("[nu]", "hi"), objects=objects) is None

    def test_a_missing_object_matches_nothing(self):
        rules, _ = self.policy(["[NU]"])
        assert verdict(rules, group_text("[NU]", "nieuws")) is None
