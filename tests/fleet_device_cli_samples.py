"""Replies of a repeater's text command line, for the plan 32 Phase 3 tests.

Each map is command -> reply, the reply being what follows ``  -> `` on the
serial line up to its ``\\r\\n`` (``examples/simple_repeater/main.cpp``). They
are hand-built from the firmware source's reply formats (stock
``src/helpers/CommonCLI.cpp``, DMC ``examples/simple_repeater/Filter.cpp`` and
``src/helpers/CommonCLI_Observer.cpp``). No value here comes from a real device.
"""

from typing import Any

from app.services import fleet_device_cli
from tests.fleet_config_samples import keypair

PRIVATE_KEY, PUBLIC_KEY = keypair()


def _unknown_get(key: str) -> str:
    return f"??: {key}"


def stock_replies(
    *,
    version: str = "v1.14.0 (Build: 01-Sep-2026)",
    private_key: str = PRIVATE_KEY,
    public_key: str = PUBLIC_KEY,
    region: str = "* F\n nl^ F\n  nl-nh F\n",
) -> dict[str, str | None]:
    """A stock repeater without bridge, packet filter or observer settings."""
    replies: dict[str, str | None] = {
        "ver": version,
        "board": "Heltec V3",
        "get role": "> repeater",
        "get public.key": f"> {public_key}",
        "get name": "> NL-TST-RPT",
        "get repeat": "> on",
        "get allow.read.only": "> off",
        "get radio": "> 869.6179809,62.5,7,5",
        "get tx": "> 22",
        "get af": "> 1.0",
        "get rxdelay": "> 0.0",
        "get txdelay": "> 0.5",
        "get direct.txdelay": "> 0.2",
        "get flood.max": "> 64",
        "get flood.advert.interval": "> 12",
        "get advert.interval": "> 120",
        "get guest.password": "> guest-pw-1",
        "get lat": "> 52.3740312",
        "get lon": "> 4.8896881",
        "get int.thresh": "> 0",
        "get agc.reset.interval": "> 0",
        "get multi.acks": "> 0",
        "get owner.info": "> line one|line two",
        "get path.hash.mode": "> 1",
        "get loop.detect": "> off",
        "get cad": _unknown_get("cad"),
        "get flood.max.unscoped": "> 64",
        "get flood.max.advert": "> 8",
        # Not an SX126x board: the key falls through to the radio reply.
        "get radio.rxgain": "> 869.6179809,62.5,7,5",
        "get adc.multiplier": "Error: unsupported by this board",
        "get prv.key": f"> {private_key}",
        "filter": "Unknown command",
        fleet_device_cli.MQTT_PROBE: _unknown_get("mqtt.config.valid"),
        "get bridge.type": "> none",
        "get bridge.enabled": _unknown_get("bridge.enabled"),
        "get bridge.delay": _unknown_get("bridge.delay"),
        "get bridge.source": _unknown_get("bridge.source"),
        "get bridge.baud": _unknown_get("bridge.baud"),
        "get bridge.channel": _unknown_get("bridge.channel"),
        "get bridge.secret": _unknown_get("bridge.secret"),
        "get radio.fem.rxgain": _unknown_get("radio.fem.rxgain"),
        "get radio.fem.txgain": _unknown_get("radio.fem.txgain"),
        "get extra.sf": "No extra SF configured",
        "region": region,
        "region home": " home is nl",
        "region default": " default scope is <null>",
    }
    return replies


_FILTER_HOPS = "[TYPE: MAX_HOPS]" + "".join(
    f"\n{index:02d}: {32 if index == 5 else 8}" for index in range(12)
)
_FILTER_RATE = "[TYPE: LIMIT,SECS,SOFT]" + "".join(
    f"\n{index:02d}: {20 if index == 2 else 5},60,{3 if index == 2 else 0}" for index in range(12)
)


def _observer_mqtt() -> dict[str, str | None]:
    replies: dict[str, str | None] = {
        "get mqtt.origin": "> NL-TST-OBS",
        "get mqtt.iata": "> AMS",
        "get mqtt.packets": "> on",
        "get mqtt.raw": "> off",
        "get mqtt.tx": "> advert",
        "get mqtt.rx": "> on",
        "get mqtt.interval": "> 5 minutes (300000 ms)",
        "get mqtt.neighbors": "Error: unsupported",
        "get mqtt.neighbors.interval": "Error: unsupported",
        "get radio.watchdog": "> 5 min",
        "get mqtt.ntp": "> (default: pool.ntp.org)",
        "get mqtt.owner": "> " + "ab" * 32,
        "get mqtt.email": "> ops@example.org",
        "get alert": "> off",
        "get alert.psk": "> (unset)",
        "get alert.hashtag": "> (not set)",
        "get alert.region": "> (not set)",
        "get alert.wifi": "> 30 min",
        "get alert.mqtt": "> 240 min",
        "get alert.interval": "> 60 min",
        "get snmp": "> on",
        "get snmp.community": "> mesh-readonly",
        "get wifi.ssid": "> MeshNet",
        "get wifi.pwd": "> wifi-pass-phrase",
        "get wifi.powersave": "> none",
        "get timezone": "> Europe/Amsterdam",
        "get timezone.offset": "> 0",
    }
    for slot in range(1, 7):
        for name in ("server", "username", "password", "token", "topic", "audience"):
            replies[f"get mqtt{slot}.{name}"] = "> (not set)"
        replies[f"get mqtt{slot}.preset"] = "> none"
        replies[f"get mqtt{slot}.port"] = "> 0"
        replies[f"get mqtt{slot}.filter"] = "> all"
    replies.update(
        {
            "get mqtt1.preset": "> custom",
            "get mqtt1.server": "> mqtt.example.org",
            "get mqtt1.port": "> 8883",
            "get mqtt1.username": "> observer",
            "get mqtt1.password": "> broker-pass",
            "get mqtt1.token": "> (not set - custom slots use username/password auth)",
            "get mqtt1.topic": "> meshcore/test",
            "get mqtt1.filter": "> 4,5,2",
            "get mqtt2.preset": "> dutchmeshcore-1",
        }
    )
    return replies


def observer_replies(**kwargs: Any) -> dict[str, str | None]:
    """A DMC observer: packet filter, ESP-NOW bridge, observer (MQTT) settings."""
    replies = stock_replies(**kwargs)
    replies.update(
        {
            "ver": "v1.14.1-dmc-observer (Build: 26-Sep-2026)",
            "board": "Heltec V4",
            "filter": "> Filter on: Blocked [ Hops: 3 | Rate: 12 | Channel: 1 | Hash: 0 | Malformed: 2 ]",
            "filter hops": _FILTER_HOPS,
            "filter rate": _FILTER_RATE,
            "filter channel list": "#test (a1),Public (11)",
            "filter hash": "> Filter: minimal 1 bytes path hash size",
            "filter malformed": "> Filter: malformed text scan on",
            fleet_device_cli.MQTT_PROBE: "> valid",
            "get bridge.type": "> espnow",
            "get bridge.enabled": "> on",
            "get bridge.delay": "> 500",
            "get bridge.source": "> logTx",
            "get bridge.channel": "> 6",
            "get bridge.secret": "> xor-bridge-key",
        }
    )
    replies.update(_observer_mqtt())
    return replies
