"""Tests for the /statistics/airtime/range OpenHop REST branch.

OpenHop's companion STATS_RADIO frame hardcodes rx_air_secs=0, so the local
cumulative-counter path never sees RX airtime. When the node is OpenHop and the
API is configured, the endpoint sources airtime from OpenHop's REST endpoint
(which reports real RX airtime); otherwise it falls back to the local
computation over airtime_history.
"""

from types import SimpleNamespace

import httpx
import pytest

from app.repository import AppSettingsRepository
from app.repository.airtime_history import AirtimeHistoryRepository
from app.routers.statistics import get_airtime_range

OPENHOP_MODEL = "openHop-Repeater-Companion"


class _FakeMeshcore:
    def __init__(self, self_info: dict | None):
        self.self_info = self_info


class _FakeRadioManager:
    def __init__(self, model, self_info):
        self.device_model = model
        self.meshcore = _FakeMeshcore(self_info)


def _set_node(monkeypatch, model, self_info=None):
    # radio_manager.meshcore is a property with no setter, so replace the whole
    # reference in the statistics module rather than patching attributes on it.
    monkeypatch.setattr(
        "app.routers.statistics.radio_manager",
        _FakeRadioManager(model, self_info),
        raising=True,
    )


def _fake_client(
    response: dict | None = None,
    *,
    raises: Exception | None = None,
    crc: dict | None = None,
    crc_raises: Exception | None = None,
    crc_calls: list | None = None,
):
    class _FakeClient:
        def __init__(self, url, token, **kwargs):
            pass

        async def airtime_chart_data(self, *args, **kwargs):
            if raises is not None:
                raise raises
            return response

        async def crc_error_history(self, hours, *, limit):
            if crc_calls is not None:
                crc_calls.append((hours, limit))
            if crc_raises is not None:
                raise crc_raises
            return crc if crc is not None else {"success": True, "data": {"history": []}}

        async def aclose(self):
            pass

    return _FakeClient


@pytest.mark.asyncio
async def test_openhop_path_maps_buckets(test_db, monkeypatch):
    _set_node(
        monkeypatch,
        OPENHOP_MODEL,
        self_info={"radio_sf": 7, "radio_bw": 62.5, "radio_cr": 5},
    )
    await AppSettingsRepository.update(openhop_api_url="http://node:8000", openhop_api_token="tok")
    resp = {
        "success": True,
        "data": {
            "bucket_seconds": 60,
            "buckets": [{"timestamp": 1000, "tx_ms": 30000, "rx_ms": 6000}],
        },
    }
    monkeypatch.setattr("app.routers.statistics.OpenHopClient", _fake_client(resp))

    out = await get_airtime_range(start_ts=0, end_ts=2400, bin_count=40)
    assert out == [{"timestamp": 1000, "tx_pct": 50.0, "rx_pct": 10.0, "rx_errors": 0}]


@pytest.mark.asyncio
async def test_openhop_path_merges_crc_errors_in_window(test_db, monkeypatch):
    _set_node(
        monkeypatch,
        OPENHOP_MODEL,
        self_info={"radio_sf": 7, "radio_bw": 62.5, "radio_cr": 5},
    )
    await AppSettingsRepository.update(openhop_api_url="http://node:8000", openhop_api_token="tok")
    monkeypatch.setattr(
        "app.routers.statistics.time", SimpleNamespace(time=lambda: 10_000.0), raising=True
    )
    resp = {
        "success": True,
        "data": {
            "bucket_seconds": 60,
            "buckets": [{"timestamp": 1020, "tx_ms": 0, "rx_ms": 6000}],
        },
    }
    crc = {
        "success": True,
        "data": {
            "history": [
                {"timestamp": 500.0, "count": 9},  # before start_ts -> dropped
                {"timestamp": 1030.0, "count": 2},
                {"timestamp": 1070.0, "count": 1},  # same 60 s bucket (1020)
                {"timestamp": 1090.0, "count": 4},  # bucket 1080, no airtime row
                {"timestamp": 2500.0, "count": 9},  # after end_ts -> dropped
            ]
        },
    }
    calls: list = []
    monkeypatch.setattr(
        "app.routers.statistics.OpenHopClient",
        _fake_client(resp, crc=crc, crc_calls=calls),
    )

    out = await get_airtime_range(start_ts=1000, end_ts=2400, bin_count=40)
    assert out == [
        {"timestamp": 1020, "tx_pct": 0.0, "rx_pct": 10.0, "rx_errors": 3},
        {"timestamp": 1080, "tx_pct": 0.0, "rx_pct": 0.0, "rx_errors": 4},
    ]
    # hours reaches back from "now" (10_000) to start_ts (1000): 9000 s -> 3 h.
    assert calls[0][0] == 3


