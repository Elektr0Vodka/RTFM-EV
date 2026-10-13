"""The guarded fetch behind chat link previews: the other end is not trusted."""

import asyncio
import gzip

import httpx
import pytest

from app.services import unfurl
from app.services.unfurl import fetch_link_preview
from app.services.url_safety import UnsafeUrlError

PUBLIC_IP = "93.184.216.34"
PAGE = b"<html><head><title>Hello</title></head><body>x</body></html>"
URL = "https://example.org/page"


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    """No cached previews, and every host resolves to one public address."""
    unfurl._cache.clear()
    monkeypatch.setattr(unfurl, "resolve_public_ip", lambda url: PUBLIC_IP)
    yield
    unfurl._cache.clear()


def _html(body=PAGE, **headers) -> httpx.Response:
    return httpx.Response(
        200, headers={"content-type": "text/html; charset=utf-8", **headers}, content=body
    )


def _fetch(handler):
    return fetch_link_preview(URL, transport=httpx.MockTransport(handler))


@pytest.mark.asyncio
async def test_a_page_gives_its_title_through_the_checked_address():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["host_in_url"] = request.url.host
        seen["host_header"] = request.headers["host"]
        seen["accept_encoding"] = request.headers.get("accept-encoding")
        return _html()

    preview = await _fetch(handler)
    assert preview.title == "Hello"
    assert seen == {
        "host_in_url": PUBLIC_IP,
        "host_header": "example.org",
        "accept_encoding": "identity",
    }


@pytest.mark.asyncio
async def test_a_compressed_answer_is_not_unpacked():
    def handler(request: httpx.Request) -> httpx.Response:
        return _html(gzip.compress(PAGE), **{"content-encoding": "gzip"})

    preview = await _fetch(handler)
    assert preview.is_empty() and preview.url == URL


@pytest.mark.asyncio
async def test_reading_stops_at_the_size_cap():
    sent = {"chunks": 0}

    async def endless():
        yield b"<html><head><title>Big</title></head><body>"
        for _ in range(200):  # finite: a missing cap fails the test, it does not hang it
            sent["chunks"] += 1
            yield b" " * 65536

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"content-type": "text/html"}, content=endless())

    preview = await _fetch(handler)
    assert preview.title == "Big"
    assert sent["chunks"] <= unfurl._MAX_BYTES // 65536 + 2


@pytest.mark.asyncio
async def test_the_whole_fetch_has_one_deadline(monkeypatch):
    monkeypatch.setattr(unfurl, "_FETCH_DEADLINE", 0.2)

    async def dripping():
        yield b"<html><head>"
        for _ in range(60):  # three seconds in all: finite, and far past the deadline
            await asyncio.sleep(0.05)  # each read is well inside the per-read timeout
            yield b" "

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"content-type": "text/html"}, content=dripping())

    with pytest.raises(TimeoutError):
        await _fetch(handler)


@pytest.mark.asyncio
async def test_something_that_is_not_a_page_is_not_read():
    sent = {"chunks": 0}

    async def endless():
        for _ in range(200):
            sent["chunks"] += 1
            yield b"\x00" * 65536

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, headers={"content-type": "application/octet-stream"}, content=endless()
        )

    preview = await _fetch(handler)
    assert preview.is_empty()
    assert sent["chunks"] <= 1


@pytest.mark.asyncio
async def test_a_redirect_is_followed_and_checked_again(monkeypatch):
    checked: list[str] = []

    def resolve(url: str) -> str:
        checked.append(url)
        return PUBLIC_IP

    monkeypatch.setattr(unfurl, "resolve_public_ip", resolve)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.headers["host"] == "example.org":
            return httpx.Response(302, headers={"location": "https://other.example/there"})
        return _html()

    preview = await _fetch(handler)
    assert preview.title == "Hello"
    assert checked == [URL, "https://other.example/there"]


@pytest.mark.asyncio
async def test_a_redirect_to_a_private_address_is_refused(monkeypatch):
    def resolve(url: str) -> str:
        if "internal" in url:
            raise UnsafeUrlError("host resolves to non-public address: 10.0.0.5")
        return PUBLIC_IP

    monkeypatch.setattr(unfurl, "resolve_public_ip", resolve)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "https://internal.example/admin"})

    with pytest.raises(UnsafeUrlError):
        await _fetch(handler)


@pytest.mark.asyncio
async def test_too_many_redirects_are_refused():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "https://example.org/again"})

    with pytest.raises(UnsafeUrlError, match="too many redirects"):
        await _fetch(handler)


@pytest.mark.asyncio
async def test_a_preview_is_cached():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return _html()

    await _fetch(handler)
    await _fetch(handler)
    assert calls["n"] == 1


@pytest.mark.asyncio
async def test_a_charset_the_page_makes_up_is_read_as_utf8():
    """Some codecs Python knows take seconds on hostile input, on the event loop."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, headers={"content-type": "text/html; charset=punycode"}, content=PAGE
        )

    preview = await _fetch(handler)
    assert preview.title == "Hello"


@pytest.mark.asyncio
async def test_a_common_charset_is_honoured():
    page = "<html><head><title>Caf\u00e9</title></head></html>".encode("iso-8859-1")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, headers={"content-type": "text/html; charset=ISO-8859-1"}, content=page
        )

    preview = await _fetch(handler)
    assert preview.title == "Caf\u00e9"


def test_only_plain_charsets_are_used():
    assert unfurl._page_charset("ISO-8859-1") == "iso8859-1"
    assert unfurl._page_charset("windows-1252") == "cp1252"
    assert unfurl._page_charset("UTF-8") == "utf-8"
    for made_up in ("punycode", "idna", "zlib", "hex", "utf-7", "bogus", "", None):
        assert unfurl._page_charset(made_up) == "utf-8"


@pytest.mark.asyncio
async def test_the_name_lookup_runs_off_the_event_loop(monkeypatch):
    import threading

    seen = {}

    def resolve(url: str) -> str:
        seen["thread"] = threading.current_thread()
        return PUBLIC_IP

    monkeypatch.setattr(unfurl, "resolve_public_ip", resolve)
    await _fetch(lambda request: _html())
    assert seen["thread"] is not threading.main_thread()
