"""Tests for comparing a stored config with what the node reported (plan 32, Phase 2).

Read-only: the comparison uses stored pane snapshots and SNMP polls. Nothing
here asks a node anything.
"""

import pytest

from app.repository import ContactRepository
from app.repository.contact_snmp import SnmpHistoryRepository
from app.repository.device_config_history import DeviceConfigHistoryRepository
from app.services import fleet_config_reported as reported
from tests.fleet_config_samples import companion_file, toolbox_file

KEY = "f1" * 32
OTHER_KEY = "a2" * 32


def _snapshots(**kinds) -> dict:
    """``kind=(timestamp, data)`` as the service takes them."""
    return {kind: {"timestamp": ts, "data": data} for kind, (ts, data) in kinds.items()}


# What the panes store for the full sample file: replies are text, as received.
MATCHING = _snapshots(
    node_info=(100, {"name": "NL-TST-RPT", "lat": "52.3740311", "lon": "4.8896899"}),
    radio_settings=(
        200,
        {
            "firmware_version": "v1.14.1",
            "radio": "869.6179809,62.5,8,8",
            "tx_power": "22",
            "airtime_factor": "1.0",
            "duty_cycle_limit": "50.0%",
            "repeat_enabled": "on",
            "flood_max": "64",
        },
    ),
    advert_intervals=(300, {"advert_interval": "120", "flood_advert_interval": "12"}),
    owner_info=(400, {"owner_info": "line one|line two", "name": "NL-TST-RPT"}),
    regions=(
        500,
        {
            "regions": [
                {"name": "*", "depth": 0, "flood_allowed": True, "is_home": False},
                {"name": "nl", "depth": 1, "flood_allowed": True, "is_home": True},
            ],
            "truncated": False,
            "source": "cli",
        },
    ),
)


def _by_path(rows) -> dict:
    return {row["path"]: row for row in rows}


