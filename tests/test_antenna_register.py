"""Tests for the Dutch Antenneregister map layer (sync, cache, router)."""

import asyncio
import math
from unittest.mock import patch

import pytest

import app.services.antenna_register as svc
from app.models import AntennaRegisterSite, AntennaRegisterTransmitter
from app.rd_new import rd_to_wgs84
from app.repository.antenna_register import AntennaRegisterRepository
from app.routers.antenna_register import reset_all_sites_cache


@pytest.fixture(autouse=True)
def _fresh_all_sites_cache():
    reset_all_sites_cache()
    yield
    reset_all_sites_cache()


def _metres(lat1, lon1, lat2, lon2):
    return math.hypot(
        (lat1 - lat2) * 111_320, (lon1 - lon2) * 111_320 * math.cos(math.radians(lat1))
    )


class TestRdNew:
    # (RD x, RD y) -> (lat, lon) pairs as published by the PDOK locatieserver.
    @pytest.mark.parametrize(
        ("x", "y", "lat", "lon"),
        [
            (121347.914, 487347.519, 52.37297089, 4.89304433),  # Dam, Amsterdam
            (233367.828, 581293.678, 53.21252567, 6.5602964),  # Groningen
            (176409.79, 317943.803, 50.85092856, 5.6912069),  # Maastricht
            (28575.314, 385874.17, 51.44776494, 3.56843741),  # Vlissingen
            (257496, 594805, 53.32982054, 6.92568126),  # Delfzijl
        ],
    )
    def test_matches_pdok_within_a_metre(self, x, y, lat, lon):
        got_lat, got_lon = rd_to_wgs84(x, y)
        assert _metres(got_lat, got_lon, lat, lon) < 1.0

    def test_origin_is_amersfoort(self):
        lat, lon = rd_to_wgs84(155000, 463000)
        assert lat == pytest.approx(52.15517440)
        assert lon == pytest.approx(5.38720621)


class TestFrequencies:
    @pytest.mark.parametrize(
        ("value", "band"),
        [
            ("763 MHz", "700"),
            ("783 MHz", "700"),
            ("796 MHz", "800"),
            ("816 MHz", "800"),
            ("816,5 MHz", "800"),
            ("925-934.8 MHz", "900"),
            ("957.4 MHz", "900"),
            ("868 MHz", None),  # licence-exempt, never registered, but not a neighbour band
            ("421-425 MHz", "450"),  # PAMR, next to 433 MHz
            ("462.65 MHz", "450"),
            ("433.92 MHz", "450"),  # never registered, but the band would match
            ("380-395 MHz", None),
            ("474 MHz", None),  # DVB-T, not kept
            ("1825-1845 MHz", None),
            ("9200-9500 MHz", None),  # matched by the loose server filter, dropped here
            ("71.625 GHz", None),
            ("", None),
            (None, None),
        ],
    )
    def test_band_for(self, value, band):
        assert svc.band_for(value) == band

    def test_range_is_ordered(self):
        assert svc.parse_frequency_mhz("2177.5-1987.5 MHz") == (1987.5, 2177.5)


def _sector_props(ai_id, freq, bearing, power=30.0, height=25.0, system="LTE", d="D"):
    return {
        "ID": ai_id * 10 + int(bearing),
        "AI_ID": ai_id,
        "SAT_CODE": system,
        "DIR_NONDIR": d,
        "HOOGTE": height,
        "HOOFDSTRAALRICHTING": bearing,
        "ZENDVERMOGEN": power,
        "FREQUENTIE": freq,
    }


def _site_feature(site_id, ant_ids, x=121347.914, y=487347.519):
    return {
        "type": "Feature",
        "properties": {
            "ID": site_id,
            "X": x,
            "Y": y,
            "ANT_IDS": ", ".join(str(a) for a in ant_ids),
            "HOOFDSOORT": "LTE, GSM",
            "GEMEENTE": "Amsterdam",
            "POSTCODE": "1012JS",
            "WOONPLAATSNAAM": "",
        },
        "geometry": {"type": "Point", "coordinates": [x, y]},
    }


