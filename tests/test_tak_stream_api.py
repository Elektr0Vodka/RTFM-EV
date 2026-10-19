"""GET /api/tak-stream/status and the tracker -> stream hook."""

import time

import pytest

from app.models import TrackerPosition
from app.services import trackers
from app.tak_stream.server import tak_stream


@pytest.mark.asyncio
async def test_status_off_when_disabled(test_db, client):
    response = await client.get("/api/tak-stream/status")
    assert response.status_code == 200
    assert response.json() == {"enabled": False, "host": None, "port": None, "clients": 0}


def test_stream_listens_to_stored_trackers(monkeypatch):
    seen: list[TrackerPosition] = []
    monkeypatch.setattr(tak_stream, "publish_tracker", seen.append)
    monkeypatch.setattr(trackers, "broadcast_event", lambda *a, **k: None)
    pos = TrackerPosition(
        source="atak", identity="A", lat=1.0, lon=2.0, received_at=int(time.time())
    )
    trackers._publish("position", pos, True)
    assert seen == [pos]
    trackers._publish("position", pos, False)  # historical decryption: not streamed
    assert seen == [pos]
