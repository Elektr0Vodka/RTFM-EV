"""Tests for the gateway radio registry (plan 30)."""

from __future__ import annotations

import json

import pytest

from app.config import Settings
from app.gateway.registry import (
    BleTransport,
    RadioRegistry,
    RegistryError,
    SerialTransport,
    TcpTransport,
)

KEY_A = "aa" * 32
KEY_B = "bb" * 32


def _registry(tmp_path) -> RadioRegistry:
    return RadioRegistry(tmp_path / "radios.json")


def test_add_assigns_ids_and_default_database_path(tmp_path):
    reg = _registry(tmp_path)
    first = reg.add(name="868", transport=TcpTransport(host="10.0.0.5"))
    second = reg.add(name="433", transport=SerialTransport(port="/dev/ttyUSB1"))
    assert (first.id, second.id) == (1, 2)
    assert second.database_path == (tmp_path / "radios" / "2" / "meshcore.db").as_posix()


def test_ids_are_never_reused(tmp_path):
    reg = _registry(tmp_path)
    reg.add(name="a", transport=TcpTransport(host="10.0.0.5"))
    second = reg.add(name="b", transport=TcpTransport(host="10.0.0.6"))
    reg.remove(second.id)
    third = reg.add(name="c", transport=TcpTransport(host="10.0.0.7"))
    assert third.id == 3


def test_save_and_load_round_trip(tmp_path):
    reg = _registry(tmp_path)
    reg.add(
        name="868",
        transport=BleTransport(address="AA:BB", pin="123456"),
        env={"MESHCORE_LOG_LEVEL": "DEBUG"},
    )
    again = _registry(tmp_path)
    again.load()
    assert [r.name for r in again.radios] == ["868"]
    assert again.radios[0].transport.pin == "123456"
    assert again.radios[0].env == {"MESHCORE_LOG_LEVEL": "DEBUG"}
    assert json.loads((tmp_path / "radios.json").read_text())["next_id"] == 2
    assert not (tmp_path / "radios.json.tmp").exists()


def test_load_without_file_keeps_empty_list(tmp_path):
    reg = _registry(tmp_path)
    reg.load()
    assert reg.radios == []


def test_bootstrap_from_settings_uses_existing_transport_and_database(tmp_path):
    reg = _registry(tmp_path)
    settings = Settings(
        serial_port="",
        tcp_host="192.168.1.9",
        tcp_port=5001,
        ble_address="",
        database_path="data/meshcore.db",
    )
    reg.bootstrap_from_settings(settings)
    radio = reg.radios[0]
    assert radio.id == 1
    assert radio.transport == TcpTransport(host="192.168.1.9", port=5001)
    assert radio.database_path == "data/meshcore.db"
    reg.bootstrap_from_settings(settings)
    assert len(reg.radios) == 1


def test_duplicate_connection_is_refused(tmp_path):
    reg = _registry(tmp_path)
    reg.add(name="a", transport=TcpTransport(host="Radio.local", port=5000))
    with pytest.raises(RegistryError, match="same connection"):
        reg.add(name="b", transport=TcpTransport(host="radio.local", port=5000))
    assert len(reg.radios) == 1


def test_duplicate_database_path_is_refused(tmp_path):
    reg = _registry(tmp_path)
    reg.add(name="a", transport=TcpTransport(host="10.0.0.5"), database_path="data/meshcore.db")
    with pytest.raises(RegistryError, match="same database"):
        reg.add(name="b", transport=TcpTransport(host="10.0.0.6"), database_path="data/meshcore.db")


def test_serial_auto_detect_only_with_one_radio(tmp_path):
    reg = _registry(tmp_path)
    reg.add(name="a", transport=SerialTransport(port=""))
    with pytest.raises(RegistryError, match="auto-detect"):
        reg.add(name="b", transport=TcpTransport(host="10.0.0.6"))


def test_reserved_env_keys_are_refused(tmp_path):
    reg = _registry(tmp_path)
    with pytest.raises(RegistryError, match="MESHCORE_WORKER_TOKEN"):
        reg.add(
            name="a", transport=TcpTransport(host="10.0.0.5"), env={"MESHCORE_WORKER_TOKEN": "x"}
        )


def test_update_changes_fields_and_validates(tmp_path):
    reg = _registry(tmp_path)
    a = reg.add(name="a", transport=TcpTransport(host="10.0.0.5"))
    b = reg.add(name="b", transport=TcpTransport(host="10.0.0.6"))
    updated = reg.update(b.id, name="433", enabled=False)
    assert (updated.name, updated.enabled) == ("433", False)
    with pytest.raises(RegistryError, match="same connection"):
        reg.update(b.id, transport=TcpTransport(host="10.0.0.5"))
    assert reg.get(b.id).transport == TcpTransport(host="10.0.0.6")
    assert reg.get(a.id).name == "a"


def test_update_and_remove_unknown_id_raise_key_error(tmp_path):
    reg = _registry(tmp_path)
    with pytest.raises(KeyError):
        reg.update(9, name="x")
    with pytest.raises(KeyError):
        reg.remove(9)


def test_set_public_key_tracks_history(tmp_path):
    reg = _registry(tmp_path)
    radio = reg.add(name="a", transport=TcpTransport(host="10.0.0.5"))
    assert reg.set_public_key(radio.id, KEY_A.upper()) is True
    assert reg.get(radio.id).public_key == KEY_A
    assert reg.set_public_key(radio.id, KEY_A) is False
    assert reg.set_public_key(radio.id, KEY_B) is True
    assert reg.get(radio.id).key_history == [KEY_A]
    assert reg.set_public_key(radio.id, KEY_A) is True
    assert reg.get(radio.id).key_history == [KEY_B]
    again = _registry(tmp_path)
    again.load()
    assert again.get(radio.id).public_key == KEY_A
