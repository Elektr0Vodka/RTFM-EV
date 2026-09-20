"""Tests for the /api/partial-resolutions endpoints."""

import pytest

from app.models import ContactUpsert, ExternalMapNode
from app.repository import ContactRepository
from app.repository.external_map import ExternalMapRepository

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
