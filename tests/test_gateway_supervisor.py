"""Tests for the gateway worker supervisor (plan 30)."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import httpx

from app.gateway.registry import BleTransport, RadioRegistry, TcpTransport
from app.gateway.supervisor import WorkerSupervisor, build_worker_env

TESTS_DIR = Path(__file__).resolve().parent
KEY = "ab" * 32


def _fake_worker_command(entry, port: int) -> list[str]:
    return [
        sys.executable,
        "-m",
        "uvicorn",
        "--app-dir",
        str(TESTS_DIR),
        "gateway_fake_worker:app",
        "--host",
        "127.0.0.1",
        "--port",
        str(port),
        "--log-level",
        "warning",
    ]


def _crashing_command(entry, port: int) -> list[str]:
    return [sys.executable, "-c", "print('boom'); raise SystemExit(3)"]


def _registry(tmp_path) -> RadioRegistry:
    reg = RadioRegistry(tmp_path / "radios.json")
    reg.add(name="a", transport=TcpTransport(host="10.0.0.5"))
    return reg


def test_worker_env_sets_transport_database_and_token(tmp_path):
    reg = RadioRegistry(tmp_path / "radios.json")
    entry = reg.add(
        name="a",
        transport=BleTransport(address="AA:BB", pin="123456"),
        env={"MESHCORE_LOG_LEVEL": "DEBUG"},
    )
    env = build_worker_env(
        entry,
        "tok",
        base_env={
            "PATH": "/bin",
            "MESHCORE_MULTI_RADIO": "true",
            "MESHCORE_TCP_HOST": "old-host",
            "MESHCORE_BASIC_AUTH_USERNAME": "u",
            "MESHCORE_BASIC_AUTH_PASSWORD": "p",
            "MESHCORE_HOST_REPEATER_ENABLED": "true",
        },
    )
    assert env["PATH"] == "/bin"
    assert env["MESHCORE_BLE_ADDRESS"] == "AA:BB"
    assert env["MESHCORE_BLE_PIN"] == "123456"
    assert env["MESHCORE_DATABASE_PATH"] == entry.database_path
    assert env["MESHCORE_WORKER_TOKEN"] == "tok"
    assert env["MESHCORE_LOG_LEVEL"] == "DEBUG"
    assert env["MESHCORE_HOST_REPEATER_ENABLED"] == "true"
    for gone in (
        "MESHCORE_MULTI_RADIO",
        "MESHCORE_TCP_HOST",
        "MESHCORE_BASIC_AUTH_USERNAME",
        "MESHCORE_BASIC_AUTH_PASSWORD",
    ):
        assert gone not in env


async def test_worker_reaches_running_and_reports_health(tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_PUBLIC_KEY", KEY)
    seen: list[tuple[int, str]] = []

    async def on_health(radio_id: int, health: dict) -> None:
        seen.append((radio_id, health["radio_identity"]["public_key"]))

    async with httpx.AsyncClient() as client:
        supervisor = WorkerSupervisor(
            _registry(tmp_path),
            client=client,
            command_factory=_fake_worker_command,
            on_health=on_health,
        )
        await supervisor.start(1)
        try:
            for _ in range(150):
                await supervisor.tick()
                if supervisor.worker(1).state == "running":
                    break
                await asyncio.sleep(0.2)
            assert supervisor.view(1) == {
                "state": "running",
                "restarts": 0,
                "radio_connected": False,
                "radio_name": "Fake",
            }
            assert seen[0] == (1, KEY)
            assert (tmp_path / "radios" / "1").is_dir()
        finally:
            await supervisor.stop(1)
    assert supervisor.view(1)["state"] == "stopped"
    assert supervisor.worker(1).process is None


async def test_crashed_worker_restarts_after_backoff(tmp_path):
    now = [100.0]
    async with httpx.AsyncClient() as client:
        supervisor = WorkerSupervisor(
            _registry(tmp_path),
            client=client,
            command_factory=_crashing_command,
            clock=lambda: now[0],
        )
        await supervisor.start(1)
        worker = supervisor.worker(1)
        await worker.process.wait()
        await asyncio.sleep(0.2)
        await supervisor.tick()
        assert worker.state == "crashed"
        assert worker.restarts == 1
        assert "boom" in supervisor.log_lines(1)

        await supervisor.tick()
        assert worker.process is None

        now[0] += 2.1
        await supervisor.tick()
        assert worker.state == "starting"
        assert worker.process is not None
        await supervisor.stop(1)


async def test_stop_keeps_worker_down(tmp_path):
    now = [100.0]
    async with httpx.AsyncClient() as client:
        supervisor = WorkerSupervisor(
            _registry(tmp_path),
            client=client,
            command_factory=_crashing_command,
            clock=lambda: now[0],
        )
        await supervisor.start(1)
        await supervisor.stop(1)
        now[0] += 500
        await supervisor.tick()
        assert supervisor.worker(1).process is None
        assert supervisor.view(1)["state"] == "stopped"


async def test_start_of_removed_radio_does_nothing(tmp_path):
    async with httpx.AsyncClient() as client:
        supervisor = WorkerSupervisor(
            _registry(tmp_path), client=client, command_factory=_crashing_command
        )
        await supervisor.start(99)
        assert supervisor.worker(99).process is None
        assert supervisor.view(99)["state"] == "stopped"
