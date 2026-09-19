"""Tests for prefix-collision computation and the endpoint."""

import pytest

from app.repository.contacts import ContactRepository
from app.services.prefix_collisions import compute_prefix_collisions


class TestComputePrefixCollisions:
    def test_no_collisions(self):
        identities = [("aa" + "0" * 62, "A", None, None), ("bb" + "0" * 62, "B", None, None)]
        widths = compute_prefix_collisions(identities)
        assert [w["width"] for w in widths] == [1, 2, 3]
        for w in widths:
            assert w["total_nodes"] == 2
            assert w["colliding_prefixes"] == 0
            assert w["colliding_nodes"] == 0
            assert w["groups"] == []

    def test_one_byte_collision_only(self):
        # Share first byte "aa" but differ in the second byte.
        pk1 = "aa" + "11" + "0" * 60
        pk2 = "aa" + "22" + "0" * 60
        widths = {
            w["width"]: w
            for w in compute_prefix_collisions([(pk1, "One", None, None), (pk2, "Two", None, None)])
        }
        # 1-byte: both share "aa" -> one colliding group of 2.
        assert widths[1]["colliding_prefixes"] == 1
        assert widths[1]["colliding_nodes"] == 2
        assert widths[1]["groups"][0]["prefix"] == "aa"
        assert widths[1]["groups"][0]["count"] == 2
        assert [n["public_key"] for n in widths[1]["groups"][0]["nodes"]] == [pk1, pk2]
        # 2-byte and 3-byte: prefixes differ -> no collision.
        assert widths[2]["colliding_prefixes"] == 0
        assert widths[3]["colliding_prefixes"] == 0
        # Matrix: 256 entries; first byte 0xaa holds the worst collision.
        assert len(widths[1]["matrix"]) == 256
        assert widths[1]["matrix"][0xAA] == 2  # both share first byte aa
        assert widths[2]["matrix"][0xAA] == 1  # worst 2-byte subgroup is a singleton
        # Distinct prefixes: one 1-byte prefix, two distinct 2-byte prefixes.
        assert widths[1]["distinct_prefixes"] == 1
        assert widths[2]["distinct_prefixes"] == 2
        # Cells with no nodes stay 0.
        assert widths[1]["matrix"][0x00] == 0

    def test_collision_at_all_widths_sorted_by_size(self):
        # group_a: 3 keys share 6-hex "aabbcc"; group_b: 2 keys share "ddeeff".
        a1 = "aabbcc" + "0" * 58
        a2 = "aabbcc" + "1" * 58
        a3 = "aabbcc" + "2" * 58
        b1 = "ddeeff" + "0" * 58
        b2 = "ddeeff" + "1" * 58
        widths = {
            w["width"]: w
            for w in compute_prefix_collisions(
                [
                    (a1, None, None, None),
                    (a2, None, None, None),
                    (a3, None, None, None),
                    (b1, None, None, None),
                    (b2, None, None, None),
                ]
            )
        }
        g = widths[3]["groups"]
        # Largest group first: aabbcc (3) before ddeeff (2).
        assert [(x["prefix"], x["count"]) for x in g] == [("aabbcc", 3), ("ddeeff", 2)]
        assert widths[3]["colliding_nodes"] == 5

    def test_nodes_sorted_name_then_key(self):
        pk1 = "aa" + "11" + "0" * 60
        pk2 = "aa" + "22" + "0" * 60
        pk3 = "aa" + "33" + "0" * 60
        # names: "Zeta", None, "alpha" -> sorted alpha (case-insensitive) with
        # None treated as empty string first.
        widths = {
            w["width"]: w
            for w in compute_prefix_collisions(
                [(pk1, "Zeta", None, None), (pk2, None, None, None), (pk3, "alpha", None, None)]
            )
        }
        names = [n["name"] for n in widths[1]["groups"][0]["nodes"]]
        assert names == [None, "alpha", "Zeta"]

    def test_distance_and_assessment(self):
        # Two nodes sharing byte "aa": ~5 km apart -> LOCAL.
        near1 = ("aa" + "11" + "0" * 60, "Near1", 51.00, 5.00)
        near2 = ("aa" + "22" + "0" * 60, "Near2", 51.00, 5.07)  # ~4.9 km east
        # Two nodes sharing byte "bb": far apart -> REGIONAL.
        far1 = ("bb" + "11" + "0" * 60, "Far1", 51.00, 5.00)
        far2 = ("bb" + "22" + "0" * 60, "Far2", 52.00, 6.00)  # >100 km
        # Two nodes sharing byte "cc" but only one has coords -> unknown distance.
        loc = ("cc" + "11" + "0" * 60, "Loc", 51.0, 5.0)
        noloc = ("cc" + "22" + "0" * 60, "NoLoc", None, None)
        w1 = {
            g["prefix"]: g
            for g in compute_prefix_collisions([near1, near2, far1, far2, loc, noloc])[0]["groups"]
        }
        assert w1["aa"]["assessment"] == "local"
        assert w1["aa"]["max_distance_km"] is not None and w1["aa"]["max_distance_km"] < 10
        assert w1["aa"]["located_count"] == 2
        assert w1["bb"]["assessment"] == "regional"
        assert w1["bb"]["max_distance_km"] > 100
        # Only one located node -> no distance, unknown assessment.
        assert w1["cc"]["assessment"] == "unknown"
        assert w1["cc"]["max_distance_km"] is None
        assert w1["cc"]["located_count"] == 1
        # Node dicts carry coordinates through.
        near = next(n for n in w1["aa"]["nodes"] if n["name"] == "Near1")
        assert near["lat"] == 51.00 and near["lon"] == 5.00

    def test_null_island_treated_as_unlocated(self):
        # A node at exact (0, 0) must not count as located for distance.
        real = ("dd" + "11" + "0" * 60, "Real", 51.0, 5.0)
        island = ("dd" + "22" + "0" * 60, "Island", 0.0, 0.0)
        group = compute_prefix_collisions([real, island])[0]["groups"][0]
        assert group["located_count"] == 1
        assert group["assessment"] == "unknown"
        assert group["max_distance_km"] is None
        island_node = next(n for n in group["nodes"] if n["name"] == "Island")
        assert island_node["lat"] is None and island_node["lon"] is None


