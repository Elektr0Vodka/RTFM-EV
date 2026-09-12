"""OpenHop node detection.

OpenHop (openhop-dev/openhop_repeater, on openhop_core) is a MeshCore-compatible
repeater/room-server daemon. Its companion frame server reports device model
"openHop-Repeater-Companion" (verified 2026-09-11). Detection is by model prefix so
future OpenHop device models still match. This is additive and read-only: non-OpenHop
nodes return False and behave exactly as before.
"""

OPENHOP_MODEL_PREFIX = "openhop"


def is_openhop(model: str | None) -> bool:
    """True when the connected radio identifies as an OpenHop node (by device model)."""
    return bool(model and model.strip().lower().startswith(OPENHOP_MODEL_PREFIX))
