"""Tests for PartialResolutionRepository (soft partial-node resolution links)."""

import pytest

from app.repository.partial_resolution import PartialResolutionRepository

PK_A = "aabb" + "11" * 30
PK_B = "aabb" + "22" * 30


class TestPartialResolutionRepository:
    @pytest.mark.asyncio
    async def test_upsert_then_list(self, test_db):
        await PartialResolutionRepository.upsert(
            prefix_hex="aabb",
            resolved_pubkey=PK_A,
            resolved_name="Alpha",
            confidence=0.9,
            candidate_count=1,
        )
        rows = await PartialResolutionRepository.list_all()
        assert len(rows) == 1
        r = rows[0]
        assert r.prefix_hex == "aabb"
        assert r.resolved_pubkey == PK_A
        assert r.resolved_name == "Alpha"
        assert r.confidence == 0.9
        assert r.candidate_count == 1
        assert r.source == "external_map"
        assert r.resolved_by == "user"

    @pytest.mark.asyncio
    async def test_upsert_replaces_existing_prefix(self, test_db):
        await PartialResolutionRepository.upsert(
            prefix_hex="aabb",
            resolved_pubkey=PK_A,
            resolved_name="Alpha",
            confidence=0.5,
            candidate_count=2,
        )
        await PartialResolutionRepository.upsert(
            prefix_hex="aabb",
            resolved_pubkey=PK_B,
            resolved_name="Beta",
            confidence=0.9,
            candidate_count=1,
        )
        rows = await PartialResolutionRepository.list_all()
        assert len(rows) == 1
        assert rows[0].resolved_pubkey == PK_B
        assert rows[0].resolved_name == "Beta"
        assert rows[0].confidence == 0.9

    @pytest.mark.asyncio
    async def test_delete_reports_whether_a_row_was_removed(self, test_db):
        await PartialResolutionRepository.upsert(
            prefix_hex="aabb",
            resolved_pubkey=PK_A,
            resolved_name=None,
            confidence=1.0,
            candidate_count=1,
        )
        assert await PartialResolutionRepository.delete("aabb") is True
        assert await PartialResolutionRepository.delete("aabb") is False
        assert await PartialResolutionRepository.list_all() == []

    @pytest.mark.asyncio
    async def test_prefix_and_pubkey_are_lowercased(self, test_db):
        await PartialResolutionRepository.upsert(
            prefix_hex="AABB",
            resolved_pubkey=PK_A.upper(),
            resolved_name=None,
            confidence=1.0,
            candidate_count=1,
        )
        rows = await PartialResolutionRepository.list_all()
        assert rows[0].prefix_hex == "aabb"
        assert rows[0].resolved_pubkey == PK_A
