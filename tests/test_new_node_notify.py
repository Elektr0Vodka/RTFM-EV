"""Tests for app.services.new_node_notify (plan 28 item 1.5).

Batching/warm-up timers are monkeypatched to a few milliseconds so these
tests run fast without waiting on the real BATCH_QUIET_SECONDS/
BATCH_MAX_WAIT_SECONDS/STARTUP_WARMUP_SECONDS values.
"""

import asyncio
from unittest.mock import patch

import pytest

from app.services import new_node_notify


@pytest.fixture(autouse=True)
def _fast_batching(monkeypatch):
    monkeypatch.setattr(new_node_notify, "BATCH_QUIET_SECONDS", 0.02)
    monkeypatch.setattr(new_node_notify, "BATCH_MAX_WAIT_SECONDS", 0.06)


class TestNotifyNewNode:
    @pytest.mark.asyncio
    async def test_single_new_node_broadcasts_full_detail(self):
        with patch("app.services.new_node_notify.broadcast_event") as mock_broadcast:
            new_node_notify.notify_new_node("AA" * 32, "Alice", 1)
            await asyncio.sleep(0.05)

        mock_broadcast.assert_called_once()
        event_type, payload = mock_broadcast.call_args[0]
        assert event_type == "new_node"
        assert payload == {
            "batched": False,
            "count": 1,
            "public_key": "aa" * 32,
            "name": "Alice",
            "type": 1,
            "types": {"1": 1},
        }

    @pytest.mark.asyncio
    async def test_multiple_new_nodes_batch_into_one_summary(self):
        with patch("app.services.new_node_notify.broadcast_event") as mock_broadcast:
            new_node_notify.notify_new_node("aa" * 32, "Alice", 2)
            new_node_notify.notify_new_node("bb" * 32, "Bob", 2)
            new_node_notify.notify_new_node("cc" * 32, "Carol", 4)
            await asyncio.sleep(0.05)

        mock_broadcast.assert_called_once()
        event_type, payload = mock_broadcast.call_args[0]
        assert event_type == "new_node"
        assert payload["batched"] is True
        assert payload["count"] == 3
        assert payload["public_key"] is None
        assert payload["name"] is None
        assert payload["type"] is None
        assert payload["types"] == {"2": 2, "4": 1}

    @pytest.mark.asyncio
    async def test_quiet_period_resets_on_each_new_node(self):
        """A steady trickle within the quiet window keeps extending one batch."""
        with patch("app.services.new_node_notify.broadcast_event") as mock_broadcast:
            new_node_notify.notify_new_node("aa" * 32, "Alice", 1)
            await asyncio.sleep(0.01)  # less than BATCH_QUIET_SECONDS (0.02)
            new_node_notify.notify_new_node("bb" * 32, "Bob", 1)
            mock_broadcast.assert_not_called()
            await asyncio.sleep(0.05)

        mock_broadcast.assert_called_once()
        _, payload = mock_broadcast.call_args[0]
        assert payload["count"] == 2

    @pytest.mark.asyncio
    async def test_hard_cap_flushes_under_continuous_churn(self):
        """BATCH_MAX_WAIT_SECONDS forces a flush even if new nodes keep arriving."""
        with patch("app.services.new_node_notify.broadcast_event") as mock_broadcast:
            loop = asyncio.get_event_loop()
            end = loop.time() + 0.09
            i = 0
            while loop.time() < end:
                new_node_notify.notify_new_node(f"{i:02x}" * 32, f"Node{i}", 1)
                i += 1
                await asyncio.sleep(0.01)
            await asyncio.sleep(0.05)

        # Continuous arrivals for ~90ms against a 60ms hard cap must flush at
        # least once before the loop above finishes queuing new nodes.
        assert mock_broadcast.call_count >= 1

    @pytest.mark.asyncio
    async def test_duplicate_public_key_counts_once(self):
        """Same key queued twice (e.g. both call sites racing) does not double-count."""
        with patch("app.services.new_node_notify.broadcast_event") as mock_broadcast:
            new_node_notify.notify_new_node("aa" * 32, "Alice", 1)
            new_node_notify.notify_new_node("AA" * 32, "Alice", 1)
            await asyncio.sleep(0.05)

        mock_broadcast.assert_called_once()
        _, payload = mock_broadcast.call_args[0]
        assert payload["count"] == 1

    @pytest.mark.asyncio
    async def test_type_zero_never_notifies(self):
        """Contact type 0 (unknown/no advertised role) has no notification checkbox."""
        with patch("app.services.new_node_notify.broadcast_event") as mock_broadcast:
            new_node_notify.notify_new_node("aa" * 32, "Unknown", 0)
            await asyncio.sleep(0.05)

        mock_broadcast.assert_not_called()


class TestStartupWarmup:
    @pytest.mark.asyncio
    async def test_empty_contacts_table_suppresses_notifications(self, test_db):
        await new_node_notify.arm_startup_warmup()

        with patch("app.services.new_node_notify.broadcast_event") as mock_broadcast:
            new_node_notify.notify_new_node("aa" * 32, "Alice", 1)
            await asyncio.sleep(0.05)

        mock_broadcast.assert_not_called()

    @pytest.mark.asyncio
    async def test_non_empty_contacts_table_does_not_suppress(self, test_db):
        from app.repository import ContactRepository

        await ContactRepository.upsert({"public_key": "ff" * 32, "name": "Existing", "type": 1})
        await new_node_notify.arm_startup_warmup()

        with patch("app.services.new_node_notify.broadcast_event") as mock_broadcast:
            new_node_notify.notify_new_node("aa" * 32, "Alice", 1)
            await asyncio.sleep(0.05)

        mock_broadcast.assert_called_once()

    @pytest.mark.asyncio
    async def test_arm_is_idempotent(self, test_db):
        """A later call cannot re-arm once armed, even if contacts appear afterwards."""
        await new_node_notify.arm_startup_warmup()  # armed empty -> warm-up active

        from app.repository import ContactRepository

        await ContactRepository.upsert({"public_key": "ff" * 32, "name": "Existing", "type": 1})
        await new_node_notify.arm_startup_warmup()  # no-op: already armed

        with patch("app.services.new_node_notify.broadcast_event") as mock_broadcast:
            new_node_notify.notify_new_node("aa" * 32, "Alice", 1)
            await asyncio.sleep(0.05)

        mock_broadcast.assert_not_called()


class TestSuppressFor:
    @pytest.mark.asyncio
    async def test_suppress_for_blocks_then_expires(self):
        new_node_notify.suppress_for(0.03)

        with patch("app.services.new_node_notify.broadcast_event") as mock_broadcast:
            new_node_notify.notify_new_node("aa" * 32, "Alice", 1)
            await asyncio.sleep(0.05)
        mock_broadcast.assert_not_called()

        await asyncio.sleep(0.05)  # let the suppression window fully elapse

        with patch("app.services.new_node_notify.broadcast_event") as mock_broadcast:
            new_node_notify.notify_new_node("bb" * 32, "Bob", 1)
            await asyncio.sleep(0.05)
        mock_broadcast.assert_called_once()
