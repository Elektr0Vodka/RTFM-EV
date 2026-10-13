"""Server-side link unfurl: fetch a URL and extract OpenGraph-style metadata.

Only used for chat link previews, gated by the ``chat_url_previews`` setting.
Outbound fetches are pinned to a validated public IP (see ``_fetch_once``), read
uncompressed up to a size cap, and bounded by one deadline for the whole fetch.
HTML parsing uses the stdlib ``html.parser`` (no new dep).
"""

import asyncio
import codecs
import logging
import time
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx

from app.services.url_safety import UnsafeUrlError, resolve_public_ip

logger = logging.getLogger(__name__)

# Per network operation (connect, one read). A server that drips bytes stays
# under it, so _FETCH_DEADLINE bounds the fetch as a whole.
_FETCH_TIMEOUT = 6.0
_FETCH_DEADLINE = 12.0
_MAX_BYTES = 256 * 1024
_MAX_REDIRECTS = 3
_CACHE_TTL = 3600.0
_USER_AGENT = "RTFM-EV-LinkPreview/1.0 (+https://github.com/Elektr0Vodka/RTFM-EV)"
# Charsets a page may name for itself (as ``codecs.lookup`` spells them).
# Anything else is read as UTF-8: the page picks the codec, the decode runs on
# the event loop, and some codecs Python knows (``punycode``) take seconds on a
# body built for it.
_CHARSETS = frozenset(
    {"utf-8", "ascii", "iso8859-1", "iso8859-2", "iso8859-15", "cp1250", "cp1251", "cp1252"}
)

# url -> (expires_at, LinkPreview)
_cache: dict[str, tuple[float, "LinkPreview"]] = {}
_cache_lock = asyncio.Lock()


@dataclass
class LinkPreview:
    url: str
    title: str | None = None
    description: str | None = None
    image: str | None = None
    site_name: str | None = None

    def is_empty(self) -> bool:
        return not (self.title or self.description or self.image)


class _MetaExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.meta: dict[str, str] = {}
        self._in_title = False
        self._title_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "title":
            self._in_title = True
            return
        if tag != "meta":
            return
        a = {k.lower(): (v or "") for k, v in attrs}
        key = a.get("property") or a.get("name")
        content = a.get("content")
        if key and content and key.lower() not in self.meta:
            self.meta[key.lower()] = content

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self._title_parts.append(data)

    @property
    def title_tag(self) -> str | None:
        text = "".join(self._title_parts).strip()
        return text or None


def parse_link_preview(html: str, url: str) -> LinkPreview:
    p = _MetaExtractor()
    p.feed(html)
    m = p.meta

    def pick(*keys: str) -> str | None:
        for k in keys:
            if m.get(k):
                return m[k].strip()
        return None

    return LinkPreview(
        url=url,
        title=pick("og:title", "twitter:title") or p.title_tag,
        description=pick("og:description", "twitter:description", "description"),
        image=pick("og:image", "twitter:image", "twitter:image:src"),
        site_name=pick("og:site_name"),
    )


def _page_charset(declared: str | None) -> str:
    """The codec to read a page with: the one it names if that is a plain one."""
    try:
        name = codecs.lookup(declared or "").name
    except LookupError:
        return "utf-8"
    return name if name in _CHARSETS else "utf-8"


async def _fetch_once(client: httpx.AsyncClient, target: str) -> tuple[str | None, str, bytes]:
    """GET ``target`` at a freshly validated public IP: (redirect, charset, body).

    The host is resolved and checked, then the request is sent to that exact IP
    (via the URL) while the original host is preserved as the ``Host`` header and
    TLS SNI. Because the address that was security-checked is the one actually
    contacted, a rebinding DNS answer cannot redirect the connection to a private
    host after the check (the connection performs no second name resolution).

    The body is only read when it is a page sent as it is: asked for and read
    uncompressed (unpacking first would let a small answer expand far past the
    cap), and reading stops at the cap. Anything else gives an empty body, which
    makes an empty preview.
    """
    ip = await asyncio.to_thread(resolve_public_ip, target)
    parts = urlsplit(target)
    host_header = parts.netloc  # original host[:port], sent as Host
    ip_netloc = f"[{ip}]" if ":" in ip else ip
    if parts.port:
        ip_netloc = f"{ip_netloc}:{parts.port}"
    pinned = urlunsplit((parts.scheme, ip_netloc, parts.path or "/", parts.query, ""))
    async with client.stream(
        "GET",
        pinned,
        headers={
            "User-Agent": _USER_AGENT,
            "Accept": "text/html",
            "Accept-Encoding": "identity",
            "Host": host_header,
        },
        # SNI + certificate verification use the real hostname, not the IP.
        extensions={"sni_hostname": parts.hostname or ""},
    ) as resp:
        location = resp.headers.get("location")
        if resp.is_redirect and location:
            return location, "", b""
        content_type = resp.headers.get("content-type", "")
        packed = resp.headers.get("content-encoding", "").strip().lower()
        if "html" not in content_type.lower() or packed not in ("", "identity"):
            return None, "", b""
        body = bytearray()
        # With no Content-Encoding (checked above) httpx decodes nothing, so these
        # are the bytes as sent and the cap is a cap on memory too.
        async for chunk in resp.aiter_bytes():
            body.extend(chunk)
            if len(body) >= _MAX_BYTES:
                break
        return None, _page_charset(resp.charset_encoding), bytes(body[:_MAX_BYTES])


async def _fetch_preview(url: str, transport: httpx.AsyncBaseTransport | None) -> LinkPreview:
    current = url
    async with httpx.AsyncClient(
        timeout=_FETCH_TIMEOUT, follow_redirects=False, transport=transport
    ) as client:
        for _ in range(_MAX_REDIRECTS + 1):
            location, charset, body = await _fetch_once(client, current)
            if location is not None:
                # Resolve against the original-host URL, not the pinned-IP one,
                # then re-validate the new hop on the next iteration.
                current = urljoin(current, location)
                continue
            if not body:
                return LinkPreview(url=url)
            return parse_link_preview(body.decode(charset, "replace"), url)
    raise UnsafeUrlError("too many redirects")


async def fetch_link_preview(
    url: str, *, transport: httpx.AsyncBaseTransport | None = None
) -> LinkPreview:
    """Fetch ``url`` (SSRF-guarded, IP-pinned, size/redirect/time capped) and extract a preview.

    Raises ``UnsafeUrlError`` for disallowed targets and ``TimeoutError`` when
    the whole fetch takes longer than ``_FETCH_DEADLINE``. Returns an empty
    preview when the content is not HTML, is compressed, or carries no usable
    metadata. ``transport`` is for tests.
    """
    now = time.monotonic()
    async with _cache_lock:
        hit = _cache.get(url)
        if hit and hit[0] > now:
            return hit[1]

    async with asyncio.timeout(_FETCH_DEADLINE):
        preview = await _fetch_preview(url, transport)

    async with _cache_lock:
        _cache[url] = (time.monotonic() + _CACHE_TTL, preview)
    return preview
