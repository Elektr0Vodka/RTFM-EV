"""Analyzer validation of suggested routes: verdict mapping and the HTTP calls."""

from unittest.mock import patch

import httpx
import pytest

from app.models import ContactRouteSuggestion
from app.services.analyzer_path_check import (
    AnalyzerCheckError,
    analyzer_base_url,
    chain_verdict,
    last_hop_verdict,
    overall_status,
    validate_suggestions,
)

BASE = "https://analyzer.example"
CONTACT = "c0" * 32


def suggestion(route: str) -> ContactRouteSuggestion:
    hops = [] if route == "0" else route.split(",")
    return ContactRouteSuggestion(
        path="".join(hops),
        path_len=len(hops),
        path_hash_mode=(len(hops[0]) // 2 - 1) if hops else 0,
        route=route,
        sources=["advert"],
        heard_count=1,
        last_seen=1,
        score=0.5,
        freshness=0.5,
        heard=0.5,
        hops=0.5,
        delivery=0.5,
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


def _patch_client(reach=None, inspect=None, error=None):
    """Fake httpx client; ``inspect`` maps a comma-joined prefix list to a response."""
    calls: list[tuple[str, str, object]] = []

    class _FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def request(self, method, url, **kwargs):
            calls.append((method, url, kwargs.get("json")))
            if error is not None:
                raise error
            if method == "GET":
                return reach if reach is not None else _FakeResponse(404)
            return (inspect or {}).get(",".join(kwargs["json"]["prefixes"]), _FakeResponse(404))

    return patch("app.services.analyzer_path_check.httpx.AsyncClient", _FakeClient), calls


def _inspect(path, speculative=False, considered=None):
    considered = considered or [1] * len(path)
    return _FakeResponse(
        payload={
            "candidates": [
                {
                    "path": path,
                    "names": [f"node-{p[:4]}" for p in path],
                    "speculative": speculative,
                    "evidence": {"perHop": [{"candidatesConsidered": c} for c in considered]},
                }
            ]
        }
    )


class TestAnalyzerBaseUrl:
    def test_uses_the_host_of_the_sync_url(self):
        assert analyzer_base_url("https://example.org:8443/api/nodes?x=1") == (
            "https://example.org:8443"
        )

    @pytest.mark.parametrize("value", [None, "", "   ", "ftp://example.org/api", "not a url"])
    def test_falls_back_to_the_default_feed_host(self, value):
        assert analyzer_base_url(value) == "https://meshcore-analyzer.eu"


class TestVerdicts:
    def test_last_hop_reads_directions_from_the_contacts_side(self):
        neighbours = [
            {"pubkey": "AA11" + "0" * 60, "weHear": 3, "theyHear": 2},
            {"pubkey": "bb22" + "0" * 60, "weHear": 4, "theyHear": 0},
            {"pubkey": "cc33" + "0" * 60, "weHear": 0, "theyHear": 9},
            {"pubkey": "dd44" + "0" * 60, "weHear": 0, "theyHear": 0},
            "junk",
        ]
        assert last_hop_verdict(neighbours, "aa11") == "two_way"
        assert last_hop_verdict(neighbours, "bb22") == "contact_hears_hop"
        assert last_hop_verdict(neighbours, "cc33") == "hop_hears_contact"
        assert last_hop_verdict(neighbours, "dd44") == "not_seen"
        assert last_hop_verdict(neighbours, "ee55") == "not_seen"

    def test_chain_verdict(self):
        ok = _inspect(["aa" * 32, "bb" * 32], considered=[1, 3]).json()
        assert chain_verdict(ok, 2) == ("observed", ["node-aaaa", "node-bbbb"], 1)
        speculative = _inspect(["aa" * 32, "bb" * 32], speculative=True).json()
        assert chain_verdict(speculative, 2)[0] == "speculative"

    @pytest.mark.parametrize(
        "payload", [None, {}, {"candidates": []}, {"candidates": [{"path": ["aa" * 32]}]}]
    )
    def test_chain_is_unknown_without_a_full_length_candidate(self, payload):
        assert chain_verdict(payload, 2) == ("unknown", [], 0)

    @pytest.mark.parametrize(
        ("chain", "last_hop", "status"),
        [
            ("observed", "two_way", "confirmed"),
            ("observed", "contact_hears_hop", "confirmed"),
            ("not_checked", "two_way", "confirmed"),
            ("observed", "hop_hears_contact", "partial"),
            ("observed", "not_seen", "partial"),
            ("speculative", "two_way", "partial"),
            ("unknown", "hop_hears_contact", "partial"),
            ("not_checked", "hop_hears_contact", "partial"),
            ("not_checked", "not_seen", "unconfirmed"),
            ("speculative", "not_seen", "unconfirmed"),
            ("unknown", "not_seen", "unconfirmed"),
        ],
    )
    def test_overall_status(self, chain, last_hop, status):
        assert overall_status(chain, last_hop) == status


class TestValidateSuggestions:
    @pytest.mark.asyncio
    async def test_checks_each_route_and_keeps_order(self):
        reach = _FakeResponse(
            payload={"neighbourList": [{"pubkey": "aa11" + "0" * 60, "weHear": 1, "theyHear": 5}]}
        )
        patcher, calls = _patch_client(
            reach=reach, inspect={"bb22,aa11": _inspect(["bb22" + "0" * 60, "aa11" + "0" * 60])}
        )
        with patcher:
            direct, one_hop, two_hop, unknown = await validate_suggestions(
                BASE,
                CONTACT.upper(),
                [suggestion("0"), suggestion("aa11"), suggestion("bb22,aa11"), suggestion("ee,ff")],
            )

        assert direct.status == "not_checked"
        assert (one_hop.status, one_hop.chain, one_hop.last_hop) == (
            "confirmed",
            "not_checked",
            "two_way",
        )
        assert (two_hop.status, two_hop.chain) == ("confirmed", "observed")
        assert two_hop.hop_names == ["node-bb22", "node-aa11"]
        assert (unknown.status, unknown.chain, unknown.last_hop) == (
            "unconfirmed",
            "unknown",
            "not_seen",
        )
        # One reach lookup for the contact, one inspect per multi-hop route.
        assert calls == [
            ("GET", f"{BASE}/api/nodes/{CONTACT}/reach", None),
            ("POST", f"{BASE}/api/paths/inspect", {"prefixes": ["bb22", "aa11"]}),
            ("POST", f"{BASE}/api/paths/inspect", {"prefixes": ["ee", "ff"]}),
        ]

    @pytest.mark.asyncio
    async def test_routes_longer_than_the_analyzer_accepts_are_not_sent(self):
        patcher, calls = _patch_client()
        long_route = ",".join(f"{i:02x}" for i in range(9))
        with patcher:
            [verdict] = await validate_suggestions(BASE, CONTACT, [suggestion(long_route)])
        assert verdict.status == "not_checked"
        assert [c[0] for c in calls] == ["GET"]

    @pytest.mark.asyncio
    async def test_a_contact_unknown_to_the_analyzer_has_no_neighbours(self):
        patcher, _calls = _patch_client(reach=_FakeResponse(404))
        with patcher:
            [verdict] = await validate_suggestions(BASE, CONTACT, [suggestion("aa")])
        assert (verdict.status, verdict.last_hop) == ("unconfirmed", "not_seen")

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("kwargs", "message"),
        [
            ({"error": httpx.ConnectError("boom")}, "Could not reach analyzer"),
            ({"reach": _FakeResponse(503)}, "HTTP 503"),
            ({"reach": _FakeResponse(raise_json=True)}, "not JSON"),
        ],
    )
    async def test_failures_raise(self, kwargs, message):
        patcher, _calls = _patch_client(**kwargs)
        with patcher, pytest.raises(AnalyzerCheckError, match=message):
            await validate_suggestions(BASE, CONTACT, [suggestion("aa")])
