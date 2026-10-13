"""Tests for the filter library service, with a kind made for the test."""

import pytest

from app.filter_profiles.format import ProfileFile
from app.filter_profiles.kinds import ProfileError
from app.repository.filter_profiles import FilterProfileRepository
from app.services import filter_profiles as service_module
from app.services.filter_profiles import FilterProfileService


class LevelKind:
    """A feature with one value, ``level``. Going above 5 needs a yes."""

    kind = "level"

    def __init__(self) -> None:
        self.live = {"level": 1}

    def validate(self, payload):
        if set(payload) != {"level"} or type(payload["level"]) is not int:
            raise ValueError("level: must be a whole number")
        return {"level": payload["level"]}

    async def capture(self):
        return dict(self.live)

    async def apply(self, payload, *, confirmed):
        clean = self.validate(payload)
        if clean["level"] > 5 and not confirmed:
            raise ProfileError("needs_confirm", status=409)
        self.live = clean

    async def matches(self, payload):
        return self.validate(payload) == self.live

    async def changes(self, payload):
        clean = self.validate(payload)
        if clean == self.live:
            return []
        return [{"key": "level", "from": self.live["level"], "to": clean["level"]}]


@pytest.fixture
def kind():
    return LevelKind()


@pytest.fixture
def service(test_db, kind):
    made = FilterProfileService()
    made.register(kind)
    return made


def file(**change) -> ProfileFile:
    data = {
        "format": "rtfm-ev-filter-profile",
        "version": 1,
        "kind": "level",
        "name": "Shared",
        "payload": {"level": 4},
    }
    return ProfileFile.model_validate({**data, **change})


async def refused(awaitable) -> ProfileError:
    with pytest.raises(ProfileError) as caught:
        await awaitable
    return caught.value


@pytest.mark.asyncio
async def test_an_empty_library(service):
    assert await service.snapshot("level") == {
        "kind": "level",
        "profiles": [],
        "in_use": None,
        "limits": {"per_kind": 100},
    }


@pytest.mark.asyncio
async def test_an_unknown_kind(service):
    error = await refused(service.snapshot("nope"))
    assert (error.code, error.status) == ("unknown_kind", 400)
    assert (await refused(service.create("nope", "x"))).code == "unknown_kind"
    assert (await refused(service.import_file(file(kind="nope")))).code == "unknown_kind"


@pytest.mark.asyncio
async def test_create_captures_the_live_values_and_is_in_use(service, kind):
    kind.live = {"level": 3}
    state = await service.create("level", "  Calm ", "  quiet days ")
    created = state["profiles"][0]
    assert state["created_id"] == created["id"]
    assert (created["name"], created["description"], created["source"]) == (
        "Calm",
        "quiet days",
        "local",
    )
    assert created["payload"] == {"level": 3}
    assert state["in_use"] == {"profile_id": created["id"], "modified": False}


@pytest.mark.asyncio
async def test_modified_follows_the_live_values(service, kind):
    state = await service.create("level", "Calm")
    kind.live = {"level": 2}
    assert (await service.snapshot("level"))["in_use"] == {
        "profile_id": state["created_id"],
        "modified": True,
    }


@pytest.mark.asyncio
async def test_import_stores_and_never_applies(service, kind):
    state = await service.import_file(file())
    assert state["profiles"][0]["payload"] == {"level": 4}
    assert state["created_id"] == state["profiles"][0]["id"]
    assert state["in_use"] is None
    assert kind.live == {"level": 1}


@pytest.mark.asyncio
async def test_import_refuses_a_payload_the_kind_does_not_accept(service):
    error = await refused(service.import_file(file(payload={"level": "high"})))
    assert (error.code, error.status) == ("invalid_file", 400)
    assert error.message == "payload: level: must be a whole number"
    assert await FilterProfileRepository.count("level") == 0


@pytest.mark.asyncio
async def test_the_limit_per_kind(service, monkeypatch):
    monkeypatch.setattr(service_module, "MAX_PROFILES_PER_KIND", 2)
    await service.create("level", "One")
    await service.import_file(file())
    assert (await refused(service.create("level", "Three"))).code == "too_many_profiles"
    assert (await refused(service.import_file(file()))).code == "too_many_profiles"
    assert await FilterProfileRepository.count("level") == 2


