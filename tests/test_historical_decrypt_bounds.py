"""Historical DM scans: no toast storm without a key, one scan per contact at a time."""

import asyncio
from unittest.mock import patch

import pytest

import app.packet_processor as pp

KEY = "ab" * 32


@pytest.fixture(autouse=True)
def _clear_pending():
    pp._historical_scans_pending.clear()
    yield
    pp._historical_scans_pending.clear()


@pytest.mark.asyncio
async def test_automatic_scan_without_a_key_does_not_warn_the_ui():
    with (
        patch.object(pp, "has_private_key", return_value=False),
        patch.object(pp, "broadcast_error") as warn,
    ):
        await pp.start_historical_dm_decryption(None, KEY, "Alice", automatic=True)
    warn.assert_not_called()


@pytest.mark.asyncio
async def test_requested_scan_without_a_key_still_warns():
    with (
        patch.object(pp, "has_private_key", return_value=False),
        patch.object(pp, "broadcast_error") as warn,
    ):
        await pp.start_historical_dm_decryption(None, KEY, "Alice")
    warn.assert_called_once()


@pytest.mark.asyncio
async def test_a_contact_already_queued_is_not_queued_again():
    started = asyncio.Event()
    release = asyncio.Event()
    runs: list[str] = []

    async def fake_scan(_priv, _pub, key, _name=None):
        runs.append(key)
        started.set()
        await release.wait()

    with (
        patch.object(pp, "has_private_key", return_value=True),
        patch.object(pp, "get_private_key", return_value=b"\x01" * 64),
        patch.object(pp, "run_historical_dm_decryption", side_effect=fake_scan),
    ):
        await pp.start_historical_dm_decryption(None, KEY, "Alice")
        await started.wait()
        await pp.start_historical_dm_decryption(None, KEY, "Alice")
        release.set()
        for _ in range(5):
            await asyncio.sleep(0)
        assert runs == [KEY]
        assert KEY not in pp._historical_scans_pending
