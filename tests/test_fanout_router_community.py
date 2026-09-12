from app.routers.fanout import _validate_mqtt_community_config


def _base() -> dict:
    return {"broker_host": "collector1.dutchmeshcore.nl", "iata": "AMS"}


def test_community_toggles_default_on_and_interval_default():
    cfg = _base()
    _validate_mqtt_community_config(cfg)
    assert cfg["publish_status"] is True
    assert cfg["publish_packets"] is True
    assert cfg["status_interval_ms"] == 300000
    # raw is intentionally NOT part of the community schema
    assert "publish_raw" not in cfg


def test_community_toggles_respect_explicit_false():
    cfg = _base() | {"publish_status": False, "publish_packets": False}
    _validate_mqtt_community_config(cfg)
    assert cfg["publish_status"] is False
    assert cfg["publish_packets"] is False


def test_forward_toggles_default_off():
    """Forwarding remote-node telemetry/neighbors/regions is opt-in (plan [24])."""
    cfg = _base()
    _validate_mqtt_community_config(cfg)
    assert cfg["publish_telemetry"] is False
    assert cfg["publish_neighbors"] is False
    assert cfg["publish_regions"] is False


def test_forward_toggles_coerced_to_bool_when_enabled():
    cfg = _base() | {
        "publish_telemetry": True,
        "publish_neighbors": 1,
        "publish_regions": "yes",
    }
    _validate_mqtt_community_config(cfg)
    assert cfg["publish_telemetry"] is True
    assert cfg["publish_neighbors"] is True
    assert cfg["publish_regions"] is True


def test_community_status_interval_clamped_out_of_range():
    for bad in (500, 4_000_000, "nope", None):
        cfg = _base() | {"status_interval_ms": bad}
        _validate_mqtt_community_config(cfg)
        assert cfg["status_interval_ms"] == 300000


def test_community_status_interval_in_range_preserved():
    cfg = _base() | {"status_interval_ms": 600000}
    _validate_mqtt_community_config(cfg)
    assert cfg["status_interval_ms"] == 600000
