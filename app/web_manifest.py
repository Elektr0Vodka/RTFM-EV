"""The web manifest (PWA) of the app.

Kept free of database and radio imports: the multi-radio gateway serves a
manifest too, and it must not open either.
"""

from fastapi import Request
from fastapi.responses import JSONResponse

# Default app name for the tab title, iOS home-screen title and PWA manifest
# when no custom brand name is set.
DEFAULT_APP_NAME = "RTFM-EV"


def _resolve_request_base(request: Request) -> str:
    """Resolve the external base URL, honoring common reverse-proxy headers.

    Returns a URL like ``https://host:8000/meshcore/`` (always trailing-slash)
    so callers can append paths directly.

    Recognized headers:
    - ``X-Forwarded-Proto`` + ``X-Forwarded-Host``: override scheme and host.
    - ``X-Forwarded-Prefix`` (or ``X-Forwarded-Path``): sub-path prefix added
      by the proxy (e.g. ``/meshcore``).
    """
    forwarded_proto = request.headers.get("x-forwarded-proto")
    forwarded_host = request.headers.get("x-forwarded-host")

    if forwarded_proto and forwarded_host:
        proto = forwarded_proto.split(",")[0].strip()
        host = forwarded_host.split(",")[0].strip()
        if proto and host:
            origin = f"{proto}://{host}"
        else:
            origin = str(request.base_url).rstrip("/")
    else:
        origin = str(request.base_url).rstrip("/")

    # Sub-path prefix (e.g. /meshcore) communicated by the reverse proxy
    prefix = (
        (request.headers.get("x-forwarded-prefix") or request.headers.get("x-forwarded-path") or "")
        .strip()
        .rstrip("/")
    )

    return f"{origin}{prefix}/"


def web_manifest_response(request: Request, *, app_name: str, start_path: str = "") -> JSONResponse:
    """The web manifest for the app behind this request.

    The scope is the base URL of the request. ``start_path`` is where the
    installed app opens and where the icons are served, relative to that base:
    empty for a single radio, ``gateway/`` for the radios page of the
    multi-radio gateway.
    """
    base = _resolve_request_base(request)
    start_url = f"{base}{start_path}"
    manifest = {
        "name": app_name,
        "short_name": app_name,
        "id": start_url,
        "start_url": start_url,
        "scope": base,
        "display": "standalone",
        # No "window-controls-overlay": the frontend has no drag region and
        # its header buttons would sit under the window buttons.
        "display_override": ["standalone", "fullscreen"],
        "theme_color": "#111419",
        "background_color": "#111419",
        # Icons are PNG-only on purpose. iOS Safari's manifest parser has
        # historically been unreliable with SVG icons, and Android/Chrome
        # PWA install flows prefer PNG for the install prompt.
        #
        # The "any" purpose entries are what iOS and desktop Chrome use
        # for the home-screen / install icon. "maskable" entries are
        # Android-only (adaptive icon with safe-zone crop); iOS does not
        # apply the safe-zone mask, so a maskable-only icon set would
        # render with excessive padding.
        "icons": [
            {
                "src": f"{start_url}favicon-96x96.png",
                "sizes": "96x96",
                "type": "image/png",
                "purpose": "any",
            },
            {
                "src": f"{start_url}apple-touch-icon.png",
                "sizes": "180x180",
                "type": "image/png",
                "purpose": "any",
            },
            {
                "src": f"{start_url}favicon-256x256.png",
                "sizes": "256x256",
                "type": "image/png",
                "purpose": "any",
            },
            {
                "src": f"{start_url}web-app-manifest-192x192.png",
                "sizes": "192x192",
                "type": "image/png",
                "purpose": "maskable",
            },
            {
                "src": f"{start_url}web-app-manifest-512x512.png",
                "sizes": "512x512",
                "type": "image/png",
                "purpose": "maskable",
            },
        ],
        "screenshots": [
            {
                "src": f"{start_url}screenshot-wide.png",
                "sizes": "1367x909",
                "type": "image/png",
                "form_factor": "wide",
                "label": f"{app_name} desktop view",
            },
            {
                "src": f"{start_url}screenshot-mobile.png",
                "sizes": "1170x2532",
                "type": "image/png",
                "label": f"{app_name} mobile view",
            },
            {
                "src": f"{start_url}screenshot-mobile-2.png",
                "sizes": "750x1334",
                "type": "image/png",
                "label": f"{app_name} mobile conversation",
            },
        ],
    }
    return JSONResponse(
        manifest,
        media_type="application/manifest+json",
        headers={"Cache-Control": "no-store"},
    )
