"""A full radio queue at connect means messages heard while disconnected may be lost."""

from unittest.mock import patch

from app import radio_sync


def test_no_warning_below_the_queue_size():
    with patch.object(radio_sync, "broadcast_error") as warn:
        assert not radio_sync.warn_if_offline_queue_overflowed(0)
        assert not radio_sync.warn_if_offline_queue_overflowed(
            radio_sync.RADIO_OFFLINE_QUEUE_SIZE - 1
        )
    warn.assert_not_called()


def test_warns_when_the_drain_emptied_a_full_queue():
    with patch.object(radio_sync, "broadcast_error") as warn:
        assert radio_sync.warn_if_offline_queue_overflowed(radio_sync.RADIO_OFFLINE_QUEUE_SIZE)
    warn.assert_called_once()
    title, detail = warn.call_args.args
    assert title == "Some messages may be missing"
    assert "16 messages" in detail
