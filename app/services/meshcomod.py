"""Meshcomod DMC / DMC-EV companion settings: CAD tuning byte and GPS custom vars.

The meshcore library cannot read or write the CAD byte: set_tuning() hardcodes it
to 0 and the reader parses only the first 9 bytes of the 0x17 response. So CAD is
written with a raw 0x15 frame and read by briefly hooking the reader's handle_rx.
GPS uses the standard custom-vars commands, which round-trip cleanly.
"""

import logging

from meshcore import EventType

from app.services.radio_commands import RadioCommandRejectedError

logger = logging.getLogger(__name__)

SET_TUNING_OPCODE = 0x15
TUNING_RESP_OPCODE = 0x17
GPS_INTERVAL_MAX = 86400


def build_set_tuning_frame(rx_delay: int, airtime_factor: int, cad_enabled: int) -> bytes:
    """Build a CMD_SET_TUNING_PARAMS (0x15) frame including the CAD byte.

    rx_delay and airtime_factor are the raw already-scaled uint32 values as
    returned by the library get_tuning() (i.e. base * 1000).
    """
    return (
        bytes([SET_TUNING_OPCODE])
        + int(rx_delay).to_bytes(4, "little")
        + int(airtime_factor).to_bytes(4, "little")
        + bytes([1 if cad_enabled else 0])
    )


def parse_tuning_response(frame: bytes) -> dict:
    """Parse a RESP_CODE_TUNING_PARAMS (0x17) frame; cad_enabled is None if absent."""
    rx_delay = int.from_bytes(frame[1:5], "little")
    airtime_factor = int.from_bytes(frame[5:9], "little")
    cad_enabled = frame[9] if len(frame) >= 10 else None
    return {"rx_delay": rx_delay, "airtime_factor": airtime_factor, "cad_enabled": cad_enabled}


def is_meshcomod(ver_code: int | None, version: str | None) -> bool:
    """Detect the meshcomod DMC/DMC-EV fork. Primary signal is FIRMWARE_VER_CODE 27.

    Secondary signal is a 'DMC' substring in the version string. The version
    string's trailing suffix is not stable across connections, so never match the
    exact suffix.
    """
    if ver_code == 27:
        return True
    return bool(version and "DMC" in version.upper())


def clamp_gps_interval(value: int) -> int:
    return max(0, min(GPS_INTERVAL_MAX, int(value)))


async def capture_tuning_frame(mc) -> bytes | None:
    """Trigger a 0x17 response and capture the raw frame via a temporary hook.

    The library drops the appended CAD byte, so hook the reader's single frame
    entry point (handle_rx), request tuning, then restore the original.
    """
    reader = mc._reader
    original = reader.handle_rx
    holder: dict[str, bytes | None] = {"frame": None}

    async def hooked(data):
        try:
            b = bytes(data)
            if b and b[0] == TUNING_RESP_OPCODE:
                holder["frame"] = b
        except Exception:  # noqa: BLE001 - never let sniffing break the pipeline
            logger.debug("tuning sniff failed", exc_info=True)
        return await original(data)

    reader.handle_rx = hooked
    try:
        await mc.commands.get_tuning()
    finally:
        reader.handle_rx = original
    return holder["frame"]


async def read_meshcomod_settings(mc) -> dict:
    """Read CAD (via raw frame capture) and GPS (via custom vars) state."""
    frame = await capture_tuning_frame(mc)
    if frame is not None:
        parsed = parse_tuning_response(frame)
        cad_enabled = parsed["cad_enabled"]
    else:
        cad_enabled = None
    cad_supported = cad_enabled is not None

    vars_event = await mc.commands.get_custom_vars()
    res = vars_event.payload if vars_event is not None else {}
    gps_supported = "gps" in res
    gps_enabled = res.get("gps") == "1" if gps_supported else None
    gps_interval = int(res.get("gps_interval", "0") or 0) if gps_supported else None

    return {
        "cad_supported": cad_supported,
        "cad_enabled": bool(cad_enabled) if cad_supported else None,
        "gps_supported": gps_supported,
        "gps_enabled": gps_enabled,
        "gps_interval": gps_interval,
    }


async def apply_meshcomod_update(
    mc,
    *,
    cad_enabled: bool | None = None,
    gps_enabled: bool | None = None,
    gps_interval: int | None = None,
) -> None:
    """Apply any provided meshcomod settings to the connected radio."""
    if cad_enabled is not None:
        # Preserve current rx_delay / airtime_factor; only flip the CAD byte.
        tuning = await mc.commands.get_tuning()
        payload = tuning.payload if tuning is not None else {}
        rx_delay = int(payload.get("rx_delay", 0))
        airtime_factor = int(payload.get("airtime_factor", 0))
        frame = build_set_tuning_frame(rx_delay, airtime_factor, 1 if cad_enabled else 0)
        logger.info("Setting CAD to %s via raw tuning frame", cad_enabled)
        result = await mc.commands.send(frame, [EventType.OK, EventType.ERROR])
        if result is not None and result.type == EventType.ERROR:
            raise RadioCommandRejectedError(f"Failed to set CAD: {result.payload}")

    if gps_enabled is not None:
        logger.info("Setting GPS enabled to %s", gps_enabled)
        result = await mc.commands.set_custom_var("gps", "1" if gps_enabled else "0")
        if result is not None and result.type == EventType.ERROR:
            raise RadioCommandRejectedError(f"Failed to set GPS enable: {result.payload}")

    if gps_interval is not None:
        clamped = clamp_gps_interval(gps_interval)
        logger.info("Setting GPS interval to %d seconds", clamped)
        result = await mc.commands.set_custom_var("gps_interval", str(clamped))
        if result is not None and result.type == EventType.ERROR:
            raise RadioCommandRejectedError(f"Failed to set GPS interval: {result.payload}")
