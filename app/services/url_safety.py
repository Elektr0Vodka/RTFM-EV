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


class UnresolvedHostError(UnsafeUrlError):
    """The host name has no address.

    Still refused, so it is an ``UnsafeUrlError`` for callers that only know
    that one. A caller that tells the user why can say the name does not exist
    rather than that the address is unsafe.
    """


def _ip_is_public(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    # An IPv4 address written as IPv6 is judged as the IPv4 address it reaches.
    # Current Python does that itself; the versions before 3.13 did not.
    mapped = getattr(addr, "ipv4_mapped", None)
    if mapped is not None:
        addr = mapped
    # ``is_global`` adds the one range the flags below leave out: shared address
    # space (100.64.0.0/10, carrier NAT and overlay networks), which is neither
    # "private" nor global. Site-local IPv6 (fec0::/10) is deprecated but still
    # routed inside networks that use it, and counts as global to ``ipaddress``.
    return addr.is_global and not (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_reserved
        or addr.is_multicast
        or addr.is_unspecified
        or getattr(addr, "is_site_local", False)
    )


def _resolve_validated(url: str) -> list[str]:
    """Validate the URL's scheme+host and return its resolved public IPs.

    Raises ``UnsafeUrlError`` for a non-http(s) scheme, a missing host, a host
    that does not resolve, or any resolved address that is not public.
    """
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise UnsafeUrlError(f"scheme not allowed: {parts.scheme!r}")
    host = parts.hostname
    if not host:
        raise UnsafeUrlError("URL has no host")

    try:
        infos = socket.getaddrinfo(host, parts.port or (443 if parts.scheme == "https" else 80))
    except socket.gaierror as exc:
        raise UnresolvedHostError(f"host does not resolve: {host}") from exc

    resolved = [str(info[4][0]) for info in infos]
    if not resolved:
        raise UnresolvedHostError(f"host does not resolve: {host}")
    for ip in resolved:
        if not _ip_is_public(ip):
            raise UnsafeUrlError(f"host resolves to non-public address: {ip}")
    return resolved


def assert_public_http_url(url: str) -> str:
    """Return the URL if it is a safe public http(s) target, else raise.

    Resolves the host and requires every resolved address to be public.
    """
    _resolve_validated(url)
    return url


def resolve_public_ip(url: str) -> str:
    """Return one validated public IP for the URL's host, else raise.

    Callers connect to this exact IP (and send the original Host / SNI) so the
    address that was security-checked is the address actually contacted - closing
    the DNS-rebinding gap where a second name resolution could return a private
    address after the check passed.
    """
    return _resolve_validated(url)[0]