class TestCompare:
    def test_a_node_that_matches_its_config_has_no_difference(self):
        rows, not_reported = reported.compare(toolbox_file(), MATCHING)

        assert not_reported == []
        assert [row["path"] for row in rows] == [
            "vars/name",
            "vars/lat",
            "vars/lon",
            "vars/radio/freq",
            "vars/radio/bw",
            "vars/radio/sf",
            "vars/radio/cr",
            "vars/tx",
            "vars/af",
            "vars/repeat",
            "vars/flood.max",
            "vars/advert.interval",
            "vars/flood.advert.interval",
            "vars/owner.info",
            "region/home",
        ]
        assert [row["path"] for row in rows if not row["same"]] == []

    def test_a_row_says_what_is_configured_what_was_reported_and_from_where(self):
        rows = _by_path(reported.compare(toolbox_file(), MATCHING)[0])

        assert rows["vars/tx"] == {
            "path": "vars/tx",
            "configured": "22",
            "reported": "22",
            "reported_at": 200,
            "source": "radio_settings",
            "same": True,
        }
        assert rows["vars/radio/freq"]["configured"] == "869.618"
        assert rows["vars/radio/freq"]["reported"] == "869.6179809"
        assert rows["vars/repeat"]["configured"] == "true"
        assert rows["vars/repeat"]["reported"] == "on"
        assert (rows["vars/lat"]["source"], rows["vars/lat"]["reported_at"]) == ("node_info", 100)
        assert rows["region/home"]["reported"] == "nl"

    def test_differences_are_found(self):
        snapshots = _snapshots(
            node_info=(100, {"name": "NL-OLD-NAME", "lat": "52.3741", "lon": "4.8896899"}),
            radio_settings=(
                200,
                {
                    "radio": "868.000,125,11,5",
                    "tx_power": "20",
                    "airtime_factor": "9",
                    "repeat_enabled": "off",
                    "flood_max": "8",
                },
            ),
            advert_intervals=(300, {"advert_interval": "60", "flood_advert_interval": "12"}),
            owner_info=(50, {"owner_info": "someone else", "name": "NL-OLDER"}),
        )

        rows = _by_path(reported.compare(toolbox_file(), snapshots)[0])

        different = sorted(path for path, row in rows.items() if not row["same"])
        assert different == [
            "vars/advert.interval",
            "vars/af",
            "vars/flood.max",
            "vars/lat",
            "vars/name",
            "vars/owner.info",
            "vars/radio/bw",
            "vars/radio/cr",
            "vars/radio/freq",
            "vars/radio/sf",
            "vars/repeat",
            "vars/tx",
        ]
        assert rows["vars/lon"]["same"] is True
        assert rows["vars/flood.advert.interval"]["same"] is True

    def test_the_file_rounds_position_and_frequency_so_the_last_digits_do_not_count(self):
        # The toolbox writes lat and lon with 5 decimals and the frequency with 3.
        document = toolbox_file(sections=False)
        document["vars"].update({"lat": 52.95004, "lon": "4.75578"})
        document["vars"]["radio"] = {"freq": "869.618", "bw": "62.5", "sf": "7", "cr": "5"}
        snapshots = _snapshots(
            node_info=(1, {"lat": "52.9500389", "lon": "4.7557802"}),
            radio_settings=(1, {"radio": "869.6179809,62.5,7,5"}),
        )

        rows = _by_path(reported.compare(document, snapshots)[0])

        assert all(row["same"] for row in rows.values())
        assert set(rows) == {
            "vars/lat",
            "vars/lon",
            "vars/radio/freq",
            "vars/radio/bw",
            "vars/radio/sf",
            "vars/radio/cr",
        }

    def test_the_newest_name_wins(self):
        snapshots = _snapshots(
            node_info=(100, {"name": "NL-TST-RPT"}),
            owner_info=(300, {"name": "NL-RENAMED"}),
            snmp=(200, {"node_name": "NL-TST-RPT", "firmware_version": "v1.14"}),
        )

        row = _by_path(reported.compare(toolbox_file(), snapshots)[0])["vars/name"]

        assert (row["reported"], row["source"], row["reported_at"], row["same"]) == (
            "NL-RENAMED",
            "owner_info",
            300,
            False,
        )

    def test_snmp_alone_reports_the_name(self):
        snapshots = _snapshots(snmp=(200, {"node_name": "NL-TST-RPT"}))

        rows, _not_reported = reported.compare(toolbox_file(), snapshots)

        assert [(row["path"], row["source"], row["same"]) for row in rows] == [
            ("vars/name", "snmp", True)
        ]

    def test_only_keys_both_sides_have_are_compared(self):
        document = {"vars": {"tx": 20, "cad": True, "guest.password": {"$secret": None}}}

        rows, not_reported = reported.compare(document, MATCHING)

        assert [(row["path"], row["same"]) for row in rows] == [("vars/tx", False)]
        assert not_reported == []

    def test_a_setting_without_a_stored_answer_is_listed_not_compared(self):
        snapshots = _snapshots(
            node_info=(100, {"name": "NL-TST-RPT", "lat": None, "lon": "4.8896899"}),
            radio_settings=(200, {"radio": None, "tx_power": "??: tx", "airtime_factor": None}),
        )

        rows, not_reported = reported.compare(toolbox_file(), snapshots)

        assert [row["path"] for row in rows] == ["vars/name", "vars/lon"]
        assert not_reported == [
            "vars/lat",
            "vars/radio/freq",
            "vars/radio/bw",
            "vars/radio/sf",
            "vars/radio/cr",
            "vars/tx",
            "vars/af",
            "vars/repeat",
            "vars/flood.max",
            "vars/advert.interval",
            "vars/flood.advert.interval",
            "vars/owner.info",
            "region/home",
        ]

    def test_a_reply_that_is_not_a_number_counts_as_different(self):
        snapshots = _snapshots(radio_settings=(1, {"tx_power": "high", "radio": "garbage"}))

        rows = _by_path(reported.compare(toolbox_file(), snapshots)[0])

        assert rows["vars/tx"]["same"] is False
        assert rows["vars/tx"]["reported"] == "high"
        assert "vars/radio/freq" not in rows

    def test_the_home_region_needs_a_complete_admin_dump(self):
        entries = [{"name": "nl", "depth": 0, "flood_allowed": True, "is_home": False}]
        guest = _snapshots(regions=(1, {"regions": entries, "source": "anon"}))
        cut_off = _snapshots(regions=(1, {"regions": entries, "source": "cli", "truncated": True}))
        no_home = _snapshots(regions=(1, {"regions": entries, "source": "cli"}))

        assert reported.compare(toolbox_file(), guest) == ([], _all_but_none())
        assert reported.compare(toolbox_file(), cut_off) == ([], _all_but_none())
        rows = _by_path(reported.compare(toolbox_file(), no_home)[0])
        assert (rows["region/home"]["reported"], rows["region/home"]["same"]) == ("", False)

    def test_an_owner_info_line_break_is_the_same_as_the_pipe_the_cli_shows(self):
        document = {"vars": {"owner.info": "a\nb"}}

        same = reported.compare(document, _snapshots(owner_info=(1, {"owner_info": "a|b"})))[0]
        other = reported.compare(document, _snapshots(owner_info=(1, {"owner_info": "a b"})))[0]

        assert (same[0]["same"], other[0]["same"]) == (True, False)

    def test_a_companion_file_has_nothing_to_compare(self):
        assert reported.compare(companion_file(), MATCHING) == ([], [])


def _all_but_none() -> list[str]:
    """Every mapped key of the full sample, as ``not_reported`` lists them."""
    return [
        "vars/name",
        "vars/lat",
        "vars/lon",
        "vars/radio/freq",
        "vars/radio/bw",
        "vars/radio/sf",
        "vars/radio/cr",
        "vars/tx",
        "vars/af",
        "vars/repeat",
        "vars/flood.max",
        "vars/advert.interval",
        "vars/flood.advert.interval",
        "vars/owner.info",
        "region/home",
    ]


async def _contact(public_key: str) -> None:
    """Pane snapshots and SNMP polls belong to a contact."""
    await ContactRepository.upsert({"public_key": public_key, "name": "node", "type": 2})


async def _asset(client, **fields) -> dict:
    response = await client.post("/api/fleet/assets", json={"label": "Mast 7", **fields})
    assert response.status_code == 201, response.text
    return response.json()


