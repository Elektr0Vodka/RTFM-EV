"""Tests for the guarded fetch of a subscribed bot list."""

import json

import httpx
import pytest

from app.bot_lists.format import MAX_FILE_BYTES
from app.services import bot_list_fetch
from app.services.bot_list_fetch import BotListFetchError, check_subscription_url, fetch_bot_list
from app.services.url_safety import UnresolvedHostError, UnsafeUrlError

PUBLIC_IP = "93.184.216.34"
FILE = {
    "format": "rtfm-ev-bot-list",
    "version": 1,
    "name": "Shared",
    "entries": [{"name": "PingBot"}],
}


@pytest.fixture
def resolved(monkeypatch):
    """Every host resolves to one public address; the calls are recorded."""
    calls: list[str] = []

    def fake(url: str) -> str:
        calls.append(url)
        return PUBLIC_IP

    monkeypatch.setattr(bot_list_fetch, "resolve_public_ip", fake)
    return calls


def _transport(handler):
    return httpx.MockTransport(handler)


def test_check_keeps_an_https_url_and_drops_the_fragment():
    assert (
        check_subscription_url(" https://example.org/lists/bots.json?v=1#top ")
        == "https://example.org/lists/bots.json?v=1"
    )


@pytest.mark.parametrize(
    ("url", "code"),
    [
        ("http://example.org/bots.json", "not_https"),
        ("ftp://example.org/bots.json", "not_https"),
        ("example.org/bots.json", "not_https"),
        ("https:///bots.json", "bad_url"),
        ("https://user:secret@example.org/bots.json", "bad_url"),
        ("https://example.org/" + "a" * 2100, "bad_url"),
    ],
)
def test_check_refuses(url, code):
    with pytest.raises(BotListFetchError) as caught:
        check_subscription_url(url)
    assert caught.value.code == code


@pytest.mark.asyncio
async def test_fetches_through_the_checked_address_with_the_real_host(resolved):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["host_in_url"] = request.url.host
        seen["host_header"] = request.headers["host"]
        seen["path"] = request.url.path
        return httpx.Response(200, content=json.dumps(FILE))

    parsed = await fetch_bot_list(
        "https://example.org/lists/bots.json", transport=_transport(handler)
    )
    assert parsed.name == "Shared"
    assert seen == {
        "host_in_url": PUBLIC_IP,
        "host_header": "example.org",
        "path": "/lists/bots.json",
    }
    assert resolved == ["https://example.org/lists/bots.json"]


@pytest.mark.asyncio
async def test_checks_every_redirect_hop(resolved):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.headers["host"] == "example.org":
            return httpx.Response(302, headers={"location": "https://cdn.example.net/b.json"})
        return httpx.Response(200, content=json.dumps(FILE))

    parsed = await fetch_bot_list("https://example.org/b.json", transport=_transport(handler))
    assert parsed.name == "Shared"
    assert resolved == ["https://example.org/b.json", "https://cdn.example.net/b.json"]


@pytest.mark.asyncio
async def test_refuses_a_redirect_to_http(resolved):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "http://example.org/b.json"})

    with pytest.raises(BotListFetchError) as caught:
        await fetch_bot_list("https://example.org/b.json", transport=_transport(handler))
    assert caught.value.code == "not_https"
    assert resolved == ["https://example.org/b.json"]


@pytest.mark.asyncio
async def test_refuses_an_address_that_is_not_public(monkeypatch):
    def unsafe(url: str) -> str:
        raise UnsafeUrlError("host resolves to non-public address: 10.0.0.5")

    monkeypatch.setattr(bot_list_fetch, "resolve_public_ip", unsafe)

    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("no request may be sent")

    with pytest.raises(BotListFetchError) as caught:
        await fetch_bot_list("https://intranet.example/b.json", transport=_transport(handler))
    assert caught.value.code == "unsafe_url"
    assert caught.value.public_text() == "unsafe_url"
    assert "10.0.0.5" in caught.value.detail


@pytest.mark.asyncio
async def test_gives_up_after_too_many_redirects(resolved):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "https://example.org/again"})

    with pytest.raises(BotListFetchError) as caught:
        await fetch_bot_list("https://example.org/b.json", transport=_transport(handler))
    assert caught.value.code == "too_many_redirects"
    assert len(resolved) == 4


@pytest.mark.asyncio
async def test_stops_reading_at_the_size_cap(resolved):
    sent = {"chunks": 0}

    async def endless():
        while True:
            sent["chunks"] += 1
            yield b" " * 65536

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=endless())

    with pytest.raises(BotListFetchError) as caught:
        await fetch_bot_list("https://example.org/b.json", transport=_transport(handler))
    assert caught.value.code == "too_large"
    assert sent["chunks"] <= MAX_FILE_BYTES // 65536 + 2


@pytest.mark.asyncio
async def test_a_status_other_than_200_is_an_error(resolved):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, content=b"not here")

    with pytest.raises(BotListFetchError) as caught:
        await fetch_bot_list("https://example.org/b.json", transport=_transport(handler))
    assert caught.value.code == "http_error"


