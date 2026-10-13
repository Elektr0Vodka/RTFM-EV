"""Tests for the filter library API, with Spam Guard as the kind."""

import json

import pytest

from app.repository import ChannelRepository
from app.repository.filter_profiles import FilterProfileRepository
from app.services import spam_guard as spam_guard_module
from app.services.host_repeater import HostRepeaterRuntime
from app.services.spam_backend_host import HostBackend
from app.services.spam_guard import SpamGuardRuntime

PUBLIC = "8B3387E9C5CDEA6AC9E5EDBAA115CD72"
URL = "/api/filter-profiles"
FILE = {
    "format": "rtfm-ev-filter-profile",
    "version": 1,
    "kind": "spam_guard",
    "name": "Spam wave",
    "description": "Strict detection, Protect mode",
    "payload": {"mode": "protect", "sensitivity": "strict", "overrides": {"dedupe_seconds": 3600}},
}


@pytest.fixture
async def runtime(test_db, monkeypatch):
    rt = SpamGuardRuntime()
    rt.host = HostBackend(HostRepeaterRuntime())
    monkeypatch.setattr(spam_guard_module, "spam_guard", rt)
    monkeypatch.setattr(spam_guard_module, "broadcast_event", lambda *args, **kwargs: None)
    await ChannelRepository.upsert(key=PUBLIC, name="Public")
    await rt.load()
    await rt.set_enabled(True)
    yield rt
    await rt.stop()


@pytest.mark.asyncio
async def test_the_kind_is_required_and_must_exist(runtime, client):
    async with client:
        assert (await client.get(URL)).status_code == 422
        unknown = await client.get(URL, params={"kind": "nope"})
        assert (unknown.status_code, unknown.json()["detail"]) == (400, "unknown_kind")
        empty = await client.get(URL, params={"kind": "spam_guard"})
        assert empty.status_code == 200
        assert empty.json() == {
            "kind": "spam_guard",
            "profiles": [],
            "in_use": None,
            "limits": {"per_kind": 100},
        }


@pytest.mark.asyncio
async def test_save_current_then_modify_then_revert(runtime, client):
    async with client:
        created = await client.post(URL, json={"kind": "spam_guard", "name": " Normal "})
        assert created.status_code == 200
        state = created.json()
        profile_id = state["created_id"]
        assert state["profiles"][0]["name"] == "Normal"
        assert state["profiles"][0]["payload"] == {
            "mode": "monitor",
            "sensitivity": "balanced",
            "overrides": {},
        }
        assert state["in_use"] == {"profile_id": profile_id, "modified": False}

        # The user changes a value in the Spam Guard form.
        changed = runtime.config.model_copy(update={"sensitivity": "strict"})
        assert await runtime.save_config(runtime.version, changed) is not None
        state = (await client.get(URL, params={"kind": "spam_guard"})).json()
        assert state["in_use"] == {"profile_id": profile_id, "modified": True}

        changes = (await client.get(f"{URL}/{profile_id}/changes")).json()
        assert changes["profile_id"] == profile_id
        assert {"key": "sensitivity", "from": "strict", "to": "balanced"} in changes["changes"]

        # Revert is applying the profile in use again.
        reverted = await client.post(f"{URL}/{profile_id}/apply", json={})
        assert reverted.status_code == 200
        assert reverted.json()["in_use"] == {"profile_id": profile_id, "modified": False}
        assert runtime.config.sensitivity == "balanced"


@pytest.mark.asyncio
async def test_import_does_not_apply_and_protect_needs_a_yes(runtime, client):
    async with client:
        imported = await client.post(f"{URL}/import", content=json.dumps(FILE))
        assert imported.status_code == 200
        state = imported.json()
        profile_id = state["created_id"]
        assert state["in_use"] is None
        assert (runtime.config.mode, runtime.version) == ("monitor", 0)

        refused = await client.post(f"{URL}/{profile_id}/apply", json={})
        assert (refused.status_code, refused.json()["detail"]) == (409, "needs_confirm")
        assert runtime.config.mode == "monitor"

        applied = await client.post(f"{URL}/{profile_id}/apply", json={"confirm_protect": True})
        assert applied.status_code == 200
        assert applied.json()["in_use"] == {"profile_id": profile_id, "modified": False}
        assert (runtime.config.mode, runtime.config.sensitivity) == ("protect", "strict")
        assert runtime.config.overrides == {"dedupe_seconds": 3600}
        assert [c.key for c in runtime.config.channels] == [PUBLIC]


