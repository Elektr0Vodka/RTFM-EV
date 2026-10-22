"""Record which radio settings a contact was heard on (migration _160).

Called from the receive paths that can attribute a packet to a contact
(advert, incoming DM, channel message with a resolved sender). Never raises:
a sighting is a side note and must not break packet processing.
"""

from __future__ import annotations

import logging

from app import radio_stamp
from app.repository.contact_radio_sightings import ContactRadioSightingsRepository
from app.websocket import broadcast_event

logger = logging.getLogger(__name__)


async def record_contact_sighting(public_key: str | None, seen_at: int) -> None:
    """Store the current settings for this contact; broadcast when they are new."""
    if not public_key:
        return
    try:
        stamp = radio_stamp.current_radio_stamp()
        if stamp is None:
            return
        if await ContactRadioSightingsRepository.record(public_key, stamp, seen_at):
            broadcast_event(
                "contact_radio_sighting",
                {
                    "public_key": public_key.lower(),
                    "sighting": {
                        "freq": round(stamp.freq, 3),
                        "bw": round(stamp.bw, 3),
                        "sf": stamp.sf,
                        "cr": stamp.cr,
                        "first_seen": seen_at,
                        "last_seen": seen_at,
                    },
                },
            )
    except Exception:
        logger.exception("Could not record radio sighting for %s", public_key[:12])