async def _config(client, asset_id: int, document: dict) -> dict:
    response = await client.post(
        f"/api/fleet/assets/{asset_id}/configs/import", json={"document": document}
    )
    assert response.status_code == 201, response.text
    return response.json()["config"]


class TestLatestSnapshots:
    @pytest.mark.asyncio
    async def test_the_newest_snapshot_of_each_kind(self, test_db):
        await _contact(KEY)
        await _contact(OTHER_KEY)
        await DeviceConfigHistoryRepository.record(KEY, "node_info", 100, {"name": "old"})
        await DeviceConfigHistoryRepository.record(KEY, "node_info", 200, {"name": "new"})
        await DeviceConfigHistoryRepository.record(KEY, "radio_settings", 150, {"tx_power": "22"})
        await DeviceConfigHistoryRepository.record(OTHER_KEY, "node_info", 900, {"name": "no"})

        latest = await DeviceConfigHistoryRepository.get_latest_by_kind(KEY.upper())

        assert latest == {
            "node_info": {"timestamp": 200, "data": {"name": "new"}},
            "radio_settings": {"timestamp": 150, "data": {"tx_power": "22"}},
        }
        assert await DeviceConfigHistoryRepository.get_latest_by_kind("b3" * 32) == {}


class TestReportedRoute:
    @pytest.mark.asyncio
    async def test_compares_with_the_stored_pane_snapshots_and_snmp(self, test_db, client):
        await _contact(KEY)
        asset = await _asset(client, public_key=KEY)
        config = await _config(client, asset["id"], toolbox_file())
        await DeviceConfigHistoryRepository.record(
            KEY, "radio_settings", 200, {"radio": "869.6179809,62.5,8,8", "tx_power": "20"}
        )
        await SnmpHistoryRepository.record(KEY, 300, {"node_name": "NL-TST-RPT"})

        response = await client.get(f"/api/fleet/configs/{config['id']}/reported")

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "ok"
        rows = _by_path(body["rows"])
        assert set(rows) == {
            "vars/name",
            "vars/radio/freq",
            "vars/radio/bw",
            "vars/radio/sf",
            "vars/radio/cr",
            "vars/tx",
        }
        assert rows["vars/tx"] == {
            "path": "vars/tx",
            "configured": "22",
            "reported": "20",
            "reported_at": 200,
            "source": "radio_settings",
            "same": False,
        }
        assert (rows["vars/name"]["source"], rows["vars/name"]["same"]) == ("snmp", True)
        assert "vars/lat" in body["not_reported"]

    @pytest.mark.asyncio
    async def test_an_asset_without_a_public_key_cannot_be_compared(self, test_db, client):
        asset = await _asset(client)
        config = await _config(client, asset["id"], toolbox_file())

        body = (await client.get(f"/api/fleet/configs/{config['id']}/reported")).json()

        assert body == {"status": "no_public_key", "rows": [], "not_reported": []}

    @pytest.mark.asyncio
    async def test_a_companion_file_cannot_be_compared(self, test_db, client):
        await _contact(KEY)
        asset = await _asset(client, public_key=KEY)
        config = await _config(client, asset["id"], companion_file())
        await DeviceConfigHistoryRepository.record(KEY, "node_info", 1, {"name": "x"})

        body = (await client.get(f"/api/fleet/configs/{config['id']}/reported")).json()

        assert body == {"status": "not_a_device_file", "rows": [], "not_reported": []}

    @pytest.mark.asyncio
    async def test_a_node_nothing_is_stored_for(self, test_db, client):
        await _contact(KEY)
        asset = await _asset(client, public_key=KEY)
        config = await _config(client, asset["id"], toolbox_file(sections=False))
        await _contact(OTHER_KEY)
        await DeviceConfigHistoryRepository.record(OTHER_KEY, "node_info", 1, {"name": "x"})

        body = (await client.get(f"/api/fleet/configs/{config['id']}/reported")).json()

        assert body["status"] == "nothing_stored"
        assert body["rows"] == []
        assert "vars/name" in body["not_reported"]

    @pytest.mark.asyncio
    async def test_unknown_config(self, test_db, client):
        response = await client.get("/api/fleet/configs/999/reported")

        assert response.status_code == 404
        assert response.json()["detail"] == "Config not found"

    @pytest.mark.asyncio
    async def test_it_only_reads(self, test_db, client, monkeypatch):
        """The route must not reach for the radio: the runtime is made to fail if touched."""
        from app.services import radio_runtime

        class _NoRadio:
            def __getattr__(self, name):
                raise AssertionError(f"the comparison touched the radio: {name}")

        await _contact(KEY)
        asset = await _asset(client, public_key=KEY)
        config = await _config(client, asset["id"], toolbox_file())
        await DeviceConfigHistoryRepository.record(KEY, "node_info", 1, {"name": "NL-TST-RPT"})
        monkeypatch.setattr(radio_runtime, "radio_runtime", _NoRadio())

        response = await client.get(f"/api/fleet/configs/{config['id']}/reported")

        assert response.status_code == 200
        assert response.json()["status"] == "ok"
