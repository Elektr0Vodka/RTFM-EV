"""Map the add-on's /data/options.json onto Settings.

Home Assistant hands add-on options to the container as a JSON file, not as
environment variables. In add-on mode the app reads that file and passes the
values to Settings as init arguments. A ``MESHCORE_*`` variable that is set in
the environment still wins, so its option is left out here (init arguments
would otherwise beat the environment).

This module must not import ``app.config``: config imports it while building
the settings object.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Mapping

logger = logging.getLogger(__name__)

ADDON_OPTIONS_PATH = "/data/options.json"
ADDON_DATABASE_PATH = "/data/meshcore.db"

_LOG_LEVELS = frozenset({"DEBUG", "INFO", "WARNING", "ERROR"})


def load_addon_options(path: str) -> dict[str, object]:
    """Read the options file. Missing or unreadable gives ``{}`` and one warning."""
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        logger.warning("Add-on mode: %s not found, using defaults", path)
        return {}
    except (OSError, ValueError) as err:
        logger.warning("Add-on mode: cannot read %s (%s), using defaults", path, err)
        return {}
    if not isinstance(data, dict):
        logger.warning("Add-on mode: %s is not a JSON object, using defaults", path)
        return {}
    return data


def addon_overrides(options: Mapping[str, object], environ: Mapping[str, str]) -> dict[str, object]:
    """Settings init arguments from add-on options, skipping anything set in the environment."""
    out: dict[str, object] = {}

    host = options.get("tcp_host")
    if isinstance(host, str) and host.strip() and "MESHCORE_TCP_HOST" not in environ:
        out["tcp_host"] = host.strip()
        port = options.get("tcp_port")
        if (
            isinstance(port, int)
            and not isinstance(port, bool)
            and "MESHCORE_TCP_PORT" not in environ
        ):
            out["tcp_port"] = port

    level = options.get("log_level")
    if level in _LOG_LEVELS and "MESHCORE_LOG_LEVEL" not in environ:
        out["log_level"] = level

    direct = options.get("allow_direct_access")
    if isinstance(direct, bool) and "MESHCORE_HA_ALLOW_DIRECT" not in environ:
        out["ha_allow_direct"] = direct

    if "MESHCORE_DATABASE_PATH" not in environ:
        out["database_path"] = ADDON_DATABASE_PATH

    return out
