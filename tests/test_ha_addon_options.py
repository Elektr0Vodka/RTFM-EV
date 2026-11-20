"""Home Assistant add-on mode: options.json mapping onto settings."""

import logging

from app.config import Settings, _build_settings
from app.ha_addon.options import addon_overrides, load_addon_options


def test_overrides_map_tcp_and_log_level():
    out = addon_overrides({"tcp_host": "192.0.2.5", "tcp_port": 5001, "log_level": "DEBUG"}, {})
    assert out == {
        "tcp_host": "192.0.2.5",
        "tcp_port": 5001,
        "log_level": "DEBUG",
        "database_path": "/data/meshcore.db",
    }


def test_empty_tcp_host_sets_no_transport():
    out = addon_overrides({"tcp_host": "", "tcp_port": 5000, "log_level": "INFO"}, {})
    assert "tcp_host" not in out
    assert "tcp_port" not in out


def test_env_wins_over_options():
    out = addon_overrides(
        {"tcp_host": "192.0.2.5", "tcp_port": 5001},
        {"MESHCORE_TCP_HOST": "198.51.100.1", "MESHCORE_DATABASE_PATH": "/x.db"},
    )
    assert "tcp_host" not in out
    assert "database_path" not in out


def test_env_port_wins_over_options():
    out = addon_overrides(
        {"tcp_host": "192.0.2.5", "tcp_port": 5001}, {"MESHCORE_TCP_PORT": "6000"}
    )
    assert out["tcp_host"] == "192.0.2.5"
    assert "tcp_port" not in out


def test_unknown_log_level_ignored():
    assert "log_level" not in addon_overrides({"log_level": "LOUD"}, {})


def test_non_string_host_ignored():
    assert "tcp_host" not in addon_overrides({"tcp_host": 12}, {})


def test_load_missing_file_returns_empty(tmp_path, caplog):
    with caplog.at_level(logging.WARNING):
        assert load_addon_options(str(tmp_path / "nope.json")) == {}
    assert "nope.json" in caplog.text


def test_load_invalid_json_returns_empty(tmp_path):
    p = tmp_path / "options.json"
    p.write_text("{not json")
    assert load_addon_options(str(p)) == {}


def test_load_non_object_returns_empty(tmp_path):
    p = tmp_path / "options.json"
    p.write_text("[1, 2]")
    assert load_addon_options(str(p)) == {}


def test_load_valid_file(tmp_path):
    p = tmp_path / "options.json"
    p.write_text('{"tcp_host": "192.0.2.5"}')
    assert load_addon_options(str(p)) == {"tcp_host": "192.0.2.5"}


def test_settings_off_by_default(monkeypatch):
    monkeypatch.delenv("MESHCORE_HA_ADDON", raising=False)
    assert Settings().ha_addon is False


def test_build_settings_reads_options_in_addon_mode(monkeypatch, tmp_path):
    p = tmp_path / "options.json"
    p.write_text('{"tcp_host": "192.0.2.5", "tcp_port": 5001, "log_level": "WARNING"}')
    monkeypatch.setenv("MESHCORE_HA_ADDON", "true")
    for name in (
        "MESHCORE_TCP_HOST",
        "MESHCORE_TCP_PORT",
        "MESHCORE_DATABASE_PATH",
        "MESHCORE_LOG_LEVEL",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr("app.config.ADDON_OPTIONS_PATH", str(p))
    s = _build_settings()
    assert s.ha_addon is True
    assert (s.tcp_host, s.tcp_port, s.log_level) == ("192.0.2.5", 5001, "WARNING")
    assert s.database_path == "/data/meshcore.db"


def test_build_settings_ignores_options_outside_addon_mode(monkeypatch, tmp_path):
    p = tmp_path / "options.json"
    p.write_text('{"tcp_host": "192.0.2.5"}')
    monkeypatch.delenv("MESHCORE_HA_ADDON", raising=False)
    monkeypatch.delenv("MESHCORE_TCP_HOST", raising=False)
    monkeypatch.setattr("app.config.ADDON_OPTIONS_PATH", str(p))
    assert _build_settings().tcp_host == ""
