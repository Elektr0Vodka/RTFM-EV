"""Image tags and Home Assistant add-on version for a publish-docker run.

Usage (CI): python scripts/addon_version.py >> "$GITHUB_OUTPUT"
Reads pyproject.toml and app/version_info.py from the current directory and
GITHUB_REF_TYPE / GITHUB_REF_NAME / GITHUB_REF / GITHUB_RUN_NUMBER from the
environment. Prints ``version=``, ``channel=`` and ``addon_version=`` lines.

- main branch: channel ``edge``, add-on version ``<base>.<a>.<b>.<run>``
- tag ``v<version>``: channel ``stable``, add-on version ``<base>.<a>.<b>``
- anything else: refused, so a dispatch from a feature branch never publishes.

The app version is ``<pyproject version><FORK_VERSION_SUFFIX>`` such as
``3.18.0-EV.0.3``. HA Core offers an add-on update only when AwesomeVersion says
latest > installed, and it does not order those strings, so the add-on version
uses numbers only: ``3.18.0-EV.0.3`` becomes ``3.18.0.0.3``.
"""

from __future__ import annotations

import os
import re
import sys

NUMERIC = re.compile(r"^[0-9]+(\.[0-9]+)*$")
_PYPROJECT_VERSION = re.compile(r'^version = "([^"]+)"', re.MULTILINE)
_SUFFIX = re.compile(r'^FORK_VERSION_SUFFIX = "([^"]*)"', re.MULTILINE)


def resolve(
    pyproject: str,
    version_info: str,
    *,
    ref_type: str,
    ref_name: str,
    ref: str,
    run_number: int,
) -> dict[str, str]:
    base_match = _PYPROJECT_VERSION.search(pyproject)
    if not base_match:
        raise ValueError("no version in pyproject.toml")
    base = base_match.group(1)
    suffix_match = _SUFFIX.search(version_info)
    suffix = suffix_match.group(1) if suffix_match else ""
    version = f"{base}{suffix}"

    parts = suffix.removeprefix("-EV.")
    if not NUMERIC.match(base) or not NUMERIC.match(parts) or not suffix.startswith("-EV."):
        raise ValueError(f"version suffix {suffix!r} on {base!r} is not -EV.<n>.<n>")
    numeric = f"{base}.{parts}"

    if ref_type == "tag":
        if ref_name != f"v{version}":
            raise ValueError(f"tag {ref_name} does not match app version v{version}")
        return {"version": version, "channel": "stable", "addon_version": numeric}
    if ref == "refs/heads/main":
        return {
            "version": version,
            "channel": "edge",
            "addon_version": f"{numeric}.{run_number}",
        }
    raise ValueError(f"images are published only from main or a v* tag, not {ref}")


def main() -> int:
    with open("pyproject.toml", encoding="utf-8") as fh:
        pyproject = fh.read()
    with open("app/version_info.py", encoding="utf-8") as fh:
        version_info = fh.read()
    try:
        out = resolve(
            pyproject,
            version_info,
            ref_type=os.environ.get("GITHUB_REF_TYPE", ""),
            ref_name=os.environ.get("GITHUB_REF_NAME", ""),
            ref=os.environ.get("GITHUB_REF", ""),
            run_number=int(os.environ.get("GITHUB_RUN_NUMBER", "0")),
        )
    except ValueError as err:
        print(f"::error::{err}", file=sys.stderr)
        return 1
    for key, value in out.items():
        print(f"{key}={value}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
