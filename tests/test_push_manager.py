"""Web Push dispatch must honour the block lists like the live UI does."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.push.manager import PushManager

BLOCKED_KEY = "ab" * 32
OTHER_KEY = "cd" * 32
CHAN_KEY = "AA" * 16


def _settings(blocked_keys=(), blocked_names=(), hidden_hop_widths=()):
    return SimpleNamespace(
        blocked_keys=list(blocked_keys),
        blocked_names=list(blocked_names),
        hidden_hop_widths=list(hidden_hop_widths),
    )


async def _dispatch(data: dict, settings) -> AsyncMock:
    manager = PushManager()
    send_one = AsyncMock(return_value=None)
    state_key = (
        f"contact-{data['conversation_key']}"
        if data["type"] == "PRIV"
        else f"channel-{data['conversation_key']}"
    )
    with (
        patch(
            "app.push.manager.AppSettingsRepository.get_push_conversations",
            new_callable=AsyncMock,
            return_value=[state_key],
        ),
        patch(
            "app.push.manager.AppSettingsRepository.get",
            new_callable=AsyncMock,
            return_value=settings,
        ),
        patch(
            "app.push.manager.ChannelRepository.get_by_key",
            new_callable=AsyncMock,
            return_value=None,
        ),
        patch(
            "app.push.manager.PushSubscriptionRepository.get_all",
            new_callable=AsyncMock,
            return_value=[{"id": "s1", "endpoint": "https://x", "p256dh": "p", "auth": "a"}],
        ),
        patch("app.push.manager.get_vapid_private_key", return_value="key"),
        patch.object(manager, "_send_one", send_one),
    ):
        await manager.dispatch_message(data)
    return send_one


@pytest.mark.asyncio
async def test_blocked_dm_sender_gets_no_push():
    send = await _dispatch(
        {"type": "PRIV", "conversation_key": BLOCKED_KEY, "text": "hi", "outgoing": False},
        _settings(blocked_keys=[BLOCKED_KEY]),
    )
    send.assert_not_called()


@pytest.mark.asyncio
async def test_blocked_channel_sender_key_gets_no_push():
    send = await _dispatch(
        {
            "type": "CHAN",
            "conversation_key": CHAN_KEY,
            "sender_key": BLOCKED_KEY.upper(),
            "text": "Spammer: hi",
            "outgoing": False,
        },
        _settings(blocked_keys=[BLOCKED_KEY]),
    )
    send.assert_not_called()


@pytest.mark.asyncio
async def test_blocked_channel_sender_name_gets_no_push():
    send = await _dispatch(
        {
            "type": "CHAN",
            "conversation_key": CHAN_KEY,
            "sender_name": "Spammer",
            "text": "Spammer: hi",
            "outgoing": False,
        },
        _settings(blocked_names=["Spammer"]),
    )
    send.assert_not_called()


@pytest.mark.asyncio
async def test_unblocked_sender_still_pushed():
    send = await _dispatch(
        {"type": "PRIV", "conversation_key": OTHER_KEY, "text": "hi", "outgoing": False},
        _settings(blocked_keys=[BLOCKED_KEY], blocked_names=["Spammer"]),
    )
    send.assert_called_once()


def _chan_msg(paths: list[dict]) -> dict:
    return {
        "type": "CHAN",
        "conversation_key": CHAN_KEY,
        "sender_name": "Someone",
        "text": "Someone: hi",
        "outgoing": False,
        "paths": paths,
    }


@pytest.mark.asyncio
async def test_hop_hidden_channel_message_gets_no_push():
    # Two 1-byte hops: hidden when 1-byte widths are hidden.
    send = await _dispatch(
        _chan_msg([{"path": "a1b2", "path_len": 2, "received_at": 1}]),
        _settings(hidden_hop_widths=[1]),
    )
    send.assert_not_called()


@pytest.mark.asyncio
async def test_other_hop_width_still_pushed():
    # Two 2-byte hops are not hidden by a 1-byte filter.
    send = await _dispatch(
        _chan_msg([{"path": "a1b2c3d4", "path_len": 2, "received_at": 1}]),
        _settings(hidden_hop_widths=[1]),
    )
    send.assert_called_once()


@pytest.mark.asyncio
async def test_direct_message_without_hops_still_pushed():
    # A 0-hop (direct) path has no derivable width, so the filter never hides it.
    send = await _dispatch(
        _chan_msg([{"path": "", "path_len": 0, "received_at": 1}]),
        _settings(hidden_hop_widths=[1, 2, 3]),
    )
    send.assert_called_once()
