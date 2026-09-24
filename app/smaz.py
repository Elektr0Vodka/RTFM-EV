"""SMAZ-compressed message bodies ("s:<base64>").

meshcore-open can send DM and channel text SMAZ-compressed, base64-encoded and
prefixed with ``s:``. This decodes those bodies on receive so stored text,
mentions and reaction hashes work on the readable message.

Ported from meshcore-open ``lib/helpers/smaz.dart``
(https://github.com/zjs81/meshcore-open, MIT License, Copyright (c) 2025 zjs81).

Stream format: bytes 0-253 index ``CODEBOOK``; 254 is followed by one verbatim
byte; 255 is followed by a length byte ``n`` and then ``n + 1`` verbatim bytes.
"""

import base64
import binascii

# fmt: off
CODEBOOK: tuple[str, ...] = (
    " ", "the", "e", "t", "a", "of", "o", "and", "i", "n", "s", "e ", "r", " th", " t", "in",
    "he", "th", "h", "he ", "to", "\r\n", "l", "s ", "d", " a", "an", "er", "c", " o", "d ",
    "on", " of", "re", "of ", "t ", ", ", "is", "u", "at", "   ", "n ", "or", "which", "f",
    "m", "as", "it", "that", "\n", "was", "en", "  ", " w", "es", " an", " i", "\r", "f ", "g",
    "p", "nd", " s", "nd ", "ed ", "w", "ed", "http://", "for", "te", "ing", "y ", "The", " c",
    "ti", "r ", "his", "st", " in", "ar", "nt", ",", " to", "y", "ng", " h", "with", "le",
    "al", "to ", "b", "ou", "be", "were", " b", "se", "o ", "ent", "ha", "ng ", "their", '"',
    "hi", "from", " f", "in ", "de", "ion", "me", "v", ".", "ve", "all", "re ", "ri", "ro",
    "is ", "co", "f t", "are", "ea", ". ", "her", " m", "er ", " p", "es ", "by", "they", "di",
    "ra", "ic", "not", "s, ", "d t", "at ", "ce", "la", "h ", "ne", "as ", "tio", "on ", "n t",
    "io", "we", " a ", "om", ", a", "s o", "ur", "li", "ll", "ch", "had", "this", "e t", "g ",
    "e\r\n", " wh", "ere", " co", "e o", "a ", "us", " d", "ss", "\n\r\n", "\r\n\r", '="',
    " be", " e", "s a", "ma", "one", "t t", "or ", "but", "el", "so", "l ", "e s", "s,", "no",
    "ter", " wa", "iv", "ho", "e a", " r", "hat", "s t", "ns", "ch ", "wh", "tr", "ut", "/",
    "have", "ly ", "ta", " ha", " on", "tha", "-", " l", "ati", "en ", "pe", " re", "there",
    "ass", "si", " fo", "wa", "ec", "our", "who", "its", "z", "fo", "rs", ">", "ot", "un", "<",
    "im", "th ", "nc", "ate", "><", "ver", "ad", " we", "ly", "ee", " n", "id", " cl", "ac",
    "il", "</", "rt", " wi", "div", "e, ", " it", "whi", " ma", "ge", "x", "e c", "men",
    ".com",
)
# fmt: on

_VERBATIM_SINGLE = 254
_VERBATIM_RUN = 255
_CODEBOOK_BYTES = tuple(entry.encode("ascii") for entry in CODEBOOK)
_MAX_ENTRY_LEN = max(len(entry) for entry in _CODEBOOK_BYTES)
_PREFIX = "s:"


def decompress(data: bytes) -> bytes:
    """Expand a SMAZ stream. Raises ``ValueError`` on a truncated stream."""
    out = bytearray()
    index = 0
    while index < len(data):
        code = data[index]
        if code == _VERBATIM_SINGLE:
            if index + 1 >= len(data):
                raise ValueError("Invalid SMAZ stream: truncated verbatim byte")
            out.append(data[index + 1])
            index += 2
        elif code == _VERBATIM_RUN:
            if index + 1 >= len(data):
                raise ValueError("Invalid SMAZ stream: truncated verbatim length")
            end = index + 2 + data[index + 1] + 1
            if end > len(data):
                raise ValueError("Invalid SMAZ stream: truncated verbatim run")
            out += data[index + 2 : end]
            index = end
        else:
            out += _CODEBOOK_BYTES[code]
            index += 1
    return bytes(out)


def compress(data: bytes) -> bytes:
    """Greedy longest-match SMAZ encoding, byte-for-byte the meshcore-open encoder.

    Used here only to check that a received body is canonical; the backend does
    not send SMAZ.
    """
    out = bytearray()
    verbatim = bytearray()

    def flush_verbatim() -> None:
        if not verbatim:
            return
        if len(verbatim) == 1:
            out.append(_VERBATIM_SINGLE)
            out.append(verbatim[0])
        else:
            out.append(_VERBATIM_RUN)
            out.append(len(verbatim) - 1)
            out.extend(verbatim)
        verbatim.clear()

    index = 0
    while index < len(data):
        max_len = min(len(data) - index, _MAX_ENTRY_LEN)
        best_len = 0
        best_code = -1
        for code, entry in enumerate(_CODEBOOK_BYTES):
            entry_len = len(entry)
            if entry_len > max_len or entry_len <= best_len:
                continue
            if data.startswith(entry, index):
                best_len = entry_len
                best_code = code
                if best_len == max_len:
                    break
        if best_code >= 0:
            flush_verbatim()
            out.append(best_code)
            index += best_len
            continue
        verbatim.append(data[index])
        index += 1
        if len(verbatim) == 256:
            flush_verbatim()
    flush_verbatim()
    return bytes(out)


def _decode_base64_flexible(encoded: str) -> bytes:
    """Standard base64, or base64url with optional padding."""
    trimmed = encoded.strip()
    try:
        return base64.b64decode(trimmed, validate=True)
    except (binascii.Error, ValueError):
        normalized = trimmed.replace("-", "+").replace("_", "/")
        normalized += "=" * (-len(normalized) % 4)
        return base64.b64decode(normalized, validate=True)


def try_decode_prefixed(text: str) -> str | None:
    """Return the decoded text of an ``s:<base64>`` SMAZ body, else ``None``.

    Stricter than meshcore-open on purpose, because the decoded text replaces
    the original in storage: the output must be valid UTF-8, the body must be
    exactly what the meshcore-open encoder produces for that text, and it must
    be shorter than that text (the encoder only compresses when it saves bytes).
    A plain message such as ``s:test`` (valid base64, decodable stream) is left
    alone.
    """
    trimmed = text.lstrip()
    if not trimmed.startswith(_PREFIX) or len(trimmed) <= len(_PREFIX):
        return None
    try:
        packed = _decode_base64_flexible(trimmed[len(_PREFIX) :])
        if not packed:
            return None
        raw = decompress(packed)
        decoded = raw.decode("utf-8")
    except (binascii.Error, ValueError):
        return None
    if compress(raw) != packed:
        return None
    # meshcore-open only sends "s:" when it is strictly shorter than the plain text.
    if len(_PREFIX) + len(base64.b64encode(packed)) >= len(raw):
        return None
    return decoded


def decode_message_text(text: str) -> str:
    """Decoded text for an ``s:`` SMAZ body; any other text is returned unchanged."""
    decoded = try_decode_prefixed(text)
    return text if decoded is None else decoded