@pytest.mark.asyncio
async def test_a_network_failure_is_an_error_without_the_exception_text(resolved):
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connect to 93.184.216.34 failed")

    with pytest.raises(BotListFetchError) as caught:
        await fetch_bot_list("https://example.org/b.json", transport=_transport(handler))
    assert caught.value.code == "fetch_failed"
    assert caught.value.public_text() == "fetch_failed"


@pytest.mark.asyncio
async def test_an_invalid_file_says_why(resolved):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=json.dumps({**FILE, "version": 2}))

    with pytest.raises(BotListFetchError) as caught:
        await fetch_bot_list("https://example.org/b.json", transport=_transport(handler))
    assert caught.value.code == "invalid_file"
    assert caught.value.public_text() == "invalid_file: unsupported bot list version 2"


@pytest.mark.asyncio
async def test_asks_for_an_uncompressed_body_and_refuses_a_compressed_one(resolved):
    import gzip

    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["accept_encoding"] = request.headers.get("accept-encoding")
        return httpx.Response(
            200,
            headers={"content-encoding": "gzip"},
            content=gzip.compress(b" " * (MAX_FILE_BYTES * 40)),
        )

    with pytest.raises(BotListFetchError) as caught:
        await fetch_bot_list("https://example.org/b.json", transport=_transport(handler))
    assert seen["accept_encoding"] == "identity"
    assert caught.value.code == "fetch_failed"
    assert "content-encoding" in caught.value.detail


@pytest.mark.asyncio
async def test_a_slow_server_hits_the_deadline_for_the_whole_fetch(resolved, monkeypatch):
    import asyncio
    import time

    monkeypatch.setattr(bot_list_fetch, "FETCH_DEADLINE", 0.2)

    async def handler(request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(30)
        return httpx.Response(200, content=json.dumps(FILE))

    started = time.monotonic()
    with pytest.raises(BotListFetchError) as caught:
        await fetch_bot_list("https://example.org/b.json", transport=_transport(handler))
    assert caught.value.code == "fetch_failed"
    assert time.monotonic() - started < 5


@pytest.mark.asyncio
async def test_deeply_nested_json_is_an_invalid_file_not_a_crash(resolved):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"[" * 100_000)

    with pytest.raises(BotListFetchError) as caught:
        await fetch_bot_list("https://example.org/b.json", transport=_transport(handler))
    assert caught.value.public_text() == "invalid_file: the file is not valid JSON"


@pytest.mark.asyncio
async def test_a_host_name_the_resolver_chokes_on_is_a_bad_url(monkeypatch):
    def choke(url: str) -> str:
        raise UnicodeError("label empty or too long")

    monkeypatch.setattr(bot_list_fetch, "resolve_public_ip", choke)

    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("no request may be sent")

    with pytest.raises(BotListFetchError) as caught:
        await fetch_bot_list("https://a..b/x.json", transport=_transport(handler))
    assert caught.value.code == "bad_url"


def test_the_public_text_of_an_invalid_file_is_kept_short():
    error = BotListFetchError("invalid_file", "x" * 5000)
    assert len(error.public_text()) <= 220
    assert error.public_text().startswith("invalid_file: xxx")


@pytest.mark.asyncio
async def test_the_request_line_with_address_and_query_is_not_logged(resolved, caplog):
    import logging

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=json.dumps(FILE))

    with caplog.at_level(logging.INFO, logger="httpx"):
        await fetch_bot_list(
            "https://example.org/b.json?token=secret", transport=_transport(handler)
        )
        during = [r.getMessage() for r in caplog.records if r.name == "httpx"]
        async with httpx.AsyncClient(transport=_transport(handler)) as other:
            await other.get("https://example.org/other")
        after = [r.getMessage() for r in caplog.records if r.name == "httpx"]

    assert during == []
    assert len(after) == 1 and "example.org/other" in after[0]


@pytest.mark.asyncio
async def test_a_host_that_does_not_exist_is_not_called_unsafe(monkeypatch):
    def no_such_host(url: str) -> str:
        raise UnresolvedHostError("host does not resolve: no-such-host.example")

    monkeypatch.setattr(bot_list_fetch, "resolve_public_ip", no_such_host)
    with pytest.raises(BotListFetchError) as caught:
        await fetch_bot_list("https://no-such-host.example/b.json")
    assert caught.value.code == "host_not_found"
    assert caught.value.public_text() == "host_not_found"


@pytest.mark.parametrize(
    ("url", "stored"),
    [
        ("https://example.org:443/b.json", "https://example.org/b.json"),
        ("https://EXAMPLE.org/b.json", "https://example.org/b.json"),
        ("https://example.org:8443/b.json", "https://example.org:8443/b.json"),
        ("https://[2001:db8::1]:443/b.json", "https://[2001:db8::1]/b.json"),
    ],
)
def test_check_writes_one_address_one_way(url, stored):
    assert check_subscription_url(url) == stored
