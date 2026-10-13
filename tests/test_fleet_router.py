"""Tests for the fleet asset register (plan 31, Phase 1)."""

import pytest

from app.repository import ContactRepository

KEY_A = "a1" * 32
KEY_B = "b2" * 32
KEY_C = "c3" * 32


async def _contact(public_key: str, name: str, **extra) -> None:
    await ContactRepository.upsert({"public_key": public_key, "name": name, "type": 2, **extra})


class TestCreate:
    @pytest.mark.asyncio
    async def test_asset_without_a_key_gets_the_defaults(self, test_db, client):
        response = await client.post("/api/fleet/assets", json={"label": "Spare T-Beam"})

        assert response.status_code == 201
        asset = response.json()
        assert asset["id"] > 0
        assert asset["label"] == "Spare T-Beam"
        assert asset["status"] == "in_stock"
        assert asset["public_key"] is None
        assert asset["contact"] is None
        assert asset["created_at"] == asset["updated_at"] > 0

    @pytest.mark.asyncio
    async def test_fields_are_trimmed_and_normalised(self, test_db, client):
        response = await client.post(
            "/api/fleet/assets",
            json={
                "public_key": KEY_A.upper(),
                "org_serial": "  DTIS-0042 ",
                "hw_serial": "",
                "model": "Heltec V3",
                "role": "Repeater",
                "wifi_mac": "aa-bb-cc-dd-ee-ff",
                "ble_mac": "AABBCCDDEE01",
                "assigned_to": "Team North",
                "site_name": "Water tower",
                "status": "deployed",
                "notes": "South mast",
            },
        )

        assert response.status_code == 201
        asset = response.json()
        assert asset["public_key"] == KEY_A
        assert asset["org_serial"] == "DTIS-0042"
        assert asset["hw_serial"] is None
        assert asset["wifi_mac"] == "AA:BB:CC:DD:EE:FF"
        assert asset["ble_mac"] == "AA:BB:CC:DD:EE:01"
        assert asset["status"] == "deployed"
        assert asset["site_name"] == "Water tower"

    @pytest.mark.asyncio
    async def test_asset_with_a_known_key_carries_the_contact(self, test_db, client):
        await _contact(KEY_A, "Tower RPT", last_seen=1700000000, lat=52.1, lon=5.2)

        asset = (await client.post("/api/fleet/assets", json={"public_key": KEY_A})).json()

        assert asset["contact"] == {
            "name": "Tower RPT",
            "type": 2,
            "last_seen": 1700000000,
            "lat": 52.1,
            "lon": 5.2,
        }

    @pytest.mark.asyncio
    async def test_contact_position_prefers_the_manual_one(self, test_db, client):
        await _contact(KEY_A, "Tower RPT", lat=52.1, lon=5.2, manual_lat=53.0, manual_lon=6.0)

        asset = (await client.post("/api/fleet/assets", json={"public_key": KEY_A})).json()

        assert (asset["contact"]["lat"], asset["contact"]["lon"]) == (53.0, 6.0)

    @pytest.mark.asyncio
    async def test_key_of_a_node_never_heard_is_accepted(self, test_db, client):
        response = await client.post("/api/fleet/assets", json={"public_key": KEY_C})

        assert response.status_code == 201
        assert response.json()["contact"] is None

    @pytest.mark.asyncio
    async def test_second_asset_for_the_same_key_is_refused(self, test_db, client):
        await client.post("/api/fleet/assets", json={"public_key": KEY_A})

        response = await client.post("/api/fleet/assets", json={"public_key": KEY_A.upper()})

        assert response.status_code == 409

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "body",
        [
            {},
            {"label": "   ", "org_serial": ""},
            {"public_key": "abc123"},
            {"public_key": "zz" * 32},
            {"label": "x", "wifi_mac": "AA:BB:CC:DD:EE"},
            {"label": "x", "ble_mac": "not a mac"},
            {"label": "x", "status": "sold"},
            {"label": "x" * 201},
            {"label": "x", "notes": "n" * 4001},
        ],
    )
    async def test_invalid_bodies_are_rejected(self, test_db, client, body):
        response = await client.post("/api/fleet/assets", json=body)

        assert response.status_code == 422


