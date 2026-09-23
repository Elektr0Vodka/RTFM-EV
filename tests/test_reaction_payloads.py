"""Reaction payload detection (backend mirror of the frontend isReactionPayload)."""

import pytest

from app.reaction_payloads import (
    build_reaction_text,
    dart_string_hash,
    is_reaction_text,
    is_valid_reaction_emoji,
    open_reaction_hash,
    parse_any_reaction,
    parse_hash_reaction,
    reaction_matches,
    reaction_target_hash,
)


@pytest.mark.parametrize(
    "text",
    [
        "Bob: @[Me]👍\nABCD1234",
        "Bob: 🔥@[Me]\nabcd1234",
        "Bob: @[Me]❤️\nABCD1234",
        "👍\nABCD1234",
        "r:1a2b:0f",
        "Bob: r:1a2b:00",
        "Bob: @[Me] r:1a2b:00",
        "Bob: @[Me] 👍@[Me]\nABCD1234",
    ],
)
def test_reactions_detected(text):
    assert is_reaction_text(text) is True


@pytest.mark.parametrize(
    "text",
    [
        None,
        "",
        "Bob: @[Me] hi",
        "Bob: @[Me] look\nat this",
        "Bob: ok\nABCD1234",
        "Bob: @[Me]👍\nABCD12345",
        "Bob: @[Me]👍\nABCDU123",
        "Bob: r:1a2b:0",
    ],
)
def test_non_reactions_not_detected(text):
    assert is_reaction_text(text) is False


# Real channel traffic: reactions whose hash was matched against the stored
# target. The hash covers the body *without* the "Sender: " prefix plus the
# sender timestamp (LE uint32): SHA-256, first 5 bytes, Crockford Base32.
@pytest.mark.parametrize(
    ("body", "sender_timestamp", "expected"),
    [
        ("Test", 1790113549, "3eykm5rn"),
        ("@[corrauder #2 🍃]: Hello! 😁", 1790110910, "gg1bqd4r"),
    ],
)
def test_reaction_target_hash_matches_real_traffic(body, sender_timestamp, expected):
    assert reaction_target_hash(body, sender_timestamp) == expected


@pytest.mark.parametrize(
    ("text", "msg_type", "expected"),
    [
        ("512 A: @[NL-HVS-BK03]👍\nn3nyfd5a", "CHAN", ("👍", "n3nyfd5a", "NL-HVS-BK03")),
        ("512 A: 🔥@[Bob]\nN3NYFD5A", "CHAN", ("🔥", "n3nyfd5a", "Bob")),
        ("👍\nn3nyfd5a", "PRIV", ("👍", "n3nyfd5a", None)),
        ("512 A: hello", "CHAN", None),
        ("r:1a2b:00", "PRIV", None),
    ],
)
def test_parse_hash_reaction(text, msg_type, expected):
    parsed = parse_hash_reaction(text, msg_type)
    if expected is None:
        assert parsed is None
    else:
        assert parsed is not None
        assert (parsed.emoji, parsed.target_hash, parsed.target_sender) == expected


def test_build_channel_reaction_text_matches_wire_format():
    text = build_reaction_text("👍", "Test", 1790113549, "NL-OV-ENS-NL1CTM-TEST")
    assert text == "@[NL-OV-ENS-NL1CTM-TEST]👍\n3eykm5rn"
    parsed = parse_hash_reaction(f"Me: {text}", "CHAN")
    assert parsed is not None and parsed.target_hash == "3eykm5rn"


def test_build_dm_reaction_text_has_no_sender():
    assert build_reaction_text("👍", "Test", 1790113549, None) == "👍\n3eykm5rn"


@pytest.mark.parametrize("emoji", ["👍", "❤️", "👍🏽", "🎉"])
def test_valid_reaction_emoji(emoji):
    assert is_valid_reaction_emoji(emoji)


