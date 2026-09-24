"""meshcore:// contact links.

A contact link is ``meshcore://`` followed by the lowercase hex of a raw advert
packet (header, path and signed advert payload). This is the format
meshcore-open copies to the clipboard and the format the companion firmware
returns for CMD_EXPORT_CONTACT (meshcore_py ``EventType.CONTACT_URI``).
"""

import re
from dataclasses import dataclass
from typing import Any

from meshcore import EventType

from app.decoder import (
    ParsedAdvertisement,
    PayloadType,
    parse_advertisement,
    parse_packet,
    verify_advert_signature,
)

CONTACT_URI_SCHEME = "meshcore://"
# A LoRa packet cannot exceed 255 bytes.
_MAX_PACKET_BYTES = 255
_HEX = re.compile(r"^(?:[0-9a-fA-F]{2})+$")


class ContactUriError(ValueError):
    """The text is not a valid meshcore:// contact link."""


@dataclass(frozen=True)
class ContactCard:
    raw: bytes
    advert: ParsedAdvertisement

    @property
    def public_key(self) -> str:
        return self.advert.public_key


def format_contact_uri(raw_packet: bytes) -> str:
    return CONTACT_URI_SCHEME + raw_packet.hex()


def parse_contact_uri(uri: str) -> ContactCard:
    """Validate a contact link and return the raw advert packet and its parsed fields.

    Checks the scheme, the hex, that the packet is an ADVERT, and the advert's
    Ed25519 signature, so a corrupted or forged link never reaches the radio.
    """
    text = uri.strip()
    if text[: len(CONTACT_URI_SCHEME)].lower() != CONTACT_URI_SCHEME:
        raise ContactUriError("Link must start with meshcore://")
    hex_part = text[len(CONTACT_URI_SCHEME) :]
    if not _HEX.match(hex_part):
        raise ContactUriError("Link is not valid hex")
    raw = bytes.fromhex(hex_part)
    if len(raw) > _MAX_PACKET_BYTES:
        raise ContactUriError("Link is too long to be a MeshCore advert")

    packet = parse_packet(raw)
    if packet is None or packet.payload_type != PayloadType.ADVERT:
        raise ContactUriError("Link does not contain a MeshCore advert")
    advert = parse_advertisement(packet.payload, raw_packet=raw)
    if advert is None:
        raise ContactUriError("Advert in link is truncated")
    if not verify_advert_signature(packet.payload):
        raise ContactUriError("Advert signature is invalid")
    return ContactCard(raw=raw, advert=advert)


def card_from_export_result(result: Any) -> ContactCard:
    """Validate a meshcore_py ``export_contact`` result (``EventType.CONTACT_URI``)."""
    if result is None or result.type != EventType.CONTACT_URI:
        raise ContactUriError("Radio did not return a contact link")
    payload = result.payload if isinstance(result.payload, dict) else {}
    uri = payload.get("uri")
    if not isinstance(uri, str):
        raise ContactUriError("Radio did not return a contact link")
    return parse_contact_uri(uri)