class TestRead:
    @pytest.mark.asyncio
    async def test_list_is_empty_at_first(self, test_db, client):
        response = await client.get("/api/fleet/assets")

        assert response.status_code == 200
        assert response.json() == []

    @pytest.mark.asyncio
    async def test_list_returns_every_asset_with_its_contact(self, test_db, client):
        await _contact(KEY_A, "Tower RPT")
        await client.post("/api/fleet/assets", json={"label": "Spare"})
        await client.post("/api/fleet/assets", json={"public_key": KEY_A})

        assets = (await client.get("/api/fleet/assets")).json()

        assert len(assets) == 2
        by_key = {a["public_key"]: a for a in assets}
        assert by_key[None]["label"] == "Spare"
        assert by_key[KEY_A]["contact"]["name"] == "Tower RPT"

    @pytest.mark.asyncio
    async def test_list_can_be_narrowed_to_one_key(self, test_db, client):
        await client.post("/api/fleet/assets", json={"public_key": KEY_A})
        await client.post("/api/fleet/assets", json={"public_key": KEY_B})

        hit = (await client.get("/api/fleet/assets", params={"public_key": KEY_B.upper()})).json()
        miss = (await client.get("/api/fleet/assets", params={"public_key": KEY_C})).json()

        assert [a["public_key"] for a in hit] == [KEY_B]
        assert miss == []

    @pytest.mark.asyncio
    async def test_get_one(self, test_db, client):
        created = (await client.post("/api/fleet/assets", json={"label": "Spare"})).json()

        response = await client.get(f"/api/fleet/assets/{created['id']}")

        assert response.status_code == 200
        assert response.json() == created

    @pytest.mark.asyncio
    async def test_get_unknown_is_404(self, test_db, client):
        assert (await client.get("/api/fleet/assets/999")).status_code == 404


class TestUpdate:
    @pytest.mark.asyncio
    async def test_only_sent_fields_change_and_null_clears(self, test_db, client):
        created = (
            await client.post(
                "/api/fleet/assets",
                json={"label": "Spare", "org_serial": "S-1", "model": "T-Beam", "notes": "n"},
            )
        ).json()

        response = await client.patch(
            f"/api/fleet/assets/{created['id']}",
            json={"status": "maintenance", "model": None, "notes": "  "},
        )

        assert response.status_code == 200
        asset = response.json()
        assert asset["status"] == "maintenance"
        assert asset["model"] is None
        assert asset["notes"] is None
        assert asset["org_serial"] == "S-1"
        assert asset["label"] == "Spare"
        assert asset["created_at"] == created["created_at"]

    @pytest.mark.asyncio
    async def test_key_can_be_linked_later(self, test_db, client):
        await _contact(KEY_A, "Tower RPT")
        created = (await client.post("/api/fleet/assets", json={"label": "Spare"})).json()

        asset = (
            await client.patch(f"/api/fleet/assets/{created['id']}", json={"public_key": KEY_A})
        ).json()

        assert asset["public_key"] == KEY_A
        assert asset["contact"]["name"] == "Tower RPT"

    @pytest.mark.asyncio
    async def test_key_of_another_asset_is_refused(self, test_db, client):
        await client.post("/api/fleet/assets", json={"public_key": KEY_A})
        other = (await client.post("/api/fleet/assets", json={"public_key": KEY_B})).json()

        response = await client.patch(
            f"/api/fleet/assets/{other['id']}", json={"public_key": KEY_A}
        )

        assert response.status_code == 409

    @pytest.mark.asyncio
    async def test_resending_its_own_key_is_fine(self, test_db, client):
        created = (await client.post("/api/fleet/assets", json={"public_key": KEY_A})).json()

        response = await client.patch(
            f"/api/fleet/assets/{created['id']}", json={"public_key": KEY_A, "label": "Tower"}
        )

        assert response.status_code == 200
        assert response.json()["label"] == "Tower"

    @pytest.mark.asyncio
    async def test_clearing_every_identifier_is_refused(self, test_db, client):
        created = (await client.post("/api/fleet/assets", json={"label": "Spare"})).json()

        response = await client.patch(f"/api/fleet/assets/{created['id']}", json={"label": None})

        assert response.status_code == 422
        assert (await client.get(f"/api/fleet/assets/{created['id']}")).json()["label"] == "Spare"

    @pytest.mark.asyncio
    async def test_null_status_is_rejected(self, test_db, client):
        created = (await client.post("/api/fleet/assets", json={"label": "Spare"})).json()

        response = await client.patch(f"/api/fleet/assets/{created['id']}", json={"status": None})

        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_unknown_is_404(self, test_db, client):
        response = await client.patch("/api/fleet/assets/999", json={"label": "x"})

        assert response.status_code == 404


