"""The radio's "contact table full" push warns the UI, at most once an hour."""

from types import SimpleNamespace
from unittest.mock import patch

import app.event_handlers as event_handlers


def test_warns_once_then_stays_quiet(monkeypatch):
    monkeypatch.setattr(event_handlers, "_contacts_full_warned_at", None)
    now = [100.0]
    monkeypatch.setattr(event_handlers.time, "monotonic", lambda: now[0])

    with patch.object(event_handlers, "broadcast_error") as warn:
        event_handlers.on_contacts_full(SimpleNamespace(payload={}))
        event_handlers.on_contacts_full(SimpleNamespace(payload={}))
        assert warn.call_count == 1

        now[0] += event_handlers.CONTACTS_FULL_WARN_INTERVAL_SECONDS + 1
        event_handlers.on_contacts_full(SimpleNamespace(payload={}))
        assert warn.call_count == 2
