"""Spam Guard on an OpenHop node: syncing our rules through its policy API.

The node is a fake that behaves like OpenHop's ``/api/policy`` handlers
(``repeater/web/api_endpoints.py``): GET returns the normalised policy engine
document in a ``{success, data}`` envelope, POST replaces it and keeps the
stored objects only when the body carries none, and a handler error comes back
as HTTP 200 with ``success: false``.
"""

import asyncio
import copy
import json
from typing import Any

import httpx
import pytest

from app.services.spam_backend_openhop import OpenHopBackend
from app.spam.detector import SpamDetector
from app.spam.rules import RuleSet, render
from app.spam.settings import SpamConfig

PUBLIC = "8B3387E9C5CDEA6AC9E5EDBAA115CD72"
KNOWN_REF = "@rtfmspam.known_senders"


def rule(name: str, rule_id: Any = None, *, action: str = "drop", value: Any = "27") -> dict:
    return {
        "id": rule_id if rule_id is not None else name,
        "name": name,
        "enabled": True,
        "if": {"all": [{"field": "path_hashes", "op": "contains", "value": value}]},
        "then": {"action": action},
    }


def ours(key: str, rule_id: int, **kwargs: Any) -> dict:
    return rule(f"rtfm-spam:{key}", rule_id, **kwargs)


USER_A = rule("Drop the noisy repeater", "user-1", value="AA")
USER_B = rule("Let the club through", "user-2", action="allow", value="BB")
BEFORE = [ours("hop:27", 700000001), ours("text:abc", 700000002)]
AFTER = [
    {
        "id": 700000003,
        "name": f"rtfm-spam:known-people:{PUBLIC}",
        "enabled": True,
        "if": {"all": [{"field": "channel_sender", "op": "in", "value": KNOWN_REF}]},
        "then": {"action": "allow"},
    },
    ours("lockdown", 700000004),
]


def rule_set(before=BEFORE, after=AFTER, known=("Dave", "Sarah")) -> RuleSet:
    return RuleSet(before=list(before), after=list(after), known_senders=list(known))


class FakeNode:
    """The policy API of one OpenHop node."""

    def __init__(
        self,
        rules: list | None = None,
        *,
        enabled: bool = False,
        default_action: str = "allow",
        objects: dict | None = None,
    ) -> None:
        self.engine: dict[str, Any] = {
            "enabled": enabled,
            "default_action": default_action,
            "rules": list(rules or []),
            "objects": dict(objects or {}),
        }
        self.gets = 0
        self.posts: list[dict] = []
        self.post_times: list[float] = []
        self.closed = 0
        self.fail: Exception | None = None
        self.reject: str | None = None

    async def get_policy(self) -> dict:
        self.gets += 1
        if self.fail is not None:
            raise self.fail
        return {
            "success": True,
            "data": {
                "policy_file": "/etc/openhop/policy.yaml",
                "exists": True,
                "policy_engine": copy.deepcopy(self.engine),
                "groups": {"channel_hashes": [], "pubkeys": []},
            },
        }

    async def update_policy(self, body: dict) -> dict:
        if self.fail is not None:
            raise self.fail
        if self.reject is not None:
            return {"success": False, "error": self.reject}
        engine = body["policy_engine"] if isinstance(body.get("policy_engine"), dict) else body
        self.posts.append(copy.deepcopy(body))
        self.post_times.append(asyncio.get_running_loop().time())
        self.engine = {
            "enabled": bool(engine.get("enabled", False)),
            "default_action": str(engine.get("default_action", "allow")),
            "rules": copy.deepcopy(engine["rules"])
            if isinstance(engine.get("rules"), list)
            else [],
            "objects": copy.deepcopy(engine["objects"])
            if isinstance(engine.get("objects"), dict)
            else self.engine["objects"],
        }
        return {"success": True, "data": {"policy_engine": copy.deepcopy(self.engine)}}

    async def aclose(self) -> None:
        self.closed += 1

    def names(self) -> list[str]:
        return [r["name"] for r in self.engine["rules"]]


def backend_for(node: FakeNode | None, **kwargs: Any) -> OpenHopBackend:
    async def factory(*, known_node: bool) -> Any:
        return node

    return OpenHopBackend(client_factory=factory, **kwargs)


