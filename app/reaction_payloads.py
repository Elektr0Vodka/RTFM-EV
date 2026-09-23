"""Recognize emoji-reaction payloads sent as ordinary mesh text.

Mirrors ``frontend/src/utils/meshcoreOpenPayloads.ts`` (``isReactionPayload``)
so the backend unread-mention flag agrees with the live frontend: a channel
reaction names its target (``@[Name]``) but is not a mention.

Dialects, each whole-body or behind a reply prefix ``@[Name] ``:

- meshcore-open v3 ``r:<4 hex hash>:<2 hex emoji index>``
- meshcore-open v1 ``r:<millis>_<name hash>_<text hash>:<emoji>`` (older clients)
- ``<emoji>@[Name]\\n<hash>`` / ``@[Name]<emoji>\\n<hash>`` (channel) or
  ``<emoji>\\n<hash>`` (DM), where ``<hash>`` is 8 Crockford Base32 chars.
"""

import hashlib
import re
import struct
import unicodedata
from dataclasses import dataclass
from typing import Literal

_R_REACTION = re.compile(r"^r:([0-9a-f]{4}):([0-9a-f]{2})$")
_R_REACTION_V1 = re.compile(r"^r:(\d{1,16})_(\d{1,10})_(\d{1,10}):(\S+)$")
_HASH = re.compile(r"^[0-9a-tv-z]{8}$", re.IGNORECASE)
_CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz"
_HEAD = re.compile(r"^(?:([^@\[\]]+)(?:@\[([^\]]+)\])?|@\[([^\]]+)\](.+))$", re.DOTALL)
_REPLY_PREFIX = re.compile(r"^(@\[[^\]]+\])\s+(.+)$", re.DOTALL)


def _starts_with_emoji(text: str) -> bool:
    # Approximates JS \p{Extended_Pictographic} on the first code point.
    if not text:
        return False
    first = text[0]
    return unicodedata.category(first) == "So" or 0x1F000 <= ord(first) <= 0x1FAFF


@dataclass(frozen=True)
class HashReaction:
    emoji: str
    target_hash: str  # normalized: lowercase Crockford Base32
    target_sender: str | None  # channel reactions name the target's sender


def _normalize_hash(value: str) -> str:
    # Crockford Base32 is case-insensitive and maps O -> 0, I/L -> 1.
    return value.lower().replace("o", "0").replace("i", "1").replace("l", "1")


def _parse_two_line_reaction(text: str) -> HashReaction | None:
    lines = text.strip().split("\n")
    if len(lines) != 2 or not _HASH.match(lines[1].strip()):
        return None
    head = _HEAD.match(lines[0].strip())
    if head is None:
        return None
    emoji = (head.group(1) if head.group(1) is not None else head.group(4)).strip()
    if not _starts_with_emoji(emoji):
        return None
    return HashReaction(
        emoji=emoji,
        target_hash=_normalize_hash(lines[1].strip()),
        target_sender=head.group(2) or head.group(3),
    )


def _is_two_line_reaction(text: str) -> bool:
    return _parse_two_line_reaction(text) is not None


def _is_v1_reaction(body: str) -> bool:
    match = _R_REACTION_V1.match(body.strip())
    return match is not None and _starts_with_emoji(match.group(4))


def _is_reaction_body(body: str) -> bool:
    return (
        _R_REACTION.match(body.strip()) is not None
        or _is_v1_reaction(body)
        or _is_two_line_reaction(body)
    )


def _strip_sender(text: str) -> str:
    # Channel text is stored as "Sender: body" (same rule as parseSenderFromText).
    colon = text.find(": ")
    if 0 < colon < 50 and ":" not in text[:colon]:
        return text[colon + 2 :]
    return text


def message_body(text: str, msg_type: str) -> str:
    """The text a sender typed: channel rows are stored as "Sender: body"."""
    return _strip_sender(text) if msg_type == "CHAN" else text


