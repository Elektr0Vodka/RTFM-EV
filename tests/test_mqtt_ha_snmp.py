"""Home Assistant MQTT fanout: SNMP sensors of tracked repeaters."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.fanout.manager import fanout_manager
from app.fanout.mqtt_ha import (
    _SNMP_SENSORS,
    MqttHaModule,
    _node_id,
    _snmp_discovery_configs,
    _snmp_state_payload,
)
from app.models import ContactSnmpConfigUpdate
from app.repository import ContactRepository
from app.repository.contact_snmp import SnmpHistoryRepository
from app.routers.snmp import poll_snmp, put_snmp_config
from app.snmp import mib

KEY = "ccdd112233445566778899aabbccddeeff00112233445566778899aabbccddee"
RADIO = "aabbccddeeff"


def _config(**overrides) -> dict:
    cfg = {
        "broker_host": "127.0.0.1",
        "broker_port": 1883,
        "username": "",
        "password": "",
        "use_tls": False,
        "tls_insecure": False,
        "topic_prefix": "meshcore",
        "tracked_contacts": [],
        "tracked_repeaters": [],
    }
    cfg.update(overrides)
    return cfg


def _module(**overrides) -> MqttHaModule:
    mod = MqttHaModule("test", _config(**overrides))
    mod._radio_key = RADIO
    mod._publisher = MagicMock()
    mod._publisher.connected = True
    mod._publisher.publish = AsyncMock()
    mod._clear_retained_topics = AsyncMock()
    return mod


def _published(mod) -> list[tuple[str, dict, bool]]:
    return [
        (call.args[0], call.args[1], call.kwargs.get("retain") is True)
        for call in mod._publisher.publish.call_args_list
    ]


class TestSnmpSensorTable:
    def test_one_sensor_per_oid_table_entry(self):
        assert [s["field"] for s in _SNMP_SENSORS] == [e.key for e in mib.ENTRIES]
        assert len({s["object_id"] for s in _SNMP_SENSORS}) == 22
        assert all(s["object_id"].startswith("snmp_") for s in _SNMP_SENSORS)

    def test_sensor_classes(self):
        by = {s["field"]: s for s in _SNMP_SENSORS}
        assert by["wifi_rssi"]["device_class"] == "signal_strength"
        assert by["wifi_rssi"]["unit"] == "dBm"
        assert by["free_heap"]["device_class"] == "data_size"
        assert by["free_heap"]["state_class"] == "measurement"
        assert by["packets_recv"]["state_class"] == "total_increasing"
        assert by["mqtt_queue_depth"]["state_class"] == "measurement"
        assert by["uptime_secs"]["device_class"] == "duration"
        assert by["uptime_secs"]["state_class"] is None
        assert by["total_air_time_secs"]["state_class"] == "total_increasing"
        assert by["last_snr"]["unit"] == "dB"
        # Text values are plain sensors without a statistics class.
        assert by["node_name"]["state_class"] is None
        assert by["firmware_version"]["unit"] is None

    def test_discovery_configs(self):
        configs = _snmp_discovery_configs("meshcore", KEY, "Obs", RADIO, expire_after=900)
        assert len(configs) == 22
        nid = _node_id(KEY)
        topic, cfg = configs[0]
        assert topic == f"homeassistant/sensor/meshcore_{nid}/snmp_uptime_secs/config"
        assert cfg["unique_id"] == f"meshcore_{nid}_snmp_uptime_secs"
        assert cfg["state_topic"] == f"meshcore/{nid}/snmp"
        assert cfg["value_template"] == "{{ value_json.uptime_secs }}"
        assert cfg["expire_after"] == 900
        # Same HA device as the repeater's telemetry sensors.
        assert cfg["device"]["identifiers"] == [f"meshcore_{nid}"]

    def test_no_expiry_for_a_node_polled_by_hand_only(self):
        configs = _snmp_discovery_configs("meshcore", KEY, "Obs", RADIO, expire_after=None)
        assert all("expire_after" not in cfg for _, cfg in configs)

    def test_state_payload_leaves_out_missing_values_and_unknown_keys(self):
        payload = _snmp_state_payload(
            {"free_heap": 199612, "psram_free": None, "last_snr": -7.5, "host": "10.0.0.1"}
        )
        assert payload == {"free_heap": 199612, "last_snr": -7.5}


class TestOnSnmp:
    @pytest.mark.asyncio
    async def test_ignores_untracked_and_disconnected(self):
        mod = _module(tracked_repeaters=["other"])
        await mod.on_snmp({"public_key": KEY, "timestamp": 1, "values": {"free_heap": 1}})
        mod._publisher.publish.assert_not_called()

        mod = _module(tracked_repeaters=[KEY])
        mod._publisher.connected = False
        await mod.on_snmp({"public_key": KEY, "timestamp": 1, "values": {"free_heap": 1}})
        mod._publisher.publish.assert_not_called()

    @pytest.mark.asyncio
    async def test_publishes_state_on_the_snmp_topic_not_retained(self):
        mod = _module(tracked_repeaters=[KEY])
        # Sensors already discovered: no rediscovery, just the state.
        mod._discovery_topics = [
            f"homeassistant/sensor/meshcore_{_node_id(KEY)}/snmp_uptime_secs/config"
        ]
        mod._publish_discovery = AsyncMock()

        await mod.on_snmp(
            {"public_key": KEY, "timestamp": 1, "values": {"free_heap": 199612, "psram_free": None}}
        )

        mod._publish_discovery.assert_not_awaited()
        assert _published(mod) == [(f"meshcore/{_node_id(KEY)}/snmp", {"free_heap": 199612}, False)]

    @pytest.mark.asyncio
    async def test_first_poll_publishes_discovery_before_state(self, test_db):
        await ContactRepository.upsert({"public_key": KEY, "name": "Obs", "type": 2, "flags": 0})
        await put_snmp_config(
            KEY,
            ContactSnmpConfigUpdate(host="10.0.0.1", poll_enabled=True, poll_interval_minutes=5),
        )
        mod = _module(tracked_repeaters=[KEY])

        await mod.on_snmp({"public_key": KEY, "timestamp": 1, "values": {"free_heap": 199612}})

        published = _published(mod)
        nid = _node_id(KEY)
        snmp_config_index = next(
            i for i, (topic, _, _) in enumerate(published) if "/snmp_free_heap/config" in topic
        )
        state_index = max(
            i for i, (topic, _, _) in enumerate(published) if topic == f"meshcore/{nid}/snmp"
        )
        assert snmp_config_index < state_index
        topic, cfg, retained = published[snmp_config_index]
        assert retained is True
        # Scheduled every 5 minutes: unavailable after 3 missed polls.
        assert cfg["expire_after"] == 900
        assert published[state_index][1] == {"free_heap": 199612}
        # A second poll does not rediscover.
        before = len(published)
        await mod.on_snmp({"public_key": KEY, "timestamp": 2, "values": {"free_heap": 1}})
        assert len(_published(mod)) == before + 1


class TestDiscoveryWithSnmp:
    @pytest.mark.asyncio
    async def test_tracked_repeater_without_snmp_gets_no_snmp_sensors(self, test_db):
        await ContactRepository.upsert({"public_key": KEY, "name": "Obs", "type": 2, "flags": 0})
        mod = _module(tracked_repeaters=[KEY])
        await mod._publish_discovery()
        assert not any("/snmp_" in topic for topic in mod._discovery_topics)

    @pytest.mark.asyncio
    async def test_snmp_sensors_and_cached_state_for_a_configured_repeater(self, test_db):
        await ContactRepository.upsert({"public_key": KEY, "name": "Obs", "type": 2, "flags": 0})
        # Polled by hand only: no schedule, so no expiry.
        await put_snmp_config(KEY, ContactSnmpConfigUpdate(host="10.0.0.1", community="s3cret"))
        await SnmpHistoryRepository.record(KEY, 100, {"free_heap": 1})
        await SnmpHistoryRepository.record(KEY, 200, {"free_heap": 2, "wifi_rssi": -22})
        mod = _module(tracked_repeaters=[KEY])

        await mod._publish_discovery()

        snmp_topics = [t for t in mod._discovery_topics if "/snmp_" in t]
        assert len(snmp_topics) == 22
        published = _published(mod)
        configs = [(t, p) for t, p, retained in published if "/snmp_" in t and retained]
        assert all("expire_after" not in cfg for _, cfg in configs)
        # The newest stored poll is replayed after the configs, not retained.
        state = [(i, p, r) for i, (t, p, r) in enumerate(published) if t.endswith("/snmp")]
        assert [(p, r) for _, p, r in state] == [({"free_heap": 2, "wifi_rssi": -22}, False)]
        last_config = max(i for i, (t, _, _) in enumerate(published) if t.endswith("/config"))
        assert state[0][0] > last_config
        # The address and community never reach the broker.
        assert "s3cret" not in repr(published)
        assert "10.0.0.1" not in repr(published)

    @pytest.mark.asyncio
    async def test_removing_snmp_clears_its_discovery_topics(self, test_db):
        from app.routers.snmp import delete_snmp_config

        await ContactRepository.upsert({"public_key": KEY, "name": "Obs", "type": 2, "flags": 0})
        await put_snmp_config(KEY, ContactSnmpConfigUpdate(host="10.0.0.1"))
        mod = _module(tracked_repeaters=[KEY])
        await mod._publish_discovery()
        assert any("/snmp_" in t for t in mod._discovery_topics)

        await delete_snmp_config(KEY)
        await mod._publish_discovery()

        assert not any("/snmp_" in t for t in mod._discovery_topics)
        cleared = mod._clear_retained_topics.call_args[0][0]
        assert len([t for t in cleared if "/snmp_" in t]) == 22


class TestPollReachesFanout:
    @pytest.mark.asyncio
    async def test_good_poll_is_broadcast_without_address_or_community(self, test_db):
        await ContactRepository.upsert({"public_key": KEY, "name": "Obs", "type": 2, "flags": 0})
        await put_snmp_config(KEY, ContactSnmpConfigUpdate(host="10.0.0.1", community="s3cret"))
        values = {entry.key: 1 for entry in mib.ENTRIES}

        with (
            patch(
                "app.services.snmp_poll.poll_meshcore", new_callable=AsyncMock, return_value=values
            ),
            patch.object(fanout_manager, "broadcast_snmp", new_callable=AsyncMock) as broadcast,
        ):
            response = await poll_snmp(KEY)
            await asyncio.sleep(0)  # let the fire-and-forget task run

        broadcast.assert_awaited_once()
        event = broadcast.await_args.args[0]
        assert event == {"public_key": KEY, "timestamp": response.timestamp, "values": values}
        assert "s3cret" not in repr(event)
        assert "10.0.0.1" not in repr(event)

    @pytest.mark.asyncio
    async def test_failed_poll_is_not_broadcast(self, test_db):
        from app.snmp.client import SnmpTimeoutError

        await ContactRepository.upsert({"public_key": KEY, "name": "Obs", "type": 2, "flags": 0})
        await put_snmp_config(KEY, ContactSnmpConfigUpdate(host="10.0.0.1"))

        with (
            patch(
                "app.services.snmp_poll.poll_meshcore",
                new_callable=AsyncMock,
                side_effect=SnmpTimeoutError("no reply"),
            ),
            patch.object(fanout_manager, "broadcast_snmp", new_callable=AsyncMock) as broadcast,
        ):
            await poll_snmp(KEY)
            await asyncio.sleep(0)

        broadcast.assert_not_awaited()
