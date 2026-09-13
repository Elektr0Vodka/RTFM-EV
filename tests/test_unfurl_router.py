import pytest
from fastapi import HTTPException

from app.services.url_safety import UnsafeUrlError


@pytest.mark.asyncio
async def test_rejects_unsafe_url(monkeypatch):
    from app.routers import unfurl as unfurl_router

    async def boom(url):
        raise UnsafeUrlError("blocked")

    monkeypatch.setattr(unfurl_router, "fetch_link_preview", boom)
    with pytest.raises(HTTPException) as exc:
        await unfurl_router.get_unfurl(url="http://127.0.0.1/x")
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_returns_preview(monkeypatch):
    from app.routers import unfurl as unfurl_router
    from app.services.unfurl import LinkPreview

    async def fake(url):
        return LinkPreview(url=url, title="T", description="D", image=None, site_name="S")

    monkeypatch.setattr(unfurl_router, "fetch_link_preview", fake)
    result = await unfurl_router.get_unfurl(url="https://example.com/p")
    assert result.title == "T"
    assert result.site_name == "S"
