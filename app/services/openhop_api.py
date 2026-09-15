"""Thin async client for OpenHop's REST API (Surface B).

Authenticates with an API token sent as X-API-Key (created by the user via
POST /api/auth/tokens on the node). Never stores the admin password. All calls are
opt-in and only invoked when the connected node is detected as OpenHop and the user
has configured a URL + token. Shapes are from the live-verified endpoints
(see docs/plans/20-openhop-integration.md).
"""

from typing import Any

import httpx


class OpenHopClient:
    def __init__(
        self,
        base_url: str,
        token: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout: float = 8.0,
    ) -> None:
        self._base = base_url.rstrip("/")
        self._client = httpx.AsyncClient(
            base_url=self._base,
            headers={"X-API-Key": token},
            timeout=timeout,
            transport=transport,
        )

    async def _get(self, path: str) -> dict[str, Any]:
        r = await self._client.get(path)
        r.raise_for_status()
        return r.json()

    async def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        r = await self._client.post(path, json=body)
        r.raise_for_status()
        return r.json()

    async def get_site_info(self) -> dict[str, Any]:
        return await self._get("/api/site_info")

    async def get_policy(self) -> dict[str, Any]:
        return await self._get("/api/policy")

    async def cli(self, command: str) -> dict[str, Any]:
        return await self._post("/api/cli", {"command": command})

    async def _delete(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        r = await self._client.request("DELETE", path, json=body)
        r.raise_for_status()
        return r.json()

    async def update_policy(self, policy: dict[str, Any]) -> dict[str, Any]:
        return await self._post("/api/policy", policy)

    async def validate_policy(self, policy: dict[str, Any]) -> dict[str, Any]:
        return await self._post("/api/policy_validate", policy)

    async def list_policy_groups(self, kind: str | None = None) -> dict[str, Any]:
        return await self._get("/api/policy_groups" + (f"?kind={kind}" if kind else ""))

    async def create_policy_group(
        self, kind: str, group_id: str, *, friendly_name: str = "", description: str = ""
    ) -> dict[str, Any]:
        return await self._post(
            "/api/policy_groups",
            {
                "kind": kind,
                "group_id": group_id,
                "friendly_name": friendly_name,
                "description": description,
            },
        )

    async def delete_policy_group(self, kind: str, group_id: str) -> dict[str, Any]:
        return await self._delete("/api/policy_groups", {"kind": kind, "group_id": group_id})

    async def add_group_entry(self, kind: str, group_id: str, value: str) -> dict[str, Any]:
        return await self._post(
            "/api/policy_group_entries",
            {"kind": kind, "group_id": group_id, "value": value},
        )

    async def delete_group_entry(
        self, kind: str, group_id: str, *, value: str | None = None, entry_id: str | None = None
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"kind": kind, "group_id": group_id}
        if value is not None:
            body["value"] = value
        if entry_id is not None:
            body["entry_id"] = entry_id
        return await self._delete("/api/policy_group_entries", body)

    async def _get_q(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        r = await self._client.get(path, params=params)
        r.raise_for_status()
        return r.json()

    async def list_plugins(self) -> dict[str, Any]:
        return await self._get("/api/plugins/")

    async def plugin_status(self, plugin_id: str) -> dict[str, Any]:
        return await self._get(f"/api/plugins/{plugin_id}")

    async def plugin_catalogue(self, force_refresh: bool = False) -> dict[str, Any]:
        return await self._get("/api/plugins/catalogue" + ("?refresh=1" if force_refresh else ""))

    async def plugin_logs(self, plugin_id: str, tail: int = 200) -> dict[str, Any]:
        return await self._get_q("/api/plugins/logs", {"id": plugin_id, "tail": tail})

    async def get_plugin_config(self, plugin_id: str) -> dict[str, Any]:
        return await self._get_q("/api/plugins/settings", {"id": plugin_id})

    async def check_plugin_update(
        self, plugin_id: str, force_refresh: bool = False
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"id": plugin_id}
        if force_refresh:
            params["refresh"] = 1
        return await self._get_q("/api/plugins/updates", params)

    async def enable_plugin(self, plugin_id: str) -> dict[str, Any]:
        return await self._post("/api/plugins/enable", {"id": plugin_id})

    async def disable_plugin(self, plugin_id: str) -> dict[str, Any]:
        return await self._post("/api/plugins/disable", {"id": plugin_id})

    async def start_plugin(self, plugin_id: str) -> dict[str, Any]:
        return await self._post("/api/plugins/start", {"id": plugin_id})

    async def stop_plugin(self, plugin_id: str) -> dict[str, Any]:
        return await self._post("/api/plugins/stop", {"id": plugin_id})

    async def restart_plugin(self, plugin_id: str) -> dict[str, Any]:
        return await self._post("/api/plugins/restart", {"id": plugin_id})

    async def catalogue_install(self, plugin_id: str, version: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"id": plugin_id}
        if version:
            body["version"] = version
        return await self._post("/api/plugins/catalogue_install", body)

    async def update_plugin(self, plugin_id: str, version: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"id": plugin_id}
        if version:
            body["version"] = version
        return await self._post("/api/plugins/update", body)

    async def set_plugin_config(
        self, plugin_id: str, config: dict[str, Any], restart: bool = False
    ) -> dict[str, Any]:
        return await self._post(
            "/api/plugins/settings", {"id": plugin_id, "config": config, "restart": restart}
        )

    async def uninstall_plugin(self, plugin_id: str, delete_data: bool = False) -> dict[str, Any]:
        return await self._post(
            "/api/plugins/uninstall", {"id": plugin_id, "delete_data": delete_data}
        )

    async def config_export(self, include_secrets: bool = False) -> dict[str, Any]:
        path = "/api/config_export" + ("?include_secrets=true" if include_secrets else "")
        return await self._get(path)

    async def config_import(
        self, config: dict[str, Any], restart_after: bool = False
    ) -> dict[str, Any]:
        return await self._post(
            "/api/config_import", {"config": config, "restart_after": restart_after}
        )

    async def validate_config(self) -> dict[str, Any]:
        return await self._get("/api/validate_config")

    async def update_radio_config(self, params: dict[str, Any]) -> dict[str, Any]:
        return await self._post("/api/update_radio_config", params)

    async def set_mode(self, mode: str) -> dict[str, Any]:
        return await self._post("/api/set_mode", {"mode": mode})

    async def hardware_options(self) -> dict[str, Any]:
        return await self._get("/api/hardware_options")

    async def radio_presets(self) -> dict[str, Any]:
        return await self._get("/api/radio_presets")

    async def restart_service(self) -> dict[str, Any]:
        return await self._post("/api/restart_service", {})

    # --- Update (OTA) ---------------------------------------------------
    async def update_status(self) -> dict[str, Any]:
        return await self._get("/api/update/status")

    async def update_check(self, force: bool = False) -> dict[str, Any]:
        return await self._post("/api/update/check", {"force": force})

    async def update_install(self, force: bool = False) -> dict[str, Any]:
        return await self._post("/api/update/install", {"force": force})

    async def update_channels(self) -> dict[str, Any]:
        return await self._get("/api/update/channels")

    async def update_set_channel(self, channel: str) -> dict[str, Any]:
        return await self._post("/api/update/set_channel", {"channel": channel})

    async def update_changelog(
        self, channel: str | None = None, max_commits: int = 40
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"max": max_commits}
        if channel:
            params["channel"] = channel
        return await self._get_q("/api/update/changelog", params)

    # --- CAD calibration ------------------------------------------------
    async def cad_start(self, samples: int = 8, delay: int = 100) -> dict[str, Any]:
        return await self._post("/api/cad_calibration_start", {"samples": samples, "delay": delay})

    async def cad_stop(self) -> dict[str, Any]:
        return await self._post("/api/cad_calibration_stop", {})

    async def cad_manual_check(self, params: dict[str, Any]) -> dict[str, Any]:
        return await self._post("/api/cad_manual_check", params)

    async def cad_save(self, peak: int, min_val: int, cad_symbol_num: int = 2) -> dict[str, Any]:
        return await self._post(
            "/api/save_cad_settings",
            {"peak": peak, "min_val": min_val, "cad_symbol_num": cad_symbol_num},
        )

    # --- System / hardware ----------------------------------------------
    async def hardware_stats(self) -> dict[str, Any]:
        return await self._get("/api/hardware_stats")

    async def hardware_processes(self) -> dict[str, Any]:
        return await self._get("/api/hardware_processes")

    async def node_stats(self) -> dict[str, Any]:
        return await self._get("/api/stats")

    # --- Analytics (read-only) ------------------------------------------
    async def packet_stats(self, hours: int = 24) -> dict[str, Any]:
        return await self._get_q("/api/packet_stats", {"hours": hours})

    async def packet_type_stats(self, hours: int = 24) -> dict[str, Any]:
        return await self._get_q("/api/packet_type_stats", {"hours": hours})

    async def noise_floor_stats(self, hours: int = 24) -> dict[str, Any]:
        return await self._get_q("/api/noise_floor_stats", {"hours": hours})

    async def airtime_chart_data(
        self,
        start_ts: float,
        end_ts: float,
        *,
        bucket_seconds: int,
        sf: int,
        bw_hz: int,
        cr: int,
        preamble: int = 17,
    ) -> dict[str, Any]:
        """Server-side aggregated TX/RX airtime buckets for a time range.

        OpenHop derives per-packet time-on-air from its packet DB (RX and TX),
        so this reports real RX airtime even though the companion STATS_RADIO
        frame hardcodes ``rx_air_secs`` to 0. ``preamble`` defaults to OpenHop's
        own default (17). Response is the standard ``{success, data}`` envelope
        whose ``data`` holds ``buckets`` + ``bucket_seconds``.
        """
        return await self._get_q(
            "/api/airtime_chart_data",
            {
                "start_timestamp": start_ts,
                "end_timestamp": end_ts,
                "bucket_seconds": bucket_seconds,
                "sf": sf,
                "bw_hz": bw_hz,
                "cr": cr,
                "preamble": preamble,
            },
        )

    # --- Transport keys + neighbor scopes -------------------------------
    async def transport_keys(self) -> dict[str, Any]:
        return await self._get("/api/transport_keys")

    async def create_transport_key(self, name: str) -> dict[str, Any]:
        return await self._post("/api/transport_keys", {"name": name})

    async def transport_key(self, key_id: str) -> dict[str, Any]:
        return await self._get_q("/api/transport_key", {"key_id": key_id})

    async def delete_transport_key(self, key_id: str) -> dict[str, Any]:
        r = await self._client.request("DELETE", "/api/transport_key", params={"key_id": key_id})
        r.raise_for_status()
        return r.json()

    async def neighbor_scopes(self) -> dict[str, Any]:
        return await self._get("/api/neighbor_scopes")

    async def query_neighbor_scopes(self, pubkey: str) -> dict[str, Any]:
        return await self._post("/api/query_neighbor_scopes", {"pubkey": pubkey})

    # --- MQTT config ----------------------------------------------------
    async def mqtt_status(self) -> dict[str, Any]:
        return await self._get("/api/mqtt_status")

    async def broker_presets(self) -> dict[str, Any]:
        return await self._get("/api/broker_presets")

    async def update_mqtt_config(self, config: dict[str, Any]) -> dict[str, Any]:
        return await self._post("/api/update_mqtt_config", config)

    async def publish_neighbors(self) -> dict[str, Any]:
        return await self._post("/api/publish_neighbors", {})

    async def aclose(self) -> None:
        await self._client.aclose()
