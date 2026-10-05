"""Malformed channel message detection.

Flags channel spam that is generated rather than typed: random code points
from mixed Unicode blocks, sent by a node whose clock still runs from the
firmware default. The flag is stored on the message (``messages.malformed``,
migration _129) at ingest; the chat 'Hide malformed messages' filter
(``app_settings.hide_malformed``) hides flagged messages and keeps them out of
unread counts, mentions and Web Push. Nothing is dropped.
"""

import unicodedata

# MeshCore's VolatileRTCClock starts here (15 May 2024) until the clock is set
# (src/helpers/ArduinoHelpers.h, ``base_time = 1715770351``).
MESHCORE_DEFAULT_RTC_EPOCH = 1715770351
# How long after the default epoch a sender timestamp still counts as "never
# set": a node that has been up this long without a clock sync.
DEFAULT_CLOCK_WINDOW_SECONDS = 30 * 86400
# A message genuinely sent in that window and received back then is fine; the
# signature is a default-epoch timestamp on a message that arrives much later.
_DEFAULT_CLOCK_MIN_SKEW_SECONDS = 7 * 86400

# Script family of a letter, keyed by the first word of its Unicode name.
# Kana, Han and Hangul share one family because real East Asian text mixes
# them. Letters of scripts not listed here are ignored.
_SCRIPT_FAMILIES = {
    "LATIN": "latin",
    "GREEK": "greek",
    "CYRILLIC": "cyrillic",
    "HEBREW": "hebrew",
    "ARABIC": "arabic",
    "ARMENIAN": "armenian",
    "GEORGIAN": "georgian",
    "THAI": "thai",
    "DEVANAGARI": "devanagari",
    "HIRAGANA": "east_asian",
    "KATAKANA": "east_asian",
    "KATAKANA-HIRAGANA": "east_asian",
    "CJK": "east_asian",
    "HANGUL": "east_asian",
}


def _is_invalid_code_point(code: int) -> bool:
    """Noncharacters, and planes 4-16 other than the tag/variation selector block.

    Purely numeric on purpose: checking the "unassigned" category instead would
    flag every emoji newer than the bundled Unicode tables.
    """
    if (code & 0xFFFE) == 0xFFFE or 0xFDD0 <= code <= 0xFDEF:
        return True
    return code >= 0x40000 and not (0xE0000 <= code <= 0xE01EF)


def is_gibberish_text(body: str) -> bool:
    """Whether a message body looks like random code points rather than text.

    True when the body has no ASCII letter or digit and either contains an
    invalid code point, mixes letters of two or more script families, or mixes
    letters with box-drawing characters. Emoji, punctuation and single-script
    text are left alone.
    """
    if any(ch.isascii() and ch.isalnum() for ch in body):
        return False

    families: set[str] = set()
    has_box_drawing = False
    for ch in body:
        code = ord(ch)
        if code < 0x80:
            continue
        if _is_invalid_code_point(code):
            return True
        if 0x2500 <= code <= 0x257F:
            has_box_drawing = True
            continue
        if not unicodedata.category(ch).startswith("L"):
            continue
        family = _SCRIPT_FAMILIES.get(unicodedata.name(ch, "").split(" ", 1)[0])
        if family:
            families.add(family)

    return len(families) >= 2 or (bool(families) and has_box_drawing)


def has_default_clock(sender_timestamp: int | None, received_at: int) -> bool:
    """Whether the sender's clock still runs from the firmware default epoch."""
    if sender_timestamp is None:
        return False
    since_default = sender_timestamp - MESHCORE_DEFAULT_RTC_EPOCH
    if not 0 <= since_default < DEFAULT_CLOCK_WINDOW_SECONDS:
        return False
    return received_at - sender_timestamp > _DEFAULT_CLOCK_MIN_SKEW_SECONDS


def is_malformed_channel_message(body: str, sender_timestamp: int | None, received_at: int) -> bool:
    """Whether an incoming channel text message should be flagged as malformed.

    *body* is the message text without the ``sender: `` prefix.
    """
    return is_gibberish_text(body) or has_default_clock(sender_timestamp, received_at)