class TestDelete:
    @pytest.mark.asyncio
    async def test_delete_removes_the_asset_and_keeps_the_contact(self, test_db, client):
        await _contact(KEY_A, "Tower RPT")
        created = (await client.post("/api/fleet/assets", json={"public_key": KEY_A})).json()

        response = await client.delete(f"/api/fleet/assets/{created['id']}")

        assert response.status_code == 200
        assert response.json() == {"status": "ok"}
        assert (await client.get("/api/fleet/assets")).json() == []
        assert await ContactRepository.get_by_key(KEY_A) is not None

    @pytest.mark.asyncio
    async def test_unknown_is_404(self, test_db, client):
        assert (await client.delete("/api/fleet/assets/999")).status_code == 404


class TestAssetOutlivesItsContact:
    @pytest.mark.asyncio
    async def test_deleting_the_contact_keeps_the_asset(self, test_db, client):
        await _contact(KEY_A, "Tower RPT")
        created = (await client.post("/api/fleet/assets", json={"public_key": KEY_A})).json()

        await ContactRepository.delete(KEY_A)

        asset = (await client.get(f"/api/fleet/assets/{created['id']}")).json()
        assert asset["public_key"] == KEY_A
        assert asset["contact"] is None


class TestFromContacts:
    @pytest.mark.asyncio
    async def test_creates_one_deployed_asset_per_known_contact(self, test_db, client):
        await _contact(KEY_A, "Tower RPT")
        await _contact(KEY_B, "Hill RPT")

        response = await client.post(
            "/api/fleet/assets/from-contacts", json={"public_keys": [KEY_A.upper(), KEY_B]}
        )

        assert response.status_code == 200
        data = response.json()
        assert sorted(a["public_key"] for a in data["created"]) == [KEY_A, KEY_B]
        assert {a["status"] for a in data["created"]} == {"deployed"}
        assert {a["contact"]["name"] for a in data["created"]} == {"Tower RPT", "Hill RPT"}
        assert data["skipped"] == 0

    @pytest.mark.asyncio
    async def test_skips_keys_with_an_asset_unknown_keys_and_repeats(self, test_db, client):
        await _contact(KEY_A, "Tower RPT")
        await _contact(KEY_B, "Hill RPT")
        await client.post("/api/fleet/assets", json={"public_key": KEY_A, "notes": "mine"})

        data = (
            await client.post(
                "/api/fleet/assets/from-contacts",
                json={"public_keys": [KEY_A, KEY_B, KEY_B, KEY_C]},
            )
        ).json()

        assert [a["public_key"] for a in data["created"]] == [KEY_B]
        assert data["skipped"] == 3
        assets = (await client.get("/api/fleet/assets")).json()
        assert len(assets) == 2
        assert {a["public_key"]: a["notes"] for a in assets}[KEY_A] == "mine"

    @pytest.mark.asyncio
    async def test_a_malformed_key_is_rejected(self, test_db, client):
        response = await client.post(
            "/api/fleet/assets/from-contacts", json={"public_keys": ["nope"]}
        )

        assert response.status_code == 422
        assert (await client.get("/api/fleet/assets")).json() == []