async def synced(node: FakeNode, rules: RuleSet | None = None) -> OpenHopBackend:
    """A backend that has written ``rules`` to the node."""
    backend = backend_for(node)
    backend.want(rules or rule_set())
    assert await backend.sync_once() == "written"
    return backend


class TestWrite:
    async def test_our_rules_go_around_the_users_rules(self):
        node = FakeNode([USER_A, USER_B])
        backend = await synced(node)
        assert node.engine["rules"] == [*BEFORE, USER_A, USER_B, *AFTER]
        assert node.engine["objects"]["rtfmspam"] == {"known_senders": ["Dave", "Sarah"]}
        assert backend.status()["state"] == "synced"
        assert backend.status()["rules_expected"] == 4
        assert backend.status()["rules_present"] == 4

    async def test_engine_is_switched_on_and_default_action_kept(self):
        node = FakeNode([USER_A], enabled=False, default_action="drop")
        await synced(node)
        assert node.engine["enabled"] is True
        assert node.engine["default_action"] == "drop"

    async def test_other_objects_and_groups_are_left_alone(self):
        groups = {"channel_hash_groups": {"club": ["0x11"]}, "mine": {"list": [1, 2]}}
        node = FakeNode([USER_A], objects=groups)
        await synced(node)
        assert node.engine["objects"]["channel_hash_groups"] == {"club": ["0x11"]}
        assert node.engine["objects"]["mine"] == {"list": [1, 2]}
        # Groups are not sent, so the node keeps the ones it has.
        assert "groups" not in node.posts[-1]

    async def test_nothing_is_written_when_nothing_changed(self):
        node = FakeNode([USER_A])
        backend = await synced(node)
        assert await backend.sync_once() == "unchanged"
        assert len(node.posts) == 1
        assert backend.status()["repairs"] == 0

    async def test_same_rule_set_again_asks_for_no_sync(self):
        node = FakeNode([USER_A])
        backend = await synced(node)
        backend.want(rule_set())
        assert backend.status()["state"] == "synced"

    async def test_a_changed_rule_set_replaces_ours(self):
        node = FakeNode([USER_A])
        backend = await synced(node)
        backend.want(rule_set(before=[ours("hop:99", 700000009)], after=[], known=()))
        assert backend.status()["state"] == "pending"
        assert await backend.sync_once() == "written"
        assert node.names() == ["rtfm-spam:hop:99", USER_A["name"]]
        # No rule refers to the known-people object any more.
        assert "rtfmspam" not in node.engine["objects"]
        assert backend.status()["repairs"] == 0

    async def test_client_is_closed_after_every_sync(self):
        node = FakeNode()
        backend = await synced(node)
        await backend.sync_once()
        assert node.closed == 2

    async def test_rendered_lockdown_rules_reach_the_node(self):
        detector = SpamDetector(
            SpamConfig(mode="protect", channels=[{"key": PUBLIC, "name": "Public"}])
        )
        detector.action("lockdown", minutes=30)
        rendered = render(detector, "openhop")
        node = FakeNode([USER_A])
        await synced(node, rendered)
        assert node.engine["rules"] == [*rendered.before, USER_A, *rendered.after]
        assert node.engine["objects"]["rtfmspam"] == {"known_senders": []}
        assert all(isinstance(r["id"], int) for r in rendered.rules)


class TestEmpty:
    async def test_monitor_mode_touches_nothing(self):
        node = FakeNode([USER_A], enabled=False)
        backend = backend_for(node)
        backend.want(RuleSet())
        assert await backend.sync_once() == "unchanged"
        assert node.posts == []
        assert node.engine["enabled"] is False

    async def test_empty_rule_set_removes_what_we_wrote(self):
        node = FakeNode([USER_A])
        backend = await synced(node)
        backend.want(RuleSet())
        assert await backend.sync_once() == "written"
        assert node.engine["rules"] == [USER_A]
        assert "rtfmspam" not in node.engine["objects"]
        # The node's own switch is the user's: we only ever turn it on.
        assert node.engine["enabled"] is True


