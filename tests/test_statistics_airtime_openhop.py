"""Tests for the /statistics/airtime/range OpenHop REST branch.

OpenHop's companion STATS_RADIO frame hardcodes rx_air_secs=0, so the local
cumulative-counter path never sees RX airtime. When the node is OpenHop and the
API is configured, the endpoint sources airtime from OpenHop's REST endpoint
(which reports real RX airtime); otherwise it falls back to the local
computation over airtime_history.
"""

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


def _fake_client(response: dict | None = None, *, raises: Exception | None = None):
    class _FakeClient:
        def __init__(self, url, token, **kwargs):
            pass

        async def airtime_chart_data(self, *args, **kwargs):
            if raises is not None:
                raise raises
            return response

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
    assert out == [{"_bin": 0, "timestamp": 30, "tx_pct": 50.0, "rx_pct": 10.0}]


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
