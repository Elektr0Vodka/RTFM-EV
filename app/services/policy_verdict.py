"""What an OpenHop node's policy does with a packet, worked out here (indication).

An OpenHop node forwards on its own and does not report which rule decided a
packet. It does push every received frame to us, and its policy document can be
read through its API. This module evaluates that document against each received
packet the way the node does, so the packet feed can show "Drop rule <name>".

It is an indication, never the node's own verdict:

- the document is a copy, refreshed at most every ``REFRESH_SECONDS`` (and
  whenever Spam Guard syncs its rules or the policy is saved through us), so a
  rule changed on the node itself shows up to a minute late;
- a rule made because of a packet is not on the node when that packet passes;
- a rule on ``mode`` or ``rx_radio_id`` cannot be judged from here. Evaluation
  stops at the first such rule and no verdict is given, rather than a wrong one.

``NodePolicy`` is a port of the evaluation in openhop_repeater
``repeater/policy_engine.py`` (``PolicyEngine``) with the context fields of
``repeater/engine.py``: first enabled matching rule decides, no type coercion,
channel sender and text only for a channel whose secret the document carries.
Read from source, not checked against a live node.

Nothing here transmits or writes to the node.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import time
from collections.abc import Callable, Iterator
from typing import Any

from Crypto.Cipher import AES

from app.decoder import PacketInfo, PayloadType

logger = logging.getLogger(__name__)

REFRESH_SECONDS = 60.0
ACTIONS = frozenset({"allow", "drop", "log_only"})
# Context fields the node knows and we do not.
_UNKNOWABLE = frozenset({"mode", "rx_radio_id"})
_GROUP_TYPES = (PayloadType.GROUP_TEXT, PayloadType.GROUP_DATA)
_HEX = frozenset("0123456789abcdefABCDEF")
_SECRET_KEYS = ("secret", "key", "psk", "channel_secret")
_NO_CHANNEL: dict[str, Any] = {"decryptable": False, "sender": None, "message_body": None}


class _Unknowable(Exception):
    """A rule reads a field only the node knows."""


def _secret_literal(value: Any) -> str | None:
    """A full channel secret written as 32 or 64 hex characters."""
    if not isinstance(value, str):
        return None
    raw = value.strip()
    text = raw[2:] if raw.lower().startswith("0x") else raw
    if len(text) in (32, 64) and all(ch in _HEX for ch in text):
        return text
    return None


def _secret_bytes(secret: str) -> bytes:
    try:
        return bytes.fromhex(secret)
    except ValueError:
        return secret.encode("utf-8")


def _secret_hash(secret: str) -> int:
    raw = _secret_bytes(secret)
    if len(raw) >= 32 and raw[16:32] == bytes(16):
        raw = raw[:16]  # a 16 byte secret stored zero-padded
    elif len(raw) > 32:
        raw = raw[:32]
    return hashlib.sha256(raw).digest()[0]


def _as_list(value: Any) -> list[Any]:
    return list(value) if isinstance(value, (list, tuple, set)) else [value]


def _normalise_path_hash(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, int):
        if value < 0:
            return None
        if value > 0xFFFFFF:
            raise ValueError("path hash exceeds 3 bytes")
        width = 2 if value <= 0xFF else 4 if value <= 0xFFFF else 6
        return f"{value:0{width}X}"
    raw = str(value).strip()
    if raw.lower().startswith("0x"):
        raw = raw[2:]
    if not raw:
        return None
    if len(raw) not in (2, 4, 6) or not all(ch in _HEX for ch in raw):
        raise ValueError("path hash must be 1, 2 or 3 bytes of hex")
    return raw.upper()


def _normalise_path_hashes(value: Any) -> Any:
    if isinstance(value, (list, tuple, set)):
        out = [h for h in (_normalise_path_hash(item) for item in value) if h is not None]
        if len({len(h) for h in out}) > 1:
            raise ValueError("path hashes cannot mix byte lengths")
        return out
    return _normalise_path_hash(value)


def _normalise_channel_hash(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, int):
        parsed = value
    else:
        raw = str(value).strip()
        if not raw:
            return None
        secret = _secret_literal(raw)
        if secret is not None:
            return f"0x{_secret_hash(secret):02X}"
        if raw.lower().startswith("0x"):
            parsed = int(raw, 16)
        elif raw.isdigit():
            parsed = int(raw, 10)
        else:
            parsed = int(raw, 16)
    if not 0 <= parsed <= 0xFF:
        raise ValueError("channel hash must be one byte")
    return f"0x{parsed:02X}"


def _normalise_channel_hashes(value: Any) -> Any:
    if isinstance(value, (list, tuple, set)):
        return [h for h in (_normalise_channel_hash(item) for item in value) if h is not None]
    return _normalise_channel_hash(value)


def _compare(actual: Any, op: Any, expected: Any) -> bool:
    name = str(op or "equals").lower()
    try:
        if name in ("equals", "eq", "=="):
            return actual == expected
        if name in ("not_equals", "ne", "!="):
            return actual != expected
        if name in ("greater_than", "gt", ">"):
            return actual is not None and expected is not None and actual > expected
        if name in ("greater_or_equal", "gte", ">="):
            return actual is not None and expected is not None and actual >= expected
        if name in ("less_than", "lt", "<"):
            return actual is not None and expected is not None and actual < expected
        if name in ("less_or_equal", "lte", "<="):
            return actual is not None and expected is not None and actual <= expected
        if name == "contains":
            if isinstance(actual, (list, tuple, set)):
                return expected in actual
            if isinstance(actual, str) and expected is not None:
                return str(expected) in actual
            return False
        if name in ("in", "is_in"):
            if isinstance(expected, (list, tuple, set)):
                return actual in expected
            if isinstance(expected, str) and actual is not None:
                return str(actual) in expected
            return False
        if name in ("intersects", "overlaps"):
            if isinstance(actual, (list, tuple, set)) and isinstance(expected, (list, tuple, set)):
                return bool(set(actual) & set(expected))
            return False
        if name == "starts_with":
            return (
                isinstance(actual, str)
                and isinstance(expected, str)
                and actual.startswith(expected)
            )
        if name == "ends_with":
            return (
                isinstance(actual, str) and isinstance(expected, str) and actual.endswith(expected)
            )
    except Exception:
        return False
    return False


def _conditions(rule: dict[str, Any]) -> Iterator[Any]:
    cond = rule.get("if", {})
    if not isinstance(cond, dict):
        return
    if "field" in cond:
        yield cond
        return
    for key in ("all", "any"):
        branch = cond.get(key)
        if isinstance(branch, list):
            yield from branch


class NodePolicy:
    """One ``policy_engine`` document of an OpenHop node, ready to evaluate."""

    def __init__(self, engine: dict[str, Any]) -> None:
        self.enabled = bool(engine.get("enabled", False))
        default = str(engine.get("default_action", "allow"))
        self.default_action = default if default in ACTIONS else "allow"
        rules = engine.get("rules")
        self.rules: list[Any] = rules if isinstance(rules, list) else []
        objects = engine.get("objects")
        self.objects: dict[str, Any] = objects if isinstance(objects, dict) else {}
        self._secrets = list(dict.fromkeys(self._channel_secrets()))

    # ── channel secrets the node can read with ───────────────────────────

    def _channel_secrets(self) -> Iterator[str]:
        channels = self.objects.get("channels", {})
        items: Any = channels.values() if isinstance(channels, dict) else channels
        if isinstance(items, (list, tuple)) or isinstance(channels, dict):
            for entry in items:
                if isinstance(entry, str):
                    yield entry
                elif isinstance(entry, dict):
                    secret = next((entry[k] for k in _SECRET_KEYS if entry.get(k)), None)
                    if secret:
                        yield str(secret)
        groups = self.objects.get("channel_hash_groups", {})
        if isinstance(groups, dict):
            for values in groups.values():
                for candidate in _as_list(values):
                    secret = _secret_literal(candidate)
                    if secret:
                        yield secret
        for rule in self.rules:
            if not isinstance(rule, dict):
                continue
            for cond in _conditions(rule):
                if isinstance(cond, dict) and cond.get("field") == "channel_hash":
                    for candidate in _as_list(cond.get("value")):
                        secret = _secret_literal(candidate)
                        if secret:
                            yield secret

    def _channel_info(self, packet: PacketInfo) -> dict[str, Any]:
        """Sender and text of a channel message, when the node holds its secret."""
        payload = packet.payload
        if packet.payload_type != PayloadType.GROUP_TEXT or len(payload) < 4:
            return _NO_CHANNEL
        mac, ciphertext = bytes(payload[1:3]), bytes(payload[3:])
        for secret in self._secrets:
            if _secret_hash(secret) != payload[0]:
                continue
            raw = _secret_bytes(secret)
            key = raw[:32] if len(raw) >= 32 else raw + bytes(32 - len(raw))
            if hmac.new(key, ciphertext, hashlib.sha256).digest()[:2] != mac:
                continue
            try:
                plain = AES.new(key[:16], AES.MODE_ECB).decrypt(ciphertext)
            except ValueError:
                continue
            if len(plain) < 5:
                continue
            # flags 0x02 is signed text: two more bytes before the content.
            start = 7 if plain[4] == 0x02 and len(plain) >= 7 else 5
            content = plain[start:].decode("utf-8", errors="replace").rstrip("\x00")
            sender, sep, body = content.partition(": ")
            if not sep:
                sender, body = "Unknown", content
            return {
                "decryptable": True,
                "sender": sender.rstrip("\x00").rstrip(),
                "message_body": body.rstrip("\x00").rstrip(),
            }
        return _NO_CHANNEL

    # ── evaluation ───────────────────────────────────────────────────────

    def evaluate(
        self, packet: PacketInfo, *, rssi: int | None, snr: float | None
    ) -> dict[str, Any] | None:
        """The deciding rule as ``{action, rule}``; None when nothing is to be shown.

        ``rule`` is None for a drop by the default action. A packet that no rule
        matches and the default lets through gives None, and so does a policy
        that is switched off or that cannot be judged from here.
        """
        if not self.enabled:
            return None
        context = {
            "route_type": int(packet.route_type),
            "payload_type": int(packet.payload_type),
            "payload_length": len(packet.payload),
            "path_hash_size": packet.path_hash_size,
            "hop_count": packet.path_length,
            # The node fills in 0 when the radio reported no signal figures.
            "rssi": rssi if rssi is not None else 0,
            "snr": snr if snr is not None else 0.0,
            # We only ever see frames the node received over RF.
            "local_transmission": False,
        }
        cache: dict[str, Any] = {}
        try:
            for rule in self.rules:
                if not isinstance(rule, dict) or not bool(rule.get("enabled", True)):
                    continue
                if not self._rule_matches(rule, packet, context, cache):
                    continue
                name = rule.get("name") or f"#{rule.get('id')}"
                return {"action": self._action(rule), "rule": str(name)}
        except _Unknowable:
            return None
        return {"action": "drop", "rule": None} if self.default_action == "drop" else None

    @staticmethod
    def _action(rule: dict[str, Any]) -> str:
        then = rule.get("then", {})
        action = then.get("action") if isinstance(then, dict) else then
        action = str(action or rule.get("action") or "allow")
        return action if action in ACTIONS else "allow"

    def _rule_matches(
        self, rule: dict[str, Any], packet: PacketInfo, context: dict[str, Any], cache: dict
    ) -> bool:
        cond = rule.get("if", {})
        if not isinstance(cond, dict):
            return False
        if "field" in cond:
            branch, settles = [cond], False
        elif isinstance(cond.get("all"), list):
            branch, settles = cond["all"], False
        elif isinstance(cond.get("any"), list):
            branch, settles = cond["any"], True
        else:
            return False
        # ``all`` is settled by one condition that fails, ``any`` by one that
        # holds. A field only the node knows matters when nothing else settles it.
        unknowable = False
        for item in branch:
            if isinstance(item, dict) and item.get("field") in _UNKNOWABLE:
                unknowable = True
            elif self._condition_matches(item, packet, context, cache) is settles:
                return settles
        if unknowable:
            raise _Unknowable
        return not settles

    def _condition_matches(
        self, cond: Any, packet: PacketInfo, context: dict[str, Any], cache: dict
    ) -> bool:
        if not isinstance(cond, dict):
            return False
        field = cond.get("field")
        try:
            expected = self._resolve(cond.get("value"))
            actual = self._field(field, packet, context, cache)
            if field == "path_hashes":
                actual = _normalise_path_hashes(actual)
                expected = _normalise_path_hashes(expected)
            elif field == "channel_hash":
                actual = _normalise_channel_hashes(actual)
                expected = _normalise_channel_hashes(expected)
            return _compare(actual, cond.get("op", "equals"), expected)
        except ValueError:
            return False

    def _resolve(self, value: Any) -> Any:
        if isinstance(value, str) and value.startswith("@"):
            group, sep, key = value[1:].partition(".")
            if sep:
                members = self.objects.get(group, {})
                if isinstance(members, dict):
                    return members.get(key)
        return value

    def _field(self, field: Any, packet: PacketInfo, context: dict[str, Any], cache: dict) -> Any:
        if not isinstance(field, str):
            return None
        if field in context:
            return context[field]
        if field == "payload_hex":
            return packet.payload.hex()
        if field == "channel_hash":
            if packet.payload_type in _GROUP_TYPES and packet.payload:
                return packet.payload[0]
            return None
        if field in ("channel_message_body", "channel_sender", "channel_decryptable"):
            if "channel" not in cache:
                cache["channel"] = self._channel_info(packet)
            info = cache["channel"]
            if field == "channel_decryptable":
                return bool(info["decryptable"])
            return info["message_body" if field == "channel_message_body" else "sender"]
        if field == "path_hashes":
            if packet.payload_type == PayloadType.TRACE:
                return []  # a TRACE path holds SNR bytes, not hop hashes
            width = packet.path_hash_size
            return [packet.path[i : i + width].hex() for i in range(0, len(packet.path), width)]
        if field == "transport_code_0":
            return packet.transport_codes[0] if packet.transport_codes else None
        if field == "transport_code_1":
            return packet.transport_codes[1] if packet.transport_codes else None
        return None


EngineFetcher = Callable[[], Any]


async def fetch_engine() -> dict[str, Any] | None:
    """The node's ``policy_engine`` document, or None when there is no OpenHop node."""
    from app.services.spam_backend_openhop import _data, client_from_settings

    client = await client_from_settings(known_node=False)
    if client is None:
        return None
    try:
        engine = _data(await client.get_policy()).get("policy_engine")
    finally:
        await client.aclose()
    return engine if isinstance(engine, dict) else None


