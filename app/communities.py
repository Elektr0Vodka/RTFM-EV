"""MeshCore communities: channel keys derived from a shared 32-byte secret.

Port of meshcore-open ``lib/models/community.dart`` (github.com/zjs81/meshcore-open,
MIT). A community is a shared secret ``K`` (32 random bytes) plus a display name,
shared as QR JSON ``{"v":1,"type":"meshcore_community","name":...,"k":<base64url>}``.
From ``K`` every member derives the same channel keys:

- public channel: ``HMAC-SHA256(K, "channel:v1:__public__")[:16]``
- hashtag channel: ``HMAC-SHA256(K, "channel:v1:" + normalized)[:16]``, where
  normalized strips one leading ``#``, lowercases, then trims (same order as
  meshcore-open's ``_normalizeCommunityHashtag``)
- community ID: ``SHA256("community:v1" || K)`` (hex; the short form is the first
  8 hex chars). One-way, so it is safe to display.

Channel names follow meshcore-open: ``"<name> Public"`` and ``"<name> #<tag>"``.

``K`` is a secret. Never log it and never return it except from an explicit export.
"""

import base64
import binascii
import hashlib
import hmac
import json
from dataclasses import dataclass

QR_TYPE = "meshcore_community"
QR_VERSION = 1
SECRET_BYTES = 32
CHANNEL_KEY_BYTES = 16
SHORT_ID_CHARS = 8
# The radio's channel name field holds 32 UTF-8 bytes.
MAX_CHANNEL_NAME_BYTES = 32

_PUBLIC_LABEL = "__public__"


class CommunityError(ValueError):
    """The community payload or hashtag is not valid."""


@dataclass(frozen=True)
class CommunityPayload:
    name: str
    secret: bytes


def _check_secret(secret: bytes) -> None:
    if len(secret) != SECRET_BYTES:
        raise CommunityError(f"Community secret must be {SECRET_BYTES} bytes")


def normalize_hashtag(hashtag: str) -> str:
    """Strip one leading '#', lowercase, then trim (meshcore-open order)."""
    text = hashtag[1:] if hashtag.startswith("#") else hashtag
    return text.lower().strip()


def _derive(secret: bytes, label: str) -> bytes:
    _check_secret(secret)
    digest = hmac.new(secret, f"channel:v1:{label}".encode(), hashlib.sha256).digest()
    return digest[:CHANNEL_KEY_BYTES]


def derive_public_channel_key(secret: bytes) -> bytes:
    return _derive(secret, _PUBLIC_LABEL)


def derive_hashtag_channel_key(secret: bytes, hashtag: str) -> bytes:
    normalized = normalize_hashtag(hashtag)
    if not normalized:
        raise CommunityError("Hashtag is empty")
    return _derive(secret, normalized)


def community_id(secret: bytes) -> str:
    _check_secret(secret)
    return hashlib.sha256(b"community:v1" + secret).hexdigest()


def short_community_id(secret: bytes) -> str:
    return community_id(secret)[:SHORT_ID_CHARS]


def clean_community_name(name: str) -> str:
    """Trim the name and drop leading '#'.

    meshcore_py derives a channel's key from its name when the name starts with
    '#', which would replace the community key when the channel is loaded onto
    the radio. A community name never starts a channel name with '#'.
    """
    return name.strip().lstrip("#").strip()


def _truncate_utf8(text: str, max_bytes: int) -> str:
    return text.encode("utf-8")[:max_bytes].decode("utf-8", errors="ignore").rstrip()


def public_channel_name(community_name: str) -> str:
    """``"<name> Public"``, cut to the radio's 32-byte name field.

    The name is only a label (the key comes from the secret), so a long
    community name is truncated rather than rejected.
    """
    return _truncate_utf8(f"{community_name} Public", MAX_CHANNEL_NAME_BYTES)


def hashtag_display(hashtag: str) -> str:
    """The tag as meshcore-open's add-channel form keeps it: trimmed, one leading '#' removed.

    The channel name uses this verbatim; the key uses ``normalize_hashtag`` of it.
    """
    text = hashtag.strip()
    return text[1:] if text.startswith("#") else text


def hashtag_channel_name(community_name: str, hashtag: str) -> str:
    """``"<name> #<tag>"``. Raises when it does not fit the radio's name field."""
    tag = hashtag_display(hashtag)
    if not normalize_hashtag(tag):
        raise CommunityError("Hashtag is empty")
    name = f"{community_name} #{tag}"
    if len(name.encode("utf-8")) > MAX_CHANNEL_NAME_BYTES:
        raise CommunityError(
            f'Channel name "{name}" is longer than {MAX_CHANNEL_NAME_BYTES} bytes; '
            "use a shorter hashtag"
        )
    return name


def _b64url_decode(value: str) -> bytes:
    """Decode base64url (or standard base64), padded or not."""
    text = value.strip().replace("-", "+").replace("_", "/")
    text += "=" * (-len(text) % 4)
    try:
        return base64.b64decode(text, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise CommunityError("Community key is not valid base64") from exc


def parse_qr_payload(text: str) -> CommunityPayload:
    """Validate community QR JSON and return its name and secret."""
    try:
        data = json.loads(text)
    except (json.JSONDecodeError, TypeError) as exc:
        raise CommunityError("Not valid JSON") from exc
    if not isinstance(data, dict):
        raise CommunityError("Not a community payload")
    if data.get("type") != QR_TYPE:
        raise CommunityError("Not a MeshCore community code")
    version = data.get("v")
    if isinstance(version, bool) or version != QR_VERSION:
        raise CommunityError("Unsupported community code version")
    raw_name = data.get("name")
    if not isinstance(raw_name, str) or not clean_community_name(raw_name):
        raise CommunityError("Community name is missing")
    raw_key = data.get("k")
    if not isinstance(raw_key, str):
        raise CommunityError("Community key is missing")
    secret = _b64url_decode(raw_key)
    if len(secret) != SECRET_BYTES:
        raise CommunityError(f"Community key must decode to {SECRET_BYTES} bytes")
    return CommunityPayload(name=clean_community_name(raw_name), secret=secret)


def format_qr_payload(name: str, secret: bytes) -> str:
    """QR JSON in meshcore-open's key order; ``k`` is padded base64url like Dart's encoder."""
    _check_secret(secret)
    return json.dumps(
        {
            "v": QR_VERSION,
            "type": QR_TYPE,
            "name": name,
            "k": base64.urlsafe_b64encode(secret).decode("ascii"),
        },
        separators=(",", ":"),
        ensure_ascii=False,
    )
