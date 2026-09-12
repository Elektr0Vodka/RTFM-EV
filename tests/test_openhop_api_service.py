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
