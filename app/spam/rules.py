"""Spam Guard blocks rendered as policy rules (pure, no I/O).

The detector's blocks become ordinary policy rules in the OpenHop rule format,
``{id, name, enabled, if: {all: [...]}, then: {action}}``, which both backends
evaluate top-down, first match decides. A rule set has two parts, placed around
the user's own rules:

- ``before``: manual, repeater, campaign and duplicate blocks.
- ``after``: one "let known people through" allow rule per protected channel,
  then the blocks it gates (repeater "except people it knows", links,
  lockdown), then the rotation blocks with their allow exceptions. They come
  after the user's rules so our allow rules never override anything the user
  set up. Rotation blocks come last so their allow exceptions cannot let an
  unknown name past a lockdown.

Nothing is rendered in Monitor mode or while paused. Both engines stop at the
first matching rule, so even a ``log_only`` rule ahead of the user's rules
would let through a packet one of their ``drop`` rules should have stopped;
Monitor must not change forwarding. A block set to observe only is left out for
the same reason.

Two dialects:

- ``host``: the host repeater engine. Channels are matched by their 1 byte
  hash, known names are an inline list, and a repeater block can match on the
  first hop (``starts_at``).
- ``openhop``: an OpenHop node. Channels are matched by their secret (OpenHop
  derives the hash and needs the secret to read sender and text), known names
  live in a policy object, and rule ids are integers.
"""

from __future__ import annotations

import hashlib
from collections.abc import Collection
from dataclasses import dataclass, field
from typing import Any, Literal

from app.spam.detector import Block, SpamDetector

Dialect = Literal["host", "openhop"]

PAYLOAD_TYPE_GRP_TXT = 5
HOST_PREFIX = "spam:"
OPENHOP_PREFIX = "rtfm-spam:"
# OpenHop policy object holding the known names: ``@rtfmspam.known_senders``.
OPENHOP_OBJECT_GROUP = "rtfmspam"
OPENHOP_KNOWN_SENDERS = "known_senders"
# Host rule ids and names are capped by the host policy model.
MAX_HOST_ID = 64
MAX_NAME = 128
# OpenHop rule ids are integers; ours sit in their own range, derived from the
# rule name so an id is stable for as long as its block exists.
OPENHOP_ID_BASE = 700_000_000
OPENHOP_ID_SPAN = 100_000_000


@dataclass
class RuleSet:
    before: list[dict[str, Any]] = field(default_factory=list)
    after: list[dict[str, Any]] = field(default_factory=list)
    # Names the known-people rules let through (referenced as an object on OpenHop).
    known_senders: list[str] = field(default_factory=list)
    # ``max_total_rules`` was reached and the lowest priority rules were left out.
    truncated: bool = False

    @property
    def rules(self) -> list[dict[str, Any]]:
        return self.before + self.after


def channel_hash_byte(key_hex: str) -> str:
    """The 1 byte channel hash a GRP_TXT carries, as two hex characters."""
    secret = bytes.fromhex(key_hex)
    if len(secret) == 32 and secret[16:] == bytes(16):
        secret = secret[:16]  # a 16 byte secret stored zero-padded
    return hashlib.sha256(secret).hexdigest()[:2]


def _cond(name: str, op: str, value: Any) -> dict[str, Any]:
    return {"field": name, "op": op, "value": value}


_IS_GROUP_TEXT = _cond("payload_type", "equals", PAYLOAD_TYPE_GRP_TXT)


