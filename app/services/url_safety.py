"""Guards outbound fetches of untrusted URLs against SSRF.

Chat messages can contain arbitrary URLs. Before the server fetches one (for a
link preview), we require an http(s) URL whose host resolves only to public IP
addresses, blocking loopback, private, link-local, and reserved ranges (which
includes cloud metadata endpoints such as 169.254.169.254).
"""

import ipaddress
import socket
from urllib.parse import urlsplit


class UnsafeUrlError(ValueError):
    """Raised when a URL is not a safe, public http(s) target."""


def _ip_is_public(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return not (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_reserved
        or addr.is_multicast
        or addr.is_unspecified
    )


def assert_public_http_url(url: str) -> str:
    """Return the URL if it is a safe public http(s) target, else raise.

    Resolves the host and requires every resolved address to be public.
    """
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise UnsafeUrlError(f"scheme not allowed: {parts.scheme!r}")
    host = parts.hostname
    if not host:
        raise UnsafeUrlError("URL has no host")

    # A literal IP host is checked directly; a name is resolved.
    try:
        infos = socket.getaddrinfo(host, parts.port or (443 if parts.scheme == "https" else 80))
    except socket.gaierror as exc:
        raise UnsafeUrlError(f"host does not resolve: {host}") from exc

    resolved = {info[4][0] for info in infos}
    if not resolved:
        raise UnsafeUrlError(f"host does not resolve: {host}")
    for ip in resolved:
        if not _ip_is_public(ip):
            raise UnsafeUrlError(f"host resolves to non-public address: {ip}")
    return url
