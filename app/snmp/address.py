"""Address helpers for SNMP polling: host validation and WiFi status parsing."""

from __future__ import annotations

import ipaddress
import re

# RFC 1123 hostname: labels of letters, digits and hyphens, not starting or
# ending with a hyphen.
_LABEL_RE = re.compile(r"^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$")
_WIFI_IP_RE = re.compile(r"\bIP:\s*([0-9A-Fa-f.:]+)")


def normalize_host(raw: str) -> str:
    """Validate an IP address or hostname and return its normal form.

    Raises ``ValueError`` for anything else, so text with spaces, slashes, a
    port or a URL scheme never reaches the resolver.
    """
    text = raw.strip()
    if not text:
        raise ValueError("host must not be empty")
    try:
        address = ipaddress.ip_address(text)
    except ValueError:
        pass
    else:
        if address.is_unspecified or address.is_multicast:
            raise ValueError("host must be a unicast address")
        return str(address)
    if len(text) > 253:
        raise ValueError("hostname too long")
    labels = text.rstrip(".").split(".")
    # All-numeric labels would be a malformed IPv4 address, not a hostname.
    if all(label.isdigit() for label in labels):
        raise ValueError("not a valid IP address")
    if not all(_LABEL_RE.match(label) for label in labels):
        raise ValueError("not a valid IP address or hostname")
    return text.rstrip(".").lower()


def parse_wifi_status_ip(reply: str) -> str | None:
    """Pull the address out of the observer firmware's ``get wifi.status`` reply.

    The firmware answers ``connected, IP: 192.168.1.20, RSSI: -60 dBm`` when
    WiFi is up (``CommonCLI_Observer.cpp``), and only a status word otherwise.
    """
    match = _WIFI_IP_RE.search(reply)
    if not match:
        return None
    try:
        address = ipaddress.ip_address(match.group(1).rstrip(".:"))
    except ValueError:
        return None
    if address.is_unspecified or address.is_multicast or address.is_loopback:
        return None
    return str(address)
