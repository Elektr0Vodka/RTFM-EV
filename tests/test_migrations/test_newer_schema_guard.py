"""A database written by a newer build must not be migrated silently."""

import logging

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


@pytest.mark.asyncio
async def test_newer_schema_logs_warning_and_applies_nothing(caplog):
    async with aiosqlite.connect(":memory:") as conn:
        await set_version(conn, LATEST_SCHEMA_VERSION + 5)

        with caplog.at_level(logging.WARNING, logger="app.migrations"):
            applied = await run_migrations(conn)

        assert applied == 0
        assert await get_version(conn) == LATEST_SCHEMA_VERSION + 5
        assert any(
            "newer" in record.getMessage() and str(LATEST_SCHEMA_VERSION + 5) in record.getMessage()
            for record in caplog.records
            if record.levelno == logging.WARNING
        )


@pytest.mark.asyncio
async def test_current_schema_does_not_warn(caplog):
    async with aiosqlite.connect(":memory:") as conn:
        await set_version(conn, LATEST_SCHEMA_VERSION)

        with caplog.at_level(logging.WARNING, logger="app.migrations"):
            await run_migrations(conn)

        assert not [r for r in caplog.records if r.levelno >= logging.WARNING]