def _sectors(*rows):
    out: dict[int, list[svc.Sector]] = {}
    for props in rows:
        parsed = svc.parse_sector(props)
        if parsed:
            out.setdefault(parsed[0], []).append(parsed[1])
    return out


class TestBuildSite:
    def test_folds_sectors_per_system_and_frequency(self):
        sectors = _sectors(
            _sector_props(1, "816 MHz", 0, power=28.0),
            _sector_props(1, "816 MHz", 120, power=31.4, height=30.0),
            _sector_props(1, "816 MHz", 240, power=28.0),
            _sector_props(1, "806 MHz", 0),
            _sector_props(2, "925-934.8 MHz", 90, system="GSM 900"),
            _sector_props(3, "71.625 GHz", 10, system="VV"),  # out of band, dropped
        )
        site = svc.build_site(_site_feature(7, [1, 2, 3]), sectors)
        assert site is not None
        assert site.bands == ["800", "900"]
        assert site.max_power_dbw == 31.4
        assert _metres(site.lat, site.lon, 52.37297089, 4.89304433) < 1.0
        lte816 = next(t for t in site.transmitters if t.frequency == "816 MHz")
        assert lte816.sectors == 3
        assert lte816.bearings_deg == [0.0, 120.0, 240.0]
        assert lte816.height_m == 30.0
        assert lte816.power_dbw == 31.4
        assert site.max_height_m == 30.0
        assert [t.frequency for t in site.transmitters] == ["806 MHz", "816 MHz", "925-934.8 MHz"]

    def test_omni_antenna(self):
        sectors = _sectors(_sector_props(1, "950 MHz", 0, d="N"))
        site = svc.build_site(_site_feature(7, [1]), sectors)
        assert site is not None
        assert site.transmitters[0].omni is True
        assert site.transmitters[0].bearings_deg == []

    def test_site_without_in_band_antennas_is_skipped(self):
        sectors = _sectors(_sector_props(1, "816 MHz", 0))
        assert svc.build_site(_site_feature(7, [99]), sectors) is None

    def test_amateur_site_without_antennas_is_kept(self):
        feature = _site_feature(7, [99])
        feature["properties"]["HOOFDSOORT"] = "ZENDAMATEURS"
        feature["properties"]["ZENDAMATEURS"] = 1.0
        site = svc.build_site(feature, {})
        assert site is not None
        assert site.bands == [svc.AMATEUR]
        assert site.transmitters == []
        assert site.max_power_dbw is None

    def test_amateur_flag_from_kinds_alone(self):
        feature = _site_feature(7, [1])
        feature["properties"]["HOOFDSOORT"] = "LTE, ZENDAMATEURS"
        site = svc.build_site(feature, _sectors(_sector_props(1, "816 MHz", 0)))
        assert site is not None
        assert site.bands == ["800", svc.AMATEUR]

    def test_placeholder_position_is_skipped(self):
        sectors = _sectors(_sector_props(1, "816 MHz", 0))
        assert svc.build_site(_site_feature(7, [1], x=-100000, y=200000), sectors) is None


def _site(site_id, lat, lon, power):
    return AntennaRegisterSite(
        id=site_id,
        lat=lat,
        lon=lon,
        bands=["800"],
        max_power_dbw=power,
        transmitters=[
            AntennaRegisterTransmitter(
                system="LTE", band="800", frequency="816 MHz", sectors=3, power_dbw=power
            )
        ],
    )


class TestRepository:
    @pytest.mark.asyncio
    async def test_replace_bbox_get_status(self, test_db):
        await AntennaRegisterRepository.replace_all(
            [_site(1, 52.0, 4.0, 20.0), _site(2, 52.1, 4.1, 35.0), _site(3, 10.0, 10.0, 30.0)],
            synced_at=100,
        )
        sites, truncated = await AntennaRegisterRepository.query_bbox(51, 3, 53, 5, limit=10)
        assert [s.id for s in sites] == [2, 1]  # strongest first, outside box dropped
        assert truncated is False

        sites, truncated = await AntennaRegisterRepository.query_bbox(51, 3, 53, 5, limit=1)
        assert [s.id for s in sites] == [2]
        assert truncated is True

        site = await AntennaRegisterRepository.get(2)
        assert site is not None
        assert site.transmitters[0].frequency == "816 MHz"
        assert await AntennaRegisterRepository.get(404) is None
        assert await AntennaRegisterRepository.status() == (3, 100)

    @pytest.mark.asyncio
    async def test_replace_is_a_full_refresh(self, test_db):
        await AntennaRegisterRepository.replace_all([_site(1, 52.0, 4.0, 20.0)], synced_at=1)
        await AntennaRegisterRepository.replace_all([_site(2, 52.0, 4.0, 20.0)], synced_at=2)
        assert await AntennaRegisterRepository.get(1) is None
        assert await AntennaRegisterRepository.status() == (1, 2)


