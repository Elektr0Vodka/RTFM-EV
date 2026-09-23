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
    async def test_excludes_zero_zero_sentinel(self, test_db):
        # (0, 0) is the "unset GPS" sentinel (Atlantic Ocean); it must never
        # enter the located-nodes set for either a contact or an external node.
        await ContactRepository.upsert(
            ContactUpsert(public_key="ff00000000", name="Real", lat=52.0, lon=5.0)
        )
        await ContactRepository.upsert(
            ContactUpsert(public_key="cc00000000", name="ZeroContact", lat=0.0, lon=0.0)
        )
        await ExternalMapRepository.replace_all(
            [
                ExternalMapNode(
                    pubkey="bb00000000",
                    name="ZeroExternal",
                    role="Repeater",
                    lat=0.0,
                    lon=0.0,
                    last_seen=1,
                    advert_count=0,
                    mobile=False,
                )
            ],
            source="test",
            synced_at=1,
        )
        nodes = await AdvertLinksRepository.located_nodes()
        by_pk = {n.pubkey: n for n in nodes}
        assert "ff00000000" in by_pk
        assert "cc00000000" not in by_pk
        assert "bb00000000" not in by_pk

    @pytest.mark.asyncio
    async def test_uses_manual_coordinates_when_advertised_missing(self, test_db):
        # A contact with no advertised GPS but a manual location override must be
        # placed at the manual coordinates so advert-link edges can reach it.
        await ContactRepository.upsert(
            ContactUpsert(
                public_key="ee00000000", name="ManualOnly", manual_lat=51.5, manual_lon=4.5
            )
        )
        nodes = await AdvertLinksRepository.located_nodes()
        by_pk = {n.pubkey: n for n in nodes}
        assert "ee00000000" in by_pk
        assert by_pk["ee00000000"].kind == "contact"
        assert by_pk["ee00000000"].lat == 51.5
        assert by_pk["ee00000000"].lon == 4.5

    @pytest.mark.asyncio
    async def test_advertised_coordinates_win_over_manual_override(self, test_db):
        # When both advertised and manual coordinates exist, the advertised
        # (RF-truth) location wins.
        await ContactRepository.upsert(
            ContactUpsert(
                public_key="ee11000000",
                name="Both",
                lat=52.0,
                lon=5.0,
                manual_lat=10.0,
                manual_lon=10.0,
            )
        )
        nodes = await AdvertLinksRepository.located_nodes()
        by_pk = {n.pubkey: n for n in nodes}
        assert "ee11000000" in by_pk
        assert by_pk["ee11000000"].lat == 52.0
        assert by_pk["ee11000000"].lon == 5.0

    @pytest.mark.asyncio
    async def test_excludes_zero_zero_manual_override(self, test_db):
        # (0, 0) remains the "unset" sentinel even when it arrives via the manual
        # override columns.
        await ContactRepository.upsert(
            ContactUpsert(
                public_key="ee22000000", name="ZeroManual", manual_lat=0.0, manual_lon=0.0
            )
        )
        nodes = await AdvertLinksRepository.located_nodes()
        by_pk = {n.pubkey: n for n in nodes}
        assert "ee22000000" not in by_pk

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


class TestLocatedNodesHeardOnly:
    @pytest.mark.asyncio
    async def test_heard_only_excludes_never_heard_contacts_and_external_nodes(self, test_db):
        await ContactRepository.upsert(
            ContactUpsert(public_key="ff00000000", name="Heard", lat=52.0, lon=5.0, last_seen=100)
        )
        await ContactRepository.upsert(
            ContactUpsert(public_key="dd00000000", name="NeverHeard", lat=52.2, lon=5.1)
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
        all_pks = {n.pubkey for n in await AdvertLinksRepository.located_nodes()}
        assert all_pks == {"ff00000000", "dd00000000", "aa11000000"}
        heard_pks = {n.pubkey for n in await AdvertLinksRepository.located_nodes(heard_only=True)}
        assert heard_pks == {"ff00000000"}


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
    async def test_manual_only_node_becomes_a_path_edge_endpoint(self, test_db, client):
        # A repeater placed only by a manual override (no advertised GPS) must be
        # a drawable endpoint of the advert-link path it participates in.
        await ContactRepository.upsert(
            ContactUpsert(
                public_key="ff00000000", name="ManualRepeater", manual_lat=51.5, manual_lon=4.5
            )
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
        assert len(edges) == 1
        e = edges[0]
        assert {e["a"]["pubkey"], e["b"]["pubkey"]} == {"ff00000000", "aa11000000"}
        manual = e["a"] if e["a"]["pubkey"] == "ff00000000" else e["b"]
        assert manual["lat"] == 51.5 and manual["lon"] == 4.5

    @pytest.mark.asyncio
    async def test_empty_when_no_events(self, test_db, client):
        response = await client.get("/api/packets/advert-links")
        assert response.status_code == 200
        assert response.json() == []

    @pytest.mark.asyncio
    async def test_heard_only_and_max_km_query_params(self, test_db, client):
        # Origin (heard) advertises via a unique 2-byte hop that is either an
        # analyzer-only node (never heard) or a heard contact far away.
        await ContactRepository.upsert(
            ContactUpsert(public_key="ff00000000", name="Origin", lat=52.0, lon=5.0, last_seen=1)
        )
        await ContactRepository.upsert(
            ContactUpsert(public_key="bb22000000", name="Far", lat=51.5, lon=-0.1, last_seen=1)
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
        await _insert_advert_event(test_db, "ff00000000", "bb22", 2, 1, 9001)

        def pairs(resp):
            return {frozenset((e["a"]["pubkey"], e["b"]["pubkey"])) for e in resp.json()}

        everything = await client.get("/api/packets/advert-links")
        assert pairs(everything) == {
            frozenset(("ff00000000", "aa11000000")),
            frozenset(("ff00000000", "bb22000000")),
        }
        heard = await client.get("/api/packets/advert-links?heard_only=true")
        assert pairs(heard) == {frozenset(("ff00000000", "bb22000000"))}
        # Origin (NL) to Far (London) is ~360 km; a 200 km cap drops it.
        capped = await client.get("/api/packets/advert-links?heard_only=true&max_km=200")
        assert capped.status_code == 200
        assert capped.json() == []

    @pytest.mark.asyncio
    async def test_rejects_non_positive_max_km(self, test_db, client):
        response = await client.get("/api/packets/advert-links?max_km=0")
        assert response.status_code == 422
