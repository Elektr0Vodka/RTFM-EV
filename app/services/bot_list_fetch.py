"""Fetch a bot list file from a URL the user subscribed to.

Only ``https``. Every request goes to an address ``url_safety`` validated as
public, with the original host kept as ``Host`` header and TLS SNI, so the
address that was checked is the one contacted. Redirects are followed by hand,
at most ``MAX_REDIRECTS``, with the same checks per hop.

The other end is not trusted: the body is asked for and read uncompressed (a
compressed one is refused, since it could expand far past the cap), reading
stops at the file size cap, and the whole fetch (name lookup, every hop, the
body) has one deadline. Nothing here transmits on the radio.
"""

from __future__ import annotations

import asyncio
import contextvars
import logging
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx

from app.bot_lists.format import MAX_FILE_BYTES, BotListFile, BotListFormatError, parse_bot_list
from app.services.url_safety import UnsafeUrlError, resolve_public_ip

# Per network operation (connect, one read). A server that drips bytes stays
# under it, so FETCH_DEADLINE bounds the fetch as a whole.
FETCH_TIMEOUT = 10.0
FETCH_DEADLINE = 20.0
MAX_REDIRECTS = 3
MAX_URL_LENGTH = 2048
_MAX_PUBLIC_DETAIL = 200
_USER_AGENT = "RTFM-EV-BotList/1.0 (+https://github.com/Elektr0Vodka/RTFM-EV)"

_fetching: contextvars.ContextVar[bool] = contextvars.ContextVar("bot_list_fetching", default=False)


class _NoRequestLine(logging.Filter):
    """Drop httpx's request line for these fetches.

    httpx logs every request at INFO with its full URL: here that is the pinned
    address and the query, which can carry a token. The app's log is also served
    by the debug snapshot, so the line is not written at all.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        return not _fetching.get()


logging.getLogger("httpx").addFilter(_NoRequestLine())


class BotListFetchError(Exception):
    """A subscription could not be fetched.

    ``code`` is safe to show and to store. ``detail`` can name a resolved
    address or carry exception text, so it only goes to the server log, except
    for ``invalid_file`` where it is the format message about the file itself
    (cut short: the file is someone else's text).
    """

    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(code)
        self.code = code
        self.detail = detail

    def public_text(self) -> str:
        if self.code == "invalid_file" and self.detail:
            return f"invalid_file: {self.detail[:_MAX_PUBLIC_DETAIL]}"
        return self.code


def check_subscription_url(url: str) -> str:
    """The URL as it is stored and fetched: ``https``, no credentials, no fragment."""
    cleaned = url.strip()
    if len(cleaned) > MAX_URL_LENGTH:
        raise BotListFetchError("bad_url", "longer than the URL limit")
    try:
        parts = urlsplit(cleaned)
        port = parts.port
    except ValueError as exc:
        raise BotListFetchError("bad_url", str(exc)) from exc
    if parts.scheme != "https":
        raise BotListFetchError("not_https", f"scheme {parts.scheme!r}")
    host = parts.hostname
    if not host or parts.username is not None or parts.password is not None:
        raise BotListFetchError("bad_url", "no host, or credentials in the URL")
    if ":" in host:  # IPv6 literal
        host = f"[{host}]"
    netloc = host if port is None else f"{host}:{port}"
    return urlunsplit(("https", netloc, parts.path or "/", parts.query, ""))


async def _get_once(client: httpx.AsyncClient, target: str) -> tuple[int, str | None, bytes]:
    """One GET to a freshly validated address: (status, redirect location, body)."""
    ip = await asyncio.to_thread(resolve_public_ip, target)
    parts = urlsplit(target)
    ip_netloc = f"[{ip}]" if ":" in ip else ip
    if parts.port:
        ip_netloc = f"{ip_netloc}:{parts.port}"
    pinned = urlunsplit((parts.scheme, ip_netloc, parts.path or "/", parts.query, ""))
    async with client.stream(
        "GET",
        pinned,
        headers={
            "User-Agent": _USER_AGENT,
            "Accept": "application/json, text/plain;q=0.9, */*;q=0.1",
            "Accept-Encoding": "identity",
            "Host": parts.netloc,
        },
        # SNI and certificate verification use the real host name, not the IP.
        extensions={"sni_hostname": parts.hostname or ""},
    ) as response:
        location = response.headers.get("location")
        if response.is_redirect and location:
            return response.status_code, location, b""
        encoding = response.headers.get("content-encoding", "").strip().lower()
        if encoding not in ("", "identity"):
            # Decompressing first would let a small body expand past the cap.
            raise BotListFetchError("fetch_failed", f"content-encoding {encoding!r} not accepted")
        body = bytearray()
        # With no Content-Encoding (checked above) httpx decodes nothing, so these
        # are the bytes as sent and the cap below is a cap on memory too.
        async for chunk in response.aiter_bytes():
            body.extend(chunk)
            if len(body) > MAX_FILE_BYTES:
                raise BotListFetchError("too_large", f"more than {MAX_FILE_BYTES} bytes")
        return response.status_code, None, bytes(body)


async def _fetch_body(start: str, transport: httpx.AsyncBaseTransport | None) -> bytes:
    current = start
    async with httpx.AsyncClient(
        timeout=FETCH_TIMEOUT, follow_redirects=False, transport=transport
    ) as client:
        for _hop in range(MAX_REDIRECTS + 1):
            status, location, body = await _get_once(client, current)
            if location is not None:
                # Resolve against the real URL, then check the new hop like the first.
                current = check_subscription_url(urljoin(current, location))
                continue
            if status != 200:
                raise BotListFetchError("http_error", f"status {status}")
            return body
    raise BotListFetchError("too_many_redirects")


async def fetch_bot_list(
    url: str, *, transport: httpx.AsyncBaseTransport | None = None
) -> BotListFile:
    """Fetch and validate the bot list at ``url``. ``transport`` is for tests."""
    start = check_subscription_url(url)
    quiet = _fetching.set(True)
    try:
        async with asyncio.timeout(FETCH_DEADLINE):
            body = await _fetch_body(start, transport)
    except TimeoutError as exc:
        raise BotListFetchError("fetch_failed", f"no answer within {FETCH_DEADLINE} s") from exc
    except UnsafeUrlError as exc:
        raise BotListFetchError("unsafe_url", str(exc)) from exc
    except httpx.HTTPError as exc:
        raise BotListFetchError("fetch_failed", f"{type(exc).__name__}: {exc}") from exc
    except (ValueError, httpx.InvalidURL) as exc:
        # A host name the resolver or httpx cannot handle (empty or overlong label).
        raise BotListFetchError("bad_url", f"{type(exc).__name__}: {exc}") from exc
    finally:
        _fetching.reset(quiet)
    try:
        return parse_bot_list(body)
    except BotListFormatError as exc:
        raise BotListFetchError("invalid_file", str(exc)) from exc
