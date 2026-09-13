import httpx
import pytest

from app.services.openhop_api import OpenHopClient


def _handler(request: httpx.Request) -> httpx.Response:
    if request.url.path == "/api/policy":
        assert request.headers.get("X-API-Key") == "tok"
        return httpx.Response(
            200,
            json={
                "success": True,
                "data": {
                    "policy_engine": {
                        "enabled": False,
                        "default_action": "allow",
                        "rules": [],
                    }
                },
            },
        )
    if request.url.path == "/api/cli":
        return httpx.Response(
            200, json={"success": True, "data": {"reply": "openHop_repeater v13"}}
        )
    return httpx.Response(404, json={"success": False})


@pytest.mark.asyncio
async def test_get_policy_and_cli_use_api_key():
    transport = httpx.MockTransport(_handler)
    client = OpenHopClient("http://node:8000", token="tok", transport=transport)
    policy = await client.get_policy()
    assert policy["data"]["policy_engine"]["default_action"] == "allow"
    ver = await client.cli("ver")
    assert ver["data"]["reply"] == "openHop_repeater v13"
    await client.aclose()


@pytest.mark.asyncio
async def test_policy_and_group_methods_use_api_key():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen[(request.method, request.url.path)] = request.headers.get("X-API-Key")
        if request.url.path == "/api/policy" and request.method == "POST":
            return httpx.Response(200, json={"success": True})
        if request.url.path == "/api/policy_validate":
            return httpx.Response(200, json={"success": True, "data": {"valid": True}})
        if request.url.path == "/api/policy_groups" and request.method == "GET":
            return httpx.Response(200, json={"success": True, "data": {}})
        if request.url.path == "/api/policy_groups" and request.method == "POST":
            return httpx.Response(200, json={"success": True})
        if request.url.path == "/api/policy_groups" and request.method == "DELETE":
            return httpx.Response(200, json={"success": True})
        if request.url.path == "/api/policy_group_entries" and request.method == "POST":
            return httpx.Response(200, json={"success": True})
        if request.url.path == "/api/policy_group_entries" and request.method == "DELETE":
            return httpx.Response(200, json={"success": True})
        return httpx.Response(404, json={"success": False})

    client = OpenHopClient("http://node:8000", token="tok", transport=httpx.MockTransport(handler))
    assert (await client.update_policy({"enabled": True}))["success"] is True
    assert (await client.validate_policy({"enabled": True}))["data"]["valid"] is True
    await client.list_policy_groups()
    await client.create_policy_group("channel_hashes", "g1", friendly_name="G1")
    await client.delete_policy_group("channel_hashes", "g1")
    await client.add_group_entry("channel_hashes", "g1", "0x1f")
    await client.delete_group_entry("channel_hashes", "g1", value="0x1f")
    await client.aclose()
    assert all(v == "tok" for v in seen.values())


@pytest.mark.asyncio
async def test_plugin_read_methods_use_api_key():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen[(request.method, request.url.path, request.url.query.decode())] = request.headers.get(
            "X-API-Key"
        )
        return httpx.Response(200, json={"success": True, "plugins": [], "data": {}})

    client = OpenHopClient("http://node:8000", token="tok", transport=httpx.MockTransport(handler))
    await client.list_plugins()
    await client.plugin_status("openhop.nomad")
    await client.plugin_catalogue()
    await client.plugin_catalogue(force_refresh=True)
    await client.plugin_logs("openhop.nomad", tail=50)
    await client.get_plugin_config("openhop.nomad")
    await client.check_plugin_update("openhop.nomad")
    await client.aclose()
    assert ("GET", "/api/plugins/", "") in seen
    assert ("GET", "/api/plugins/openhop.nomad", "") in seen
    assert ("GET", "/api/plugins/catalogue", "") in seen
    assert ("GET", "/api/plugins/catalogue", "refresh=1") in seen
    assert ("GET", "/api/plugins/logs", "id=openhop.nomad&tail=50") in seen
    assert ("GET", "/api/plugins/settings", "id=openhop.nomad") in seen
    assert ("GET", "/api/plugins/updates", "id=openhop.nomad") in seen
    assert all(v == "tok" for v in seen.values())


