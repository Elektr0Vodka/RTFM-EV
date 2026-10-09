"""Spam Guard API: state, versioned settings, actions, rendered rules, health."""

import json

import pytest
from fastapi import HTTPException

from app.repository import ChannelRepository, MessageRepository
from app.routers import spam as router_module
from app.services import spam_guard as spam_guard_module
from app.services.host_repeater import HostRepeaterRuntime
from app.services.spam_backend_host import HostBackend
from app.services.spam_guard import SpamGuardRuntime
from app.spam.settings import PRESETS, SpamConfig

PUBLIC = "8B3387E9C5CDEA6AC9E5EDBAA115CD72"
SPAM = "Amazing offer cheap radios available now at the usual place come quickly"
GENERATED = ["UD6DWREK", "QK3ZP9XV", "ZX8CV2BN"]


@pytest.fixture
async def runtime(test_db, monkeypatch):
    rt = SpamGuardRuntime()
    rt.host = HostBackend(HostRepeaterRuntime())
    monkeypatch.setattr(router_module, "spam_guard", rt)
    monkeypatch.setattr(spam_guard_module, "spam_guard", rt)
    monkeypatch.setattr(spam_guard_module, "broadcast_event", lambda *args, **kwargs: None)
    await ChannelRepository.upsert(key=PUBLIC, name="Public")
    await rt.load()
    await rt.set_enabled(True)
    yield rt
    await rt.stop()


def protect(**overrides) -> SpamConfig:
    return SpamConfig(
        mode="protect", channels=[{"key": PUBLIC, "name": "Public"}], overrides=overrides
    )


async def feed_campaign(rt: SpamGuardRuntime) -> list[int]:
    ids = []
    for i, name in enumerate(GENERATED):
        message_id = await MessageRepository.create(
            msg_type="CHAN",
            text=f"{name}: {SPAM}",
            received_at=1_800_000_000 + i,
            conversation_key=PUBLIC,
            sender_timestamp=1_800_000_000 + i,
            sender_name=name,
        )
        assert message_id is not None
        await rt.on_channel_message(
            message_id=message_id,
            channel_key=PUBLIC,
            sender=name,
            text=SPAM,
            path="27b1",
            path_len=2,
            received_at=int(rt._clock()),
            packet_len=80,
        )
        ids.append(message_id)
    return ids


@pytest.mark.asyncio
async def test_state_shape_for_a_fresh_install(runtime):
    state = await router_module.get_spam_guard()
    json.dumps(state)  # everything the page gets is plain JSON
    assert state["enabled"] is True
    assert state["version"] == 0
    assert state["mode"] == "monitor"
    assert state["backend"] == "host"
    assert state["settings"]["channels"] == [{"key": PUBLIC, "name": "Public"}]
    assert state["tunables"]["similarity"] == PRESETS["balanced"]["similarity"]
    assert state["presets"] == PRESETS
    assert state["defaults"]["similarity"] == PRESETS["balanced"]["similarity"]
    assert state["defaults"]["window_seconds"] == 600
    assert state["block_list"] == [] and state["held"] == [] and state["messages"] == []
    assert state["metrics"]["d1"]["messages"] == 0
    assert state["health"]["state"] == "ok"


@pytest.mark.asyncio
async def test_state_after_a_campaign(runtime):
    ids = await feed_campaign(runtime)
    state = await router_module.get_spam_guard()
    json.dumps(state)
    assert [m["message_id"] for m in state["messages"]] == ids[::-1]
    assert state["messages"][0]["random"] is True
    kinds = {block["kind"] for block in state["block_list"]}
    assert {"text", "hop", "links"} <= kinds
    hop = next(block for block in state["block_list"] if block["kind"] == "hop")
    assert hop["gated"] is True and hop["mode"] == "contains_known"
    assert state["campaigns"][0]["confirmed"] is True
    assert state["campaigns"][0]["senders"] == 3
    assert any(entry["event"] == "block_started" for entry in state["activity"])
    # The summary count leaves routine duplicate suppression out.
    assert state["blocks"] == sum(b["source"] != "dedupe" for b in state["block_list"])
    assert 0 < state["blocks"] < len(state["block_list"])


@pytest.mark.asyncio
async def test_settings_are_versioned(runtime):
    request = router_module.SpamGuardSaveRequest(version=0, settings=protect(similarity=80))
    state = await router_module.save_spam_guard_settings(request)
    assert state["version"] == 1 and state["mode"] == "protect"
    assert state["tunables"]["similarity"] == 80

    with pytest.raises(HTTPException) as exc:
        await router_module.save_spam_guard_settings(request)
    assert exc.value.status_code == 409

    fresh = SpamGuardRuntime()
    fresh.host = HostBackend(HostRepeaterRuntime())
    await fresh.load()
    assert fresh.version == 1 and fresh.config.mode == "protect"
    await fresh.stop()


@pytest.mark.asyncio
async def test_first_hop_mode_is_refused_on_openhop(runtime, monkeypatch):
    monkeypatch.setattr(runtime, "backend_name", lambda: "openhop")
    request = router_module.SpamGuardSaveRequest(
        version=0, settings=protect(hop_match_mode="starts_at")
    )
    with pytest.raises(HTTPException) as exc:
        await router_module.save_spam_guard_settings(request)
    assert exc.value.status_code == 409
    assert runtime.version == 0


