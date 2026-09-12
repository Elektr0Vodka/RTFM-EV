"""Tests for WordlistRepository (DB row + on-disk file)."""

import pytest

from app.repository import WordlistRepository


@pytest.fixture
def _wordlist_dir(tmp_path, monkeypatch):
    """Point wordlist file storage at an isolated tmp dir per test."""
    from app.config import settings

    monkeypatch.setattr(settings, "database_path", str(tmp_path / "meshcore.db"))
    return tmp_path / "wordlists"


class TestWordlistRepository:
    @pytest.mark.asyncio
    async def test_create_writes_row_and_file(self, test_db, _wordlist_dir):
        meta = await WordlistRepository.create("dutch", ["amsterdam", "utrecht"])
        assert meta["name"] == "dutch"
        assert meta["entry_count"] == 2
        rows = await WordlistRepository.list_all()
        assert len(rows) == 1
        assert (_wordlist_dir / f"{meta['id']}.txt").read_text(encoding="utf-8") == (
            "amsterdam\nutrecht\n"
        )

    @pytest.mark.asyncio
    async def test_read_words_round_trips(self, test_db, _wordlist_dir):
        meta = await WordlistRepository.create("x", ["a", "b"])
        assert await WordlistRepository.read_words(meta["id"]) == ["a", "b"]

    @pytest.mark.asyncio
    async def test_read_words_missing_returns_none(self, test_db, _wordlist_dir):
        assert await WordlistRepository.read_words(999) is None

    @pytest.mark.asyncio
    async def test_delete_removes_row_and_file(self, test_db, _wordlist_dir):
        meta = await WordlistRepository.create("x", ["a"])
        path = _wordlist_dir / f"{meta['id']}.txt"
        assert path.exists()
        assert await WordlistRepository.delete(meta["id"]) is True
        assert await WordlistRepository.list_all() == []
        assert not path.exists()

    @pytest.mark.asyncio
    async def test_delete_unknown_returns_false(self, test_db, _wordlist_dir):
        assert await WordlistRepository.delete(123) is False
