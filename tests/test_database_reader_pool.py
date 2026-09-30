"""Database.readonly() uses separate reader connections for file databases."""

import asyncio
import sqlite3

import pytest

from app.database import Database


async def _file_db(tmp_path) -> Database:
    db = Database(str(tmp_path / "pool.db"))
    await db.connect()
    async with db.tx() as conn:
        await conn.execute("CREATE TABLE widget (id INTEGER PRIMARY KEY, name TEXT)")
    return db


@pytest.mark.asyncio
async def test_read_does_not_wait_for_open_write_transaction(tmp_path):
    db = await _file_db(tmp_path)
    try:
        write_open = asyncio.Event()
        release_write = asyncio.Event()

        async def writer():
            async with db.tx() as conn:
                await conn.execute("INSERT INTO widget (name) VALUES ('a')")
                write_open.set()
                await release_write.wait()

        task = asyncio.create_task(writer())
        await write_open.wait()

        async def count():
            async with db.readonly() as conn:
                async with conn.execute("SELECT COUNT(*) FROM widget") as cursor:
                    return (await cursor.fetchone())[0]

        # The writer still holds the write lock; the read must not queue behind
        # it, and must not see the uncommitted row.
        assert await asyncio.wait_for(count(), timeout=2) == 0

        release_write.set()
        await task
        assert await count() == 1
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_reader_connection_rejects_writes(tmp_path):
    db = await _file_db(tmp_path)
    try:
        with pytest.raises(sqlite3.OperationalError):
            async with db.readonly() as conn:
                await conn.execute("INSERT INTO widget (name) VALUES ('x')")
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_memory_database_readonly_rejects_writes_then_writer_still_writes():
    db = Database(":memory:")
    await db.connect()
    try:
        async with db.tx() as conn:
            await conn.execute("CREATE TABLE widget (id INTEGER PRIMARY KEY, name TEXT)")
        with pytest.raises(sqlite3.OperationalError):
            async with db.readonly() as conn:
                await conn.execute("INSERT INTO widget (name) VALUES ('x')")
        async with db.tx() as conn:
            await conn.execute("INSERT INTO widget (name) VALUES ('ok')")
        async with db.readonly() as conn:
            async with conn.execute("SELECT name FROM widget") as cursor:
                assert [r[0] for r in await cursor.fetchall()] == ["ok"]
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_reader_connections_have_sql_helpers(tmp_path):
    db = await _file_db(tmp_path)
    try:
        async with db.readonly() as conn:
            async with conn.execute("SELECT is_reaction_text('hello')") as cursor:
                assert (await cursor.fetchone())[0] == 0
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_readonly_after_disconnect_raises(tmp_path):
    db = await _file_db(tmp_path)
    await db.disconnect()
    with pytest.raises(RuntimeError):
        async with db.readonly():
            pass
