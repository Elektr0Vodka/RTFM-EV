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