def _fake_pages(groups, sites):
    """Patch ``_fetch_page`` to serve the given features, PAGE_SIZE at a time."""

    async def fake(client, typename, start, flt):
        data = groups if typename == "Antennes_Groepen" else sites
        return data[start : start + svc.PAGE_SIZE]

    return patch.object(svc, "_fetch_page", fake)


async def _wait_idle():
    for _ in range(200):
        if not svc.get_sync_state().running:
            return
        await asyncio.sleep(0.01)
    raise AssertionError("sync did not finish")


class TestSync:
    @pytest.mark.asyncio
    async def test_sync_joins_and_stores(self, test_db):
        groups = [{"properties": _sector_props(1, "816 MHz", b)} for b in (0, 120, 240)]
        sites = [_site_feature(7, [1]), _site_feature(8, [55])]
        with _fake_pages(groups, sites), patch.object(svc, "PAGE_SIZE", 2):
            count, synced_at = await svc.sync_antenna_register()
        assert count == 1
        site = await AntennaRegisterRepository.get(7)
        assert site is not None
        assert site.transmitters[0].sectors == 3  # rows spread over two pages
        assert await AntennaRegisterRepository.status() == (1, synced_at)

    @pytest.mark.asyncio
    async def test_repeated_site_id_is_merged(self, test_db):
        # The register lists some sites once per antenna group, same ID and spot.
        groups = [
            {"properties": _sector_props(1, "816 MHz", 0)},
            {"properties": _sector_props(2, "950 MHz", 0, system="GSM 900")},
        ]
        first = _site_feature(7, [1])
        second = _site_feature(7, [2, 3])
        second["properties"]["HOOFDSOORT"] = "GSM, VASTE VERB"
        out_of_band = _site_feature(7, [99])  # microwave group, nothing in band
        out_of_band["properties"]["HOOFDSOORT"] = "VASTE VERB"
        with _fake_pages(groups, [first, out_of_band, second]):
            count, _ = await svc.sync_antenna_register()
        assert count == 1
        site = await AntennaRegisterRepository.get(7)
        assert site is not None
        assert [t.frequency for t in site.transmitters] == ["816 MHz", "950 MHz"]
        assert site.bands == ["800", "900"]
        assert site.kinds == "LTE, GSM, VASTE VERB"

    @pytest.mark.asyncio
    async def test_amateur_group_merged_into_mobile_site(self, test_db):
        groups = [{"properties": _sector_props(1, "816 MHz", 0)}]
        mobile = _site_feature(7, [1])
        ham = _site_feature(7, [50])
        ham["properties"]["HOOFDSOORT"] = "ZENDAMATEURS"
        ham["properties"]["ZENDAMATEURS"] = 1.0
        plain = _site_feature(8, [60])  # no in-band antennas, not amateur: dropped
        with _fake_pages(groups, [mobile, ham, plain]):
            count, _ = await svc.sync_antenna_register()
        assert count == 1
        site = await AntennaRegisterRepository.get(7)
        assert site is not None
        assert site.bands == ["800", svc.AMATEUR]

    @pytest.mark.asyncio
    async def test_empty_result_keeps_previous_cache(self, test_db):
        await AntennaRegisterRepository.replace_all([_site(1, 52.0, 4.0, 20.0)], synced_at=1)
        with _fake_pages([], [_site_feature(7, [1])]):
            with pytest.raises(svc.AntennaRegisterSyncError):
                await svc.sync_antenna_register()
        assert await AntennaRegisterRepository.status() == (1, 1)


