"""Tests for scripts/i18n/pull_translations.py (no network)."""

import hashlib
import importlib.util
from pathlib import Path

import pytest

_PATH = Path(__file__).resolve().parent.parent / "scripts" / "i18n" / "pull_translations.py"
_spec = importlib.util.spec_from_file_location("pull_translations", _PATH)
pt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pt)

EN = {
    "_meta": {"locale": "en"},
    "a": "Send",
    "b": "Hi {name}",
    "c": {"one": "{count} node", "other": "{count} nodes"},
    "d": "Map",
}


def test_build_prefers_release_then_current_then_english():
    cat, stats = pt.build_catalog(EN, {"a": "Verzenden"}, {"d": "Kaart"})
    assert list(cat) == ["a", "b", "c", "d"]
    assert cat == {"a": "Verzenden", "b": "Hi {name}", "c": EN["c"], "d": "Kaart"}
    assert stats == {"release": 1, "kept": 1, "english": 2}


def test_build_keeps_current_value_missing_from_release():
    cat, _ = pt.build_catalog(EN, {}, {"a": "Versturen"})
    assert cat["a"] == "Versturen"


def test_build_rejects_placeholder_mismatch():
    cat, _ = pt.build_catalog(EN, {"b": "Hoi {naam}"}, {})
    assert cat["b"] == "Hi {name}"


def test_build_rejects_shape_mismatch():
    cat, _ = pt.build_catalog(
        EN, {"a": {"other": "x"}, "c": "1 node"}, {"c": {"one": "{count} knoop"}}
    )
    assert cat["a"] == "Send" and cat["c"] == EN["c"]


def test_build_drops_keys_not_in_en():
    cat, _ = pt.build_catalog(EN, {"gone": "weg"}, {"old": "oud"})
    assert "gone" not in cat and "old" not in cat


def test_plural_may_drop_count():
    assert pt.usable({"one": "één node", "other": "{count} nodes"}, EN["c"])


def test_parse_and_verify_sha256():
    digest = hashlib.sha256(b"x").hexdigest()
    assert pt.parse_sha256(f"{digest.upper()}  rtfm-ev-i18n.tar.gz\n") == digest
    pt.verify_sha256(b"x", digest)
    with pytest.raises(SystemExit):
        pt.verify_sha256(b"y", digest)
    with pytest.raises(SystemExit):
        pt.parse_sha256("not-a-hash  file")