@pytest.mark.asyncio
async def test_openhop_crc_failure_keeps_airtime_without_rx_errors(test_db, monkeypatch):
    _set_node(
        monkeypatch,
        OPENHOP_MODEL,
        self_info={"radio_sf": 7, "radio_bw": 62.5, "radio_cr": 5},
    )
    await AppSettingsRepository.update(openhop_api_url="http://node:8000", openhop_api_token="tok")
    resp = {
        "success": True,
        "data": {
            "bucket_seconds": 60,
            "buckets": [{"timestamp": 1000, "tx_ms": 30000, "rx_ms": 6000}],
        },
    }
    monkeypatch.setattr(
        "app.routers.statistics.OpenHopClient",
        _fake_client(resp, crc_raises=httpx.ConnectError("boom")),
    )

    out = await get_airtime_range(start_ts=0, end_ts=2400, bin_count=40)
    assert out == [{"timestamp": 1000, "tx_pct": 50.0, "rx_pct": 10.0}]


@pytest.mark.asyncio
async def test_falls_back_to_local_when_not_openhop(test_db, monkeypatch):
    _set_node(monkeypatch, "Heltec V3", self_info={"radio_sf": 7, "radio_bw": 62.5, "radio_cr": 5})
    await AppSettingsRepository.update(openhop_api_url="http://node:8000", openhop_api_token="tok")
    # Local airtime_history: rx grows 6s over 60s -> 10%
    await AirtimeHistoryRepository.insert(0, 0, 0)
    await AirtimeHistoryRepository.insert(60, 30, 6)

    out = await get_airtime_range(start_ts=0, end_ts=60, bin_count=1)
    assert len(out) == 1
    assert out[0]["tx_pct"] == 50.0
    assert out[0]["rx_pct"] == 10.0


@pytest.mark.asyncio
async def test_falls_back_to_local_on_openhop_error(test_db, monkeypatch):
    _set_node(
        monkeypatch,
        OPENHOP_MODEL,
        self_info={"radio_sf": 7, "radio_bw": 62.5, "radio_cr": 5},
    )
    await AppSettingsRepository.update(openhop_api_url="http://node:8000", openhop_api_token="tok")
    monkeypatch.setattr(
        "app.routers.statistics.OpenHopClient",
        _fake_client(raises=httpx.ConnectError("boom")),
    )
    await AirtimeHistoryRepository.insert(0, 0, 0)
    await AirtimeHistoryRepository.insert(60, 30, 6)

    out = await get_airtime_range(start_ts=0, end_ts=60, bin_count=1)
    assert out == [{"_bin": 0, "timestamp": 30, "tx_pct": 50.0, "rx_pct": 10.0, "rx_errors": None}]


@pytest.mark.asyncio
async def test_falls_back_when_openhop_unconfigured(test_db, monkeypatch):
    _set_node(
        monkeypatch,
        OPENHOP_MODEL,
        self_info={"radio_sf": 7, "radio_bw": 62.5, "radio_cr": 5},
    )
    # No openhop_api_url/token configured -> local path.
    await AirtimeHistoryRepository.insert(0, 0, 0)
    await AirtimeHistoryRepository.insert(60, 30, 6)

    out = await get_airtime_range(start_ts=0, end_ts=60, bin_count=1)
    assert out[0]["rx_pct"] == 10.0
