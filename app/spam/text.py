"""Text analysis for Spam Guard (pure, no I/O).

Everything the detector needs to compare channel messages and judge sender
names: a normalised form that survives the usual tricks for making copies of
one message look different (case, look-alike letters, leetspeak, invisible
characters, emoji sprinkled in), a similarity test on that form, a "how
generated does this name look" score, and the shared text or shared words of a
set of copies, which is what a forwarding rule can match on.

Behaviour is modelled on openhop-spamguard (flackrat/openhop-spamguard); the
code is our own.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Sequence
from difflib import SequenceMatcher

# Invisible characters. U+200C / U+200D are legitimate joiners (inside emoji and
# some scripts), so they only count as hidden text between two ASCII characters.
_ZERO_WIDTH = "​‌‍⁠﻿­᠎"
_ZERO_WIDTH_TABLE = dict.fromkeys(map(ord, _ZERO_WIDTH))
_ALWAYS_HIDDEN = re.compile("[​⁠﻿­᠎]")
_HIDDEN_IN_WORD = re.compile(f"[A-Za-z0-9][{_ZERO_WIDTH}]+[A-Za-z0-9]")

# Unicode "tag" letters: invisible, abused to hide text. Subdivision flags
# (black flag + tag letters + cancel tag, e.g. England) are their one honest use.
_TAG = re.compile("[\U000e0000-\U000e007f]")
_SUBDIVISION_FLAG = re.compile("\U0001f3f4[\U000e0020-\U000e007e]+\U000e007f")

_EMOJI_BASE_CLASS = "\U0001f000-\U0001faff☀-➿⬀-⯿⌀-⏿〰〽㊗㊙"
# Pieces that modify or join emoji without being one: skin tones, variation
# selectors, the joiner, the keycap mark and tag letters.
_EMOJI_PART_CLASS = "\U0001f3fb-\U0001f3ff︎️‍⃣\U000e0020-\U000e007f"
_EMOJI_BASE = re.compile(f"[{_EMOJI_BASE_CLASS}]")
_EMOJI_PART = re.compile(f"[{_EMOJI_PART_CLASS}]")
_EMOJI_ANY = re.compile(f"[{_EMOJI_BASE_CLASS}{_EMOJI_PART_CLASS}]")
_EMOJI_IN_WORD = re.compile(f"[A-Za-z][{_EMOJI_BASE_CLASS}{_EMOJI_PART_CLASS}]+[A-Za-z]")

# "@[Rob-M0YNW]": who a reply is addressed to, not part of what it says.
_MENTION = re.compile(r"@\[[^\]\n]{1,48}\]")

# Cyrillic and Greek letters that read as a Latin letter (lower case: applied
# after case folding).
_LOOKALIKES = str.maketrans(
    {
        "а": "a",
        "в": "b",
        "е": "e",
        "к": "k",
        "м": "m",
        "н": "h",
        "о": "o",
        "р": "p",
        "с": "c",
        "т": "t",
        "у": "y",
        "х": "x",
        "ѕ": "s",
        "і": "i",
        "ј": "j",
        "һ": "h",
        "ӏ": "l",
        "ԁ": "d",
        "α": "a",
        "β": "b",
        "ε": "e",
        "ι": "i",
        "κ": "k",
        "ν": "v",
        "ο": "o",
        "ρ": "p",
        "τ": "t",
        "υ": "u",
        "χ": "x",
    }
)
_LEET_DIGITS = str.maketrans("013457", "oieast")
_LEET_SYMBOLS = {"@": "a", "$": "s", "!": "i", "|": "l"}
# Only inside a word: "fr!ends" is leetspeak, "hello!" is punctuation.
_SYMBOL_IN_WORD = re.compile(r"(?<=[a-z0-9])[@$!|](?=[a-z0-9])")
_NON_WORD = re.compile(r"[^a-z0-9]+")

_LATIN = re.compile(r"[A-Za-z]")
_GREEK_OR_CYRILLIC = re.compile("[Ͱ-ϿЀ-ӿ]")

_VOWELS = "aeiouy"
_NAME_SHAPE = re.compile(r"[A-Za-z0-9]{6,16}")
_WORD_THEN_NUMBER = re.compile(r"[A-Z]?[a-z]{2,}\d{1,4}")
_RULE_WORD = re.compile(r"[\w'&+/.-]+")
_WORD_EDGE_PUNCTUATION = ".,!?;:'\"()[]{}-_*~"

# A normalised message with fewer letters and digits than this is described by
# its emoji instead (when it has at least _EMOJI_MESSAGE_MIN of them).
_EMOJI_MESSAGE_MAX_CHARS = 8
_EMOJI_MESSAGE_MIN = 3
MAX_RULE_TEXT = 100


def strip_emoji(text: str) -> str:
    return _EMOJI_ANY.sub("", text)


def emoji_tokens(text: str) -> list[str]:
    """Code points of the base emoji, in order.

    Skin tones, variation selectors and joiners are left out, so colour or tone
    variants of one emoji count as the same.
    """
    return [f"{ord(ch):x}" for ch in text if _EMOJI_BASE.match(ch) and not _EMOJI_PART.match(ch)]


def strip_mentions(text: str) -> str:
    """Replace each ``@[name]`` mention with a line break.

    The break keeps shared text from spanning a mention, so every piece is a
    real, unbroken part of the message.
    """
    return _MENTION.sub("\n", text)


def longest_piece(text: str) -> str:
    return max((piece.strip() for piece in text.split("\n")), key=len, default="")


def normalise(text: str) -> str:
    """The comparison form of a message body.

    Lower-case Latin letters and digits separated by single spaces, with
    mentions, emoji and invisible characters gone and look-alike letters and
    leetspeak folded. A message that is (nearly) all emoji is described by its
    base emoji instead, so emoji-only spam can still be grouped.
    """
    folded = _TAG.sub("", _MENTION.sub(" ", text))
    folded = unicodedata.normalize("NFKC", folded).translate(_ZERO_WIDTH_TABLE).casefold()
    folded = "".join(
        ch for ch in unicodedata.normalize("NFKD", folded) if not unicodedata.combining(ch)
    )
    folded = folded.translate(_LOOKALIKES)
    folded = _SYMBOL_IN_WORD.sub(lambda m: _LEET_SYMBOLS[m.group()], folded)
    words = _NON_WORD.sub(" ", folded.translate(_LEET_DIGITS)).strip()
    if len(words.replace(" ", "")) < _EMOJI_MESSAGE_MAX_CHARS:
        emoji = emoji_tokens(text)
        if len(emoji) >= _EMOJI_MESSAGE_MIN:
            return f"emoji {' '.join(emoji)} {words}".strip()
    return words


def shingles(norm: str, n: int = 4) -> frozenset[str]:
    """Every ``n``-character window of a normalised text, spaces removed."""
    joined = norm.replace(" ", "")
    if len(joined) <= n:
        return frozenset([joined]) if joined else frozenset()
    return frozenset(joined[i : i + n] for i in range(len(joined) - n + 1))


def similar(a: frozenset[str], b: frozenset[str], threshold: float) -> bool:
    """Whether two shingle sets are the same message for ``threshold`` (0..1).

    Containment in the smaller set is what counts, so a copy padded with extra
    words still matches its original; the union and size checks keep a short
    text from matching every long one that happens to contain it.
    """
    if not a or not b:
        return False
    small, big = (a, b) if len(a) <= len(b) else (b, a)
    if len(small) / len(big) < threshold * 0.5:
        return False
    shared = len(a & b)
    return shared / len(small) >= threshold and shared / len(a | b) >= threshold * 0.6


def is_disguised(text: str, *, name: bool = False) -> bool:
    """Whether a text uses tricks that make copies look different.

    Invisible tag letters, hidden characters, an emoji wedged inside a word, or
    a Latin word with Greek or Cyrillic letters mixed in. Ordinary emoji between
    words and joiners inside emoji are fine. For a sender name (``name=True``) a
    symbol inside the name is styling and does not count.
    """
    if _TAG.search(_SUBDIVISION_FLAG.sub("", text)):
        return True
    if _ALWAYS_HIDDEN.search(text) or _HIDDEN_IN_WORD.search(text):
        return True
    if not name and _EMOJI_IN_WORD.search(text):
        return True
    return any(
        _LATIN.search(word) and _GREEK_OR_CYRILLIC.search(word) for word in re.findall(r"\w+", text)
    )


def _longest_run(pattern: str, text: str) -> int:
    return max((len(run) for run in re.findall(pattern, text)), default=0)


def _vowel_share(letters: str) -> float:
    return sum(ch in _VOWELS for ch in letters) / max(len(letters), 1)


def _switches(kinds: Sequence[bool]) -> int:
    return sum(1 for a, b in zip(kinds, kinds[1:], strict=False) if a != b)


def _reads_as_word(plain: str) -> bool:
    """Lower-case leetspeak that is a pronounceable word once the digits are undone."""
    if plain[1:] != plain[1:].lower() or not re.search(r"\d", plain):
        return False
    word = plain.lower().translate(_LEET_DIGITS)
    return (
        word.isalpha() and _vowel_share(word) >= 0.25 and _longest_run(f"[^{_VOWELS}]+", word) <= 3
    )


def name_score(name: str, patterns: Sequence[re.Pattern[str]] = ()) -> int:
    """How machine-generated a sender name looks, 0 (a person) to 6.

    Emoji are ignored, so adding one does not hide a random name and a genuine
    name is not marked down for having one. Only single-word names of letters
    and digits are judged on their shape; "Dave M" or "BOT-01-X" are left alone.
    ``patterns`` are extra full-match expressions that add to the score.
    """
    raw = name.strip()
    plain = strip_emoji(raw).strip()
    if raw and not plain:
        return 3 if len(set(emoji_tokens(raw))) >= 3 else 1

    score = 2 if any(p.fullmatch(plain) for p in patterns) else 0
    if not _NAME_SHAPE.fullmatch(plain):
        return score
    if _WORD_THEN_NUMBER.fullmatch(plain) or _reads_as_word(plain):
        return 1

    letters = "".join(ch for ch in plain if ch.isalpha())
    low = letters.lower()
    if letters and len(letters) < len(plain):
        score += 1
    if _switches([ch.isdigit() for ch in plain]) >= 3:
        score += 1
    if len(low) >= 4 and _vowel_share(low) < 0.15:
        score += 1
    if _longest_run(f"[^{_VOWELS}]+", low) >= 4:
        score += 1
    if (len(letters) >= 5 and letters.isupper()) or _switches(
        [ch.isupper() for ch in letters]
    ) >= 4:
        score += 1
    return min(score, 6)


def middle_piece(text: str, length: int) -> str:
    """Whole words from the middle of a text, at most ``length`` characters.

    The middle is what survives when a spammer adds words at either end.
    """
    stripped = text.strip()
    if len(stripped) <= length:
        return stripped
    start = (len(stripped) - length) // 2
    if start > 0 and not stripped[start - 1].isspace():
        space = stripped.find(" ", start, start + 12)
        if space != -1:
            start = space + 1
    end = min(len(stripped), start + length)
    if end < len(stripped) and not stripped[end].isspace():
        space = stripped.rfind(" ", start + length // 2, end)
        if space != -1:
            end = space
    return stripped[start:end].strip()


def rule_length(text: str) -> int:
    """Length for "is this long enough to be a rule": an emoji counts as three.

    A run of emoji can then form a rule, while a single thumbs-up never does.
    """
    return len(strip_emoji(text)) + 3 * len(emoji_tokens(text))


def _drop_partial_words(common: str, text: str) -> str:
    """Trim ``common`` where it starts or ends inside a word of ``text``."""
    at = text.find(common)
    if at == -1:
        return common
    if at > 0 and text[at - 1].isalnum() and common[:1].isalnum():
        common = common.split(" ", 1)[1] if " " in common else ""
        at = text.find(common)
    end = at + len(common)
    if at >= 0 and end < len(text) and text[end].isalnum() and common[-1:].isalnum():
        common = common.rsplit(" ", 1)[0] if " " in common else ""
    return common


def shared_text(texts: Sequence[str], minimum: int) -> str | None:
    """The longest text every copy contains, as whole words, or None.

    This is what a ``contains`` rule can match. ``minimum`` is the shortest
    result worth having, in ``rule_length`` units.
    """
    if not texts:
        return None
    common = texts[0]
    for other in texts[1:]:
        match = SequenceMatcher(None, common, other, autojunk=False).find_longest_match(
            0, len(common), 0, len(other)
        )
        common = common[match.a : match.a + match.size]
        if rule_length(common) < minimum:
            return None
    for text in texts:
        common = _drop_partial_words(common, text)
    common = common.strip()
    if len(common) > MAX_RULE_TEXT:
        common = middle_piece(common, MAX_RULE_TEXT)
    return common if rule_length(common) >= minimum else None


def _rule_words(text: str) -> list[str]:
    words = []
    for word in strip_emoji(text).split():
        word = word.strip(_WORD_EDGE_PUNCTUATION)
        if len(word) >= 4 and _RULE_WORD.fullmatch(word):
            words.append(word)
    return words


def shared_words(texts: Sequence[str], minimum: int, most: int = 4) -> list[str] | None:
    """The longest words every copy contains, exactly as written, or None.

    A rule requiring all of them catches copies where emoji or symbols move
    around between the words. Needs at least three words totalling ``minimum``
    characters; returned in the order they appear in the first copy.
    """
    if len(texts) < 2:
        return None
    first = texts[0]
    shared = [w for w in dict.fromkeys(_rule_words(first)) if all(w in t for t in texts[1:])]
    shared.sort(key=len, reverse=True)
    picked = shared[:most]
    if len(picked) < 3 or sum(map(len, picked)) < minimum:
        return None
    return sorted(picked, key=first.find)


def hops_related(a: str, b: str) -> bool:
    """Same repeater at different hash widths: ``27`` relates to ``27AB``."""
    return a.startswith(b) or b.startswith(a)
