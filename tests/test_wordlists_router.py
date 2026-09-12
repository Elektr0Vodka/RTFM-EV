"""Tests for the wordlists upload/list/words/delete router."""

import pytest


@pytest.fixture(autouse=True)
def _wordlist_dir(tmp_path, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "database_path", str(tmp_path / "meshcore.db"))


class TestWordlistsRouter:
    @pytest.mark.asyncio
    async def test_upload_normalizes_and_persists(self, test_db, client):
        files = {"file": ("nl.txt", b"Amsterdam\nauto's\n###\nAMSTERDAM\n", "text/plain")}
        resp = await client.post("/api/wordlists", data={"name": "dutch"}, files=files)
        assert resp.status_code == 200
        meta = resp.json()
        assert meta["name"] == "dutch"
        assert meta["entry_count"] == 2  # amsterdam, autos (dedup + strip)

        words = (await client.get(f"/api/wordlists/{meta['id']}/words")).json()["words"]
        assert words == ["amsterdam", "autos"]

    @pytest.mark.asyncio
    async def test_upload_rejects_blank_name(self, test_db, client):
        files = {"file": ("w.txt", b"amsterdam\n", "text/plain")}
        resp = await client.post("/api/wordlists", data={"name": "  "}, files=files)
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_upload_rejects_empty_after_normalize(self, test_db, client):
        files = {"file": ("w.txt", b"###\n   \n", "text/plain")}
        resp = await client.post("/api/wordlists", data={"name": "junk"}, files=files)
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_latin1_fallback(self, test_db, client):
        # 0xe9 is 'e-acute' in latin-1 and invalid UTF-8; must not crash.
        files = {"file": ("w.txt", b"caf\xe9\n", "text/plain")}
        resp = await client.post("/api/wordlists", data={"name": "x"}, files=files)
        assert resp.status_code == 200
        assert resp.json()["entry_count"] == 1  # "caf" + stripped accent -> "caf"

    @pytest.mark.asyncio
    async def test_list_and_delete(self, test_db, client):
        files = {"file": ("w.txt", b"amsterdam\n", "text/plain")}
        meta = (await client.post("/api/wordlists", data={"name": "x"}, files=files)).json()

        listing = (await client.get("/api/wordlists")).json()["wordlists"]
        assert [w["id"] for w in listing] == [meta["id"]]

        resp = await client.delete(f"/api/wordlists/{meta['id']}")
        assert resp.status_code == 204
        assert (await client.get("/api/wordlists")).json()["wordlists"] == []

    @pytest.mark.asyncio
    async def test_words_404_for_unknown(self, test_db, client):
        assert (await client.get("/api/wordlists/999/words")).status_code == 404

    @pytest.mark.asyncio
    async def test_delete_404_for_unknown(self, test_db, client):
        assert (await client.delete("/api/wordlists/999")).status_code == 404
