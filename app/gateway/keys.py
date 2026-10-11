"""Workspace URL keys: which ``/r/<key>/`` belongs to which radio.

Pure functions over the radio list. The URL key is the first 12 hex characters
of the radio's public key. Radios that share a key get ``-2``, ``-3`` in id
order. Longer forms and keys a radio used before redirect to the current key.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.gateway.registry import RadioEntry

URL_KEY_LEN = 12
_HEX = re.compile(r"[0-9a-f]+")


@dataclass(frozen=True)
class Resolution:
    radio_id: int
    # None: serve this radio. Otherwise: redirect to this URL key.
    redirect_key: str | None


def assign_url_keys(radios: list[RadioEntry]) -> dict[int, str]:
    """Radio id -> URL key, for every radio that has reported a public key."""
    keys: dict[int, str] = {}
    seen: dict[str, int] = {}
    for radio in sorted(radios, key=lambda r: r.id):
        if not radio.public_key:
            continue
        base = radio.public_key.lower()[:URL_KEY_LEN]
        count = seen.get(base, 0) + 1
        seen[base] = count
        keys[radio.id] = base if count == 1 else f"{base}-{count}"
    return keys


def resolve(segment: str, radios: list[RadioEntry]) -> Resolution | None:
    """Map the ``<key>`` part of ``/r/<key>/`` to a radio, or None when unknown."""
    wanted = segment.lower()
    current = assign_url_keys(radios)
    by_key = {key: radio_id for radio_id, key in current.items()}
    if wanted in by_key:
        return Resolution(by_key[wanted], None if segment == wanted else wanted)

    if not _HEX.fullmatch(wanted) or not URL_KEY_LEN <= len(wanted) <= 64:
        return None

    ordered = sorted(radios, key=lambda r: r.id)
    for radio in ordered:
        if radio.id in current and radio.public_key and radio.public_key.startswith(wanted):
            return Resolution(radio.id, current[radio.id])
    for radio in ordered:
        if radio.id in current and any(old.startswith(wanted) for old in radio.key_history):
            return Resolution(radio.id, current[radio.id])
    return None
