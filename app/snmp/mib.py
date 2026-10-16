"""The MeshCore observer firmware's SNMP OID table.

Source: ``src/helpers/SNMPAgent.cpp`` and ``MQTT_SNMP.md`` in the observer
firmware (Dutch-MeshCore/MeshCore ``dmc-observer-dev`` at 923fc428, identical
in agessaman/MeshCore ``observer-firmware``). The entries after the first 22
come from Dutch-MeshCore/MeshCore PR #16 (``feature/dmc-observer-dev-snmp-battery``
at 0a96eae3). Every entry is a scalar under the temporary, unregistered
enterprise number 99999:

    .1.x.0 system, .2.x.0 radio, .3.x.0 mqtt, .4.x.0 memory, .5.x.0 network,
    .6.x.0 duty gate, .7.x.0 packet filter, .8.x.0 neighbours,
    .9.x.0 companion, .10.x.0 companion receive filter

The .9 and .10 groups come from the meshcomod companion firmware
(Elektr0Vodka/meshcomod main 938352fa, ``docs/companion_snmp.md``), which
serves the same tree as a companion: no .3.1-.3.3, .2.16, .6, .7 or .8.

The first 22 numbers are INTEGER and the two names OCTET STRING. Those
counters are uint32 cast to a signed int, so a counter past 2^31 reads
negative. ``last_snr`` is sent as dB x 4; ``scale`` turns it back into dB.

The newer totals are Counter32 (``kind="counter"``): they start again from 0
after a reboot or ``clear stats``. Every newer OID may be missing: older
firmware has none of them, room servers have no .6 or .7, and other builds
may leave out more. A missing OID decodes to None, which means "not
supported", not 0. ``sentinel`` is the value a node sends when it has the OID
but cannot measure it (battery 0 mV, MCU temperature -127 C).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.snmp import ber
from app.snmp.ber import Oid, SnmpValue

ENTERPRISE_BASE: Oid = (1, 3, 6, 1, 4, 1, 99999)

MibGroup = Literal[
    "system",
    "radio",
    "mqtt",
    "memory",
    "network",
    "duty_gate",
    "filter",
    "neighbours",
    "companion",
    "companion_filter",
]
MibKind = Literal["int", "counter", "str"]
MibValue = int | float | str | None


@dataclass(frozen=True)
class MibEntry:
    key: str
    group: MibGroup
    sub_id: tuple[int, int]
    kind: MibKind = "int"
    unit: str | None = None
    scale: float = 1.0
    sentinel: int | None = None

    @property
    def oid(self) -> Oid:
        return (*ENTERPRISE_BASE, *self.sub_id, 0)


# The table of the first firmware release, all served by every firmware node.
# RTFM-EV's own agent serves only these (``app/services/snmp_agent.py``).
FIRST_RELEASE_ENTRIES: tuple[MibEntry, ...] = (
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

# Added by Dutch-MeshCore/MeshCore PR #16 and meshcomod. Any of these can be missing.
ADDED_ENTRIES: tuple[MibEntry, ...] = (
    MibEntry("battery_mv", "system", (1, 4), unit="mV", sentinel=0),
    MibEntry("mcu_temp_c", "system", (1, 5), unit="°C", sentinel=-127),
    # ESP-IDF esp_reset_reason_t of the current boot, and the same as text.
    MibEntry("reset_reason_code", "system", (1, 6)),
    MibEntry("reset_reason", "system", (1, 7), kind="str"),
    MibEntry("tx_queue_len", "radio", (2, 12)),
    MibEntry("flood_dups", "radio", (2, 13), kind="counter"),
    MibEntry("direct_dups", "radio", (2, 14), kind="counter"),
    MibEntry("rx_air_time_secs", "radio", (2, 15), kind="counter", unit="s"),
    MibEntry("tx_duty_percent", "radio", (2, 16), unit="%"),
    # Bitmask since boot: 1 packet pool full, 2 CAD timeout, 4 start-RX
    # timeout, 8 radio watchdog fired.
    MibEntry("error_flags", "radio", (2, 17)),
    MibEntry("ntp_synced", "mqtt", (3, 4)),
    MibEntry("min_free_heap", "memory", (4, 5), unit="B"),
    MibEntry("dc_gate_enabled", "duty_gate", (6, 1)),
    MibEntry("dc_gate_level", "duty_gate", (6, 2)),
    MibEntry("dc_gate_max_level", "duty_gate", (6, 3)),
    MibEntry("dc_gate_threshold", "duty_gate", (6, 4), unit="%"),
    MibEntry("dc_gate_hysteresis", "duty_gate", (6, 5), unit="%"),
    MibEntry("filter_enabled", "filter", (7, 1)),
    MibEntry("filter_dry_run", "filter", (7, 2)),
    MibEntry("filter_hop_limit_drops", "filter", (7, 3), kind="counter"),
    MibEntry("filter_rate_limit_drops", "filter", (7, 4), kind="counter"),
    MibEntry("filter_channel_drops", "filter", (7, 5), kind="counter"),
    MibEntry("filter_path_hash_drops", "filter", (7, 6), kind="counter"),
    MibEntry("filter_malformed_drops", "filter", (7, 7), kind="counter"),
    MibEntry("filter_advert_drops", "filter", (7, 8), kind="counter"),
    MibEntry("filter_path_prefix_drops", "filter", (7, 9), kind="counter"),
    MibEntry("filter_sender_drops", "filter", (7, 10), kind="counter"),
    MibEntry("filter_text_drops", "filter", (7, 11), kind="counter"),
    MibEntry("filter_age_drops", "filter", (7, 12), kind="counter"),
    MibEntry("filter_air_saved_ms", "filter", (7, 13), kind="counter", unit="ms"),
    MibEntry("neighbour_count", "neighbours", (8, 1)),
    # meshcomod companion only.
    MibEntry("companion_tcp_clients", "companion", (9, 1)),
    MibEntry("companion_ws_clients", "companion", (9, 2)),
    MibEntry("companion_contacts", "companion", (9, 3)),
    MibEntry("companion_channels", "companion", (9, 4)),
    # Messages kept from the user, not packets kept off the air (that is .7).
    MibEntry("cfilter_enabled", "companion_filter", (10, 1)),
    MibEntry("cfilter_malformed_drops", "companion_filter", (10, 2), kind="counter"),
    MibEntry("cfilter_age_drops", "companion_filter", (10, 3), kind="counter"),
    MibEntry("cfilter_path_drops", "companion_filter", (10, 4), kind="counter"),
    MibEntry("cfilter_sender_hidden", "companion_filter", (10, 5), kind="counter"),
    MibEntry("cfilter_text_hidden", "companion_filter", (10, 6), kind="counter"),
)

ENTRIES: tuple[MibEntry, ...] = FIRST_RELEASE_ENTRIES + ADDED_ENTRIES

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