class TestRepair:
    async def test_missing_rules_are_restored_and_counted(self):
        node = FakeNode([USER_A])
        backend = await synced(node)
        node.engine["rules"] = [USER_A]
        assert await backend.sync_once() == "written"
        assert node.engine["rules"] == [*BEFORE, USER_A, *AFTER]
        assert backend.status()["repairs"] == 1

    async def test_an_altered_rule_is_restored(self):
        node = FakeNode([USER_A])
        backend = await synced(node)
        node.engine["rules"][0]["enabled"] = False
        await backend.sync_once()
        assert node.engine["rules"][0] == BEFORE[0]
        assert backend.status()["repairs"] == 1

    async def test_a_removed_object_is_restored(self):
        node = FakeNode([USER_A])
        backend = await synced(node)
        del node.engine["objects"]["rtfmspam"]
        await backend.sync_once()
        assert node.engine["objects"]["rtfmspam"] == {"known_senders": ["Dave", "Sarah"]}
        assert backend.status()["repairs"] == 1

    async def test_a_rule_the_user_added_is_kept_and_is_not_a_repair(self):
        node = FakeNode([USER_A])
        backend = await synced(node)
        node.engine["rules"].insert(3, USER_B)  # after USER_A, before our after-rules
        assert await backend.sync_once() == "unchanged"
        assert backend.status()["repairs"] == 0

    async def test_stale_rules_from_an_earlier_run_are_replaced(self):
        node = FakeNode([ours("hop:OLD", 700000077), USER_A])
        await synced(node)
        assert node.engine["rules"] == [*BEFORE, USER_A, *AFTER]


class TestSpamGuardPresent:
    SPAMGUARD = rule("spamguard:hop:27", 4242)

    async def test_nothing_is_written_next_to_a_real_spamguard(self):
        node = FakeNode([self.SPAMGUARD, USER_A])
        backend = backend_for(node)
        backend.want(rule_set())
        assert await backend.sync_once() == "unchanged"
        assert node.posts == []
        assert backend.status()["state"] == "refused"
        assert backend.status()["rules_expected"] == 0

    async def test_our_rules_are_taken_out_when_spamguard_appears(self):
        node = FakeNode([USER_A])
        backend = await synced(node)
        node.engine["rules"].insert(0, self.SPAMGUARD)
        assert await backend.sync_once() == "written"
        assert node.engine["rules"] == [self.SPAMGUARD, USER_A]
        assert "rtfmspam" not in node.engine["objects"]
        assert backend.status()["state"] == "refused"

    async def test_sync_resumes_when_spamguard_is_gone(self):
        node = FakeNode([self.SPAMGUARD, USER_A])
        backend = backend_for(node)
        backend.want(rule_set())
        await backend.sync_once()
        node.engine["rules"] = [USER_A]
        assert await backend.sync_once() == "written"
        assert backend.status()["state"] == "synced"


class TestRelease:
    async def test_release_removes_our_rules_and_object(self):
        node = FakeNode([USER_A], objects={"mine": {"list": [1]}})
        backend = await synced(node)
        backend.release()
        assert await backend.sync_once() == "written"
        assert node.engine["rules"] == [USER_A]
        assert node.engine["objects"] == {"mine": {"list": [1]}}
        assert backend.status()["state"] == "idle"

    async def test_release_without_anything_written_does_not_ask_the_node(self):
        node = FakeNode([USER_A])
        backend = backend_for(node)
        backend.release()
        assert backend.status()["state"] == "idle"
        assert node.gets == 0

    async def test_stop_removes_our_rules(self):
        node = FakeNode([USER_A])
        backend = await synced(node)
        await backend.stop()
        assert node.engine["rules"] == [USER_A]

    async def test_stop_can_leave_the_rules(self):
        node = FakeNode([USER_A])
        backend = await synced(node)
        await backend.stop(remove=False)
        assert node.engine["rules"] == [*BEFORE, USER_A, *AFTER]


class TestFailures:
    async def test_unreachable_node_is_counted_and_recovers(self):
        node = FakeNode([USER_A])
        backend = backend_for(node)
        backend.want(rule_set())
        node.fail = httpx.ConnectError("no route")
        for _ in range(3):
            assert await backend.sync_once() == "failed"
        status = backend.status()
        assert status["state"] == "failed"
        assert status["failures"] == 3
        assert "no route" in status["last_error"]
        node.fail = None
        assert await backend.sync_once() == "written"
        assert backend.status()["failures"] == 0
        assert backend.status()["last_error"] is None

    async def test_a_rejected_write_is_a_failure(self):
        node = FakeNode([USER_A])
        backend = backend_for(node)
        backend.want(rule_set())
        node.reject = "disk full"
        assert await backend.sync_once() == "failed"
        assert backend.status()["last_error"] == "disk full"
        assert node.engine["rules"] == [USER_A]

    async def test_no_api_configured(self):
        backend = backend_for(None)
        backend.want(rule_set())
        assert await backend.sync_once() == "unconfigured"
        status = backend.status()
        assert status["state"] == "unconfigured"
        assert status["failures"] == 0

    async def test_odd_documents_do_not_break_the_sync(self):
        node = FakeNode()
        node.engine["rules"] = ["nonsense", USER_A, None]
        node.engine["objects"] = None  # type: ignore[assignment]
        backend = await synced(node)
        assert node.engine["rules"] == [*BEFORE, "nonsense", USER_A, None, *AFTER]
        assert backend.status()["state"] == "synced"