def reaction_target_hash(body: str, sender_timestamp: int) -> str:
    """Hash a reaction uses to name its target message.

    SHA-256 over the target's body (UTF-8, without the "Sender: " prefix) plus
    its sender timestamp as little-endian uint32; first 5 bytes as 8 Crockford
    Base32 characters. Checked against real channel traffic.
    """
    digest = hashlib.sha256(
        body.encode("utf-8") + struct.pack("<I", sender_timestamp & 0xFFFFFFFF)
    ).digest()
    value = int.from_bytes(digest[:5], "big")
    return "".join(_CROCKFORD[(value >> (35 - 5 * i)) & 31] for i in range(8))


def channel_sender(text: str) -> str | None:
    """Sender name of a stored channel row ("Sender: body"), or None."""
    colon = text.find(": ")
    if 0 < colon < 50 and ":" not in text[:colon]:
        return text[:colon]
    return None


# One emoji "grapheme" can be several code points (skin tones, ZWJ sequences,
# variation selectors); cap the bytes instead of counting characters.
_MAX_REACTION_EMOJI_BYTES = 32


def is_valid_reaction_emoji(emoji: str) -> bool:
    """A single emoji: starts with one, no spaces, delimiters or line breaks."""
    if not emoji or len(emoji.encode("utf-8")) > _MAX_REACTION_EMOJI_BYTES:
        return False
    if any(ch.isspace() or ch in "@[]" or ch.isalnum() for ch in emoji):
        return False
    return _starts_with_emoji(emoji)


def build_reaction_text(
    emoji: str, target_body: str, target_sender_timestamp: int, target_sender: str | None
) -> str:
    """Wire text for a reaction: ``@[Sender]emoji\\nhash`` (channel) or ``emoji\\nhash`` (DM)."""
    target_hash = reaction_target_hash(target_body, target_sender_timestamp)
    if target_sender is None:
        return f"{emoji}\n{target_hash}"
    return f"@[{target_sender}]{emoji}\n{target_hash}"


def parse_hash_reaction(text: str, msg_type: str) -> HashReaction | None:
    """Parse a stored message as a hash-addressed reaction, or None."""
    return _parse_two_line_reaction(message_body(text, msg_type))


def dart_string_hash(value: str) -> int:
    """Dart VM ``String.hashCode``, which meshcore-open's reaction hashes use.

    From the Dart SDK (runtime/vm/object.h ``StringHasher`` + runtime/vm/hash.h):
    seed 0, ``CombineHashes`` per UTF-16 code unit, ``FinalizeHash`` to 30 bits,
    and 0 becomes 1.
    """
    h = 0
    raw = value.encode("utf-16-le", errors="surrogatepass")
    for i in range(0, len(raw), 2):
        h = (h + int.from_bytes(raw[i : i + 2], "little")) & 0xFFFFFFFF
        h = (h + (h << 10)) & 0xFFFFFFFF
        h ^= h >> 6
    h = (h + (h << 3)) & 0xFFFFFFFF
    h ^= h >> 11
    h = (h + (h << 15)) & 0xFFFFFFFF
    h &= (1 << 30) - 1
    return h or 1


def _first_utf16_units(text: str, count: int) -> str:
    # Dart's substring counts UTF-16 code units and can split a surrogate pair.
    return text.encode("utf-16-le", errors="surrogatepass")[: 2 * count].decode(
        "utf-16-le", errors="surrogatepass"
    )


def open_reaction_hash(sender_timestamp: int, sender_name: str | None, body: str) -> str:
    """meshcore-open v3 reaction hash: 4 hex chars.

    ``String.hashCode & 0xFFFF`` of ``"<timestamp secs><sender name><first 5
    UTF-16 units of the body>"``; the sender name is left out in 1:1 DMs.
    """
    source = f"{sender_timestamp}{sender_name or ''}{_first_utf16_units(body, 5)}"
    return format(dart_string_hash(source) & 0xFFFF, "04x")


