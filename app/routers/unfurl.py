"""Chat link-preview (unfurl) endpoint."""

import logging

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.services.unfurl import LinkPreview, fetch_link_preview
from app.services.url_safety import UnsafeUrlError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/unfurl", tags=["unfurl"])


class UnfurlResponse(BaseModel):
    url: str
    title: str | None = None
    description: str | None = None
    image: str | None = None
    site_name: str | None = None


@router.get("", response_model=UnfurlResponse)
async def get_unfurl(url: str = Query(..., max_length=2048)) -> UnfurlResponse:
    try:
        preview: LinkPreview = await fetch_link_preview(url)
    except UnsafeUrlError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - previews are best-effort
        logger.info("unfurl failed for %s: %s", url, exc)
        raise HTTPException(status_code=502, detail="preview unavailable") from exc
    return UnfurlResponse(
        url=preview.url,
        title=preview.title,
        description=preview.description,
        image=preview.image,
        site_name=preview.site_name,
    )
