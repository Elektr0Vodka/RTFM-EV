"""Build the bundled "known channels" channel-finder list from an MCCL rainbow file.

Usage:
    python scripts/build_mccl_wordlist.py <channel-rainbow.json> <dest.txt>

The source is ``list_nl/channel-rainbow.json`` from
https://github.com/Elektr0Vodka/MCCL: a flat ``{"#name": "<hex key>"}`` object.
Only hashtag names are taken (a hashtag room's key is derived from its name, so
those are the only names the finder can hit); the leading ``#`` is dropped.
Each name goes through the canonical server normalizer so the bundled file
matches what the upload endpoint produces, then the list is sorted.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.wordlist_normalize import normalize_word  # noqa: E402


def build_words(rainbow: dict) -> list[str]:
    """Return the sorted, deduplicated channel names of a rainbow object."""
    words: set[str] = set()
    for name in rainbow:
        if not isinstance(name, str) or not name.startswith("#"):
            continue
        word = normalize_word(name[1:])
        if word is not None:
            words.add(word)
    return sorted(words)


def main() -> None:
    if len(sys.argv) != 3:
        print("Usage: python scripts/build_mccl_wordlist.py <channel-rainbow.json> <dest.txt>")
        raise SystemExit(2)
    src, dst = sys.argv[1], sys.argv[2]
    with open(src, encoding="utf-8") as handle:
        rainbow = json.load(handle)
    if not isinstance(rainbow, dict):
        print("Expected a JSON object mapping channel name to key")
        raise SystemExit(1)
    words = build_words(rainbow)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(dst, "w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(words) + "\n")
    print(f"Wrote {len(words)} words to {dst}")


if __name__ == "__main__":
    main()
