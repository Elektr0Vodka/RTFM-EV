"""Tests for scripts/i18n/pull_translations.py (no network)."""

import hashlib
import importlib.util
import io
import json
import tarfile
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


def make_tar(members: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name, data in members.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def _dump(data: dict) -> bytes:
    return json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")


def _locales(tmp_path: Path) -> None:
    (tmp_path / "en.json").write_bytes(_dump(EN))
    (tmp_path / "nl.json").write_bytes(_dump({"_meta": {"name": "Nederlands"}, "d": "Kaart"}))
    (tmp_path / "de.json").write_bytes(_dump({"_meta": {"name": "Deutsch"}}))


def _release() -> tuple[bytes, str]:
    tar = make_tar(
        {
            "app/nl.json": _dump({"_meta": {"name": "Nederlands"}, "a": "Verzenden"}),
            "app/de.json": _dump({"_meta": {"name": "Deutsch"}, "a": "Senden"}),
        }
    )
    return tar, hashlib.sha256(tar).hexdigest()


def test_pull_writes_targets_in_en_order(tmp_path):
    _locales(tmp_path)
    en_before = (tmp_path / "en.json").read_bytes()
    tar, sha = _release()
    stats = pt.pull(tar, f"{sha}  rtfm-ev-i18n.tar.gz", "v2026.10.20-abc", tmp_path)
    nl = json.loads((tmp_path / "nl.json").read_text(encoding="utf-8"))
    assert list(nl) == ["_meta", "a", "b", "c", "d"]
    assert nl["_meta"] == {
        "locale": "nl",
        "name": "Nederlands",
        "source": "rtfm-ev-i18n",
        "release": "v2026.10.20-abc",
        "license": "CC BY 4.0",
    }
    assert nl["a"] == "Verzenden" and nl["d"] == "Kaart"
    assert (tmp_path / "nl.json").read_bytes().endswith(b"}\n")
    assert b"\r\n" not in (tmp_path / "nl.json").read_bytes()
    assert (tmp_path / "en.json").read_bytes() == en_before
    assert stats["nl"]["release"] == 1
    assert stats["de"] == {"release": 1, "kept": 0, "english": 3}


def test_pull_checksum_mismatch_writes_nothing(tmp_path):
    _locales(tmp_path)
    nl_before = (tmp_path / "nl.json").read_bytes()
    tar, _ = _release()
    with pytest.raises(SystemExit):
        pt.pull(tar, "0" * 64 + "  rtfm-ev-i18n.tar.gz", "t", tmp_path)
    assert (tmp_path / "nl.json").read_bytes() == nl_before


def test_pull_dry_run_writes_nothing(tmp_path):
    _locales(tmp_path)
    before = {p.name: p.read_bytes() for p in tmp_path.iterdir()}
    tar, sha = _release()
    stats = pt.pull(tar, sha, "t", tmp_path, dry_run=True)
    assert stats["nl"]["release"] == 1
    assert {p.name: p.read_bytes() for p in tmp_path.iterdir()} == before


def test_read_ignores_other_members():
    tar = make_tar(
        {
            "app/nl.json": b'{"a": "x"}',
            "../evil.json": b"{}",
            "app/../../x.json": b"{}",
            "locales/nl.json": b"{}",
        }
    )
    assert pt.read_app_catalogs(tar, ["nl"]) == {"nl": {"a": "x"}}


def test_read_missing_language_exits():
    with pytest.raises(SystemExit):
        pt.read_app_catalogs(make_tar({"app/nl.json": b"{}"}), ["nl", "de"])
