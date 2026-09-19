"""The raw-packet retention prune task honors raw_packet_retention_days."""

import time

import pytest

from app.repository import AppSettingsRepository
from app.repository.raw_packets import RawPacketRepository
from app.services import raw_packet_pruner


@pytest.mark.asyncio
async def test_prune_once_noop_when_retention_zero(test_db):
    # Default is 0 (keep forever): even old rows survive.
    old = int(time.time()) - 40 * 86400
    await RawPacketRepository.create(b"\x01old", old)
    assert await raw_packet_pruner.prune_once() == 0


@pytest.mark.asyncio
async def test_prune_once_deletes_when_configured(test_db):
    old = int(time.time()) - 40 * 86400
    recent = int(time.time())
    await RawPacketRepository.create(b"\x01old", old)
    await RawPacketRepository.create(b"\x02recent", recent)
    await AppSettingsRepository.update(raw_packet_retention_days=30)

    assert await raw_packet_pruner.prune_once() == 1
