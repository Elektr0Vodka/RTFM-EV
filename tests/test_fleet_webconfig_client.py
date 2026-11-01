"""The HTTP side of an observer's web config (plan 32, Phase 4), against a fake device.

The fake answers as ``WebConfigServer.cpp`` does: a login sets the ``wcs``
cookie, every other call needs it, a save answers 202 and its result is polled.
"""

import httpx
import pytest

from app.services.fleet_webconfig import WebConfigError
from app.services.fleet_webconfig_client import WebConfigClient
from tests.fleet_webconfig_samples import FakeObserver, status

PASSWORD = FakeObserver.PASSWORD


def _client(fake: FakeObserver) -> WebConfigClient:
    return WebConfigClient(
        "192.168.1.20", transport=httpx.MockTransport(fake.handler), poll_delay=0
    )


@pytest.mark.asyncio
async def test_login_read_save_and_result() -> None:
    fake = FakeObserver()
    async with _client(fake) as client:
        assert (await client.status())["node_id"] == status()["node_id"]
        await client.login(PASSWORD)
        assert (await client.get_config())["radio"]["tx"] == 22
        request_id = await client.save("tx", "20")
        done = await client.result(request_id)
        await client.logout()

    assert done["state"] == "done" and done["results"][0]["key"] == "tx"
    assert fake.saved == [{"set": {"tx": "20"}, "reboot": False, "reqid": request_id}]
    assert len(request_id) == 16
    assert all(str(request.url).startswith("http://192.168.1.20/") for request in fake.requests)
    assert fake.requests[-1].url.path == "/api/logout"


@pytest.mark.asyncio
async def test_never_a_reboot_or_the_command_terminal() -> None:
    fake = FakeObserver(pending_polls=0)
    async with _client(fake) as client:
        await client.login(PASSWORD)
        await client.result(await client.save("snmp", "off"))

    assert all(body["reboot"] is False for body in fake.saved)
    assert not any(request.url.path.startswith("/api/cli") for request in fake.requests)
    assert not any(request.url.path == "/api/reboot" for request in fake.requests)


@pytest.mark.parametrize(("code", "expected"), [(401, "wrong_password"), (429, "locked")])
@pytest.mark.asyncio
async def test_login_refused(code: int, expected: str) -> None:
    fake = FakeObserver()
    fake.login_status = code
    async with _client(fake) as client:
        with pytest.raises(WebConfigError) as caught:
            await client.login(PASSWORD)
    assert caught.value.code == expected


@pytest.mark.asyncio
async def test_a_busy_device_is_reported() -> None:
    fake = FakeObserver()
    fake.save_status = 409
    async with _client(fake) as client:
        await client.login(PASSWORD)
        with pytest.raises(WebConfigError) as caught:
            await client.save("tx", "20")
    assert caught.value.code == "busy"


@pytest.mark.asyncio
async def test_a_result_that_never_comes() -> None:
    fake = FakeObserver(pending_polls=1000)
    async with _client(fake) as client:
        await client.login(PASSWORD)
        with pytest.raises(WebConfigError) as caught:
            await client.result(await client.save("tx", "20"), attempts=3)
    assert caught.value.code == "no_result"


@pytest.mark.asyncio
async def test_web_config_not_running() -> None:
    fake = FakeObserver()
    fake.running = False
    async with _client(fake) as client:
        with pytest.raises(WebConfigError) as caught:
            await client.status()
    assert caught.value.code == "not_running"


@pytest.mark.asyncio
async def test_unreachable() -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    async with WebConfigClient("192.168.1.20", transport=httpx.MockTransport(refuse)) as client:
        with pytest.raises(WebConfigError) as caught:
            await client.status()
    assert caught.value.code == "unreachable"


@pytest.mark.asyncio
async def test_an_ipv6_address_is_bracketed() -> None:
    fake = FakeObserver()
    async with WebConfigClient("fd00::1", transport=httpx.MockTransport(fake.handler)) as client:
        await client.status()
    assert str(fake.requests[0].url) == "http://[fd00::1]/api/status"
