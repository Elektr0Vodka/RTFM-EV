"""The radio settings the companion is on right now, as a stamp for stored rows.

Packets, messages and contact sightings carry the LoRa settings they were heard
on (migration _160), so the UI can mark traffic from another mesh (an ``SF8``
pill) and filter on SF. The companion reports its settings in ``self_info``;
``apply_radio_config_update`` refreshes that after every change.
"""

from __future__ import annotations

from app.models import RadioStamp
from app.services.radio_runtime import radio_runtime as radio_manager

FREQ_TOLERANCE_MHZ = 0.001
BW_TOLERANCE_KHZ = 1.0


def current_radio_stamp() -> RadioStamp | None:
    """Settings from the connected radio's ``self_info``; None when unknown."""
    mc = radio_manager.meshcore
    info = getattr(mc, "self_info", None) if mc is not None else None
    if not info:
        return None
    try:
        sf = int(info.get("radio_sf") or 0)
        if sf <= 0:
            return None
        return RadioStamp(
            freq=float(info.get("radio_freq") or 0.0),
            bw=float(info.get("radio_bw") or 0.0),
            sf=sf,
            cr=int(info.get("radio_cr") or 0),
        )
    except (TypeError, ValueError):
        return None


def stamps_equal(a: RadioStamp, b: RadioStamp) -> bool:
    """Same settings, allowing float noise on frequency and bandwidth."""
    return (
        a.sf == b.sf
        and a.cr == b.cr
        and abs(a.freq - b.freq) <= FREQ_TOLERANCE_MHZ
        and abs(a.bw - b.bw) <= BW_TOLERANCE_KHZ
    )


VALID_HIDDEN_SFS = frozenset({0, 5, 6, 7, 8, 9, 10, 11, 12})
"""Values for the chat SF filter: 5-12, plus 0 for messages without a stamp."""


def clean_hidden_sfs(values) -> list[int]:
    return sorted({v for v in values or [] if isinstance(v, int) and v in VALID_HIDDEN_SFS})


def message_hidden_by_radio_sf(stamp: dict | None, hidden_sfs) -> bool:
    """Same rule as the SQL SF filter: hidden when its SF (0 = no stamp) is listed."""
    hidden = set(clean_hidden_sfs(hidden_sfs))
    if not hidden:
        return False
    sf = stamp.get("sf") if isinstance(stamp, dict) else None
    return (sf if isinstance(sf, int) else 0) in hidden