async def wait_until(check, timeout: float = 3.0) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    while not check():
        assert asyncio.get_running_loop().time() < deadline, "timed out"
        await asyncio.sleep(0.005)


class TestWorker:
    async def test_writes_are_spaced_out(self):
        node = FakeNode([USER_A])
        backend = backend_for(node, write_interval=0.2, verify_interval=30, retry_interval=30)
        try:
            backend.start()
            backend.want(rule_set())
            await wait_until(lambda: len(node.posts) == 1)
            backend.want(rule_set(before=[ours("hop:99", 700000009)]))
            backend.want(rule_set(before=[ours("hop:98", 700000008)]))
            await wait_until(lambda: len(node.posts) == 2)
            assert node.post_times[1] - node.post_times[0] >= 0.19
            # The change in between was never written: only the latest set counts.
            assert node.names()[0] == "rtfm-spam:hop:98"
        finally:
            await backend.stop(remove=False)

    async def test_rules_are_checked_again_and_repaired(self):
        node = FakeNode([USER_A])
        backend = backend_for(node, write_interval=0.01, verify_interval=0.03, retry_interval=30)
        try:
            backend.start()
            backend.want(rule_set())
            await wait_until(lambda: len(node.posts) == 1)
            node.engine["rules"] = [USER_A]
            await wait_until(lambda: len(node.posts) == 2)
            assert node.engine["rules"] == [*BEFORE, USER_A, *AFTER]
            assert backend.status()["repairs"] == 1
        finally:
            await backend.stop(remove=False)

    async def test_a_failed_sync_is_tried_again(self):
        node = FakeNode([USER_A])
        node.fail = httpx.ConnectError("no route")
        backend = backend_for(node, write_interval=0.01, verify_interval=30, retry_interval=0.03)
        try:
            backend.start()
            backend.want(rule_set())
            await wait_until(lambda: backend.status()["failures"] >= 2)
            node.fail = None
            await wait_until(lambda: len(node.posts) == 1)
            assert backend.status()["state"] == "synced"
        finally:
            await backend.stop(remove=False)

    async def test_a_clean_node_is_left_alone_while_nothing_is_wanted(self):
        node = FakeNode([USER_A])
        backend = backend_for(node, write_interval=0.01, verify_interval=0.02, retry_interval=0.02)
        try:
            backend.start()
            backend.want(RuleSet())
            await wait_until(lambda: node.gets == 1)
            await asyncio.sleep(0.1)
            assert node.gets == 1
            assert node.posts == []
        finally:
            await backend.stop(remove=False)

    async def test_change_is_reported(self):
        node = FakeNode([USER_A])
        seen: list[str] = []
        backend = backend_for(node, write_interval=0.01)
        backend.on_change = lambda: seen.append(backend.status()["state"])
        try:
            backend.start()
            backend.want(rule_set())
            await wait_until(lambda: "synced" in seen)
        finally:
            await backend.stop(remove=False)


def test_backend_does_not_import_the_radio_send_path():
    import pathlib

    source = pathlib.Path("app/services/spam_backend_openhop.py").read_text(encoding="utf-8")
    for name in ("app.radio", "app.services.host_repeater_tx", "meshcore"):
        assert f"import {name}" not in source and f"from {name}" not in source, name


@pytest.mark.parametrize("name", ["spamguard:hop:27", "spamguard:known-senders"])
async def test_any_spamguard_rule_name_counts(name):
    node = FakeNode([rule(name, 1)])
    backend = backend_for(node)
    backend.want(rule_set())
    await backend.sync_once()
    assert backend.status()["state"] == "refused"