@pytest.mark.asyncio
async def test_plugin_write_methods_send_expected_bodies():
    bodies = {}

    def handler(request: httpx.Request) -> httpx.Response:
        import json as _json

        body = _json.loads(request.content.decode() or "{}")
        bodies[request.url.path] = (request.method, body, request.headers.get("X-API-Key"))
        return httpx.Response(200, json={"success": True})

    client = OpenHopClient("http://node:8000", token="tok", transport=httpx.MockTransport(handler))
    await client.enable_plugin("p1")
    await client.disable_plugin("p1")
    await client.start_plugin("p1")
    await client.stop_plugin("p1")
    await client.restart_plugin("p1")
    await client.catalogue_install("p1", version="2.0.0")
    await client.update_plugin("p1")
    await client.set_plugin_config("p1", {"k": 1}, restart=True)
    await client.uninstall_plugin("p1", delete_data=True)
    await client.aclose()
    assert bodies["/api/plugins/enable"] == ("POST", {"id": "p1"}, "tok")
    assert bodies["/api/plugins/catalogue_install"][1] == {"id": "p1", "version": "2.0.0"}
    assert bodies["/api/plugins/update"][1] == {"id": "p1"}
    assert bodies["/api/plugins/settings"][1] == {"id": "p1", "config": {"k": 1}, "restart": True}
    assert bodies["/api/plugins/uninstall"][1] == {"id": "p1", "delete_data": True}


@pytest.mark.asyncio
async def test_config_family_methods_use_api_key_and_paths():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen[(request.method, request.url.path)] = request.headers.get("X-API-Key")
        p, m = request.url.path, request.method
        if p == "/api/config_export" and m == "GET":
            return httpx.Response(200, json={"success": True, "data": {"meta": {}, "config": {}}})
        if p == "/api/config_import" and m == "POST":
            return httpx.Response(200, json={"success": True, "sections_updated": ["repeater"]})
        if p == "/api/validate_config" and m == "GET":
            return httpx.Response(200, json={"success": True, "data": {"valid": True}})
        if p == "/api/update_radio_config" and m == "POST":
            return httpx.Response(200, json={"success": True, "data": {"applied": ["txpower=22"]}})
        if p == "/api/set_mode" and m == "POST":
            return httpx.Response(200, json={"success": True, "mode": "forward"})
        if p == "/api/hardware_options" and m == "GET":
            return httpx.Response(200, json={"hardware": []})
        if p == "/api/radio_presets" and m == "GET":
            return httpx.Response(200, json={"presets": [], "source": "local"})
        if p == "/api/restart_service" and m == "POST":
            return httpx.Response(200, json={"success": True, "message": "ok"})
        return httpx.Response(404, json={"success": False})

    client = OpenHopClient("http://node:8000", token="tok", transport=httpx.MockTransport(handler))
    assert (await client.config_export())["success"] is True
    assert (await client.config_export(include_secrets=True))["success"] is True
    assert (await client.config_import({"repeater": {"node_name": "N"}}, restart_after=False))[
        "sections_updated"
    ] == ["repeater"]
    assert (await client.validate_config())["data"]["valid"] is True
    assert (await client.update_radio_config({"tx_power": 22}))["data"]["applied"] == ["txpower=22"]
    assert (await client.set_mode("forward"))["mode"] == "forward"
    assert (await client.hardware_options())["hardware"] == []
    assert (await client.radio_presets())["source"] == "local"
    assert (await client.restart_service())["message"] == "ok"
    await client.aclose()
    assert all(v == "tok" for v in seen.values())
    assert ("GET", "/api/config_export") in seen


@pytest.mark.asyncio
async def test_update_methods_use_api_key_and_paths():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen[(request.method, request.url.path)] = request.headers.get("X-API-Key")
        p, m = request.url.path, request.method
        if p == "/api/update/status" and m == "GET":
            return httpx.Response(
                200,
                json={
                    "success": True,
                    "state": "idle",
                    "current_version": "1.0.6.dev10",
                    "channel": "main",
                },
            )
        if p == "/api/update/check" and m == "POST":
            return httpx.Response(200, json={"success": True, "state": "checking"})
        if p == "/api/update/install" and m == "POST":
            return httpx.Response(200, json={"success": True, "state": "installing"})
        if p == "/api/update/channels" and m == "GET":
            return httpx.Response(
                200,
                json={"success": True, "channels": ["main", "dev"], "current_channel": "main"},
            )
        if p == "/api/update/set_channel" and m == "POST":
            return httpx.Response(200, json={"success": True, "channel": "dev"})
        if p == "/api/update/changelog" and m == "GET":
            return httpx.Response(200, json={"success": True, "commits": []})
        return httpx.Response(404, json={"success": False})

    client = OpenHopClient("http://n:8000", token="tok", transport=httpx.MockTransport(handler))
    assert (await client.update_status())["state"] == "idle"
    assert (await client.update_check(force=True))["state"] == "checking"
    assert (await client.update_install(force=False))["state"] == "installing"
    assert (await client.update_channels())["channels"] == ["main", "dev"]
    assert (await client.update_set_channel("dev"))["channel"] == "dev"
    assert (await client.update_changelog(channel="main", max_commits=10))["success"] is True
    await client.aclose()
    assert all(v == "tok" for v in seen.values())


