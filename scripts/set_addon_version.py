"""Set the ``version:`` line of a Home Assistant add-on config.yaml.

Usage: python scripts/set_addon_version.py <config.yaml> <version>

Only the first top-level ``version:`` line changes; every other byte stays as
it is. Used by CI to point the add-on at a freshly pushed image tag.
Exit codes: 0 done, 1 no version line, 2 bad arguments.
"""

from __future__ import annotations

import re
import sys

_VERSION_LINE = re.compile(rb"^version:[^\r\n]*", re.MULTILINE)
_SAFE_VERSION = re.compile(r"^[A-Za-z0-9._+-]+$")


def set_version(path: str, version: str) -> bool:
    with open(path, "rb") as fh:
        data = fh.read()
    new, count = _VERSION_LINE.subn(f'version: "{version}"'.encode(), data, count=1)
    if count == 0:
        return False
    if new != data:
        with open(path, "wb") as fh:
            fh.write(new)
    return True


def main(argv: list[str]) -> int:
    if len(argv) != 3 or not _SAFE_VERSION.match(argv[2]):
        print("usage: set_addon_version.py <config.yaml> <version>", file=sys.stderr)
        return 2
    if not set_version(argv[1], argv[2]):
        print(f"no version: line in {argv[1]}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
