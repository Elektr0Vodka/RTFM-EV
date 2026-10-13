"""Tests for the bot list file format."""

import json

import pytest

from app.bot_lists.format import (
    MAX_ENTRIES,
    MAX_FILE_BYTES,
    BotListFormatError,
    parse_bot_list,
)


def _doc(**over):
    doc = {
        "format": "rtfm-ev-bot-list",
        "version": 1,
        "name": "Example",
        "entries": [{"name": "PingBot"}],
    }
    doc.update(over)
    return doc


def test_parses_a_minimal_file():
    parsed = parse_bot_list(json.dumps(_doc()))
    assert parsed.name == "Example"
    assert parsed.description == ""
    assert parsed.updated is None
    assert [(e.name, e.public_key, e.note) for e in parsed.entries] == [("PingBot", None, None)]


def test_keeps_emoji_names_and_lowers_the_key():
    parsed = parse_bot_list(
        json.dumps(_doc(entries=[{"name": "Bot 🤖", "public_key": "AB" * 32, "note": "weather"}]))
    )
    entry = parsed.entries[0]
    assert (entry.name, entry.public_key, entry.note) == ("Bot 🤖", "ab" * 32, "weather")


def test_ignores_unknown_fields():
    parsed = parse_bot_list(json.dumps(_doc(maintainer="someone")))
    assert parsed.name == "Example"


def test_refuses_another_format():
    with pytest.raises(BotListFormatError, match="not a bot list file"):
        parse_bot_list(json.dumps(_doc(format="something-else")))


def test_refuses_another_version():
    with pytest.raises(BotListFormatError, match="unsupported bot list version 2"):
        parse_bot_list(json.dumps(_doc(version=2)))


def test_a_refusal_reads_as_plain_text_without_a_library_prefix():
    with pytest.raises(BotListFormatError) as caught:
        parse_bot_list(json.dumps(_doc(version=2)))
    assert str(caught.value) == "unsupported bot list version 2"

    with pytest.raises(BotListFormatError) as caught:
        parse_bot_list(json.dumps(_doc(entries=[{"name": "PingBot", "public_key": "abc"}])))
    assert str(caught.value) == "entries.0.public_key: a public key is 64 hex characters"


def test_refuses_text_that_is_not_json():
    with pytest.raises(BotListFormatError, match="not valid JSON"):
        parse_bot_list("{nope")


def test_refuses_json_that_is_not_an_object():
    with pytest.raises(BotListFormatError, match="not a bot list object"):
        parse_bot_list("[1, 2]")


def test_refuses_an_empty_name():
    with pytest.raises(BotListFormatError, match="entries.0.name"):
        parse_bot_list(json.dumps(_doc(entries=[{"name": ""}])))


def test_refuses_a_padded_name():
    with pytest.raises(BotListFormatError, match="spaces"):
        parse_bot_list(json.dumps(_doc(entries=[{"name": " PingBot"}])))


def test_refuses_a_bad_public_key():
    with pytest.raises(BotListFormatError, match="64 hex"):
        parse_bot_list(json.dumps(_doc(entries=[{"name": "PingBot", "public_key": "abc"}])))


def test_refuses_a_name_that_appears_twice():
    with pytest.raises(BotListFormatError, match="more than once"):
        parse_bot_list(json.dumps(_doc(entries=[{"name": "PingBot"}, {"name": "PingBot"}])))


def test_treats_names_that_differ_in_case_as_different():
    parsed = parse_bot_list(json.dumps(_doc(entries=[{"name": "PingBot"}, {"name": "pingbot"}])))
    assert len(parsed.entries) == 2


def test_refuses_too_many_entries():
    entries = [{"name": f"bot{i}"} for i in range(MAX_ENTRIES + 1)]
    with pytest.raises(BotListFormatError, match="entries"):
        parse_bot_list(json.dumps(_doc(entries=entries)))


def test_refuses_a_file_that_is_too_large():
    with pytest.raises(BotListFormatError, match="larger than 256 KiB"):
        parse_bot_list(b" " * (MAX_FILE_BYTES + 1))
