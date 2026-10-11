"""Tests for the ASGI entry point that picks single-radio or gateway mode."""

from __future__ import annotations

from app.asgi import select_app
from app.config import Settings


def test_switch_off_serves_the_single_radio_app():
    from app.main import app as single_radio_app

    settings = Settings(serial_port="", tcp_host="", ble_address="")
    assert select_app(settings) is single_radio_app


def test_switch_on_serves_the_gateway(tmp_path):
    settings = Settings(
        serial_port="",
        tcp_host="",
        ble_address="",
        multi_radio=True,
        database_path=str(tmp_path / "meshcore.db"),
    )
    app = select_app(settings)
    assert app.title == "RTFM-EV gateway"
    paths = {route.path for route in app.routes}
    assert "/gateway/api/radios" in paths
    assert "/r/{segment}/{path:path}" in paths