@pytest.mark.asyncio
async def test_cad_methods():
    def handler(request: httpx.Request) -> httpx.Response:
        p, m = request.url.path, request.method
        if p == "/api/cad_calibration_start" and m == "POST":
            return httpx.Response(200, json={"success": True})
        if p == "/api/cad_calibration_stop" and m == "POST":
            return httpx.Response(200, json={"success": True})
        if p == "/api/cad_manual_check" and m == "POST":
            return httpx.Response(
                200,
                json={
                    "success": True,
                    "data": {"detected": False, "detection_rate": 0.0, "attempts": 1},
                },
            )
        if p == "/api/save_cad_settings" and m == "POST":
            return httpx.Response(200, json={"success": True})
        return httpx.Response(404, json={"success": False})

    c = OpenHopClient("http://n:8000", token="tok", transport=httpx.MockTransport(handler))
    assert (await c.cad_start(samples=8, delay=100))["success"]
    assert (await c.cad_stop())["success"]
    assert (await c.cad_manual_check({"samples": 1}))["data"]["attempts"] == 1
    assert (await c.cad_save(peak=127, min_val=64, cad_symbol_num=2))["success"]
    await c.aclose()


@pytest.mark.asyncio
async def test_system_and_analytics_methods():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"success": True, "data": {"ok": request.url.path}})

    c = OpenHopClient("http://n:8000", token="tok", transport=httpx.MockTransport(handler))
    assert (await c.hardware_stats())["data"]["ok"] == "/api/hardware_stats"
    assert (await c.hardware_processes())["data"]["ok"] == "/api/hardware_processes"
    assert (await c.node_stats())["data"]["ok"] == "/api/stats"
    assert (await c.packet_stats(hours=24))["data"]["ok"] == "/api/packet_stats"
    assert (await c.packet_type_stats(hours=24))["data"]["ok"] == "/api/packet_type_stats"
    assert (await c.noise_floor_stats(hours=24))["data"]["ok"] == "/api/noise_floor_stats"
    await c.aclose()


@pytest.mark.asyncio
async def test_transport_and_scope_methods():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen[(request.method, request.url.path)] = dict(request.url.params)
        p, m = request.url.path, request.method
        if p == "/api/transport_keys" and m == "GET":
            return httpx.Response(200, json={"success": True, "data": [], "count": 0})
        if p == "/api/transport_keys" and m == "POST":
            return httpx.Response(200, json={"success": True})
        if p == "/api/transport_key" and m == "GET":
            return httpx.Response(200, json={"success": True, "data": {"id": "k1"}})
        if p == "/api/transport_key" and m == "DELETE":
            return httpx.Response(200, json={"success": True})
        if p == "/api/neighbor_scopes" and m == "GET":
            return httpx.Response(
                200, json={"success": True, "count": 0, "data": {}, "served": {"scopes": "*"}}
            )
        if p == "/api/query_neighbor_scopes" and m == "POST":
            return httpx.Response(200, json={"success": True, "data": {"status": "timeout"}})
        return httpx.Response(404, json={"success": False})

    c = OpenHopClient("http://n:8000", token="tok", transport=httpx.MockTransport(handler))
    assert (await c.transport_keys())["data"] == []
    assert (await c.create_transport_key("home"))["success"]
    assert (await c.transport_key("k1"))["data"]["id"] == "k1"
    assert (await c.delete_transport_key("k1"))["success"]
    assert (await c.neighbor_scopes())["served"]["scopes"] == "*"
    assert (await c.query_neighbor_scopes("ab" * 32))["data"]["status"] == "timeout"
    await c.aclose()
    assert seen[("GET", "/api/transport_key")] == {"key_id": "k1"}
    assert seen[("DELETE", "/api/transport_key")] == {"key_id": "k1"}


@pytest.mark.asyncio
async def test_mqtt_methods():
    body_seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        import json as _json

        p, m = request.url.path, request.method
        if p == "/api/mqtt_status" and m == "GET":
            return httpx.Response(200, json={"success": True, "data": {"handler_active": False}})
        if p == "/api/broker_presets" and m == "GET":
            return httpx.Response(200, json={"success": True, "data": []})
        if p == "/api/update_mqtt_config" and m == "POST":
            body_seen.update(_json.loads(request.content))
            return httpx.Response(200, json={"success": True})
        if p == "/api/publish_neighbors" and m == "POST":
            return httpx.Response(200, json={"success": True})
        return httpx.Response(404, json={"success": False})

    c = OpenHopClient("http://n:8000", token="tok", transport=httpx.MockTransport(handler))
    assert (await c.mqtt_status())["data"]["handler_active"] is False
    assert (await c.broker_presets())["data"] == []
    assert (await c.update_mqtt_config({"owner": "Callsign"}))["success"]
    assert (await c.publish_neighbors())["success"]
    await c.aclose()
    assert body_seen == {"owner": "Callsign"}
