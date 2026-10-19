"""Serve the wardrive page (``/wardrive/``) from its own build folder.

The page is a separate Vite build (``frontend/vite.wardrive.config.ts``) in
``<frontend dist>/wardrive/`` with relative asset paths, so every file it
needs lives under ``/wardrive/``: the prefix the main Basic login exempts
while the module is on. The main app's ``/assets/`` stays behind that login.
Register these routes before the SPA catch-all.
"""

import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response

logger = logging.getLogger(__name__)

PAGE_FILE = "wardrive.html"
NO_CACHE = "no-cache"
ASSET_CACHE = "public, max-age=31536000, immutable"


def _find_build(frontend_dirs: list[Path]) -> Path | None:
    for candidate in frontend_dirs:
        folder = candidate / "wardrive"
        if (folder / PAGE_FILE).is_file():
            return folder.resolve()
    return None


def register_wardrive_page_routes(app: FastAPI, frontend_dirs: list[Path]) -> Path | None:
    """Register ``/wardrive`` and ``/wardrive/...``; returns the build folder used."""
    folder = _find_build(frontend_dirs)
    if folder is None:
        logger.warning("Wardrive is on but no wardrive page build was found in %s", frontend_dirs)

    def _page() -> Response:
        if folder is None:
            return JSONResponse(
                status_code=503, content={"detail": "The wardrive page is not built"}
            )
        return FileResponse(folder / PAGE_FILE, headers={"Cache-Control": NO_CACHE})

    @app.get("/wardrive", include_in_schema=False)
    async def wardrive_redirect() -> Response:
        # Relative, so a reverse-proxy sub-path is kept: from <prefix>/wardrive
        # it resolves to <prefix>/wardrive/.
        return RedirectResponse("wardrive/", status_code=307)

    @app.get("/wardrive/", include_in_schema=False)
    async def wardrive_page() -> Response:
        return _page()

    @app.get("/wardrive/{path:path}", include_in_schema=False)
    async def wardrive_file(path: str) -> Response:
        if folder is None:
            return _page()
        file_path = (folder / path).resolve()
        try:
            file_path.relative_to(folder)
        except ValueError:
            return JSONResponse(status_code=404, content={"detail": "Not found"})
        if file_path.is_file() and file_path.name != PAGE_FILE:
            cache = ASSET_CACHE if path.startswith("assets/") else NO_CACHE
            return FileResponse(file_path, headers={"Cache-Control": cache})
        return _page()

    return folder
