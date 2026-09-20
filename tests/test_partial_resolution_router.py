"""Tests for the /api/partial-resolutions endpoints."""

import pytest

from app.models import ContactUpsert, ExternalMapNode
from app.repository import ContactRepository
from app.repository.external_map import ExternalMapRepository
from app.repository.partial_resolution import PartialResolutionRepository

EXT_A = "aa" + "11" * 31


async def _seed_placeholder_and_external() -> None:
    await ExternalMapRepository.replace_all(
        [
            ExternalMapNode(
                pubkey=EXT_A,
                name="Alpha",
                role="Repeater",
                lat=52.0,
                lon=4.0,
                last_seen=1,
                advert_count=1,
                mobile=False,
            )
        ],
        source="test",
        synced_at=1,
    )
    await ContactRepository.upsert(ContactUpsert(public_key="aa", name=None, type=0))


class TestPreviewEndpoint:
    @pytest.mark.asyncio
    async def test_matches_placeholder_to_external_candidate(self, test_db, client):
        await _seed_placeholder_and_external()
        r = await client.get("/api/partial-resolutions/preview")
        assert r.status_code == 200
        body = r.json()
        assert body["external_count"] == 1
        assert body["reason"] is None
        res = next(x for x in body["resolutions"] if x["prefix_hex"] == "aa")
        assert res["seen_as"] == "placeholder"
        assert res["candidate_count"] == 1
        assert res["candidates"][0]["pubkey"] == EXT_A

    @pytest.mark.asyncio
    async def test_reports_reason_when_external_cache_empty(self, test_db, client):
        await ContactRepository.upsert(ContactUpsert(public_key="aa"))
        r = await client.get("/api/partial-resolutions/preview")
        assert r.status_code == 200
        body = r.json()
        assert body["external_count"] == 0
        assert body["reason"]
        assert body["resolutions"] == []


class TestApplyListDelete:
    @pytest.mark.asyncio
    async def test_apply_then_list_then_delete(self, test_db, client):
        await _seed_placeholder_and_external()
        apply = await client.post(
            "/api/partial-resolutions/apply",
            json={
                "selections": [
                    {
                        "prefix_hex": "aa",
                        "resolved_pubkey": EXT_A,
                        "resolved_name": "Alpha",
                        "confidence": 0.8,
                        "candidate_count": 1,
                    }
                ]
            },
        )
        assert apply.status_code == 200
        assert apply.json()["applied"] == 1

        rows = (await client.get("/api/partial-resolutions")).json()
        assert len(rows) == 1
        assert rows[0]["prefix_hex"] == "aa"
        assert rows[0]["resolved_pubkey"] == EXT_A

        deleted = await client.delete("/api/partial-resolutions/aa")
        assert deleted.status_code == 200
        assert deleted.json()["deleted"] is True
        assert (await client.get("/api/partial-resolutions")).json() == []


class TestApplyPromotesToFullContact:
    @pytest.mark.asyncio
    async def test_apply_promotes_placeholder_into_a_full_contact(self, test_db, client):
        await _seed_placeholder_and_external()
        # Before: a prefix-only placeholder exists, the full key does not.
        assert await ContactRepository.get_by_key("aa") is not None
        assert await ContactRepository.get_by_key(EXT_A) is None

        resp = await client.post(
            "/api/partial-resolutions/apply",
            json={
                "selections": [
                    {
                        "prefix_hex": "aa",
                        "resolved_pubkey": EXT_A,
                        "resolved_name": "Alpha",
                        "confidence": 0.8,
                        "candidate_count": 1,
                    }
                ]
            },
        )
        assert resp.status_code == 200

        # The placeholder is promoted away; a full contact is created from the
        # external-map node with its advertised (overwritable) name + location.
        assert await ContactRepository.get_by_key("aa") is None
        full = await ContactRepository.get_by_key(EXT_A)
        assert full is not None
        assert full.name == "Alpha"
        assert full.lat == 52.0
        assert full.lon == 4.0
        # The soft link is still recorded (provenance / map disambiguation).
        rows = await PartialResolutionRepository.list_all()
        assert any(r.prefix_hex == "aa" for r in rows)

    @pytest.mark.asyncio
    async def test_apply_keeps_an_existing_full_contact_untouched(self, test_db, client):
        # A real contact already exists for the full key with an advert-heard name.
        await ExternalMapRepository.replace_all(
            [
                ExternalMapNode(
                    pubkey=EXT_A, name="Guessed", role="Repeater", lat=52.0, lon=4.0, last_seen=1
                )
            ],
            source="test",
            synced_at=1,
        )
        await ContactRepository.upsert(
            ContactUpsert(public_key=EXT_A, name="Real Advert Name", type=2, last_advert=999)
        )
        await ContactRepository.upsert(ContactUpsert(public_key="aa", type=0))

        resp = await client.post(
            "/api/partial-resolutions/apply",
            json={
                "selections": [
                    {
                        "prefix_hex": "aa",
                        "resolved_pubkey": EXT_A,
                        "resolved_name": "Guessed",
                        "confidence": 0.8,
                        "candidate_count": 1,
                    }
                ]
            },
        )
        assert resp.status_code == 200
        # The existing real contact's advert-heard name is not overwritten by the guess.
        full = await ContactRepository.get_by_key(EXT_A)
        assert full is not None
        assert full.name == "Real Advert Name"
        # The placeholder still got promoted (merged) into it.
        assert await ContactRepository.get_by_key("aa") is None
