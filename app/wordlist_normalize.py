"""Canonical normalizer for channel-finder wordlists.

Conforms each entry to the MeshCore hashtag-room name charset: lowercase
``[a-z0-9-]``, no leading/trailing/double hyphens, max 30 characters (the
channel key is the first 16 bytes of ``SHA256("#" + name)``). Anything outside
this charset can never match a real hashtag room, so it is stripped. Used both
for user uploads (server-side) and to pre-normalize the bundled Dutch list.
"""

import re

MAX_ROOM_NAME_LEN = 30

_INVALID = re.compile(r"[^a-z0-9-]")
_MULTI_HYPHEN = re.compile(r"-{2,}")


def normalize_word(raw: str) -> str | None:
    """Normalize a single candidate. Returns None if it cannot be a valid name."""
    word = raw.strip().lower()
    word = _INVALID.sub("", word)
    word = _MULTI_HYPHEN.sub("-", word)
    word = word.strip("-")
    if not word or len(word) > MAX_ROOM_NAME_LEN:
        return None
    return word


def normalize_wordlist_text(raw: str) -> list[str]:
    """Normalize a whole file's text into a deduplicated, ordered word list."""
    out: list[str] = []
    seen: set[str] = set()
    for line in raw.splitlines():
        word = normalize_word(line)
        if word is None or word in seen:
            continue
        seen.add(word)
        out.append(word)
    return out
