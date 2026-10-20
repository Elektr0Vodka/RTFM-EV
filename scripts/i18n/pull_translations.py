#!/usr/bin/env python3
"""
pull_translations.py

Downloads the latest rtfm-ev-i18n release, verifies the tarball against its
.sha256 asset, and rewrites the non-English catalogs in
frontend/src/i18n/locales/ (today nl.json and de.json) from the tarball's
app/<code>.json. en.json is never written.

Each key follows en.json's order. Its value is the release translation when it
fits English (same shape, same placeholders), else the current app value when
that fits, else the English text.

No GitHub CLI or authentication required - uses only the public releases API
and browser_download_url. Requires only the Python standard library.

Run it to bring translations back into the app. Run the rtfm-ev-i18n i18n
workflow first (Actions, i18n, Run workflow) so the release includes the
newest drafts.
"""

import hashlib
import re

PLACEHOLDER = re.compile(r"\{(\w+)\}")
SHA256_HEX = re.compile(r"[0-9a-f]{64}")


def parse_sha256(text: str) -> str:
    """Return the digest from `sha256sum` output (`<hex>  <file>`), lowercased."""
    tokens = text.split()
    digest = tokens[0].lower() if tokens else ""
    if not SHA256_HEX.fullmatch(digest):
        raise SystemExit(f"invalid .sha256 asset: {text.strip()[:80]!r}")
    return digest


def verify_sha256(data: bytes, expected: str) -> None:
    actual = hashlib.sha256(data).hexdigest()
    if actual != expected:
        raise SystemExit(f"checksum mismatch: expected {expected}, got {actual}")


def _placeholders(text: str) -> set[str]:
    return set(PLACEHOLDER.findall(text))


def usable(value, en_value) -> bool:
    """True when value has en_value's shape and placeholders that fit it."""
    if isinstance(en_value, str):
        return isinstance(value, str) and _placeholders(value) == _placeholders(en_value)
    if isinstance(en_value, dict):
        if not isinstance(value, dict) or "other" not in value:
            return False
        if not all(isinstance(form, str) for form in value.values()):
            return False
        allowed = set().union(*(_placeholders(form) for form in en_value.values()))
        return all(_placeholders(form) <= allowed for form in value.values())
    return False


def build_catalog(en: dict, pulled: dict, current: dict) -> tuple[dict, dict[str, int]]:
    """Build a catalog (without _meta) in en's key order, with per-source counts."""
    catalog: dict = {}
    stats = {"release": 0, "kept": 0, "english": 0}
    for key, en_value in en.items():
        if key.startswith("_"):
            continue
        if key in pulled and usable(pulled[key], en_value):
            catalog[key] = pulled[key]
            stats["release"] += 1
        elif key in current and usable(current[key], en_value):
            catalog[key] = current[key]
            stats["kept"] += 1
        else:
            catalog[key] = en_value
            stats["english"] += 1
    return catalog, stats