class PolicyVerdicts:
    """Keeps a copy of the node's policy and judges received packets with it."""

    def __init__(
        self,
        *,
        fetch: EngineFetcher = fetch_engine,
        is_openhop: Callable[[], bool] | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._fetch = fetch
        self._is_openhop = is_openhop or _radio_is_openhop
        self._clock = clock
        self._policy: NodePolicy | None = None
        self._fresh_until = float("-inf")
        self._task: asyncio.Task[None] | None = None

    def update(self, engine: Any) -> None:
        """Take a ``policy_engine`` document just read from, or written to, the node."""
        self._policy = NodePolicy(engine) if isinstance(engine, dict) else None
        self._fresh_until = self._clock() + REFRESH_SECONDS

    def invalidate(self) -> None:
        """The node's policy was changed: read it again before the next verdict."""
        self._policy = None
        self._fresh_until = float("-inf")

    def verdict_for(
        self, packet: PacketInfo | None, *, rssi: int | None, snr: float | None
    ) -> dict[str, Any] | None:
        """``{action, rule}`` for the packet feed, or None. Never raises."""
        try:
            if packet is None or not self._is_openhop():
                return None
            if self._clock() >= self._fresh_until:
                self._refresh()
            if self._policy is None:
                return None
            return self._policy.evaluate(packet, rssi=rssi, snr=snr)
        except Exception:
            logger.debug("Could not work out a policy verdict", exc_info=True)
            return None

    def _refresh(self) -> None:
        if self._task is not None and not self._task.done():
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        # Not again before the next interval, whatever this read gives.
        self._fresh_until = self._clock() + REFRESH_SECONDS
        self._task = loop.create_task(self._read())

    async def _read(self) -> None:
        try:
            engine = await self._fetch()
        except Exception as exc:
            # No verdict is better than one from a copy that may be out of date.
            logger.debug("Could not read the OpenHop policy for the packet feed: %s", exc)
            engine = None
        self._policy = NodePolicy(engine) if isinstance(engine, dict) else None


def _radio_is_openhop() -> bool:
    from app.services.host_repeater_link import radio_snapshot

    return bool(radio_snapshot().is_openhop)


policy_verdicts = PolicyVerdicts()
