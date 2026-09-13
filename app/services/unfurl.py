"""Server-side link unfurl: fetch a URL and extract OpenGraph-style metadata.

Only used for chat link previews, gated by the ``chat_url_previews`` setting.
Outbound fetches are pinned to a validated public IP (see ``_fetch_once``) and
are size/time capped. HTML parsing uses the stdlib ``html.parser`` (no new dep).
"""

import asyncio
import logging
import time
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx

from app.services.url_safety import UnsafeUrlError, resolve_public_ip

logger = logging.getLogger(__name__)

_FETCH_TIMEOUT = 6.0
_MAX_BYTES = 256 * 1024
_MAX_REDIRECTS = 3
_CACHE_TTL = 3600.0
_USER_AGENT = "RTFM-EV-LinkPreview/1.0 (+https://github.com/Elektr0Vodka/RTFM-EV)"

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


async def _fetch_once(client: httpx.AsyncClient, target: str) -> httpx.Response:
    """GET ``target`` connecting to a freshly validated public IP for its host.

    The host is resolved and checked, then the request is sent to that exact IP
    (via the URL) while the original host is preserved as the ``Host`` header and
    TLS SNI. Because the address that was security-checked is the one actually
    contacted, a rebinding DNS answer cannot redirect the connection to a private
    host after the check (the connection performs no second name resolution).
    """
    ip = resolve_public_ip(target)
    parts = urlsplit(target)
    host_header = parts.netloc  # original host[:port], sent as Host
    ip_netloc = f"[{ip}]" if ":" in ip else ip
    if parts.port:
        ip_netloc = f"{ip_netloc}:{parts.port}"
    pinned = urlunsplit((parts.scheme, ip_netloc, parts.path or "/", parts.query, ""))
    return await client.get(
        pinned,
        headers={"User-Agent": _USER_AGENT, "Accept": "text/html", "Host": host_header},
        # SNI + certificate verification use the real hostname, not the IP.
        extensions={"sni_hostname": parts.hostname or ""},
    )


async def fetch_link_preview(url: str) -> LinkPreview:
    """Fetch ``url`` (SSRF-guarded, IP-pinned, size/redirect capped) and extract a preview.

    Raises ``UnsafeUrlError`` for disallowed targets. Returns an empty preview
    when the content is not HTML or carries no usable metadata.
    """
    now = time.monotonic()
    async with _cache_lock:
        hit = _cache.get(url)
        if hit and hit[0] > now:
            return hit[1]

    current = url
    async with httpx.AsyncClient(timeout=_FETCH_TIMEOUT, follow_redirects=False) as client:
        for _ in range(_MAX_REDIRECTS + 1):
            resp = await _fetch_once(client, current)
            location = resp.headers.get("location")
            if resp.is_redirect and location:
                # Resolve against the original-host URL, not the pinned-IP one,
                # then re-validate the new hop on the next iteration.
                current = urljoin(current, location)
                continue
            content_type = resp.headers.get("content-type", "")
            if "html" not in content_type.lower():
                preview = LinkPreview(url=url)
                break
            body = resp.content[:_MAX_BYTES]
            preview = parse_link_preview(body.decode(resp.encoding or "utf-8", "replace"), url)
            break
        else:
            raise UnsafeUrlError("too many redirects")

    async with _cache_lock:
        _cache[url] = (time.monotonic() + _CACHE_TTL, preview)
    return preview
