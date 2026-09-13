"""Tests for AdvertLinksRepository and the GET /api/packets/advert-links endpoint."""

import pytest

from app.models import ContactUpsert, ExternalMapNode
from app.repository import ContactRepository
from app.repository.advert_links import AdvertLinksRepository
from app.repository.external_map import ExternalMapRepository


async def _insert_advert_event(
    dbi, public_key: str, path_hex: str, hop_width, min_path_len: int, first_seen: int
) -> None:
    async with dbi.tx() as conn:
        await conn.execute(
            """
            INSERT INTO advert_events
                (transmission_id, public_key, first_seen, min_path_len, path_hex, hop_width)
            VALUES (NULL, ?, ?, ?, ?, ?)
            """,
            (public_key.lower(), first_seen, min_path_len, path_hex, hop_width),
        )


class TestLocatedNodes:
    @pytest.mark.asyncio
    async def test_unions_located_contacts_and_external_nodes(self, test_db):
        await ContactRepository.upsert(
            ContactUpsert(public_key="ff00000000", name="Origin", lat=52.0, lon=5.0)
        )
        # A contact with no GPS must be excluded.
        await ContactRepository.upsert(ContactUpsert(public_key="dd00000000", name="NoGps"))
        await ExternalMapRepository.replace_all(
            [
                ExternalMapNode(
                    pubkey="aa11000000",
                    name="R1",
                    role="Repeater",
                    lat=52.1,
                    lon=5.0,
                    last_seen=1,
                    advert_count=3,
                    mobile=False,
                )
            ],
            source="test",
            synced_at=1,
        )
        nodes = await AdvertLinksRepository.located_nodes()
        by_pk = {n.pubkey: n for n in nodes}
        assert "ff00000000" in by_pk and by_pk["ff00000000"].kind == "contact"
        assert "aa11000000" in by_pk and by_pk["aa11000000"].kind == "external"
        assert "dd00000000" not in by_pk

    @pytest.mark.asyncio
    async def test_contact_wins_over_external_on_pubkey_collision(self, test_db):
        await ContactRepository.upsert(
            ContactUpsert(public_key="aa11000000", name="LocalRepeater", lat=1.0, lon=2.0)
        )
        await ExternalMapRepository.replace_all(
            [
                ExternalMapNode(
                    pubkey="aa11000000",
                    name="ExtRepeater",
                    role="Repeater",
                    lat=9.0,
                    lon=9.0,
                    last_seen=1,
                    advert_count=0,
                    mobile=False,
                )
            ],
            source="test",
            synced_at=1,
        )
        nodes = await AdvertLinksRepository.located_nodes()
        match = [n for n in nodes if n.pubkey == "aa11000000"]
        assert len(match) == 1
        assert match[0].kind == "contact" and match[0].lat == 1.0


class TestRecentEvents:
    @pytest.mark.asyncio
    async def test_returns_rows_newest_first_capped(self, test_db):
        for i in range(3):
            await _insert_advert_event(test_db, "ff00000000", "aa11", 2, 1, 1000 + i)
        rows = await AdvertLinksRepository.recent_events(limit=2)
        assert len(rows) == 2
        assert rows[0].first_seen == 1002 and rows[1].first_seen == 1001
        assert rows[0].hop_width == 2 and rows[0].public_key == "ff00000000"


class TestAdvertLinksEndpoint:
    @pytest.mark.asyncio
    async def test_returns_resolved_edges_without_radio(self, test_db, client):
        # Origin (contact, GPS) advertises via one unique 2-byte hop (external node).
        await ContactRepository.upsert(
            ContactUpsert(public_key="ff00000000", name="Origin", lat=52.0, lon=5.0)
        )
        await ExternalMapRepository.replace_all(
            [
                ExternalMapNode(
                    pubkey="aa11000000",
                    name="R1",
                    role="Repeater",
                    lat=52.1,
                    lon=5.0,
                    last_seen=1,
                    advert_count=3,
                    mobile=False,
                )
            ],
            source="test",
            synced_at=1,
        )
        await _insert_advert_event(test_db, "ff00000000", "aa11", 2, 1, 9000)

        response = await client.get("/api/packets/advert-links")
        assert response.status_code == 200
        edges = response.json()
        # No radio in tests => no self node => only origin -> hop edge.
        assert len(edges) == 1
        e = edges[0]
        assert {e["a"]["pubkey"], e["b"]["pubkey"]} == {"ff00000000", "aa11000000"}
        assert e["hop_width"] == 2
        assert e["count"] == 1
        assert e["last_seen"] == 9000
        assert e["ambiguous"] is False
        kinds = {e["a"]["kind"], e["b"]["kind"]}
        assert kinds == {"contact", "external"}

    @pytest.mark.asyncio
    async def test_empty_when_no_events(self, test_db, client):
        response = await client.get("/api/packets/advert-links")
        assert response.status_code == 200
        assert response.json() == []
