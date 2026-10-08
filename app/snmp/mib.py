"""The MeshCore observer firmware's SNMP OID table.

Source: ``src/helpers/SNMPAgent.cpp`` and ``MQTT_SNMP.md`` in the observer
firmware (Dutch-MeshCore/MeshCore ``dmc-observer-dev`` at 923fc428, identical
in agessaman/MeshCore ``observer-firmware``). Every entry is a scalar under
the temporary, unregistered enterprise number 99999:

    .1.x.0 system, .2.x.0 radio, .3.x.0 mqtt, .4.x.0 memory, .5.x.0 network

The firmware serves all numbers as INTEGER and the two names as OCTET STRING.
Its counters are uint32 cast to a signed int, so a counter past 2^31 reads
negative. ``last_snr`` is sent as dB x 4; ``scale`` turns it back into dB.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.snmp import ber
from app.snmp.ber import Oid, SnmpValue

ENTERPRISE_BASE: Oid = (1, 3, 6, 1, 4, 1, 99999)

MibGroup = Literal["system", "radio", "mqtt", "memory", "network"]
MibKind = Literal["int", "str"]
MibValue = int | float | str | None


@dataclass(frozen=True)
class MibEntry:
    key: str
    group: MibGroup
    sub_id: tuple[int, int]
    kind: MibKind = "int"
    unit: str | None = None
    scale: float = 1.0

    @property
    def oid(self) -> Oid:
        return (*ENTERPRISE_BASE, *self.sub_id, 0)


ENTRIES: tuple[MibEntry, ...] = (
    MibEntry("uptime_secs", "system", (1, 1), unit="s"),
    MibEntry("firmware_version", "system", (1, 2), kind="str"),
    MibEntry("node_name", "system", (1, 3), kind="str"),
    MibEntry("packets_recv", "radio", (2, 1)),
    MibEntry("packets_sent", "radio", (2, 2)),
    MibEntry("recv_errors", "radio", (2, 3)),
    MibEntry("noise_floor", "radio", (2, 4), unit="dBm"),
    MibEntry("last_rssi", "radio", (2, 5), unit="dBm"),
    MibEntry("last_snr", "radio", (2, 6), unit="dB", scale=0.25),
    MibEntry("sent_flood", "radio", (2, 7)),
    MibEntry("sent_direct", "radio", (2, 8)),
    MibEntry("recv_flood", "radio", (2, 9)),
    MibEntry("recv_direct", "radio", (2, 10)),
    MibEntry("total_air_time_secs", "radio", (2, 11), unit="s"),
    MibEntry("mqtt_connected_slots", "mqtt", (3, 1)),
    MibEntry("mqtt_queue_depth", "mqtt", (3, 2)),
    MibEntry("mqtt_skipped_publishes", "mqtt", (3, 3)),
    MibEntry("free_heap", "memory", (4, 1), unit="B"),
    MibEntry("max_alloc", "memory", (4, 2), unit="B"),
    MibEntry("internal_free", "memory", (4, 3), unit="B"),
    MibEntry("psram_free", "memory", (4, 4), unit="B"),
    MibEntry("wifi_rssi", "network", (5, 1), unit="dBm"),
)

BY_OID: dict[Oid, MibEntry] = {entry.oid: entry for entry in ENTRIES}
BY_KEY: dict[str, MibEntry] = {entry.key: entry for entry in ENTRIES}

_NUMERIC_TAGS = frozenset({ber.TAG_INTEGER, *ber.UNSIGNED_TAGS})


def decode_entry(entry: MibEntry, value: SnmpValue) -> MibValue:
    """Turn one varbind value into a plain Python value, or None when the
    agent did not serve the OID or sent a type that does not fit the entry."""
    if entry.kind == "str":
        if value.tag != ber.TAG_OCTET_STRING or not isinstance(value.value, bytes):
            return None
        return value.value.split(b"\x00", 1)[0].decode("utf-8", errors="replace")
    if value.tag not in _NUMERIC_TAGS or not isinstance(value.value, int):
        return None
    if entry.scale == 1.0:
        return value.value
    return value.value * entry.scale


def decode_varbinds(varbinds: list[tuple[Oid, SnmpValue]]) -> dict[str, MibValue]:
    """Map a response to ``{key: value}`` with every table key present."""
    result: dict[str, MibValue] = {entry.key: None for entry in ENTRIES}
    for oid, value in varbinds:
        entry = BY_OID.get(oid)
        if entry is not None:
            result[entry.key] = decode_entry(entry, value)
    return result
