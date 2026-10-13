"""Tests for filter profile storage."""

import pytest

from app.repository.filter_profiles import FilterProfileRepository

PAYLOAD = {"mode": "protect", "sensitivity": "strict", "overrides": {"similarity": 80}}


@pytest.mark.asyncio
async def test_create_get_and_list(test_db):
    profile_id = await FilterProfileRepository.create(
        "spam_guard", "Spam wave", "strict", "local", PAYLOAD
    )
    row = await FilterProfileRepository.get(profile_id)
    assert row is not None
    assert set(row) == {
        "id",
        "kind",
        "name",
        "description",
        "source",
        "payload",
        "created_at",
        "updated_at",
    }
    assert (row["kind"], row["name"], row["description"], row["source"]) == (
        "spam_guard",
        "Spam wave",
        "strict",
        "local",
    )
    assert row["payload"] == PAYLOAD
    assert row["created_at"] == row["updated_at"] > 0
    assert await FilterProfileRepository.get(profile_id + 99) is None


@pytest.mark.asyncio
async def test_list_is_per_kind_and_sorted_by_name(test_db):
    b = await FilterProfileRepository.create("spam_guard", "beta", "", "local", {})
    a = await FilterProfileRepository.create("spam_guard", "Alpha", "", "local", {})
    await FilterProfileRepository.create("other", "Zed", "", "local", {})
    assert [row["id"] for row in await FilterProfileRepository.list_kind("spam_guard")] == [a, b]
    assert await FilterProfileRepository.count("spam_guard") == 2
    assert await FilterProfileRepository.count("other") == 1
    assert await FilterProfileRepository.count("none") == 0


@pytest.mark.asyncio
async def test_update_changes_only_what_is_given(test_db):
    profile_id = await FilterProfileRepository.create("spam_guard", "One", "d", "local", PAYLOAD)
    await FilterProfileRepository.update(profile_id, name="Two")
    row = await FilterProfileRepository.get(profile_id)
    assert (row["name"], row["description"], row["payload"]) == ("Two", "d", PAYLOAD)
    await FilterProfileRepository.update(profile_id, description="", payload={"mode": "monitor"})
    row = await FilterProfileRepository.get(profile_id)
    assert (row["name"], row["description"], row["payload"]) == ("Two", "", {"mode": "monitor"})
    # Nothing given: nothing happens, and no error.
    await FilterProfileRepository.update(profile_id)


@pytest.mark.asyncio
async def test_in_use_follows_set_and_delete(test_db):
    first = await FilterProfileRepository.create("spam_guard", "One", "", "local", {})
    second = await FilterProfileRepository.create("spam_guard", "Two", "", "local", {})
    assert await FilterProfileRepository.in_use("spam_guard") is None
    await FilterProfileRepository.set_in_use("spam_guard", first)
    await FilterProfileRepository.set_in_use("spam_guard", second)
    assert await FilterProfileRepository.in_use("spam_guard") == second
    await FilterProfileRepository.delete(second)
    assert await FilterProfileRepository.in_use("spam_guard") is None
    assert await FilterProfileRepository.get(second) is None
    assert await FilterProfileRepository.get(first) is not None


@pytest.mark.asyncio
async def test_in_use_ignores_a_profile_of_another_kind(test_db):
    other = await FilterProfileRepository.create("other", "Zed", "", "local", {})
    await FilterProfileRepository.set_in_use("spam_guard", other)
    assert await FilterProfileRepository.in_use("spam_guard") is None


@pytest.mark.asyncio
async def test_a_payload_that_is_not_an_object_reads_as_empty(test_db):
    profile_id = await FilterProfileRepository.create("spam_guard", "One", "", "local", {})
    async with test_db.tx() as conn:
        await conn.execute(
            "UPDATE filter_profiles SET payload = ? WHERE id = ?", ("[1, 2", profile_id)
        )
    assert (await FilterProfileRepository.get(profile_id))["payload"] == {}
