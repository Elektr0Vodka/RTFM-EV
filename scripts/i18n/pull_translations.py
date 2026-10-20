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

import argparse
import hashlib
import io
import json
import re
import sys
import tarfile
import urllib.request
from pathlib import Path

REPO = "Elektr0Vodka/rtfm-ev-i18n"
API_URL = f"https://api.github.com/repos/{REPO}/releases/latest"
TARBALL = "rtfm-ev-i18n.tar.gz"
CHECKSUM = f"{TARBALL}.sha256"

REPO_ROOT = Path(__file__).resolve().parents[2]
LOCALES_DIR = REPO_ROOT / "frontend" / "src" / "i18n" / "locales"

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


def target_codes(locales_dir: Path) -> list[str]:
    """Languages the app ships, except English."""
    return sorted(p.stem for p in locales_dir.glob("*.json") if p.stem != "en")


def read_app_catalogs(tar_bytes: bytes, codes: list[str]) -> dict[str, dict]:
    """Read app/<code>.json for each code. Nothing is extracted to disk."""
    catalogs: dict[str, dict] = {}
    missing: list[str] = []
    with tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r:gz") as tar:
        members = {m.name: m for m in tar.getmembers() if m.isfile()}
        for code in codes:
            member = members.get(f"app/{code}.json")
            fh = tar.extractfile(member) if member else None
            if fh is None:
                missing.append(code)
                continue
            with fh:
                catalogs[code] = json.loads(fh.read().decode("utf-8"))
    if missing:
        raise SystemExit(f"release has no app catalog for: {', '.join(missing)}")
    return catalogs


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def pull(
    tar_bytes: bytes, sha_text: str, tag: str, locales_dir: Path, dry_run: bool = False
) -> dict[str, dict[str, int]]:
    """Verify the tarball, then rewrite every target catalog. Writes nothing on error."""
    verify_sha256(tar_bytes, parse_sha256(sha_text))
    en = _load(locales_dir / "en.json")
    codes = target_codes(locales_dir)
    pulled = read_app_catalogs(tar_bytes, codes)

    outputs: dict[str, str] = {}
    stats: dict[str, dict[str, int]] = {}
    for code in codes:
        current = _load(locales_dir / f"{code}.json")
        catalog, stats[code] = build_catalog(en, pulled[code], current)
        name = (
            pulled[code].get("_meta", {}).get("name")
            or current.get("_meta", {}).get("name")
            or code
        )
        meta = {
            "locale": code,
            "name": name,
            "source": "rtfm-ev-i18n",
            "release": tag,
            "license": "CC BY 4.0",
        }
        data = {"_meta": meta, **catalog}
        outputs[code] = json.dumps(data, ensure_ascii=False, indent=2) + "\n"

    if not dry_run:
        for code, text in outputs.items():
            (locales_dir / f"{code}.json").write_bytes(text.encode("utf-8"))
    return stats


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def fetch_release(api_url: str = API_URL) -> tuple[str, bytes, str]:
    """Return (tag, tarball bytes, .sha256 text) of the latest release."""
    release = fetch_json(api_url)
    tag = release.get("tag_name", "")
    urls = {a.get("name"): a.get("browser_download_url") for a in release.get("assets", [])}
    missing = [name for name in (TARBALL, CHECKSUM) if not urls.get(name)]
    if missing:
        raise SystemExit(
            f"latest release {tag or '(unknown)'} has no asset: {', '.join(missing)}\n"
            f"Check https://github.com/{REPO}/releases for available assets."
        )
    with urllib.request.urlopen(urls[TARBALL]) as resp:
        tar_bytes = resp.read()
    with urllib.request.urlopen(urls[CHECKSUM]) as resp:
        sha_text = resp.read().decode("utf-8")
    return tag, tar_bytes, sha_text


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Pull translations from the latest rtfm-ev-i18n release."
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="show the counts without writing any file"
    )
    args = parser.parse_args(argv)

    print("Fetching latest rtfm-ev-i18n release...")
    tag, tar_bytes, sha_text = fetch_release()
    print(f"  Release : {tag}")
    stats = pull(tar_bytes, sha_text, tag, LOCALES_DIR, dry_run=args.dry_run)
    for code, s in stats.items():
        print(f"{code}: {s['release']} from release, {s['kept']} kept, {s['english']} English")
    if args.dry_run:
        print("Dry run: no files written.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
