"""Sender name patterns of the chat 'Hide by name pattern' filter.

Some senders change their name for every message (``Adriaan257``, ``Adriaan502``),
so a list of exact names cannot catch them. The operator lists regular
expressions instead (``app_settings.name_filter_patterns``). A pattern has to
match the whole name and ignores case. The result is stored on the message
(``messages.name_filtered``, migration _167) like the malformed flag; the chat
filter (``app_settings.hide_name_filtered``) hides flagged messages and keeps
them out of unread counts, mentions and Web Push.
"""

import logging
import re
from collections.abc import Iterable, Sequence
from functools import lru_cache

from app.reaction_payloads import channel_sender

logger = logging.getLogger(__name__)

MAX_PATTERNS = 16
MAX_PATTERN_LENGTH = 128


def clean_patterns(patterns: Iterable[str]) -> list[str]:
    """Trimmed patterns without blanks or repeats; ValueError names a bad one."""
    cleaned: list[str] = []
    for raw in patterns:
        pattern = raw.strip()
        if not pattern or pattern in cleaned:
            continue
        if len(pattern) > MAX_PATTERN_LENGTH:
            raise ValueError(f"A name pattern is at most {MAX_PATTERN_LENGTH} characters long")
        try:
            re.compile(pattern)
        except re.error as exc:
            raise ValueError(f"Invalid name pattern '{pattern}': {exc}") from exc
        cleaned.append(pattern)
    if len(cleaned) > MAX_PATTERNS:
        raise ValueError(f"At most {MAX_PATTERNS} name patterns")
    return cleaned


@lru_cache(maxsize=8)
def _compiled(patterns: tuple[str, ...]) -> tuple[re.Pattern[str], ...]:
    compiled: list[re.Pattern[str]] = []
    for pattern in patterns:
        try:
            compiled.append(re.compile(pattern, re.IGNORECASE))
        except re.error:
            # Saved patterns are checked, so this is a hand-edited database.
            logger.warning("Skipping invalid name pattern %r", pattern)
    return tuple(compiled)


def name_matches(name: str, patterns: Sequence[str]) -> bool:
    """Whether a pattern matches the whole name, ignoring case."""
    return any(pattern.fullmatch(name) for pattern in _compiled(tuple(patterns)))


def shown_sender(sender_name: str | None, text: str) -> str | None:
    """The name chat shows for a channel row.

    A row can be stored without a sender (the decoder rejects a name with
    brackets) while chat still shows the "Sender: " prefix of its text.
    """
    return sender_name or channel_sender(text)