@pytest.mark.asyncio
async def test_action_returns_result_and_state(runtime):
    request = router_module.SpamGuardActionRequest(op="block_hop", args={"hop": "27"})
    response = await router_module.run_spam_guard_action(request)
    assert response.result == {"key": "hop:27"}
    assert [block["key"] for block in response.state["block_list"]] == ["hop:27"]

    response = await router_module.run_spam_guard_action(
        router_module.SpamGuardActionRequest(op="lockdown", args={"minutes": 30})
    )
    assert response.state["lockdown"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "op,args",
    [
        ("block_sender", {"sender": "Dave"}),  # deliberately not offered
        ("block_hop", {"hop": "2"}),
        ("block_hop", {}),
        ("extend", {"key": "hop:99"}),
        ("lockdown", {"minutes": 99999}),
        ("_note", {"event": "x"}),
        ("decide", {}),
    ],
)
async def test_bad_action_is_a_400(runtime, op, args):
    with pytest.raises(HTTPException) as exc:
        await router_module.run_spam_guard_action(
            router_module.SpamGuardActionRequest(op=op, args=args)
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_feedback_on_a_message_sets_its_chat_flag(runtime):
    message_id = await MessageRepository.create(
        msg_type="CHAN",
        text=f"Dave: {SPAM}",
        received_at=1_800_000_000,
        conversation_key=PUBLIC,
        sender_timestamp=1_800_000_000,
        sender_name="Dave",
    )

    async def flag() -> bool:
        return {m.id: m.spam for m in await MessageRepository.get_all(conversation_key=PUBLIC)}[
            message_id
        ]

    response = await router_module.run_spam_guard_action(
        router_module.SpamGuardActionRequest(
            op="mark_spam", args={"text": SPAM, "channel": PUBLIC}, message_id=message_id
        )
    )
    assert await flag() is True
    key = response.result["key"]

    await router_module.run_spam_guard_action(
        router_module.SpamGuardActionRequest(
            op="not_spam", args={"sender": "Dave", "matched": key}, message_id=message_id
        )
    )
    assert await flag() is False
    assert runtime.config.allow_senders == ["Dave"]
    assert key not in runtime.detector.blocks


@pytest.mark.asyncio
async def test_not_spam_from_chat_undoes_this_is_spam_without_a_block_key(runtime):
    (message_id, *_rest) = await feed_campaign(runtime)
    before = set(runtime.detector.blocks)
    marked = await router_module.run_spam_guard_action(
        router_module.SpamGuardActionRequest(
            op="mark_spam", args={"text": SPAM, "channel": PUBLIC}, message_id=message_id
        )
    )
    key = marked.result["key"]
    assert runtime.detector.blocks[key].reason == "marked_spam"

    # Chat only knows the message, not which block is behind it.
    await router_module.run_spam_guard_action(
        router_module.SpamGuardActionRequest(
            op="not_spam", args={"sender": GENERATED[0]}, message_id=message_id
        )
    )
    assert key not in runtime.detector.blocks
    assert set(runtime.detector.blocks) >= before - {key}


@pytest.mark.asyncio
async def test_rules_follow_the_mode_unless_previewed(runtime):
    await runtime.action("block_hop", {"hop": "27", "match": "contains"})
    assert (await router_module.get_spam_guard_rules(preview=False))["before"] == []
    preview = await router_module.get_spam_guard_rules(preview=True)
    assert preview["backend"] == "host"
    assert [rule["name"] for rule in preview["before"]] == ["spam:hop:27"]
    # A preview is for reading only: nothing reached the engine.
    assert runtime.host.status()["rules_present"] == 0

    await runtime.save_config(runtime.version, protect())
    assert len((await router_module.get_spam_guard_rules(preview=False))["before"]) == 1
    assert runtime.host.status()["rules_present"] == 1


@pytest.mark.asyncio
async def test_health_states(runtime):
    response = await router_module.get_spam_guard_health()
    assert response.status_code == 200
    assert json.loads(response.body)["state"] == "ok"

    # Protect on a host repeater that is not armed changes nothing on air.
    await runtime.save_config(runtime.version, protect())
    body = json.loads((await router_module.get_spam_guard_health()).body)
    assert body["state"] == "warn" and body["warnings"] == ["host_not_armed"]

    runtime.last_error = "boom"
    response = await router_module.get_spam_guard_health()
    assert response.status_code == 503
    assert json.loads(response.body)["problems"] == ["rules_failed"]
    runtime.last_error = None

    await runtime.set_enabled(False)
    response = await router_module.get_spam_guard_health()
    assert response.status_code == 200
    assert json.loads(response.body)["state"] == "off"


@pytest.mark.asyncio
async def test_routes_are_registered():
    from app.main import app

    paths = {route.path for route in app.routes}
    assert {
        "/api/spam-guard",
        "/api/spam-guard/settings",
        "/api/spam-guard/action",
        "/api/spam-guard/rules",
        "/api/spam-guard/health",
    } <= paths
