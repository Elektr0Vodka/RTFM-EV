"""Tests for the FUOTA campaign aggregation and the /fuota-traffic endpoint."""

from unittest.mock import patch

import pytest

from app.fuota import detect_fuota
from app.packet_processor import process_raw_packet
from app.repository.fuota_traffic import FuotaObservation, aggregate_fuota


def _offer(campaign: str = "deadbeef", sender: str = "ab", build: int = 5) -> bytes:
    payload = (
        bytes.fromhex("01" + sender + campaign + "c400" + "00380000" + "01000000")
        + build.to_bytes(4, "little")
        + bytes.fromhex("1122334455667788" + "047f")
    )
    return bytes([0x3A, 0x00]) + payload


def _request(campaign: str = "deadbeef", sender: str = "cd", provider: str = "ab") -> bytes:
    return bytes([0x3A, 0x00]) + bytes.fromhex(
        "02" + sender + campaign + "0300" + "ff00" + provider + "01"
    )


def _data(fragment: int, campaign: str = "deadbeef", sender: str = "ab") -> bytes:
    payload = bytes.fromhex("03" + sender + campaign) + fragment.to_bytes(2, "little") + bytes(40)
    return bytes([0x3A, 0x00]) + payload


def _retract(sender: str = "ab") -> bytes:
    return bytes([0x3A, 0x00]) + bytes.fromhex("04" + sender) + bytes(80)


def _obs(
    raw: bytes, ts: int = 1000, rssi: int | None = -70, snr: float | None = 5.0
) -> FuotaObservation:
    msg = detect_fuota(raw)
    assert msg is not None
    return FuotaObservation(ts=ts, raw_len=len(raw), rssi=rssi, snr=snr, msg=msg)


def _campaigns(agg: dict) -> dict[str, dict]:
    return {c["campaign"]: c for c in agg["campaigns"]}


def test_groups_by_campaign():
    agg = aggregate_fuota(
        [
            _obs(_offer(), ts=1000),
            _obs(_offer(), ts=1100),
            _obs(_request(), ts=1200),
            _obs(_request(campaign="cafef00d"), ts=1300),
        ],
        airtime_ms=None,
    )

    camps = _campaigns(agg)
    assert set(camps) == {"deadbeef", "cafef00d"}
    assert camps["deadbeef"]["offers"] == 2
    assert camps["deadbeef"]["requests"] == 1
    assert camps["deadbeef"]["build"] == 5
    assert camps["deadbeef"]["first_seen"] == 1000
    assert camps["deadbeef"]["last_seen"] == 1200
    assert agg["totals"]["offers"] == 2
    assert agg["totals"]["requests"] == 2
    assert agg["totals"]["senders"] == 2  # ab and cd


def test_campaign_without_offer_has_null_fields():
    agg = aggregate_fuota([_obs(_request(campaign="cafef00d"))], airtime_ms=None)

    camp = _campaigns(agg)["cafef00d"]
    assert camp["build"] is None
    assert camp["patch_size"] is None
    assert camp["target"] is None
    assert camp["requests"] == 1
    assert camp["providers_asked"] == ["ab"]


def test_fragments_heard_unique_sorted():
    agg = aggregate_fuota([_obs(_data(7)), _obs(_data(3)), _obs(_data(7))], airtime_ms=None)

    camp = _campaigns(agg)["deadbeef"]
    assert camp["fragments_heard"] == [3, 7]
    assert camp["data"] == 3


def test_senders_keep_best_signal_and_kinds():
    agg = aggregate_fuota(
        [_obs(_offer(), rssi=-80, snr=2.0), _obs(_data(1), rssi=-60, snr=7.5)],
        airtime_ms=None,
    )

    senders = _campaigns(agg)["deadbeef"]["senders"]
    assert senders == [
        {"sender": "ab", "count": 2, "best_rssi": -60, "best_snr": 7.5, "kinds": ["data", "offer"]}
    ]


def test_retracts_listed_separately():
    agg = aggregate_fuota([_obs(_retract(), ts=1500)], airtime_ms=None)

    assert agg["retracts"] == [{"ts": 1500, "sender": "ab", "count": 1}]
    assert agg["campaigns"] == []
    assert agg["totals"]["retracts"] == 1


def test_airtime_none_without_radio():
    obs = [_obs(_offer()), _obs(_request())]

    assert aggregate_fuota(obs, airtime_ms=None)["totals"]["airtime_ms"] is None
    with_radio = aggregate_fuota(obs, airtime_ms=lambda n: float(n))
    assert with_radio["totals"]["airtime_ms"] == float(32 + 14)
    assert _campaigns(with_radio)["deadbeef"]["airtime_ms"] == float(32 + 14)


@pytest.mark.asyncio
async def test_endpoint_empty_window(test_db, client):
    resp = await client.get("/api/packets/fuota-traffic?start_ts=100&end_ts=200")

    assert resp.status_code == 200
    body = resp.json()
    assert body["campaigns"] == []
    assert body["retracts"] == []
    assert body["visibility_limit_bytes"] == 173
    totals = body["totals"]
    assert (totals["offers"], totals["requests"], totals["data"], totals["retracts"]) == (
        0,
        0,
        0,
        0,
    )
    assert totals["senders"] == 0


@pytest.mark.asyncio
async def test_endpoint_rejects_inverted_window(test_db, client):
    resp = await client.get("/api/packets/fuota-traffic?start_ts=200&end_ts=100")
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_endpoint_reads_stored_rows(test_db, client, captured_broadcasts):
    _, mock_broadcast = captured_broadcasts
    with patch("app.packet_processor.broadcast_event", mock_broadcast):
        await process_raw_packet(_offer(), timestamp=1700000000, rssi=-65, snr=6.0)

    resp = await client.get("/api/packets/fuota-traffic?start_ts=1699999000&end_ts=1700001000")

    assert resp.status_code == 200
    body = resp.json()
    assert [c["campaign"] for c in body["campaigns"]] == ["deadbeef"]
    assert body["campaigns"][0]["build"] == 5
    assert body["totals"]["offers"] == 1
