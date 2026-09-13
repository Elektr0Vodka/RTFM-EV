import aiosqlite
import pytest

from app.migrations._090_add_mention_sound import migrate


@pytest.mark.asyncio
async def test_090_adds_columns_and_table_idempotently():
    async with aiosqlite.connect(":memory:") as conn:
        conn.row_factory = aiosqlite.Row
        # Minimal app_settings table with the seed row, like earlier migrations expect.
        await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
        await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
        await conn.commit()

        # Run twice to prove idempotency.
        await migrate(conn)
        await migrate(conn)

        cols = {
            row[1]
            for row in await (await conn.execute("PRAGMA table_info(app_settings)")).fetchall()
        }
        assert "mention_sound_enabled" in cols
        assert "mention_sound_choice" in cols
        assert "mention_sound_volume" in cols

        tables = {
            row[0]
            for row in await (
                await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
            ).fetchall()
        }
        assert "mention_sound" in tables

        # Defaults on the seed row.
        row = await (
            await conn.execute(
                "SELECT mention_sound_enabled, mention_sound_choice, mention_sound_volume "
                "FROM app_settings WHERE id = 1"
            )
        ).fetchone()
        assert row["mention_sound_enabled"] == 0
        assert row["mention_sound_choice"] == "beep"
        assert row["mention_sound_volume"] == 80