@pytest.mark.parametrize("emoji", ["", "a", "👍 nice", "👍\n", "@[x]", "👍" * 9])
def test_invalid_reaction_emoji(emoji):
    assert not is_valid_reaction_emoji(emoji)


# meshcore-open hashes use the Dart VM's String.hashCode (runtime/vm/object.h
# StringHasher: seed 0, CombineHashes per UTF-16 code unit, FinalizeHash to 30
# bits, 0 -> 1). No real-traffic vectors exist yet, so these pin the algorithm
# and the exact input construction.
def test_dart_string_hash_empty_is_one():
    assert dart_string_hash("") == 1


def test_dart_string_hash_is_30_bit_and_stable():
    value = dart_string_hash("hello")
    assert 0 < value < (1 << 30)
    assert value == dart_string_hash("hello")
    assert value != dart_string_hash("world")


def test_dart_string_hash_uses_utf16_code_units():
    # An astral emoji is two UTF-16 code units; hashing must see both.
    assert dart_string_hash("😀") != dart_string_hash("\ud83d")


def test_open_reaction_hash_channel_input():
    expected = format(dart_string_hash("1700000000Alicehello") & 0xFFFF, "04x")
    assert open_reaction_hash(1700000000, "Alice", "hello there") == expected


def test_open_reaction_hash_dm_input_omits_sender():
    expected = format(dart_string_hash("1700000000hello") & 0xFFFF, "04x")
    assert open_reaction_hash(1700000000, None, "hello there") == expected


def test_open_reaction_hash_takes_five_utf16_units():
    # "😀😀😀" is 6 UTF-16 units; only the first 5 are hashed (Dart substring).
    expected = format(dart_string_hash("1700000000😀😀\ud83d") & 0xFFFF, "04x")
    assert open_reaction_hash(1700000000, None, "😀😀😀") == expected


@pytest.mark.parametrize(
    ("text", "msg_type", "kind", "target_hash"),
    [
        ("Bob: r:1a2b:00", "CHAN", "open_v3", "1a2b"),
        ("Bob: @[Alice] r:1a2b:05", "CHAN", "open_v3", "1a2b"),
        ("r:1a2b:00", "PRIV", "open_v3", "1a2b"),
        ("Bob: r:1700000000123_12345_67890:👍", "CHAN", "open_v1", None),
        ("Bob: @[Alice]👍\nn3nyfd5a", "CHAN", "hash", "n3nyfd5a"),
    ],
)
def test_parse_any_reaction_dialects(text, msg_type, kind, target_hash):
    parsed = parse_any_reaction(text, msg_type)
    assert parsed is not None
    assert parsed.kind == kind
    if target_hash is not None:
        assert parsed.target_hash == target_hash


def test_parse_open_v1_fields():
    parsed = parse_any_reaction("Bob: r:1700000000123_12345_67890:👍", "CHAN")
    assert parsed is not None
    assert (parsed.v1_timestamp, parsed.v1_name_hash, parsed.v1_text_hash) == (
        1700000000,
        12345,
        67890,
    )
    assert parsed.emoji == "👍"


def test_open_v1_is_a_reaction_for_mentions():
    assert is_reaction_text("Bob: @[Me] r:1700000000123_12345_67890:👍")


def test_reaction_target_hash_matches_other_client_vector():
    # Known-answer vector from the other client's reaction tests.
    assert reaction_target_hash("Hello world!", 1234567890) == "tyvbkb33"


def test_reaction_matches_reply_with_prefix_stripped():
    # meshcore-open strips a leading "@[Name] " reply prefix before hashing.
    reaction = parse_any_reaction(
        f"Bob: r:{open_reaction_hash(1700000000, 'Alice', 'thanks!')}:00", "CHAN"
    )
    assert reaction is not None
    assert reaction_matches(
        reaction,
        body="@[Bob] thanks!",
        sender_name="Alice",
        sender_timestamp=1700000000,
        is_channel=True,
    )
