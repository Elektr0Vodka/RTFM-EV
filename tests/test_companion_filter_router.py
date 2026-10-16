"""Companion receive filter endpoints against a fake meshcomod filter CLI.

``FakeFilterFirmware`` answers ``filter ...`` the way meshcomod's
CompanionFilter.cpp does, so the router, service and backup run end to end.
"""

from contextlib import asynccontextmanager
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

import app.routers.companion_filter as router_module
from app.repository.companion_filter import (
    CompanionFilterBackupRepository,
    CompanionFilterHistoryRepository,
)
from app.routers.companion_filter import (
    FilterPathRequest,
    FilterRule,
    FilterRuleRemove,
    FilterSettingsUpdate,
    add_companion_filter_path,
    add_companion_filter_rule,
    get_companion_filter,
    get_companion_filter_history,
    remove_companion_filter_rule,
    restore_companion_filter,
    save_companion_filter_backup,
    update_companion_filter,
)
from app.services import companion_filter as cf


class FakeFilterFirmware:
    def __init__(self):
        self.reset()
        self.counts = {"malformed": 2, "age": 0, "path": 5, "sender": 9, "text": 0}
        self.commands: list[str] = []

    def reset(self):
        self.enabled = False
        self.malformed = False
        self.age = 0
        self.paths: list[str] = []
        self.rules: dict[str, list[tuple[str, int, int]]] = {"sender": [], "text": []}

    def _rule_list(self, kind):
        if not self.rules[kind]:
            return "None"
        out = []
        for pat, secs, prob in self.rules[kind]:
            entry = f"{pat} throttle {secs}s" if secs else f"{pat} block"
            if prob < 100:
                entry += f" {prob}%"
            out.append(entry)
        return ",".join(out)

    def handle(self, command: str) -> str:
        self.commands.append(command)
        parts = command.split(" ")
        if parts == ["filter"]:
            c = self.counts
            return (
                f"> Filter {'on' if self.enabled else 'off'}: Hidden [ Malformed: {c['malformed']} "
                f"| Age: {c['age']} | Path: {c['path']} | Sender: {c['sender']} | Text: {c['text']} ]"
            )
        sub = parts[1]
        if len(parts) == 2:
            if sub in ("on", "off"):
                self.enabled = sub == "on"
                return f"> Filter: {sub}"
            if sub == "reset":
                self.reset()
                return "> Filter: preferences reset"
            if sub == "malformed":
                return f"> Filter: malformed text scan {'on' if self.malformed else 'off'}"
            if sub == "age":
                if not self.age:
                    return "> Filter: message age limit off"
                return f"> Message age: max {self.age}m, dropped 0"
            return "> Filter: command error"
        arg = parts[2]
        if sub == "stats":
            if arg == "malformed":
                return "> Blocked 2 [ short:0 time:2 empty:0 utf8:0 ]"
            if arg == "path":
                return ",".join(f"{p}: 5" for p in self.paths) or "None"
            return ",".join(f"{r[0]}: 9" for r in self.rules[arg]) or "None"
        if sub == "malformed":
            self.malformed = arg == "on"
            return f"> Filter: malformed scan {arg}"
        if sub == "age":
            self.age = 0 if arg == "off" else int(arg)
            return "> Filter: OK"
        if sub == "path":
            if arg == "list":
                return ",".join(self.paths) or "None"
            hex_ = parts[3].upper()
            if arg == "add":
                if hex_ in self.paths:
                    return "Failed"
                self.paths.append(hex_)
                return f"> Filter: path {hex_} added"
            self.paths.remove(hex_)
            return f"> Filter: path {hex_} removed"
        if arg == "list":
            return self._rule_list(sub)
        if arg == "add":
            secs = int(parts[4]) if len(parts) > 4 else 0
            prob = int(parts[5]) if len(parts) > 5 else 100
            self.rules[sub].append((parts[3], secs, prob))
            return f"> Filter: {sub} {parts[3]} added"
        before = len(self.rules[sub])
        self.rules[sub] = [r for r in self.rules[sub] if r[0] != parts[3]]
        if len(self.rules[sub]) == before:
            return "Failed"
        return f"> Filter: {sub} {parts[3]} removed"


@pytest.fixture
def firmware(monkeypatch, test_db):
    fw = FakeFilterFirmware()
    mgr = MagicMock()
    mgr.firmware_ver_code = 27
    mgr.firmware_version = "v1.18.0.1"
    mgr.companion_filter_supported = True
    mgr.require_connected = MagicMock()
    mgr.meshcore.self_info = {"public_key": "ab" * 32}

    @asynccontextmanager
    async def _op(name, **kwargs):
        yield object()

    async def fake_cli(_mc, command):
        return fw.handle(command)

    mgr.radio_operation = _op
    monkeypatch.setattr(router_module, "radio_manager", mgr)
    monkeypatch.setattr(router_module, "sample_identity", lambda key: (True, 7))
    monkeypatch.setattr(cf, "run_local_cli", fake_cli)
    fw.manager = mgr
    return fw