class TestPrefixCollisionsEndpoint:
    @pytest.mark.asyncio
    async def test_endpoint_reports_collisions(self, test_db, client):
        pk1 = "aa" + "11" + "0" * 60
        pk2 = "aa" + "22" + "0" * 60
        placeholder = "aa1234"  # short placeholder key, must be excluded
        await ContactRepository.upsert({"public_key": pk1, "name": "One", "lat": 51.0, "lon": 5.0})
        await ContactRepository.upsert({"public_key": pk2, "name": "Two", "lat": 51.0, "lon": 5.07})
        await ContactRepository.upsert({"public_key": placeholder, "name": "Ghost"})

        resp = await client.get("/api/packets/prefix-collisions")
        assert resp.status_code == 200
        body = resp.json()
        widths = {w["width"]: w for w in body["widths"]}
        # Only the two full-key contacts are counted (placeholder excluded).
        assert widths[1]["total_nodes"] == 2
        assert widths[1]["colliding_prefixes"] == 1
        group = widths[1]["groups"][0]
        assert group["prefix"] == "aa"
        assert group["count"] == 2
        # The two colliding nodes are ~5 km apart -> LOCAL, with coords carried.
        assert group["assessment"] == "local"
        assert group["max_distance_km"] is not None and group["max_distance_km"] < 10
        assert group["located_count"] == 2
        assert all(n["lat"] == 51.0 for n in group["nodes"])
        # 2-byte differs -> no collision.
        assert widths[2]["colliding_prefixes"] == 0
