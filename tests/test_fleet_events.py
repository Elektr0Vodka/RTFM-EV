"""Tests for the fleet asset event log (plan 31, Phase 2)."""

import pytest

from app.repository import ContactRepository

KEY_A = "a1" * 32


async def _asset(client, **fields) -> dict:
    response = await client.post("/api/fleet/assets", json={"label": "Spare", **fields})
    assert response.status_code == 201
    return response.json()


async def _events(client, asset_id: int) -> list[dict]:
    response = await client.get(f"/api/fleet/assets/{asset_id}/events")
    assert response.status_code == 200
    return response.json()


class TestManualEvents:
    @pytest.mark.asyncio
    async def test_a_new_asset_has_no_events(self, test_db, client):
        asset = await _asset(client)

        assert await _events(client, asset["id"]) == []
        assert asset["last_maintenance"] is None
        assert asset["last_failure"] is None

    @pytest.mark.asyncio
    async def test_add_an_entry(self, test_db, client):
        asset = await _asset(client)

        response = await client.post(
            f"/api/fleet/assets/{asset['id']}/events",
            json={
                "kind": "maintenance",
                "occurred_at": 1700000000,
                "summary": "  Replaced the antenna  ",
                "detail": "N-connector was corroded",
                "actor": "Mike",
            },
        )

        assert response.status_code == 201
        event = response.json()
        assert event["kind"] == "maintenance"
        assert event["occurred_at"] == 1700000000
        assert event["summary"] == "Replaced the antenna"
        assert event["detail"] == "N-connector was corroded"
        assert event["actor"] == "Mike"
        assert event["from_value"] is None and event["to_value"] is None
        assert await _events(client, asset["id"]) == [event]

    @pytest.mark.asyncio
    async def test_time_defaults_to_now(self, test_db, client):
        asset = await _asset(client)

        event = (
            await client.post(
                f"/api/fleet/assets/{asset['id']}/events",
                json={"kind": "note", "summary": "Checked"},
            )
        ).json()

        assert abs(event["occurred_at"] - event["created_at"]) <= 1

    @pytest.mark.asyncio
    async def test_newest_entry_comes_first(self, test_db, client):
        asset = await _asset(client)
        for when, summary in ((100, "first"), (300, "third"), (200, "second")):
            await client.post(
                f"/api/fleet/assets/{asset['id']}/events",
                json={"kind": "note", "occurred_at": when, "summary": summary},
            )

        assert [e["summary"] for e in await _events(client, asset["id"])] == [
            "third",
            "second",
            "first",
        ]

    @pytest.mark.asyncio
    async def test_the_asset_carries_the_last_maintenance_and_failure(self, test_db, client):
        asset = await _asset(client)
        url = f"/api/fleet/assets/{asset['id']}/events"
        await client.post(url, json={"kind": "maintenance", "occurred_at": 100, "summary": "a"})
        await client.post(url, json={"kind": "maintenance", "occurred_at": 500, "summary": "b"})
        await client.post(url, json={"kind": "failure", "occurred_at": 300, "summary": "c"})
        await client.post(url, json={"kind": "note", "occurred_at": 900, "summary": "d"})

        one = (await client.get(f"/api/fleet/assets/{asset['id']}")).json()
        listed = (await client.get("/api/fleet/assets")).json()[0]

        assert (one["last_maintenance"], one["last_failure"]) == (500, 300)
        assert (listed["last_maintenance"], listed["last_failure"]) == (500, 300)

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "body",
        [
            {"kind": "note"},
            {"kind": "note", "summary": "   "},
            {"kind": "status", "summary": "by hand"},
            {"kind": "party", "summary": "x"},
            {"kind": "note", "summary": "x" * 201},
            {"kind": "note", "summary": "x", "occurred_at": -1},
        ],
    )
    async def test_invalid_entries_are_rejected(self, test_db, client, body):
        asset = await _asset(client)

        response = await client.post(f"/api/fleet/assets/{asset['id']}/events", json=body)

        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_unknown_asset_is_404(self, test_db, client):
        assert (await client.get("/api/fleet/assets/999/events")).status_code == 404
        response = await client.post(
            "/api/fleet/assets/999/events", json={"kind": "note", "summary": "x"}
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_an_entry(self, test_db, client):
        asset = await _asset(client)
        event = (
            await client.post(
                f"/api/fleet/assets/{asset['id']}/events",
                json={"kind": "note", "summary": "typo"},
            )
        ).json()

        response = await client.delete(f"/api/fleet/assets/{asset['id']}/events/{event['id']}")

        assert response.status_code == 200
        assert await _events(client, asset["id"]) == []

    @pytest.mark.asyncio
    async def test_an_entry_is_only_deleted_through_its_own_asset(self, test_db, client):
        first = await _asset(client)
        second = await _asset(client, label="Other")
        event = (
            await client.post(
                f"/api/fleet/assets/{first['id']}/events", json={"kind": "note", "summary": "x"}
            )
        ).json()

        response = await client.delete(f"/api/fleet/assets/{second['id']}/events/{event['id']}")

        assert response.status_code == 404
        assert len(await _events(client, first["id"])) == 1


class TestAutomaticEvents:
    @pytest.mark.asyncio
    async def test_a_status_change_is_logged(self, test_db, client):
        asset = await _asset(client)

        await client.patch(f"/api/fleet/assets/{asset['id']}", json={"status": "deployed"})

        events = await _events(client, asset["id"])
        assert [(e["kind"], e["from_value"], e["to_value"]) for e in events] == [
            ("status", "in_stock", "deployed")
        ]
        assert events[0]["summary"] is None

    @pytest.mark.asyncio
    async def test_resending_the_same_status_logs_nothing(self, test_db, client):
        asset = await _asset(client)

        await client.patch(
            f"/api/fleet/assets/{asset['id']}", json={"status": "in_stock", "model": "T-Beam"}
        )

        assert await _events(client, asset["id"]) == []

    @pytest.mark.asyncio
    async def test_a_change_of_holder_is_logged_as_custody(self, test_db, client):
        asset = await _asset(client, assigned_to="Depot")

        await client.patch(f"/api/fleet/assets/{asset['id']}", json={"assigned_to": "Team North"})
        await client.patch(f"/api/fleet/assets/{asset['id']}", json={"assigned_to": None})

        events = await _events(client, asset["id"])
        assert [(e["kind"], e["from_value"], e["to_value"]) for e in reversed(events)] == [
            ("custody", None, "Depot"),
            ("custody", "Depot", "Team North"),
            ("custody", "Team North", None),
        ]

    @pytest.mark.asyncio
    async def test_a_refused_change_logs_nothing(self, test_db, client):
        asset = await _asset(client)

        response = await client.patch(
            f"/api/fleet/assets/{asset['id']}", json={"status": "deployed", "wifi_mac": "nope"}
        )

        assert response.status_code == 422
        assert await _events(client, asset["id"]) == []


class TestEventsFollowTheAsset:
    @pytest.mark.asyncio
    async def test_deleting_the_asset_removes_its_entries(self, test_db, client):
        asset = await _asset(client)
        await client.post(
            f"/api/fleet/assets/{asset['id']}/events", json={"kind": "note", "summary": "x"}
        )

        await client.delete(f"/api/fleet/assets/{asset['id']}")

        async with test_db.readonly() as conn:
            async with conn.execute("SELECT COUNT(*) FROM fleet_asset_events") as cursor:
                row = await cursor.fetchone()
        assert row[0] == 0

    @pytest.mark.asyncio
    async def test_assets_added_from_contacts_start_without_entries(self, test_db, client):
        await ContactRepository.upsert({"public_key": KEY_A, "name": "Tower", "type": 2})

        data = (
            await client.post("/api/fleet/assets/from-contacts", json={"public_keys": [KEY_A]})
        ).json()

        assert await _events(client, data["created"][0]["id"]) == []
