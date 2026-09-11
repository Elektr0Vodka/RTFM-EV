"""Pytest configuration and shared fixtures."""

import os
import shutil
import tempfile
from pathlib import Path

import httpx
import pytest

from app.database import Database

# Use an isolated file-backed SQLite DB for tests that import app.main/TestClient.
# This must be set before app.config/app.database are imported, otherwise the global
# Database instance will bind to the default runtime DB (data/meshcore.db).
_TEST_DB_DIR = Path(tempfile.mkdtemp(prefix="meshcore-pytest-"))
_TEST_DB_PATH = _TEST_DB_DIR / "meshcore.db"
os.environ.setdefault("MESHCORE_DATABASE_PATH", str(_TEST_DB_PATH))


@pytest.fixture(scope="session", autouse=True)
def cleanup_test_db_dir():
    """Clean up temporary pytest DB directory after the test session."""
    yield
    shutil.rmtree(_TEST_DB_DIR, ignore_errors=True)


@pytest.fixture(autouse=True)
def _reset_radio_stats_buffers():
    """Reset radio_stats' module-global in-memory deques before each test.

    ``_noise_floor_samples`` and ``_battery_samples`` are process-global state.
    Without a reset, a test that samples a snapshot (e.g. battery_mv=4100) leaks
    that value into any later test on the same xdist worker, e.g. the battery
    statistics endpoint would report the leaked sample as the latest reading.
    """
    from app.services import radio_stats

    radio_stats._noise_floor_samples.clear()
    radio_stats._battery_samples.clear()
    yield


@pytest.fixture
async def test_db():
    """Create an in-memory test database with schema + migrations."""
    from app.repository import (
        battery_history,
        channels,
        contact_telemetry,
        contacts,
        link_signal,
        messages,
        noise_floor,
        raw_packets,
        repeater_telemetry,
        settings,
    )
    from app.repository import fanout as fanout_repo

    db = Database(":memory:")
    await db.connect()

    submodules = [
        contacts,
        channels,
        messages,
        raw_packets,
        settings,
        fanout_repo,
        repeater_telemetry,
        contact_telemetry,
        noise_floor,
        battery_history,
        link_signal,
    ]
    originals = [(mod, mod.db) for mod in submodules]

    for mod in submodules:
        mod.db = db

    # Also patch the db reference used by the packets router for VACUUM
    import app.routers.packets as packets_module

    original_packets_db = packets_module.db
    packets_module.db = db

    try:
        yield db
    finally:
        for mod, original in originals:
            mod.db = original
        packets_module.db = original_packets_db
        await db.disconnect()


@pytest.fixture
def client():
    """Create an httpx AsyncClient for testing the app."""
    from app.main import app

    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


@pytest.fixture
def captured_broadcasts():
    """Capture WebSocket broadcasts for verification."""
    broadcasts = []

    def mock_broadcast(event_type: str, data: dict, **kwargs):
        broadcasts.append({"type": event_type, "data": data})

    return broadcasts, mock_broadcast