@pytest.mark.asyncio
async def test_rejects_radio_without_filter(firmware):
    firmware.manager.companion_filter_supported = False
    with pytest.raises(HTTPException) as exc:
        await get_companion_filter()
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_rejects_non_meshcomod(firmware):
    firmware.manager.firmware_ver_code = 14
    firmware.manager.firmware_version = "v1.18.0"
    with pytest.raises(HTTPException) as exc:
        await get_companion_filter()
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_edit_flow_and_backup(firmware):
    state = await update_companion_filter(
        FilterSettingsUpdate(enabled=True, malformed=True, age_mins=60)
    )
    assert state.config.enabled is True
    assert state.config.malformed is True
    assert state.config.age_mins == 60

    await add_companion_filter_path(FilterPathRequest(prefix="a1b2"))
    await add_companion_filter_rule("sender", FilterRule(pattern="Bot*"))
    state = await add_companion_filter_rule("text", FilterRule(pattern="^!ping", secs=300, prob=50))

    assert state.config.paths == ["A1B2"]
    assert state.path_hits[0].hidden == 5
    assert state.sender_rules[0].pattern == "Bot*"
    assert state.sender_rules[0].hidden == 9
    assert state.text_rules[0].secs == 300
    assert state.text_rules[0].prob == 50
    assert state.counters["sender"] == 9
    assert state.backup is not None
    assert state.backup.config.text_rules[0].pattern == "^!ping"

    stored = await CompanionFilterBackupRepository.get(7)
    assert stored["config"]["paths"] == ["A1B2"]


@pytest.mark.asyncio
async def test_refused_command_is_422(firmware):
    await add_companion_filter_path(FilterPathRequest(prefix="A1B2"))
    with pytest.raises(HTTPException) as exc:
        await add_companion_filter_path(FilterPathRequest(prefix="A1B2"))
    assert exc.value.status_code == 422
    assert "Failed" in exc.value.detail

    with pytest.raises(HTTPException) as exc:
        await remove_companion_filter_rule("sender", FilterRuleRemove(pattern="nope"))
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_invalid_input_never_reaches_the_radio(firmware):
    with pytest.raises(HTTPException) as exc:
        await add_companion_filter_rule("sender", FilterRule(pattern="two words"))
    assert exc.value.status_code == 422
    with pytest.raises(HTTPException) as exc:
        await add_companion_filter_path(FilterPathRequest(prefix="abc"))
    assert exc.value.status_code == 422
    assert not any("add" in c for c in firmware.commands)


@pytest.mark.asyncio
async def test_restore_after_reset(firmware):
    await update_companion_filter(FilterSettingsUpdate(enabled=True, age_mins=30))
    await add_companion_filter_rule("text", FilterRule(pattern="spam", secs=0, prob=40))

    firmware.reset()  # e.g. a flash wiped /cfilter.json
    state = await get_companion_filter()
    # Reading the wiped radio shows its empty settings but keeps the backup.
    assert state.config.text_rules == []
    assert state.backup is not None
    assert state.backup.config.text_rules[0].pattern == "spam"

    state = await restore_companion_filter()
    assert state.config.enabled is True
    assert state.config.age_mins == 30
    assert state.config.text_rules[0].prob == 40
    start = len(firmware.commands) - 1 - firmware.commands[::-1].index("filter reset")
    assert firmware.commands[start : start + 5] == [
        "filter reset",
        "filter malformed off",
        "filter age 30",
        "filter text add spam 0 40",
        "filter on",
    ]


@pytest.mark.asyncio
async def test_first_read_creates_backup_and_save_overwrites(firmware):
    state = await get_companion_filter()
    assert state.backup is not None and state.backup.config.enabled is False

    firmware.enabled = True  # changed on the console, not through RTFM-EV
    state = await get_companion_filter()
    assert state.backup.config.enabled is False  # a read never overwrites

    state = await save_companion_filter_backup()
    assert state.backup.config.enabled is True


@pytest.mark.asyncio
async def test_restore_without_backup_is_404(firmware):
    with pytest.raises(HTTPException) as exc:
        await restore_companion_filter()
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_clipped_read_keeps_complete_backup(firmware, monkeypatch):
    await add_companion_filter_rule("text", FilterRule(pattern="keep"))
    original = firmware._rule_list
    monkeypatch.setattr(firmware, "_rule_list", lambda kind: original(kind) + ",xx bl..")
    state = await get_companion_filter()
    assert state.truncated["text"] is True
    assert state.backup is not None
    assert state.backup.truncated is False


@pytest.mark.asyncio
async def test_history_bins_deltas(firmware, monkeypatch):
    async def all_scope(radio_id, unassigned):
        return None

    monkeypatch.setattr(router_module, "resolve_stat_scope", all_scope)
    base = {"malformed": 0, "age": 0, "path": 0, "sender": 0, "text": 0}
    await CompanionFilterHistoryRepository.insert(1000, {**base, "sender": 2}, 7)
    await CompanionFilterHistoryRepository.insert(1060, {**base, "sender": 5}, 7)
    await CompanionFilterHistoryRepository.insert(1120, {**base, "sender": 1}, 7)  # reboot

    resp = await get_companion_filter_history(start_ts=1000, end_ts=1200, bin_count=2)
    assert resp.totals["sender"] == 4
    assert [b["sender"] for b in resp.bins] == [3, 1]

    with pytest.raises(HTTPException):
        await get_companion_filter_history(start_ts=10, end_ts=10, bin_count=2)
