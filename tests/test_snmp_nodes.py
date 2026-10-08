"""SNMP overview API: every contact with SNMP set up, for the Tools > SNMP page.

Read-only. Nothing here polls, and nothing can reach RF or the network.
"""

import json
from unittest.mock import MagicMock, patch

import pytest

from app.models import ContactSnmpConfigUpdate
from app.repository import ContactRepository
from app.repository.contact_snmp import ContactSnmpRepository, SnmpHistoryRepository
from app.routers.snmp import get_snmp_nodes, put_snmp_config

KEY_A = "aa" * 32
KEY_B = "bb" * 32
KEY_C = "cc" * 32
SECRET = "s3cret-community"


async def _insert_contact(key: str, name: str | None, contact_type: int = 2):
    await ContactRepository.upsert(
        {"public_key": key, "name": name, "type": contact_type, "flags": 0}
    )


class TestNodesOverview:
    @pytest.mark.asyncio
    async def test_empty_when_no_contact_has_snmp(self, test_db):
        await _insert_contact(KEY_A, "Observer")
        assert await get_snmp_nodes() == []

    @pytest.mark.asyncio
    async def test_lists_only_configured_contacts_with_name_type_and_settings(self, test_db):
        await _insert_contact(KEY_A, "Zulu", contact_type=2)
        await _insert_contact(KEY_B, "alpha", contact_type=3)
        await _insert_contact(KEY_C, "No SNMP")
        await put_snmp_config(
            KEY_A,
            ContactSnmpConfigUpdate(
                host="192.168.50.95", port=1161, poll_enabled=True, poll_interval_minutes=15
            ),
        )
        await put_snmp_config(KEY_B, ContactSnmpConfigUpdate(host="node.lan"))

        nodes = await get_snmp_nodes()

        # Sorted by name, case-insensitive; the unconfigured contact is left out.
        assert [node.public_key for node in nodes] == [KEY_B, KEY_A]
        alpha, zulu = nodes
        assert (alpha.name, alpha.type) == ("alpha", 3)
        assert (alpha.host, alpha.port) == ("node.lan", 161)
        assert (alpha.poll_enabled, alpha.poll_interval_minutes) == (False, 5)
        assert (zulu.name, zulu.type) == ("Zulu", 2)
        assert (zulu.host, zulu.port) == ("192.168.50.95", 1161)
        assert (zulu.poll_enabled, zulu.poll_interval_minutes) == (True, 15)

    @pytest.mark.asyncio
    async def test_carries_the_poll_outcome_and_the_newest_stored_values(self, test_db):
        await _insert_contact(KEY_A, "Good")
        await _insert_contact(KEY_B, "Failing")
        await put_snmp_config(KEY_A, ContactSnmpConfigUpdate(host="10.0.0.1"))
        await put_snmp_config(KEY_B, ContactSnmpConfigUpdate(host="10.0.0.2"))
        await SnmpHistoryRepository.record(KEY_A, 1700000000, {"free_heap": 1})
        await SnmpHistoryRepository.record(KEY_A, 1700000600, {"free_heap": 2, "node_name": "Obs"})
        await ContactSnmpRepository.record_ok(KEY_A, 1700000600)
        await ContactSnmpRepository.record_error(KEY_B, 1700000700, "No reply from 10.0.0.2")

        failing, good = await get_snmp_nodes()

        assert good.last_ok_at == 1700000600
        assert (good.last_error, good.last_error_at) == (None, None)
        assert good.latest is not None
        assert good.latest.timestamp == 1700000600
        assert good.latest.values == {"free_heap": 2, "node_name": "Obs"}

        assert failing.last_ok_at is None
        assert failing.last_error == "No reply from 10.0.0.2"
        assert failing.last_error_at == 1700000700
        assert failing.latest is None

    @pytest.mark.asyncio
    async def test_a_node_that_now_fails_keeps_its_last_good_values(self, test_db):
        await _insert_contact(KEY_A, "Flaky")
        await put_snmp_config(KEY_A, ContactSnmpConfigUpdate(host="10.0.0.1"))
        await SnmpHistoryRepository.record(KEY_A, 1700000000, {"free_heap": 7})
        await ContactSnmpRepository.record_ok(KEY_A, 1700000000)
        await ContactSnmpRepository.record_error(KEY_A, 1700000300, "timeout")

        (node,) = await get_snmp_nodes()

        assert (node.last_ok_at, node.last_error) == (1700000000, "timeout")
        assert node.latest is not None
        assert node.latest.values == {"free_heap": 7}

    @pytest.mark.asyncio
    async def test_never_touches_the_radio(self, test_db):
        await _insert_contact(KEY_A, "Observer")
        await put_snmp_config(KEY_A, ContactSnmpConfigUpdate(host="10.0.0.1"))
        radio = MagicMock()
        with (
            patch("app.routers.snmp.radio_manager", radio),
            patch("app.routers.snmp.poll_contact") as poll,
            patch("app.routers.snmp.batch_cli_fetch") as cli,
        ):
            assert len(await get_snmp_nodes()) == 1
        assert radio.mock_calls == []
        poll.assert_not_called()
        cli.assert_not_called()


class TestCommunityStaysPrivate:
    @pytest.mark.asyncio
    async def test_model_has_no_community_and_flags_the_default(self, test_db):
        await _insert_contact(KEY_A, "Custom")
        await _insert_contact(KEY_B, "Default")
        await put_snmp_config(KEY_A, ContactSnmpConfigUpdate(host="10.0.0.1", community=SECRET))
        await put_snmp_config(KEY_B, ContactSnmpConfigUpdate(host="10.0.0.2"))

        custom, default = await get_snmp_nodes()

        assert custom.community_is_default is False
        assert default.community_is_default is True
        for node in (custom, default):
            assert SECRET not in node.model_dump_json()
            assert "community" not in set(node.model_dump()) - {"community_is_default"}

    @pytest.mark.asyncio
    async def test_http_response_does_not_contain_the_community(self, test_db, client):
        await _insert_contact(KEY_A, "Custom")
        await put_snmp_config(KEY_A, ContactSnmpConfigUpdate(host="10.0.0.1", community=SECRET))
        await SnmpHistoryRepository.record(KEY_A, 1700000000, {"free_heap": 1})
        # The secret is really stored, so its absence below is not a false pass.
        assert (await ContactSnmpRepository.get(KEY_A))["community"] == SECRET

        async with client:
            response = await client.get("/api/snmp/nodes")

        assert response.status_code == 200
        assert SECRET not in response.text
        (node,) = json.loads(response.text)
        assert node["public_key"] == KEY_A
        assert node["community_is_default"] is False
        assert [key for key in node if "community" in key] == ["community_is_default"]

    @pytest.mark.asyncio
    async def test_repository_overview_rows_do_not_carry_the_community(self, test_db):
        await _insert_contact(KEY_A, "Custom")
        await put_snmp_config(KEY_A, ContactSnmpConfigUpdate(host="10.0.0.1", community=SECRET))

        (row,) = await ContactSnmpRepository.list_overview(default_community="public")

        assert "community" not in row
        assert SECRET not in json.dumps(row)
        assert row["community_is_default"] is False
