"""Read-only metrics in the Prometheus text exposition format (version 0.0.4).

Served by ``GET /api/metrics`` when ``MESHCORE_METRICS_ENABLED`` is set. Covers
the connected radio, the radio queue, what is stored, the newest telemetry of
every tracked node (including its LPP sensors) and the MQTT integrations.
Values are read from memory and the database; nothing is sent over RF.
"""

import logging
import math
import time

logger = logging.getLogger(__name__)

_CONTACT_TYPES = {0: "unknown", 1: "client", 2: "repeater", 3: "room", 4: "sensor"}

# Own radio: key in the radio stats sample -> (metric, help)
_RADIO_STATS = {
    "battery_mv": ("rtfm_radio_battery_millivolts", "Battery of the connected radio"),
    "noise_floor": ("rtfm_radio_noise_floor_dbm", "Noise floor seen by the connected radio"),
    "uptime_secs": ("rtfm_radio_uptime_seconds", "Uptime of the connected radio"),
    "last_rssi": ("rtfm_radio_last_rssi_dbm", "RSSI of the last packet the radio heard"),
    "last_snr": ("rtfm_radio_last_snr_db", "SNR of the last packet the radio heard"),
    "tx_air_secs": ("rtfm_radio_tx_airtime_seconds_total", "Transmit airtime of the radio"),
    "rx_air_secs": ("rtfm_radio_rx_airtime_seconds_total", "Receive airtime of the radio"),
}

# Tracked node telemetry row key -> (metric, help)
_NODE_FIELDS = {
    "battery_volts": ("rtfm_node_battery_volts", "Battery of a tracked node"),
    "noise_floor_dbm": ("rtfm_node_noise_floor_dbm", "Noise floor of a tracked node"),
    "last_rssi_dbm": ("rtfm_node_last_rssi_dbm", "RSSI of the last packet a tracked node heard"),
    "last_snr_db": ("rtfm_node_last_snr_db", "SNR of the last packet a tracked node heard"),
    "uptime_seconds": ("rtfm_node_uptime_seconds", "Uptime of a tracked node"),
    "tx_queue_len": ("rtfm_node_tx_queue_length", "Transmit queue length of a tracked node"),
    "packets_received": ("rtfm_node_packets_received_total", "Packets a tracked node received"),
    "packets_sent": ("rtfm_node_packets_sent_total", "Packets a tracked node sent"),
    "airtime_seconds": ("rtfm_node_airtime_seconds_total", "Transmit airtime of a tracked node"),
    "recv_errors": ("rtfm_node_receive_errors_total", "Receive errors of a tracked node"),
}


def _escape(value: object) -> str:
    return str(value).replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')


def _labels(labels: dict[str, object] | None) -> str:
    if not labels:
        return ""
    inner = ",".join(f'{k}="{_escape(v)}"' for k, v in labels.items())
    return "{" + inner + "}"


def _number(value: object) -> float | None:
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, int | float) and math.isfinite(value):
        return float(value)
    return None


def _fmt(value: float) -> str:
    return str(int(value)) if value.is_integer() else repr(value)


class _Writer:
    """Groups samples per metric so each gets one HELP and TYPE line."""

    def __init__(self) -> None:
        self._order: list[str] = []
        self._meta: dict[str, tuple[str, str]] = {}
        self._samples: dict[str, list[str]] = {}

    def add(
        self,
        name: str,
        value: object,
        help_text: str,
        *,
        kind: str = "gauge",
        labels: dict[str, object] | None = None,
    ) -> None:
        number = _number(value)
        if number is None:
            return
        if name not in self._meta:
            self._order.append(name)
            self._meta[name] = (help_text, kind)
            self._samples[name] = []
        self._samples[name].append(f"{name}{_labels(labels)} {_fmt(number)}")

    def render(self) -> str:
        lines: list[str] = []
        for name in self._order:
            help_text, kind = self._meta[name]
            lines.append(f"# HELP {name} {help_text}")
            lines.append(f"# TYPE {name} {kind}")
            lines.extend(self._samples[name])
        return "\n".join(lines) + "\n"


async def _stored_counts(out: _Writer) -> None:
    from app.repository import StatisticsRepository

    counts = await StatisticsRepository.get_stored_counts()
    for type_code, count in counts["contacts"].items():
        out.add(
            "rtfm_contacts",
            count,
            "Contacts stored, by type",
            labels={"type": _CONTACT_TYPES.get(type_code, str(type_code))},
        )
    out.add("rtfm_channels", counts["channels"], "Channels stored")
    for msg_type, count in counts["messages"].items():
        out.add(
            "rtfm_messages",
            count,
            "Messages stored, by type",
            labels={"type": "channel" if msg_type == "CHAN" else "direct"},
        )
    out.add("rtfm_raw_packets", counts["raw_packets"], "Raw packets stored")


