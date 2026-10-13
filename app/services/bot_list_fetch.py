"""Fetch a bot list file from a URL the user subscribed to.

Only ``https``. Every request goes to an address ``url_safety`` validated as
public, with the original host kept as ``Host`` header and TLS SNI, so the
address that was checked is the one contacted. Redirects are followed by hand,
at most ``MAX_REDIRECTS``, with the same checks per hop. Reading stops at the
file size cap. Nothing here transmits on the radio.
"""

from __future__ import annotations

import asyncio
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx

from app.bot_lists.format import MAX_FILE_BYTES, BotListFile, BotListFormatError, parse_bot_list
from app.services.url_safety import UnsafeUrlError, resolve_public_ip

FETCH_TIMEOUT = 10.0
MAX_REDIRECTS = 3
MAX_URL_LENGTH = 2048
_USER_AGENT = "RTFM-EV-BotList/1.0 (+https://github.com/Elektr0Vodka/RTFM-EV)"


class BotListFetchError(Exception):
    """A subscription could not be fetched.

    ``code`` is safe to show and to store. ``detail`` can name a resolved
    address or carry exception text, so it only goes to the server log, except
    for ``invalid_file`` where it is the format message about the file itself.
    """

    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(code)
        self.code = code
        self.detail = detail

    def public_text(self) -> str:
        if self.code == "invalid_file" and self.detail:
            return f"invalid_file: {self.detail}"
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
            "Host": parts.netloc,
        },
        # SNI and certificate verification use the real host name, not the IP.
        extensions={"sni_hostname": parts.hostname or ""},
    ) as response:
        location = response.headers.get("location")
        if response.is_redirect and location:
            return response.status_code, location, b""
        body = bytearray()
        async for chunk in response.aiter_bytes():
            body.extend(chunk)
            if len(body) > MAX_FILE_BYTES:
                raise BotListFetchError("too_large", f"more than {MAX_FILE_BYTES} bytes")
        return response.status_code, None, bytes(body)


async def fetch_bot_list(
    url: str, *, transport: httpx.AsyncBaseTransport | None = None
) -> BotListFile:
    """Fetch and validate the bot list at ``url``. ``transport`` is for tests."""
    current = check_subscription_url(url)
    body = b""
    try:
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
                break
            else:
                raise BotListFetchError("too_many_redirects")
    except UnsafeUrlError as exc:
        raise BotListFetchError("unsafe_url", str(exc)) from exc
    except httpx.HTTPError as exc:
        raise BotListFetchError("fetch_failed", f"{type(exc).__name__}: {exc}") from exc
    try:
        return parse_bot_list(body)
    except BotListFormatError as exc:
        raise BotListFetchError("invalid_file", str(exc)) from exc
