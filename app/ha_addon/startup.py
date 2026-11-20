"""Add-on mode startup: learn the Ingress path from the Supervisor."""

from __future__ import annotations

import logging

from app.ha_addon.ingress import set_ingress_prefix
from app.ha_addon.supervisor import SupervisorClient, SupervisorUnavailable

logger = logging.getLogger(__name__)


async def init_ha_addon(client: SupervisorClient) -> None:
    """Set the Ingress prefix. Without the Supervisor the app still starts."""
    try:
        info = await client.self_info()
    except SupervisorUnavailable as err:
        logger.warning("Add-on mode: Supervisor not reachable, no Ingress prefix (%s)", err)
        return
    entry = info.get("ingress_entry")
    set_ingress_prefix(entry if isinstance(entry, str) else "")
    logger.info("Add-on mode: Ingress path %s", entry or "(none)")
