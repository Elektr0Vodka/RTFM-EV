"""The Ingress path of this add-on, as the Supervisor reports it.

Home Assistant Ingress forwards requests without a prefix header, so the
browser-facing sub-path (``/api/hassio_ingress/<token>``) has to come from the
Supervisor. It is fetched once at startup and used wherever a reverse-proxy
prefix header would otherwise be read. A header, when present, still wins.
"""

from __future__ import annotations

import re

# Plain path characters only, so the value can never add cookie attributes.
_SAFE_PREFIX = re.compile(r"^/[A-Za-z0-9._~/-]*$")

_prefix = ""


def set_ingress_prefix(prefix: str) -> None:
    """Store the Ingress prefix; anything that is not a plain absolute path is dropped."""
    global _prefix
    value = (prefix or "").strip().rstrip("/")
    _prefix = value if value and _SAFE_PREFIX.match(value) else ""


def get_ingress_prefix() -> str:
    return _prefix
