"""Read-only radio facts for the host repeater (identity, modulation, capabilities).

This is the only host-repeater module that touches the radio manager, and it only
reads cached state: it never sends a command. The shadow runner
(``host_repeater.py``) and the engine get these values passed in, so they hold no
reference to the radio or its send path.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.services.host_repeater_engine import RadioParams
from app.services.openhop import is_openhop
from app.services.radio_runtime import radio_runtime as radio_manager

# CMD_SEND_RAW_PACKET first shipped in companion-v1.16.0 (FIRMWARE_VER_CODE 13).
RAW_SEND_MIN_VER_CODE = 13


@dataclass(frozen=True)
class RadioSnapshot:
    connected: bool
    public_key: bytes | None
    name: str | None
    radio: RadioParams | None
    firmware_ver_code: int | None
    device_model: str | None
    client_repeat: bool | None
    lock_busy: bool

    @property
    def is_openhop(self) -> bool:
        return is_openhop(self.device_model)

    @property
    def raw_send_supported(self) -> bool | None:
        if self.firmware_ver_code is None:
            return None
        return self.firmware_ver_code >= RAW_SEND_MIN_VER_CODE


def radio_snapshot() -> RadioSnapshot:
    """Current cached radio facts; never raises, never talks to the radio."""
    manager = radio_manager.manager
    mc = getattr(manager, "meshcore", None) if manager is not None else None
    info = getattr(mc, "self_info", None) or {}
    connected = bool(getattr(manager, "is_connected", False))

    public_key: bytes | None = None
    try:
        key_hex = info.get("public_key") or ""
        public_key = bytes.fromhex(key_hex) if len(key_hex) == 64 else None
    except (ValueError, AttributeError):
        public_key = None

    radio: RadioParams | None = None
    try:
        freq = float(info.get("radio_freq") or 0.0)
        bw = float(info.get("radio_bw") or 0.0)
        sf = int(info.get("radio_sf") or 0)
        cr = int(info.get("radio_cr") or 0)
        if bw > 0 and sf > 0 and cr > 0:
            radio = RadioParams(freq_mhz=freq or None, bw_khz=bw, sf=sf, cr=cr)
    except (TypeError, ValueError, AttributeError):
        radio = None

    lock = getattr(manager, "_operation_lock", None)
    return RadioSnapshot(
        connected=connected,
        public_key=public_key,
        name=info.get("name") or None,
        radio=radio,
        firmware_ver_code=getattr(manager, "firmware_ver_code", None),
        device_model=getattr(manager, "device_model", None),
        client_repeat=getattr(manager, "client_repeat", None),
        lock_busy=bool(lock is not None and lock.locked()),
    )
