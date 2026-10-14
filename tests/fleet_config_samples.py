"""Sample config files for the fleet config library tests (plan 32, Phase 1).

``toolbox_file`` is hand-built from the shape the Dutch MeshCore toolbox's USB
config page writes (its ``exportConfig``: ``vars`` always, ``filter``,
``region``, ``hardware`` and ``mqtt`` only on firmware that has them). No
value here comes from a real device.
"""

import copy
from typing import Any

from app.services import fleet_vault

OWNER_KEY = "ab" * 32

# Every secret value in the full sample, by where it sits in the file.
TOOLBOX_SECRETS: dict[str, Any] = {
    "vars/guest.password": "guest-pw-1",
    "hardware/bridgeSecret": "xor-bridge-key",
    "mqtt/alertPsk": "0123456789abcdef0123456789abcdef",
    "mqtt/snmpCommunity": "mesh-readonly",
    "mqtt/wifiPassword": "wifi-pass-phrase",
    "mqtt/slots/0/password": "broker-pass",
    "mqtt/slots/0/token": "broker-token-xyz",
}


def keypair() -> tuple[str, str]:
    """A MeshCore keypair as hex: (private 128 chars, public 64 chars)."""
    found = fleet_vault.generate_keypair("", set(), 0, 1000)
    assert found is not None
    private_key, public_key, _attempts = found
    return private_key.hex(), public_key.hex()


def _slot(**fields: Any) -> dict[str, Any]:
    return {
        "preset": "none",
        "server": "",
        "port": 0,
        "username": "",
        "password": "",
        "token": "",
        "topic": "",
        "audience": "",
        "filter": "all",
        **fields,
    }


def toolbox_file(private_key: str | None = None, *, sections: bool = True) -> dict[str, Any]:
    """A toolbox export. ``sections=False`` gives what stock firmware writes: ``vars`` only."""
    document: dict[str, Any] = {
        "vars": {
            "name": "NL-TST-RPT",
            "repeat": True,
            "allow.read.only": False,
            "radio": {"freq": "869.618", "bw": "62.5", "sf": "8", "cr": "8"},
            "tx": 22,
            "af": 1,
            "rxdelay": 0,
            "txdelay": 0.5,
            "direct.txdelay": 0.2,
            "flood.max": 64,
            "flood.advert.interval": 12,
            "advert.interval": 120,
            "guest.password": TOOLBOX_SECRETS["vars/guest.password"],
            "lat": 52.37403,
            "lon": 4.88969,
            "int.thresh": 0,
            "agc.reset.interval": 0,
            "multi.acks": "0",
            "owner.info": "line one\nline two",
            "path.hash.mode": "1",
            "loop.detect": "off",
            "cad": False,
            "flood.max.unscoped": 64,
            "flood.max.advert": 8,
            "radio.rxgain": True,
            "adc.multiplier": 0,
        }
    }
    if private_key is not None:
        document["vars"]["prv.key"] = private_key
    if not sections:
        return document
    document["filter"] = {
        "enabled": True,
        "perType": [{"hops": 8, "rateLimit": 0, "rateSecs": 0} for _ in range(12)],
        "channels": ["#test"],
        "minHashBytes": 1,
        "malformed": True,
    }
    document["region"] = {"def": "nl nl-nh|nl", "home": "nl", "default": ""}
    document["hardware"] = {
        "bridgeType": "espnow",
        "bridgeSupported": True,
        "bridgeEnabled": True,
        "bridgeDelay": 500,
        "bridgeSource": "tx",
        "rs232Supported": False,
        "bridgeBaud": 115200,
        "espnowSupported": True,
        "bridgeChannel": 6,
        "bridgeSecret": TOOLBOX_SECRETS["hardware/bridgeSecret"],
        "femRxSupported": False,
        "femRxgain": False,
        "femTxSupported": False,
        "femTxgain": False,
        "extraSfSupported": False,
        "extraSf": "",
    }
    document["mqtt"] = {
        "origin": "NL-TST-OBS",
        "iata": "AMS",
        "status": True,
        "packets": True,
        "raw": False,
        "tx": "advert",
        "rx": True,
        "interval": 5,
        "neighbors": False,
        "neighborsInterval": 24,
        "neighborsSupported": False,
        "radioWatchdog": 5,
        "ntp": "",
        "owner": OWNER_KEY,
        "email": "ops@example.org",
        "slots": [
            _slot(
                preset="custom",
                server="mqtt.example.org",
                port=8883,
                username="observer",
                password=TOOLBOX_SECRETS["mqtt/slots/0/password"],
                token=TOOLBOX_SECRETS["mqtt/slots/0/token"],
                topic="meshcore/test",
            ),
            _slot(preset="dutchmeshcore-1"),
            _slot(),
            _slot(),
            _slot(),
            _slot(),
        ],
        "alert": True,
        "alertPsk": TOOLBOX_SECRETS["mqtt/alertPsk"],
        "alertHashtag": "#alerts",
        "alertRegion": "nl",
        "alertWifi": 30,
        "alertMqtt": 240,
        "alertInterval": 60,
        "snmp": True,
        "snmpCommunity": TOOLBOX_SECRETS["mqtt/snmpCommunity"],
        "wifiSsid": "mesh-lab",
        "wifiPassword": TOOLBOX_SECRETS["mqtt/wifiPassword"],
        "wifiPowersave": "none",
        "timezone": "Europe/Amsterdam",
        "timezoneOffset": 0,
    }
    return document


def companion_file(private_key: str | None = None) -> dict[str, Any]:
    """The version 1 file Settings > Radio writes for the connected companion."""
    document: dict[str, Any] = {
        "version": 1,
        "exported_at": "2026-10-14T10:00:00.000Z",
        "name": "My Companion",
        "lat": 52.1,
        "lon": 5.2,
        "tx_power": 20,
        "radio": {"freq": 869.618, "bw": 62.5, "sf": 8, "cr": 8},
        "path_hash_mode": 1,
        "advert_location_source": "current",
        "multi_acks_enabled": False,
        "telemetry_mode_base": 0,
        "telemetry_mode_loc": 0,
        "telemetry_mode_env": 0,
    }
    if private_key is not None:
        document["private_key"] = private_key
    return document


def secret_values(document: dict[str, Any], private_key: str | None = None) -> list[str]:
    """Every secret string a stored copy of ``document`` must not contain."""
    values = [str(value) for value in TOOLBOX_SECRETS.values()] if "mqtt" in document else []
    if "vars" in document and "mqtt" not in document:
        values.append(str(TOOLBOX_SECRETS["vars/guest.password"]))
    if private_key is not None:
        values.append(private_key)
    return values


def clone(document: dict[str, Any]) -> dict[str, Any]:
    return copy.deepcopy(document)
