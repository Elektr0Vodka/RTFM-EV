"""The wardrive module switch (``MESHCORE_WARDRIVE``).

Wardrive is the opt-in plugin that lets drivers on the owner's network or
tailnet pair their own companion radio in the browser, forward what it hears
to the DutchMeshCore wardrive collectors and keep a copy here. Off by default.
"""

from typing import Protocol


class WardriveSettings(Protocol):
    """The settings the switch reads (``app.config.Settings`` has them)."""

    @property
    def wardrive(self) -> bool: ...
    @property
    def multi_radio(self) -> bool: ...
    @property
    def basic_auth_enabled(self) -> bool: ...


PAGE_PREFIX = "/wardrive"
API_PREFIX = "/api/wardrive/"
ADMIN_API_PREFIX = "/api/wardrive-admin/"

UNPROTECTED_WARNING = (
    "Wardrive is on but MESHCORE_BASIC_AUTH_USERNAME/PASSWORD is not set: anyone who can "
    "open the wardrive page can also open the main app and the home radio."
)
MULTI_RADIO_WARNING = "MESHCORE_WARDRIVE is set but wardrive is not available in multi-radio mode."


def wardrive_active(s: WardriveSettings) -> bool:
    """True when the module is switched on and this process serves it."""
    return s.wardrive and not s.multi_radio


def wardrive_unprotected(s: WardriveSettings) -> bool:
    """True when the module is active but the main app has no login."""
    return wardrive_active(s) and not s.basic_auth_enabled


def startup_warnings(s: WardriveSettings) -> list[str]:
    if s.wardrive and s.multi_radio:
        return [MULTI_RADIO_WARNING]
    if wardrive_unprotected(s):
        return [UNPROTECTED_WARNING]
    return []