@dataclass(frozen=True)
class AnyReaction:
    """A received reaction in any supported dialect."""

    kind: Literal["hash", "open_v3", "open_v1"]
    emoji: str | None  # None for open_v3 (index into meshcore-open's emoji table)
    target_hash: str | None
    target_sender: str | None = None
    v1_timestamp: int | None = None
    v1_name_hash: int | None = None
    v1_text_hash: int | None = None


def parse_any_reaction(text: str, msg_type: str) -> AnyReaction | None:
    """Parse a stored message as a reaction in any supported dialect, or None."""
    body = message_body(text, msg_type)
    hashed = _parse_two_line_reaction(body)
    if hashed is not None:
        return AnyReaction("hash", hashed.emoji, hashed.target_hash, hashed.target_sender)

    candidate = body.strip()
    reply = _REPLY_PREFIX.match(candidate)
    for payload in (candidate, reply.group(2).strip() if reply else None):
        if payload is None:
            continue
        v3 = _R_REACTION.match(payload)
        if v3 is not None:
            return AnyReaction("open_v3", None, v3.group(1))
        v1 = _R_REACTION_V1.match(payload)
        if v1 is not None and _starts_with_emoji(v1.group(4)):
            return AnyReaction(
                "open_v1",
                v1.group(4),
                None,
                v1_timestamp=int(v1.group(1)) // 1000,
                v1_name_hash=int(v1.group(2)),
                v1_text_hash=int(v1.group(3)),
            )
    return None


# meshcore-open v1 compares timestamps loosely; allow small clock differences.
_V1_TIMESTAMP_SLACK_SECONDS = 60


def reaction_matches(
    reaction: AnyReaction,
    *,
    body: str,
    sender_name: str | None,
    sender_timestamp: int,
    is_channel: bool,
) -> bool:
    """Whether a candidate message (body without "Sender: ") is the reaction's target.

    meshcore-open strips a leading ``@[Name] `` reply prefix before hashing, the
    other clients hash the full body, so both forms are tried.
    """
    reply = _REPLY_PREFIX.match(body)
    if reply is not None and _matches_body(
        reaction,
        body=reply.group(2),
        sender_name=sender_name,
        sender_timestamp=sender_timestamp,
        is_channel=is_channel,
    ):
        return True
    return _matches_body(
        reaction,
        body=body,
        sender_name=sender_name,
        sender_timestamp=sender_timestamp,
        is_channel=is_channel,
    )


def _matches_body(
    reaction: AnyReaction,
    *,
    body: str,
    sender_name: str | None,
    sender_timestamp: int,
    is_channel: bool,
) -> bool:
    if reaction.kind == "hash":
        return reaction_target_hash(body, sender_timestamp) == reaction.target_hash
    if reaction.kind == "open_v3":
        # Channels hash the target's sender name; 1:1 DMs leave it out, but
        # room-server DMs include it, so try both for DMs.
        if is_channel:
            names: list[str | None] = [sender_name] if sender_name is not None else []
        else:
            names = [None] + ([sender_name] if sender_name else [])
        return any(
            open_reaction_hash(sender_timestamp, name, body) == reaction.target_hash
            for name in names
        )
    if reaction.v1_timestamp is None or reaction.v1_text_hash is None:
        return False
    if abs(sender_timestamp - reaction.v1_timestamp) > _V1_TIMESTAMP_SLACK_SECONDS:
        return False
    if dart_string_hash(body) != reaction.v1_text_hash:
        return False
    if is_channel and sender_name is not None:
        return dart_string_hash(sender_name) == reaction.v1_name_hash
    return True


def is_reaction_text(text: str | None) -> bool:
    """True when a stored message text (channel or DM) is a reaction payload."""
    if not text:
        return False
    body = _strip_sender(text)
    if _is_reaction_body(body):
        return True
    reply = _REPLY_PREFIX.match(body.strip())
    return reply is not None and _is_reaction_body(reply.group(2))