class _Renderer:
    def __init__(self, detector: SpamDetector, dialect: Dialect) -> None:
        self.detector = detector
        self.dialect = dialect
        self.prefix = HOST_PREFIX if dialect == "host" else OPENHOP_PREFIX
        self._used_ids: set[Any] = set()

    def _id(self, name: str) -> Any:
        digest = hashlib.sha256(name.encode()).hexdigest()
        if self.dialect == "host":
            rule_id: Any = name if len(name) <= MAX_HOST_ID else f"{self.prefix}{digest[:24]}"
        else:
            rule_id = OPENHOP_ID_BASE + int(digest[:12], 16) % OPENHOP_ID_SPAN
            while rule_id in self._used_ids:  # vanishingly rare; keep ids unique
                rule_id = OPENHOP_ID_BASE + (rule_id + 1 - OPENHOP_ID_BASE) % OPENHOP_ID_SPAN
        self._used_ids.add(rule_id)
        return rule_id

    def rule(
        self, key: str, conditions: list[dict[str, Any]], action: str = "drop"
    ) -> dict[str, Any]:
        name = f"{self.prefix}{key}"
        return {
            "id": self._id(name),
            "name": name[:MAX_NAME],
            "enabled": True,
            "if": {"all": conditions},
            "then": {"action": action},
        }

    def channel(self, key_hex: str) -> dict[str, Any]:
        value = channel_hash_byte(key_hex) if self.dialect == "host" else key_hex.lower()
        return _cond("channel_hash", "equals", value)

    def known(self, names: list[str]) -> dict[str, Any]:
        value: Any = (
            names if self.dialect == "host" else f"@{OPENHOP_OBJECT_GROUP}.{OPENHOP_KNOWN_SENDERS}"
        )
        return _cond("channel_sender", "in", value)

    # ── before the user's rules ──────────────────────────────────────────

    def plain(self, block: Block) -> list[dict[str, Any]]:
        if block.kind == "hop":
            return self._hop(block)
        conditions = [_IS_GROUP_TEXT]
        if block.channel:
            conditions.append(self.channel(block.channel))
        pieces = block.value if block.kind == "words" else [block.value]
        conditions += [_cond("channel_message_body", "contains", piece) for piece in pieces]
        if block.sender:
            # Duplicate suppression: the original sender may re-send their own message.
            conditions.append(_cond("channel_sender", "not_equals", block.sender))
        return [self.rule(block.key, conditions)]

    def _hop(self, block: Block) -> list[dict[str, Any]]:
        mode = self.detector.hop_mode(block)
        if mode == "exact_paths":
            return [
                self.rule(
                    f"{block.key}:{path}",
                    [_IS_GROUP_TEXT, _cond("path_hashes", "equals", path.split(">"))],
                )
                for path in block.paths
            ]
        if mode == "starts_at":
            if self.dialect != "host":
                return []  # OpenHop has no first-hop field; never widen a block to make do
            # ``path_first`` is compared as a plain string, and the engine's is lower case.
            return [
                self.rule(
                    block.key, [_IS_GROUP_TEXT, _cond("path_first", "equals", block.value.lower())]
                )
            ]
        return [
            self.rule(block.key, [_IS_GROUP_TEXT, _cond("path_hashes", "contains", block.value)])
        ]

    # ── after the user's rules ───────────────────────────────────────────

    def suffix(self, block: Block) -> list[dict[str, Any]]:
        """A rotation block: unknown first repeaters on one onward route."""
        suffix: list[str] = block.value
        limit = self.detector.tunables.max_origins_per_route
        rules = [
            self.rule(
                f"{block.key}:allow:{origin}",
                [_IS_GROUP_TEXT, _cond("path_hashes", "equals", [origin, *suffix])],
                action="allow",
            )
            for origin in sorted(self.detector.allowed_origins(block))[:limit]
        ]
        # Rules cannot say "this exact route after an unknown first repeater", so
        # this matches any route of that length through those repeaters.
        rules.append(
            self.rule(
                block.key,
                [
                    _IS_GROUP_TEXT,
                    _cond("hop_count", "equals", len(suffix) + 1),
                    *[_cond("path_hashes", "contains", hop) for hop in suffix],
                ],
            )
        )
        return rules

    def gated(
        self, blocks: list[Block], channel_keys: list[str], names: list[str]
    ) -> list[dict[str, Any]]:
        rules = [
            self.rule(
                f"known-people:{key}",
                [_IS_GROUP_TEXT, self.channel(key), self.known(names)],
                action="allow",
            )
            for key in channel_keys
        ]
        for block in blocks:
            if block.kind == "links":
                variants = [
                    (f":{marker}", [_cond("channel_message_body", "contains", marker)])
                    for marker in block.value
                ]
            elif block.kind == "hop":
                variants = [("", [_cond("path_hashes", "contains", block.value)])]
            else:  # lockdown
                variants = [("", [])]
            for key in channel_keys:
                for suffix, extra in variants:
                    rules.append(
                        self.rule(
                            f"{block.key}:{key}{suffix}",
                            [_IS_GROUP_TEXT, self.channel(key), *extra],
                        )
                    )
        return rules


def render(
    detector: SpamDetector,
    dialect: Dialect,
    *,
    preview: bool = False,
    channels: Collection[str] | None = None,
) -> RuleSet:
    """The rule set that enforces the detector's current blocks on one backend.

    ``preview`` renders what Protect mode would apply whatever the current mode,
    for showing the user; it must never be handed to a backend.

    ``channels``, when given, is the set of channel keys that may appear in a
    rule: a block on any other channel is left out. An OpenHop rule carries the
    channel key itself, so a private channel is only rendered for OpenHop once
    the user agreed to that.
    """
    out = RuleSet()
    config = detector.config
    if not preview and (config.paused or config.mode != "protect"):
        return out

    renderer = _Renderer(detector, dialect)
    active = [
        b
        for b in detector.ordered_blocks()
        if not b.observe and (channels is None or b.channel is None or b.channel in channels)
    ]
    limit = detector.tunables.max_total_rules
    for block in active:
        if detector.gated(block):
            continue
        rules = renderer.plain(block)
        if len(out.before) + len(rules) > limit:
            out.truncated = True
            break
        out.before += rules

    gated = sorted((b for b in active if detector.gated(b)), key=lambda b: b.created)
    channel_keys = sorted(
        channel.key for channel in config.channels if channels is None or channel.key in channels
    )
    if gated and channel_keys:
        out.known_senders = detector.known_names()
        out.after += renderer.gated(
            [b for b in gated if b.kind != "suffix"], channel_keys, out.known_senders
        )
    for block in gated:
        if block.kind == "suffix":
            out.after += renderer.suffix(block)
    return out
