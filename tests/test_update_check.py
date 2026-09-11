from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import app.services.update_check as uc


@pytest.fixture(autouse=True)
def _reset_cache():
    uc.reset_cache()
    yield
    uc.reset_cache()


def _mock_response(status_code=200, payload=None):
    resp = MagicMock()
    resp.status_code = status_code
    resp.json = MagicMock(return_value=payload or {})
    return resp


def _patch_build_info(commit_hash):
    info = MagicMock()
    info.commit_hash = commit_hash
    return patch.object(uc, "get_app_build_info", return_value=info)


def _patch_get(resp):
    client = AsyncMock()
    client.get = AsyncMock(return_value=resp)
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=client)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return patch.object(uc.httpx, "AsyncClient", return_value=ctx), client


@pytest.mark.asyncio
async def test_update_available_when_main_ahead():
    payload = {
        "status": "ahead",
        "ahead_by": 7,
        "commits": [{"sha": "a1b2c3d4e5f6"}],
    }
    get_patch, client = _patch_get(_mock_response(200, payload))
    with _patch_build_info("dc11fbe0"), get_patch:
        result = await uc.get_update_status()
    assert result["update_available"] is True
    assert result["commits_behind"] == 7
    assert result["current_commit"] == "dc11fbe0"
    assert result["latest_commit"] == "a1b2c3d4"
    assert result["compare_url"] == (
        "https://github.com/Elektr0Vodka/RTFM-EV/compare/dc11fbe0...main"
    )
    client.get.assert_awaited_once()


@pytest.mark.asyncio
async def test_up_to_date_when_identical():
    payload = {"status": "identical", "ahead_by": 0, "commits": []}
    get_patch, _ = _patch_get(_mock_response(200, payload))
    with _patch_build_info("dc11fbe0"), get_patch:
        result = await uc.get_update_status()
    assert result["update_available"] is False
    assert result["commits_behind"] == 0


@pytest.mark.asyncio
async def test_diverged_is_not_an_update():
    payload = {"status": "diverged", "ahead_by": 3, "commits": []}
    get_patch, _ = _patch_get(_mock_response(200, payload))
    with _patch_build_info("dc11fbe0"), get_patch:
        result = await uc.get_update_status()
    assert result["update_available"] is False


@pytest.mark.asyncio
async def test_http_404_is_not_an_update():
    get_patch, _ = _patch_get(_mock_response(404, {}))
    with _patch_build_info("deadbeef"), get_patch:
        result = await uc.get_update_status()
    assert result["update_available"] is False


@pytest.mark.asyncio
async def test_no_commit_hash_skips_network():
    with _patch_build_info(None):
        client_patch, client = _patch_get(_mock_response(200, {}))
        with client_patch:
            result = await uc.get_update_status()
        client.get.assert_not_awaited()
    assert result["check_enabled"] is True
    assert result["update_available"] is False
    assert result["current_commit"] is None


@pytest.mark.asyncio
async def test_disabled_setting_skips_network(monkeypatch):
    monkeypatch.setattr(uc.settings, "update_check_enabled", False)
    client_patch, client = _patch_get(_mock_response(200, {}))
    with _patch_build_info("dc11fbe0"), client_patch:
        result = await uc.get_update_status()
    client.get.assert_not_awaited()
    assert result["check_enabled"] is False
    assert result["update_available"] is False


@pytest.mark.asyncio
async def test_result_is_cached_within_ttl():
    payload = {"status": "ahead", "ahead_by": 2, "commits": [{"sha": "aabbccdd"}]}
    get_patch, client = _patch_get(_mock_response(200, payload))
    with _patch_build_info("dc11fbe0"), get_patch:
        await uc.get_update_status()
        await uc.get_update_status()
    client.get.assert_awaited_once()
