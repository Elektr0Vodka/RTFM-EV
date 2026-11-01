"""The wardrive module switch: when it is active and when it warns."""

from app.config import Settings
from app.wardrive.module import startup_warnings, wardrive_active, wardrive_unprotected

AUTH = {"basic_auth_username": "owner", "basic_auth_password": "secret"}


def test_inactive_by_default():
    assert wardrive_active(Settings()) is False


def test_active_when_flag_set():
    assert wardrive_active(Settings(wardrive=True)) is True


def test_inactive_in_multi_radio():
    assert wardrive_active(Settings(wardrive=True, multi_radio=True)) is False


def test_unprotected_without_basic_auth():
    assert wardrive_unprotected(Settings(wardrive=True)) is True


def test_protected_with_basic_auth():
    assert wardrive_unprotected(Settings(wardrive=True, **AUTH)) is False


def test_not_unprotected_when_off():
    assert wardrive_unprotected(Settings()) is False


def test_warning_when_unprotected():
    warnings = startup_warnings(Settings(wardrive=True))
    assert len(warnings) == 1
    assert "MESHCORE_BASIC_AUTH" in warnings[0]


def test_no_warning_when_protected():
    assert startup_warnings(Settings(wardrive=True, **AUTH)) == []


def test_warning_in_multi_radio():
    warnings = startup_warnings(Settings(wardrive=True, multi_radio=True))
    assert any("multi-radio" in w for w in warnings)


def test_no_warnings_when_off():
    assert startup_warnings(Settings()) == []


async def test_health_reports_wardrive(test_db, monkeypatch):
    import app.routers.health as health

    monkeypatch.setattr(health, "settings", Settings(wardrive=True))
    data = await health.build_health_data(False, None)
    assert data["wardrive_enabled"] is True
    assert data["wardrive_unprotected"] is True


async def test_health_reports_wardrive_off(test_db, monkeypatch):
    import app.routers.health as health

    monkeypatch.setattr(health, "settings", Settings())
    data = await health.build_health_data(False, None)
    assert data["wardrive_enabled"] is False
    assert data["wardrive_unprotected"] is False


def test_health_wardrive_flags_with_a_settings_stub(monkeypatch):
    from types import SimpleNamespace

    import app.routers.health as health

    monkeypatch.setattr(health, "settings", SimpleNamespace(wardrive=True))
    assert health._wardrive_flag(wardrive_active) is True
    assert health._wardrive_flag(wardrive_unprotected) is True