class TestRouter:
    @pytest.mark.asyncio
    async def test_sync_runs_in_background(self, test_db, client):
        groups = [{"properties": _sector_props(1, "950 MHz", 0)}]
        with _fake_pages(groups, [_site_feature(7, [1])]):
            resp = await client.post("/api/antenna-register/sync")
            assert resp.status_code == 202
            await _wait_idle()
        status = (await client.get("/api/antenna-register/status")).json()
        assert status["count"] == 1
        assert status["running"] is False
        assert status["error"] is None

    @pytest.mark.asyncio
    async def test_failed_sync_reports_error(self, test_db, client):
        async def boom(*_a, **_k):
            raise svc.AntennaRegisterSyncError("Antenneregister returned HTTP 503")

        with patch.object(svc, "_fetch_page", boom):
            await client.post("/api/antenna-register/sync")
            await _wait_idle()
        status = (await client.get("/api/antenna-register/status")).json()
        assert status["error"] == "Antenneregister returned HTTP 503"
        assert status["count"] == 0

    @pytest.mark.asyncio
    async def test_sites_and_site_endpoints(self, test_db, client):
        await AntennaRegisterRepository.replace_all(
            [_site(1, 52.0, 4.0, 20.0), _site(2, 10.0, 10.0, 30.0)], synced_at=1
        )
        resp = await client.get(
            "/api/antenna-register/sites", params={"west": 3, "south": 51, "east": 5, "north": 53}
        )
        assert resp.status_code == 200
        body = resp.json()
        assert [s["id"] for s in body["sites"]] == [1]
        assert body["truncated"] is False
        assert "transmitters" not in body["sites"][0]  # summaries only

        detail = await client.get("/api/antenna-register/sites/1")
        assert detail.status_code == 200
        assert detail.json()["transmitters"][0]["sectors"] == 3
        assert (await client.get("/api/antenna-register/sites/999")).status_code == 404

    @pytest.mark.asyncio
    async def test_all_sites_is_compact_and_follows_syncs(self, test_db, client):
        empty = (await client.get("/api/antenna-register/sites/all")).json()
        assert empty == {
            "synced_at": None,
            "fields": ["id", "lat", "lon", "bands", "max_power_dbw", "max_height_m"],
            "rows": [],
        }
        tall = _site(1, 52.0, 4.0, 20.0)
        tall.max_height_m = 42.0
        await AntennaRegisterRepository.replace_all([tall], synced_at=7)
        body = (await client.get("/api/antenna-register/sites/all")).json()
        assert body["synced_at"] == 7
        assert body["rows"] == [[1, 52.0, 4.0, "800", 20.0, 42.0]]
        # A new sync replaces the cached body.
        await AntennaRegisterRepository.replace_all(
            [_site(2, 51.0, 5.0, 30.0), _site(3, 51.5, 5.5, 31.0)], synced_at=8
        )
        body = (await client.get("/api/antenna-register/sites/all")).json()
        assert body["synced_at"] == 8
        assert [r[0] for r in body["rows"]] == [2, 3]

    @pytest.mark.asyncio
    async def test_full_sites_endpoint_returns_transmitters_in_box(self, test_db, client):
        tall = _site(1, 52.0, 4.0, 20.0)
        tall.max_height_m = 42.0
        await AntennaRegisterRepository.replace_all(
            [tall, _site(2, 52.1, 4.1, 30.0), _site(3, 10.0, 10.0, 30.0)], synced_at=1
        )
        box = {"west": 3, "south": 51, "east": 5, "north": 53}
        body = (await client.get("/api/antenna-register/sites/full", params=box)).json()
        assert [s["id"] for s in body["sites"]] == [2, 1]  # strongest first
        assert body["sites"][1]["transmitters"][0]["frequency"] == "816 MHz"
        assert body["sites"][1]["max_height_m"] == 42.0
        assert body["truncated"] is False
        capped = await client.get("/api/antenna-register/sites/full", params={**box, "limit": 1})
        assert capped.json()["truncated"] is True
        summary = (await client.get("/api/antenna-register/sites", params=box)).json()
        assert summary["sites"][1]["max_height_m"] == 42.0
