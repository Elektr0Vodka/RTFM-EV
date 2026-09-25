"""Tests for plan 16 case (a): analyzer name resolution for unnamed full pubkeys."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.models import AnalyzerSite, ExternalMapNode
from app.repository.analyzer_names import AnalyzerResolvedNameRepository
from app.repository.external_map import ExternalMapRepository
from app.services import analyzer_resolution as svc
from app.services.analyzer_resolution import (
    NEGATIVE_TTL_SECONDS,
    extract_name,
    resolution_sites,
    resolve_pubkey_name,
)

KEY = "ab" * 32
NOW = 1_800_000_000

SITE = AnalyzerSite(
    name="Corn",
    node_url_template="https://corn.example/#node?id={pubkey}",
    node_api_url_template="https://corn.example/api/nodes/{pubkey}/detail",
    resolution_enabled=True,
)


class _FakeResponse:
    def __init__(self, status_code=200, payload=None, raise_json=False):
        self.status_code = status_code
        self._payload = payload
        self._raise_json = raise_json

    def json(self):
        if self._raise_json:
            raise ValueError("not json")
        return self._payload


def _patch_client(response=None, error=None, calls: list[str] | None = None):
    """Patch httpx.AsyncClient used by the resolution service."""

    class _FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url):
            if calls is not None:
                calls.append(url)
            if error is not None:
                raise error
            return response

    return patch("app.services.analyzer_resolution.httpx.AsyncClient", _FakeClient)


def _patch_sites(sites):
    settings = SimpleNamespace(analyzer_sites=sites)
    return patch.object(svc.AppSettingsRepository, "get", AsyncMock(return_value=settings))


class TestExtractName:
    def test_top_level_name(self):
        assert extract_name({"name": "Alpha"}) == "Alpha"

    def test_cornmeister_detail_shape(self):
        assert extract_name({"stat": {"name": "Beta", "receptions": 3}}) == "Beta"

    def test_capitalised_and_alternate_keys(self):
        assert extract_name({"Name": "Gamma"}) == "Gamma"
        assert extract_name({"node_name": "Delta"}) == "Delta"

    def test_blank_or_missing_name(self):
        assert extract_name({"name": "   "}) is None
        assert extract_name({"stat": {}}) is None
        assert extract_name(["name"]) is None
        assert extract_name(None) is None

    def test_nesting_is_bounded(self):
        assert extract_name({"data": {"node": {"name": "Deep"}}}) == "Deep"
        assert extract_name({"data": {"node": {"stat": {"name": "TooDeep"}}}}) is None


class TestResolutionSites:
    def test_filters_disabled_and_template_less_sites(self):
        disabled = SITE.model_copy(update={"resolution_enabled": False})
        no_api = SITE.model_copy(update={"node_api_url_template": None})
        assert resolution_sites([disabled, no_api, SITE]) == [SITE]


class TestResolvePubkeyName:
    @pytest.mark.asyncio
    async def test_directory_hit_wins_without_network(self, test_db):
        await ExternalMapRepository.replace_all(
            [ExternalMapNode(pubkey=KEY, name="Dir Node", lat=1.0, lon=2.0)], "src", NOW
        )
        with _patch_sites([SITE]), _patch_client(error=AssertionError("no network")):
            result = await resolve_pubkey_name(KEY, now=NOW)
        assert result is not None
        assert (result.name, result.source, result.cached) == ("Dir Node", "external_map", False)

    @pytest.mark.asyncio
    async def test_nothing_to_ask_returns_none(self, test_db):
        with _patch_sites([]):
            assert await resolve_pubkey_name(KEY, now=NOW) is None

    @pytest.mark.asyncio
    async def test_network_hit_is_cached(self, test_db):
        calls: list[str] = []
        response = _FakeResponse(payload={"stat": {"name": "Netty"}})
        with _patch_sites([SITE]), _patch_client(response=response, calls=calls):
            result = await resolve_pubkey_name(KEY, now=NOW)
        assert result is not None
        assert (result.name, result.source, result.cached) == ("Netty", "Corn", False)
        assert calls == [f"https://corn.example/api/nodes/{KEY}/detail"]

        row = await AnalyzerResolvedNameRepository.get(KEY)
        assert row is not None and row.resolved_name == "Netty" and row.source_site == "Corn"

        with _patch_sites([SITE]), _patch_client(error=AssertionError("no network")):
            again = await resolve_pubkey_name(KEY, now=NOW + 60)
        assert again is not None
        assert (again.name, again.cached) == ("Netty", True)

    @pytest.mark.asyncio
    async def test_miss_is_cached_and_not_reasked_within_ttl(self, test_db):
        with _patch_sites([SITE]), _patch_client(response=_FakeResponse(payload={"stat": {}})):
            result = await resolve_pubkey_name(KEY, now=NOW)
        assert result is not None
        assert (result.name, result.source, result.cached) == (None, "Corn", False)

        with _patch_sites([SITE]), _patch_client(error=AssertionError("no network")):
            again = await resolve_pubkey_name(KEY, now=NOW + NEGATIVE_TTL_SECONDS - 1)
        assert again is not None
        assert (again.name, again.cached) == (None, True)

    @pytest.mark.asyncio
    async def test_stale_miss_is_reasked_and_force_skips_the_cache(self, test_db):
        await AnalyzerResolvedNameRepository.upsert(KEY, None, "Corn", NOW - NEGATIVE_TTL_SECONDS)
        calls: list[str] = []
        response = _FakeResponse(payload={"name": "Fresh"})
        with _patch_sites([SITE]), _patch_client(response=response, calls=calls):
            stale = await resolve_pubkey_name(KEY, now=NOW)
        assert stale is not None and stale.name == "Fresh" and len(calls) == 1

        with _patch_sites([SITE]), _patch_client(response=response, calls=calls):
            forced = await resolve_pubkey_name(KEY, now=NOW, force=True)
        assert forced is not None and forced.cached is False and len(calls) == 2

    @pytest.mark.asyncio
    async def test_http_error_non_200_and_bad_json_are_misses(self, test_db):
        with _patch_sites([SITE]), _patch_client(error=httpx.ConnectError("boom")):
            result = await resolve_pubkey_name(KEY, now=NOW, force=True)
        assert result is not None and result.name is None

        with _patch_sites([SITE]), _patch_client(response=_FakeResponse(status_code=404)):
            result = await resolve_pubkey_name(KEY, now=NOW, force=True)
        assert result is not None and result.name is None

        with _patch_sites([SITE]), _patch_client(response=_FakeResponse(raise_json=True)):
            result = await resolve_pubkey_name(KEY, now=NOW, force=True)
        assert result is not None and result.name is None

    @pytest.mark.asyncio
    async def test_first_site_with_a_name_wins(self, test_db):
        second = SITE.model_copy(
            update={"name": "Second", "node_api_url_template": "https://two.example/{pubkey}"}
        )
        calls: list[str] = []
        response = _FakeResponse(payload={"name": "Winner"})
        with _patch_sites([SITE, second]), _patch_client(response=response, calls=calls):
            result = await resolve_pubkey_name(KEY, now=NOW)
        assert result is not None and result.source == "Corn"
        assert len(calls) == 1

    @pytest.mark.asyncio
    async def test_no_sites_returns_stale_cache_rather_than_nothing(self, test_db):
        await AnalyzerResolvedNameRepository.upsert(KEY, "Old", "Corn", NOW - 100 * 86400)
        with _patch_sites([]):
            result = await resolve_pubkey_name(KEY, now=NOW)
        assert result is not None
        assert (result.name, result.cached) == ("Old", True)
