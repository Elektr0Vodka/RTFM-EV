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

A rule name ends in where its block came from: ``(yours)`` for a block the user
made or kept, ``(duplicate)`` for routine duplicate suppression, ``(auto)`` for
the rest. On an OpenHop node the name is all there is to tell them apart. The
rule id is made from the name without that ending, so it does not change when
a block changes hands.

A bot list (``app/services/bot_lists.py``) can ask for its names to be kept off
the air: ``render(bot_senders=...)`` then puts one drop rule per protected
channel first in ``before``, named ``bots:<channel key> (bot list)``. It is not
a detector block, and it sits ahead of the user's rules and the known-people
allow rules, so a listed bot is dropped even when Spam Guard knows its name.

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
# Second object in the same group: names a bot list asked to keep off the air.
OPENHOP_BOT_SENDERS = "bot_senders"
# Ending of the rule names made for a bot list (not a detector block).
BOT_LIST_ORIGIN = "bot list"
# Host rule ids and names are capped by the host policy model.
MAX_HOST_ID = 64
MAX_NAME = 128
# OpenHop rule ids are integers; ours sit in their own range, derived from the
# rule name so an id is stable for as long as its block exists.
OPENHOP_ID_BASE = 700_000_000
OPENHOP_ID_SPAN = 100_000_000
# Where a block came from, as the ending of its rule names.
_ORIGINS = {"manual": "yours", "lockdown": "yours", "dedupe": "duplicate"}


@dataclass
class RuleSet:
    before: list[dict[str, Any]] = field(default_factory=list)
    after: list[dict[str, Any]] = field(default_factory=list)
    # Names the known-people rules let through (referenced as an object on OpenHop).
    known_senders: list[str] = field(default_factory=list)
    # Names the bot list rules drop (referenced as an object on OpenHop).
    bot_senders: list[str] = field(default_factory=list)
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
        self,
        key: str,
        conditions: list[dict[str, Any]],
        action: str = "drop",
        *,
        block: Block | None = None,
        origin: str | None = None,
    ) -> dict[str, Any]:
        """One rule. ``block`` is the block it enforces; a helper rule has none.

        ``origin`` names where a rule without a block came from.
        """
        name = f"{self.prefix}{key}"
        if origin is None and block is not None:
            origin = _ORIGINS.get(block.source, "auto")
        ending = f" ({origin})" if origin else ""
        return {
            "id": self._id(name),
            "name": f"{name[: MAX_NAME - len(ending)]}{ending}",
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

    def bots(self, key_hex: str, names: list[str]) -> dict[str, Any]:
        """Drop channel text from a listed bot on one protected channel."""
        value: Any = (
            names if self.dialect == "host" else f"@{OPENHOP_OBJECT_GROUP}.{OPENHOP_BOT_SENDERS}"
        )
        return self.rule(
            f"bots:{key_hex}",
            [_IS_GROUP_TEXT, self.channel(key_hex), _cond("channel_sender", "in", value)],
            origin=BOT_LIST_ORIGIN,
        )

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
            # Duplicate suppression: the original sender may re-send their own
            # message, or (``sender_only``) is the only one held back.
            op = "equals" if block.sender_only else "not_equals"
            conditions.append(_cond("channel_sender", op, block.sender))
        return [self.rule(block.key, conditions, block=block)]

    def _hop(self, block: Block) -> list[dict[str, Any]]:
        mode = self.detector.hop_mode(block)
        # A repeater block the user made for one channel only names that channel.
        scope = [_IS_GROUP_TEXT, *([self.channel(block.channel)] if block.channel else [])]
        if mode == "exact_paths":
            return [
                self.rule(
                    f"{block.key}:{path}",
                    [*scope, _cond("path_hashes", "equals", path.split(">"))],
                    block=block,
                )
                for path in block.paths
            ]
        if mode == "starts_at":
            if self.dialect != "host":
                return []  # OpenHop has no first-hop field; never widen a block to make do
            # ``path_first`` is compared as a plain string, and the engine's is lower case.
            return [
                self.rule(
                    block.key,
                    [*scope, _cond("path_first", "equals", block.value.lower())],
                    block=block,
                )
            ]
        return [
            self.rule(
                block.key, [*scope, _cond("path_hashes", "contains", block.value)], block=block
            )
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
                block=block,
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
                block=block,
            )
        )
        return rules

    def gated(
        self,
        blocks: list[Block],
        channel_keys: list[str],
        names: list[str],
        known_channels: list[str],
    ) -> list[dict[str, Any]]:
        """The known-people rule of each channel in ``known_channels``, then the blocks."""
        rules = [
            self.rule(
                f"known-people:{key}",
                [_IS_GROUP_TEXT, self.channel(key), self.known(names)],
                action="allow",
            )
            for key in known_channels
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
                if block.channel is not None and block.channel != key:
                    continue
                for suffix, extra in variants:
                    rules.append(
                        self.rule(
                            f"{block.key}:{key}{suffix}",
                            [_IS_GROUP_TEXT, self.channel(key), *extra],
                            block=block,
                        )
                    )
        return rules


def render(
    detector: SpamDetector,
    dialect: Dialect,
    *,
    preview: bool = False,
    channels: Collection[str] | None = None,
    bot_senders: Collection[str] = (),
) -> RuleSet:
    """The rule set that enforces the detector's current blocks on one backend.

    ``preview`` renders what Protect mode would apply whatever the current mode,
    for showing the user; it must never be handed to a backend.

    ``channels``, when given, is the set of channel keys that may appear in a
    rule: a block on any other channel is left out. An OpenHop rule carries the
    channel key itself, so a private channel is only rendered for OpenHop once
    the user agreed to that.

    ``bot_senders`` are the names a bot list wants kept off the air: one drop
    rule per channel that may appear, ahead of everything else.
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
    channel_keys = sorted(
        channel.key for channel in config.channels if channels is None or channel.key in channels
    )
    names = sorted({name for name in bot_senders if name})
    if names:
        for key in channel_keys:
            if len(out.before) >= limit:
                out.truncated = True
                break
            out.before.append(renderer.bots(key, names))
        if out.before:
            out.bot_senders = names
    for block in active:
        if detector.gated(block):
            continue
        rules = renderer.plain(block)
        if len(out.before) + len(rules) > limit:
            out.truncated = True
            break
        out.before += rules

    gated = sorted((b for b in active if detector.gated(b)), key=lambda b: b.created)
    # A block for one channel needs the known-people rule of that channel only.
    known_channels = [key for key in channel_keys if any(b.channel in (None, key) for b in gated)]
    if known_channels:
        out.known_senders = detector.known_names()
        out.after += renderer.gated(
            [b for b in gated if b.kind != "suffix"],
            channel_keys,
            out.known_senders,
            known_channels,
        )
    for block in gated:
        if block.kind == "suffix":
            out.after += renderer.suffix(block)
    return out