# ── the runtime on an OpenHop radio ──────────────────────────────────────

CLUB = "CC" * 16


class Radio:
    """Stands in for the radio snapshot: which radio is connected."""

    def __init__(self) -> None:
        self.connected = True
        self.device_model: str | None = "openHop-Repeater-Companion"
        self.radio = None

    @property
    def is_openhop(self) -> bool:
        return bool(self.device_model and self.device_model.lower().startswith("openhop"))


class Guard:
    def __init__(self, runtime, node, radio, events) -> None:
        self.runtime = runtime
        self.node = node
        self.radio = radio
        self.events = events

    async def protect(self, *channels: dict, mode: str = "protect") -> None:
        config = SpamConfig(mode=mode, channels=[{"key": PUBLIC, "name": "Public"}, *channels])
        assert await self.runtime.save_config(self.runtime.version, config) is not None

    async def block_repeater(self) -> None:
        await self.runtime.action("block_hop", {"hop": "27", "match": "contains"})

    async def written(self, count: int) -> None:
        await wait_until(lambda: len(self.node.posts) >= count)


async def start_runtime(monkeypatch, node, events=None):
    from app.services import spam_guard as spam_guard_module
    from app.services.host_repeater import HostRepeaterRuntime
    from app.services.spam_backend_host import HostBackend
    from app.services.spam_guard import SpamGuardRuntime

    radio = Radio()
    captured: list = [] if events is None else events
    runtime = SpamGuardRuntime(
        openhop=backend_for(node, write_interval=0.01, verify_interval=30, retry_interval=0.02)
    )
    runtime.host = HostBackend(HostRepeaterRuntime())
    monkeypatch.setattr(spam_guard_module, "spam_guard", runtime)
    monkeypatch.setattr(spam_guard_module, "radio_snapshot", lambda: radio)
    monkeypatch.setattr(
        spam_guard_module,
        "broadcast_event",
        lambda event, data, **_: captured.append((event, data)),
    )
    await runtime.load()
    await runtime.set_enabled(True)
    return Guard(runtime, node, radio, captured)


@pytest.fixture
async def guard(test_db, monkeypatch):
    started = await start_runtime(monkeypatch, FakeNode([USER_A]))
    yield started
    await started.runtime.stop()


class TestRuntimeOnOpenHop:
    async def test_protect_writes_the_blocks_to_the_node(self, guard):
        await guard.protect()
        await guard.block_repeater()
        await guard.written(1)
        assert guard.node.names() == ["rtfm-spam:hop:27", USER_A["name"]]
        assert guard.runtime.host.status()["rules_present"] == 0
        health = guard.runtime.health()
        assert health["state"] == "ok"
        assert health["backend"] == "openhop"
        assert health["sync_state"] == "synced"
        assert (health["rules_expected"], health["rules_present"]) == (1, 1)
        assert guard.runtime.public_state()["backend_state"] == "synced"

    async def test_monitor_writes_nothing(self, guard):
        await guard.protect(mode="monitor")
        await guard.block_repeater()
        await wait_until(lambda: guard.node.gets >= 1)
        await asyncio.sleep(0.05)
        assert guard.node.posts == []
        assert guard.runtime.health()["state"] == "ok"

    async def test_switching_to_monitor_takes_the_rules_off(self, guard):
        await guard.protect()
        await guard.block_repeater()
        await guard.written(1)
        await guard.protect(mode="monitor")
        await guard.written(2)
        assert guard.node.engine["rules"] == [USER_A]

    async def test_switching_the_feature_off_takes_the_rules_off(self, guard):
        await guard.protect()
        await guard.runtime.action("lockdown", {"minutes": 30})
        await guard.written(1)
        assert "rtfmspam" in guard.node.engine["objects"]
        await guard.runtime.set_enabled(False)
        await guard.written(2)
        assert guard.node.engine["rules"] == [USER_A]
        assert "rtfmspam" not in guard.node.engine["objects"]

    async def test_shutdown_takes_the_rules_off(self, guard):
        await guard.protect()
        await guard.block_repeater()
        await guard.written(1)
        await guard.runtime.stop()
        assert guard.node.engine["rules"] == [USER_A]

    async def test_a_sync_result_is_broadcast(self, guard):
        await guard.protect()
        await guard.block_repeater()
        await wait_until(
            lambda: any(
                name == "spam_guard" and data["backend_state"] == "synced"
                for name, data in guard.events
            )
        )