async def _node_telemetry(out: _Writer, now: float) -> None:
    from app.repository import ContactRepository
    from app.repository.repeater_telemetry import RepeaterTelemetryRepository

    latest = await RepeaterTelemetryRepository.get_latest_all()
    for public_key, row in latest.items():
        contact = await ContactRepository.get_by_key(public_key)
        labels = {"public_key": public_key, "name": contact.name if contact else ""}
        data = row.get("data") or {}
        timestamp = _number(row.get("timestamp"))
        if timestamp is not None:
            out.add(
                "rtfm_node_telemetry_age_seconds",
                max(0.0, now - timestamp),
                "Seconds since the newest telemetry of a tracked node",
                labels=labels,
            )
        for key, (metric, help_text) in _NODE_FIELDS.items():
            kind = "counter" if metric.endswith("_total") else "gauge"
            out.add(metric, data.get(key), help_text, kind=kind, labels=labels)
        for sensor in data.get("lpp_sensors") or []:
            if not isinstance(sensor, dict):
                continue
            out.add(
                "rtfm_node_sensor",
                sensor.get("value"),
                "LPP sensor reading of a tracked node",
                labels={
                    **labels,
                    "channel": sensor.get("channel", 0),
                    "sensor": sensor.get("type_name", "unknown"),
                },
            )


def _radio(out: _Writer) -> None:
    from app.services.radio_runtime import radio_runtime as radio_manager
    from app.services.radio_stats import get_latest_radio_stats

    out.add(
        "rtfm_radio_connected",
        bool(getattr(radio_manager, "is_connected", False)),
        "1 while a radio is connected",
    )
    queue_fn = getattr(radio_manager, "operation_queue", None)
    if callable(queue_fn):
        try:
            queue = queue_fn()
        except Exception:
            queue = None
        if isinstance(queue, dict):
            out.add(
                "rtfm_radio_operation_running",
                queue.get("holder") is not None,
                "1 while an operation holds the radio",
            )
            out.add(
                "rtfm_radio_operations_waiting",
                len(queue.get("waiting") or []),
                "Operations waiting for the radio",
            )
    stats = get_latest_radio_stats()
    for key, (metric, help_text) in _RADIO_STATS.items():
        kind = "counter" if metric.endswith("_total") else "gauge"
        out.add(metric, stats.get(key), help_text, kind=kind)
    packets = stats.get("packets") or {}
    out.add(
        "rtfm_radio_packets_received_total",
        packets.get("recv"),
        "Packets the radio received",
        kind="counter",
    )
    out.add(
        "rtfm_radio_packets_sent_total",
        packets.get("sent"),
        "Packets the radio sent",
        kind="counter",
    )


def _integrations(out: _Writer) -> None:
    from app.fanout.manager import fanout_manager

    for broker in fanout_manager.get_mqtt_stats():
        labels = {"name": broker.get("name", ""), "type": broker.get("type", "")}
        out.add(
            "rtfm_mqtt_connected",
            broker.get("status") == "connected",
            "1 while an MQTT integration is connected",
            labels=labels,
        )
        out.add(
            "rtfm_mqtt_messages_published_total",
            broker.get("messages_published"),
            "Messages an MQTT integration published",
            kind="counter",
            labels=labels,
        )
        out.add(
            "rtfm_mqtt_publish_failures_total",
            broker.get("publish_failures"),
            "Failed publishes of an MQTT integration",
            kind="counter",
            labels=labels,
        )
        out.add(
            "rtfm_mqtt_reconnects_total",
            broker.get("reconnects"),
            "Reconnects of an MQTT integration",
            kind="counter",
            labels=labels,
        )


async def build_metrics_text(now: float | None = None) -> str:
    """Every metric as Prometheus text. A section that fails is left out and logged."""
    from app.version_info import get_app_build_info

    out = _Writer()
    try:
        version = get_app_build_info().version
    except Exception:
        version = "unknown"
    out.add("rtfm_build_info", 1, "Build of RTFM-EV", labels={"version": version})
    _radio(out)
    try:
        await _stored_counts(out)
    except Exception:
        logger.warning("Metrics: stored counts failed", exc_info=True)
    try:
        await _node_telemetry(out, time.time() if now is None else now)
    except Exception:
        logger.warning("Metrics: node telemetry failed", exc_info=True)
    try:
        _integrations(out)
    except Exception:
        logger.warning("Metrics: integrations failed", exc_info=True)
    return out.render()
