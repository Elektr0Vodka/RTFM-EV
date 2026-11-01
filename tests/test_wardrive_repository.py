"""Wardrive accounts, radios, groups and sessions in the database."""

import pytest

from app.repository.wardrive import (
    RadioTaken,
    UsernameTaken,
    WardriveGroupRepository,
    WardriveRadioRepository,
    WardriveSessionRepository,
    WardriveUserRepository,
)

KEY = "ab" * 32
HASH = "scrypt$16384$8$1$00$00"


async def _user(name: str = "mike") -> int:
    return await WardriveUserRepository.create(name, HASH, now=1)


async def test_create_and_get_user(test_db):
    uid = await _user()
    user = await WardriveUserRepository.get(uid)
    assert user is not None
    assert user["username"] == "mike"
    assert user["visibility"] == "own"
    assert user["disabled"] is False
    assert user["password_hash"] == HASH


async def test_get_by_username_ignores_case(test_db):
    uid = await _user("Mike")
    user = await WardriveUserRepository.get_by_username("mike")
    assert user is not None and user["id"] == uid


async def test_username_case_insensitive_clash(test_db):
    await _user("Mike")
    with pytest.raises(UsernameTaken):
        await _user("mike")


async def test_radio_key_normalized(test_db):
    uid = await _user()
    await WardriveRadioRepository.add(KEY, uid, "car", now=1)
    assert await WardriveRadioRepository.owner_of(KEY.upper()) == uid


async def test_radio_on_one_account_only(test_db):
    uid1 = await _user("a")
    uid2 = await _user("b")
    await WardriveRadioRepository.add(KEY.upper(), uid1, None, now=1)
    with pytest.raises(RadioTaken):
        await WardriveRadioRepository.add(KEY.lower(), uid2, None, now=1)


async def test_update_visibility(test_db):
    uid = await _user()
    assert await WardriveUserRepository.update(uid, visibility="all")
    user = await WardriveUserRepository.get(uid)
    assert user is not None and user["visibility"] == "all"


async def test_update_visibility_rejects_unknown(test_db):
    uid = await _user()
    with pytest.raises(ValueError):
        await WardriveUserRepository.update(uid, visibility="everyone")


async def test_update_disabled(test_db):
    uid = await _user()
    assert await WardriveUserRepository.update(uid, disabled=True)
    user = await WardriveUserRepository.get(uid)
    assert user is not None and user["disabled"] is True


async def test_list_all_includes_radios_and_groups(test_db):
    uid = await _user()
    await WardriveRadioRepository.add(KEY, uid, "car", now=1)
    gid = await WardriveGroupRepository.create("crew", now=1)
    await WardriveGroupRepository.set_members(gid, [uid])
    [row] = await WardriveUserRepository.list_all()
    assert row["radios"] == [{"public_key": KEY.upper(), "name": "car", "added_at": 1}]
    assert row["group_ids"] == [gid]
    assert row["obs_count"] == 0


async def test_delete_user_cascades(test_db):
    uid = await _user()
    await WardriveRadioRepository.add(KEY, uid, None, now=1)
    await WardriveSessionRepository.create("th", uid, now=1, ttl_s=100)
    gid = await WardriveGroupRepository.create("crew", now=1)
    await WardriveGroupRepository.set_members(gid, [uid])
    async with test_db.tx() as conn:
        await conn.execute(
            "INSERT INTO wardrive_obs (user_id, radio_key, rx_at, rx_ts, hash, raw, lat, lon, "
            "uploaded_at) VALUES (?, ?, 't', 1, 'h', 'r', 0, 0, 1)",
            (uid, KEY.upper()),
        )
        await conn.execute(
            "INSERT INTO wardrive_tracks (user_id, radio_key, t0, t1, t0_ts, lat, lon, rx_count, "
            "listening, uploaded_at) VALUES (?, ?, 'a', 'b', 1, 0, 0, 0, 1, 1)",
            (uid, KEY.upper()),
        )

    assert await WardriveUserRepository.delete(uid)

    assert await WardriveUserRepository.get(uid) is None
    assert await WardriveRadioRepository.owner_of(KEY) is None
    assert await WardriveSessionRepository.get_user_id("th", now=2) is None
    [group] = await WardriveGroupRepository.list_all()
    assert group["member_ids"] == []
    async with test_db.readonly() as conn:
        for table in ("wardrive_obs", "wardrive_tracks"):
            async with conn.execute(f"SELECT COUNT(*) FROM {table}") as cur:
                assert (await cur.fetchone())[0] == 0


async def test_delete_radio_keeps_account(test_db):
    uid = await _user()
    await WardriveRadioRepository.add(KEY, uid, None, now=1)
    assert await WardriveRadioRepository.delete(KEY.lower())
    assert await WardriveRadioRepository.owner_of(KEY) is None
    assert await WardriveUserRepository.get(uid) is not None


async def test_group_crud(test_db):
    gid = await WardriveGroupRepository.create("crew", now=1)
    assert await WardriveGroupRepository.rename(gid, "team")
    [group] = await WardriveGroupRepository.list_all()
    assert group["name"] == "team"
    assert await WardriveGroupRepository.delete(gid)
    assert await WardriveGroupRepository.list_all() == []


async def test_group_members_replace(test_db):
    u1 = await _user("a")
    u2 = await _user("b")
    gid = await WardriveGroupRepository.create("crew", now=1)
    await WardriveGroupRepository.set_members(gid, [u1, u2])
    await WardriveGroupRepository.set_members(gid, [u2])
    [group] = await WardriveGroupRepository.list_all()
    assert group["member_ids"] == [u2]


async def test_session_expiry(test_db):
    uid = await _user()
    await WardriveSessionRepository.create("th", uid, now=0, ttl_s=10)
    assert await WardriveSessionRepository.get_user_id("th", now=5) == uid
    assert await WardriveSessionRepository.get_user_id("th", now=11) is None


async def test_session_delete_for_user(test_db):
    uid = await _user()
    await WardriveSessionRepository.create("t1", uid, now=0, ttl_s=10)
    await WardriveSessionRepository.create("t2", uid, now=0, ttl_s=10)
    await WardriveSessionRepository.delete_for_user(uid)
    assert await WardriveSessionRepository.get_user_id("t1", now=1) is None
    assert await WardriveSessionRepository.get_user_id("t2", now=1) is None


async def test_migration_adds_retention_column(test_db):
    async with test_db.readonly() as conn:
        async with conn.execute("PRAGMA table_info(app_settings)") as cur:
            columns = {row[1]: row[4] for row in await cur.fetchall()}
    assert columns["wardrive_retention_days"] == "0"