class TestPrivateChannelKey:
    async def test_a_private_key_stays_here_until_the_user_agrees(self, guard):
        await guard.protect({"key": CLUB, "name": "Club"})
        await guard.runtime.action("block_text", {"text": "cheap radios today", "channel": CLUB})
        await guard.block_repeater()
        await guard.written(1)
        assert CLUB.lower() not in str(guard.node.engine).lower()
        assert guard.node.names() == ["rtfm-spam:hop:27", USER_A["name"]]
        health = guard.runtime.health()
        assert health["warnings"] == ["openhop_key_not_shared"]
        assert health["state"] == "warn"
        assert guard.runtime.snapshot()["private_channels"] == [CLUB]

        await guard.protect({"key": CLUB, "name": "Club", "share_key": True})
        await guard.written(2)
        assert CLUB.lower() in str(guard.node.engine["rules"]).lower()
        assert guard.runtime.health()["warnings"] == []

    async def test_the_rules_shown_leave_the_private_channel_out(self, guard, monkeypatch):
        from app.routers import spam as router_module

        monkeypatch.setattr(router_module, "spam_guard", guard.runtime)
        await guard.protect({"key": CLUB, "name": "Club"})
        await guard.runtime.action("block_text", {"text": "cheap radios today", "channel": CLUB})
        shown = await router_module.get_spam_guard_rules(preview=False)
        assert shown["backend"] == "openhop"
        assert shown["before"] == []


class TestOpenHopHealth:
    async def test_no_api_configured(self, test_db, monkeypatch):
        started = await start_runtime(monkeypatch, None)
        try:
            await started.protect()
            await started.block_repeater()
            backend = started.runtime.openhop
            await wait_until(lambda: backend.status()["state"] == "unconfigured")
            health = started.runtime.health()
            assert health["warnings"] == ["openhop_not_configured"]
            assert health["state"] == "warn"
        finally:
            await started.runtime.stop()

    async def test_a_real_spamguard_on_the_node(self, guard):
        guard.node.engine["rules"].insert(0, rule("spamguard:hop:27", 4242))
        await guard.protect()
        await guard.block_repeater()
        await wait_until(lambda: guard.runtime.openhop.status()["state"] == "refused")
        assert guard.node.posts == []
        health = guard.runtime.health()
        assert health["warnings"] == ["openhop_spamguard_present"]
        assert health["rules_expected"] == 0

    async def test_repeated_failures_turn_health_bad(self, guard):
        guard.node.fail = httpx.ConnectError("no route")
        await guard.protect()
        await guard.block_repeater()
        await wait_until(lambda: guard.runtime.openhop.status()["failures"] >= 3)
        health = guard.runtime.health()
        assert health["problems"] == ["openhop_sync_failed"]
        assert health["state"] == "bad"
        assert "no route" in guard.runtime.openhop.status()["last_error"]
        assert "no route" not in json.dumps(health)
        guard.node.fail = None
        await guard.written(1)
        assert guard.runtime.health()["state"] == "ok"

    async def test_repairs_are_reported(self, guard):
        await guard.protect()
        await guard.block_repeater()
        await guard.written(1)
        guard.node.engine["rules"] = [USER_A]
        assert await guard.runtime.openhop.sync_once() == "written"
        assert guard.runtime.health()["repairs"] == 1


class TestWhichBackend:
    async def test_a_dropped_link_keeps_the_openhop_backend(self, guard):
        await guard.protect()
        await guard.block_repeater()
        await guard.written(1)
        guard.radio.connected = False
        guard.radio.device_model = None
        await guard.runtime.tick()
        assert guard.runtime.backend_name() == "openhop"
        # A block that ends while the link is down still ends on the node.
        await guard.runtime.action("unblock", {"key": "hop:27"})
        await guard.written(2)
        assert guard.node.engine["rules"] == [USER_A]

    async def test_another_radio_takes_the_rules_off_the_node(self, guard):
        await guard.protect()
        await guard.block_repeater()
        await guard.written(1)
        guard.radio.device_model = "Heltec V3"
        await guard.runtime.tick()
        assert guard.runtime.backend_name() == "host"
        await guard.written(2)
        assert guard.node.engine["rules"] == [USER_A]
        assert guard.runtime.host.status()["rules_present"] == 1
