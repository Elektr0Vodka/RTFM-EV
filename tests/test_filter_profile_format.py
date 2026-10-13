"""Tests for the filter profile file format."""

import json

import pytest

from app.filter_profiles.format import (
    FORMAT,
    MAX_FILE_BYTES,
    clean_name,
    export_document,
    export_filename,
    parse_profile,
)
from app.filter_profiles.kinds import ProfileError

FILE = {
    "format": "rtfm-ev-filter-profile",
    "version": 1,
    "kind": "spam_guard",
    "name": "Spam wave",
    "description": "Strict detection, Protect mode",
    "updated": "2026-10-14",
    "payload": {"mode": "protect", "sensitivity": "strict", "overrides": {"dedupe_seconds": 3600}},
}


def refusal(raw) -> ProfileError:
    with pytest.raises(ProfileError) as caught:
        parse_profile(raw)
    return caught.value


def test_a_valid_file():
    parsed = parse_profile(json.dumps(FILE))
    assert (parsed.kind, parsed.name, parsed.description) == (
        "spam_guard",
        "Spam wave",
        "Strict detection, Protect mode",
    )
    assert parsed.payload == FILE["payload"]


def test_description_and_updated_are_optional():
    data = {k: v for k, v in FILE.items() if k not in ("description", "updated")}
    parsed = parse_profile(json.dumps(data))
    assert (parsed.description, parsed.updated) == ("", None)


def test_the_name_is_trimmed():
    assert parse_profile(json.dumps({**FILE, "name": "  Spam wave "})).name == "Spam wave"


def test_a_byte_order_mark_is_accepted():
    text = json.dumps(FILE)
    assert parse_profile("﻿" + text).name == "Spam wave"
    assert parse_profile(b"\xef\xbb\xbf" + text.encode()).name == "Spam wave"


@pytest.mark.parametrize(
    ("raw", "code"),
    [
        ("{broken", "not_json"),
        (b"\xff\xfe\x00", "not_json"),
        ("[" * 100_000, "not_json"),
        ("[1, 2]", "not_a_profile"),
        ("7", "not_a_profile"),
        (json.dumps({**FILE, "format": "rtfm-ev-bot-list"}), "not_a_profile"),
        (json.dumps({k: v for k, v in FILE.items() if k != "format"}), "not_a_profile"),
        (json.dumps({**FILE, "version": 2}), "unsupported_version"),
        (json.dumps({**FILE, "version": "1"}), "unsupported_version"),
        (json.dumps({**FILE, "version": True}), "unsupported_version"),
        (json.dumps({k: v for k, v in FILE.items() if k != "version"}), "unsupported_version"),
    ],
)
def test_refusals(raw, code):
    error = refusal(raw)
    assert (error.code, error.status) == (code, 400)
    assert error.detail == code


@pytest.mark.parametrize(
    ("change", "where"),
    [
        ({"extra": 1}, "extra"),
        ({"name": ""}, "name"),
        ({"name": "   "}, "name"),
        ({"name": "x" * 65}, "name"),
        ({"description": "x" * 257}, "description"),
        ({"kind": ""}, "kind"),
        ({"payload": [1]}, "payload"),
        ({"payload": None}, "payload"),
    ],
)
def test_an_invalid_document_names_the_field(change, where):
    error = refusal(json.dumps({**FILE, **change}))
    assert error.code == "invalid_file"
    assert error.message.startswith(f"{where}: ")
    assert error.detail == f"invalid_file: {error.message}"


def test_a_missing_payload_is_refused():
    error = refusal(json.dumps({k: v for k, v in FILE.items() if k != "payload"}))
    assert (error.code, error.message.split(":")[0]) == ("invalid_file", "payload")


def test_too_large():
    padded = json.dumps({**FILE, "description": "x" * MAX_FILE_BYTES})
    assert refusal(padded).code == "too_large"
    assert refusal(padded.encode()).code == "too_large"


def test_clean_name():
    assert clean_name("  a b ") == "a b"
    with pytest.raises(ValueError):
        clean_name(" \t ")


def test_export_document_round_trips():
    row = {
        "id": 3,
        "kind": "spam_guard",
        "name": "Spam wave",
        "description": "d",
        "source": "local",
        "payload": FILE["payload"],
        "created_at": 1_800_000_000,
        "updated_at": 1_800_000_000,
    }
    document = export_document(row)
    assert list(document) == [
        "format",
        "version",
        "kind",
        "name",
        "description",
        "updated",
        "payload",
    ]
    assert (document["format"], document["version"]) == (FORMAT, 1)
    assert document["updated"] == "2027-01-15"
    parsed = parse_profile(json.dumps(document))
    assert (parsed.name, parsed.payload) == ("Spam wave", FILE["payload"])


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("Spam wave", "rtfm-ev-profile-spam_guard-spam-wave.json"),
        ("  Evénement / 2026!  ", "rtfm-ev-profile-spam_guard-ev-nement-2026.json"),
        ("🚨🚨", "rtfm-ev-profile-spam_guard-profile.json"),
        ("Шторм", "rtfm-ev-profile-spam_guard-profile.json"),
        ("x" * 64, f"rtfm-ev-profile-spam_guard-{'x' * 40}.json"),
    ],
)
def test_export_filename_is_plain_ascii(name, expected):
    filename = export_filename("spam_guard", name)
    assert filename == expected
    filename.encode("ascii")
    assert '"' not in filename and "/" not in filename and "\\" not in filename
