"""One-off: normalize a plain-text wordlist into the bundled channel-finder file.

Usage:
    python scripts/normalize_wordlist.py <source.txt> <dest.txt>

Reuses the canonical server normalizer so the bundled Dutch list matches what
the upload endpoint produces.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.wordlist_normalize import normalize_wordlist_text  # noqa: E402


def main() -> None:
    if len(sys.argv) != 3:
        print("Usage: python scripts/normalize_wordlist.py <source.txt> <dest.txt>")
        raise SystemExit(2)
    src, dst = sys.argv[1], sys.argv[2]
    with open(src, encoding="utf-8", errors="replace") as handle:
        text = handle.read()
    words = normalize_wordlist_text(text)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(dst, "w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(words) + "\n")
    print(f"Wrote {len(words)} words to {dst}")


if __name__ == "__main__":
    main()