@pytest.mark.asyncio
async def test_update_renames_and_saves_the_live_values(service, kind):
    first = (await service.create("level", "One"))["created_id"]
    second = (await service.import_file(file()))["created_id"]

    state = await service.update(second, name=" Two ", description=" d ")
    row = next(p for p in state["profiles"] if p["id"] == second)
    assert (row["name"], row["description"], row["payload"]) == ("Two", "d", {"level": 4})
    assert state["in_use"]["profile_id"] == first

    kind.live = {"level": 5}
    state = await service.update(second, capture=True)
    row = next(p for p in state["profiles"] if p["id"] == second)
    assert row["payload"] == {"level": 5}
    # The live values are now those of this profile: it is the one in use.
    assert state["in_use"] == {"profile_id": second, "modified": False}


@pytest.mark.asyncio
async def test_apply_makes_it_live_and_in_use(service, kind):
    profile_id = (await service.import_file(file()))["created_id"]
    assert await service.changes(profile_id) == {
        "profile_id": profile_id,
        "changes": [{"key": "level", "from": 1, "to": 4}],
    }
    state = await service.apply(profile_id, confirmed=False)
    assert kind.live == {"level": 4}
    assert state["in_use"] == {"profile_id": profile_id, "modified": False}
    assert (await service.changes(profile_id))["changes"] == []


@pytest.mark.asyncio
async def test_a_refusal_by_the_kind_leaves_everything(service, kind):
    profile_id = (await service.import_file(file(payload={"level": 9})))["created_id"]
    error = await refused(service.apply(profile_id, confirmed=False))
    assert (error.code, error.status) == ("needs_confirm", 409)
    assert kind.live == {"level": 1}
    assert (await service.snapshot("level"))["in_use"] is None

    await service.apply(profile_id, confirmed=True)
    assert kind.live == {"level": 9}


@pytest.mark.asyncio
async def test_a_stored_payload_that_no_longer_validates(service, kind):
    profile_id = (await service.create("level", "Old"))["created_id"]
    # As if a later release changed what this kind accepts.
    await FilterProfileRepository.update(profile_id, payload={"level": "high"})

    state = await service.snapshot("level")
    assert state["in_use"] == {"profile_id": profile_id, "modified": True}

    error = await refused(service.apply(profile_id, confirmed=True))
    assert (error.code, error.status) == ("invalid_profile", 422)
    assert error.message == "level: must be a whole number"
    error = await refused(service.changes(profile_id))
    assert (error.code, error.status) == ("invalid_profile", 422)
    assert kind.live == {"level": 1}


@pytest.mark.asyncio
async def test_delete_of_the_profile_in_use(service, kind):
    profile_id = (await service.create("level", "One"))["created_id"]
    state = await service.delete(profile_id)
    assert state["profiles"] == [] and state["in_use"] is None
    assert kind.live == {"level": 1}


@pytest.mark.asyncio
async def test_what_does_not_exist(service):
    for call in (
        lambda: service.update(404, name="x"),
        lambda: service.delete(404),
        lambda: service.export(404),
        lambda: service.changes(404),
        lambda: service.apply(404, confirmed=True),
    ):
        error = await refused(call())
        assert (error.code, error.status) == ("not_found", 404)


@pytest.mark.asyncio
async def test_a_profile_of_a_kind_this_build_does_not_have_is_not_found(service):
    stray = await FilterProfileRepository.create("gone", "Stray", "", "local", {})
    assert (await refused(service.export(stray))).code == "not_found"


@pytest.mark.asyncio
async def test_export(service):
    profile_id = (await service.import_file(file(name="Storm 🚨", description="d")))["created_id"]
    filename, document = await service.export(profile_id)
    assert filename == "rtfm-ev-profile-level-storm.json"
    assert (document["format"], document["version"], document["kind"]) == (
        "rtfm-ev-filter-profile",
        1,
        "level",
    )
    assert (document["name"], document["description"], document["payload"]) == (
        "Storm 🚨",
        "d",
        {"level": 4},
    )


def test_spam_guard_is_registered():
    assert "spam_guard" in service_module.filter_profiles._kinds