@pytest.mark.asyncio
async def test_import_refusals_store_nothing(runtime, client):
    async with client:
        cases = [
            ("{broken", "not_json"),
            (json.dumps({**FILE, "format": "rtfm-ev-bot-list"}), "not_a_profile"),
            (json.dumps({**FILE, "version": 2}), "unsupported_version"),
            (json.dumps({**FILE, "kind": "forwarding"}), "unknown_kind"),
        ]
        for body, code in cases:
            answer = await client.post(f"{URL}/import", content=body)
            assert (answer.status_code, answer.json()["detail"]) == (400, code)

        with_key = {**FILE, "payload": {**FILE["payload"], "channels": [{"key": PUBLIC}]}}
        answer = await client.post(f"{URL}/import", content=json.dumps(with_key))
        assert answer.status_code == 400
        assert answer.json()["detail"].startswith("invalid_file: payload: channels")

        evidence = {
            **FILE,
            "payload": {**FILE["payload"], "overrides": {"evidence_log": True}},
        }
        answer = await client.post(f"{URL}/import", content=json.dumps(evidence))
        assert answer.status_code == 400
        assert "evidence_log" in answer.json()["detail"]
    assert await FilterProfileRepository.count("spam_guard") == 0


@pytest.mark.asyncio
async def test_import_then_export_gives_the_same_profile(runtime, client):
    async with client:
        profile_id = (await client.post(f"{URL}/import", content=json.dumps(FILE))).json()[
            "created_id"
        ]
        exported = await client.get(f"{URL}/{profile_id}/export")
        assert exported.status_code == 200
        assert exported.headers["content-disposition"] == (
            'attachment; filename="rtfm-ev-profile-spam_guard-spam-wave.json"'
        )
        document = exported.json()
        assert {k: document[k] for k in FILE} == FILE

        again = await client.post(f"{URL}/import", content=exported.content)
        assert again.status_code == 200
        assert len(again.json()["profiles"]) == 2


@pytest.mark.asyncio
async def test_export_of_a_name_without_ascii(runtime, client):
    async with client:
        body = json.dumps({**FILE, "name": "🚨 Шторм"})
        profile_id = (await client.post(f"{URL}/import", content=body)).json()["created_id"]
        exported = await client.get(f"{URL}/{profile_id}/export")
        assert exported.status_code == 200
        assert exported.headers["content-disposition"] == (
            'attachment; filename="rtfm-ev-profile-spam_guard-profile.json"'
        )
        assert exported.json()["name"] == "🚨 Шторм"


@pytest.mark.asyncio
async def test_rename_save_to_profile_and_delete(runtime, client):
    async with client:
        profile_id = (await client.post(f"{URL}/import", content=json.dumps(FILE))).json()[
            "created_id"
        ]

        renamed = await client.patch(
            f"{URL}/{profile_id}", json={"name": "Wave", "description": ""}
        )
        row = renamed.json()["profiles"][0]
        assert (row["name"], row["description"]) == ("Wave", "")
        assert row["payload"] == FILE["payload"]

        saved = await client.patch(f"{URL}/{profile_id}", json={"capture": True})
        state = saved.json()
        assert state["profiles"][0]["payload"] == {
            "mode": "monitor",
            "sensitivity": "balanced",
            "overrides": {},
        }
        assert state["in_use"] == {"profile_id": profile_id, "modified": False}

        deleted = await client.delete(f"{URL}/{profile_id}")
        assert deleted.json()["profiles"] == [] and deleted.json()["in_use"] is None
        assert runtime.version == 0


@pytest.mark.asyncio
async def test_names_are_checked(runtime, client):
    async with client:
        for name in ("", "   ", "x" * 65):
            answer = await client.post(URL, json={"kind": "spam_guard", "name": name})
            assert answer.status_code == 422
        answer = await client.post(
            URL, json={"kind": "spam_guard", "name": "ok", "description": "x" * 257}
        )
        assert answer.status_code == 422
    assert await FilterProfileRepository.count("spam_guard") == 0


@pytest.mark.asyncio
async def test_what_does_not_exist_is_404(runtime, client):
    async with client:
        for answer in (
            await client.patch(f"{URL}/404", json={"name": "x"}),
            await client.delete(f"{URL}/404"),
            await client.get(f"{URL}/404/export"),
            await client.get(f"{URL}/404/changes"),
            await client.post(f"{URL}/404/apply", json={}),
        ):
            assert (answer.status_code, answer.json()["detail"]) == (404, "not_found")


@pytest.mark.asyncio
async def test_first_hop_matching_on_openhop_is_409(runtime, client, monkeypatch):
    monkeypatch.setattr(runtime, "backend_name", lambda: "openhop")
    payload = {
        "mode": "monitor",
        "sensitivity": "balanced",
        "overrides": {"hop_match_mode": "starts_at"},
    }
    async with client:
        profile_id = (
            await client.post(f"{URL}/import", content=json.dumps({**FILE, "payload": payload}))
        ).json()["created_id"]
        answer = await client.post(f"{URL}/{profile_id}/apply", json={})
        assert (answer.status_code, answer.json()["detail"]) == (409, "openhop_starts_at")
    assert runtime.version == 0
