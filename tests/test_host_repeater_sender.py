"""The host repeater's ``channel_sender`` policy field for names the decoder rejects."""

import time

import pytest

from app.decoder import decrypt_group_text, parse_packet
from app.services.host_repeater import HostRepeaterRuntime, PreFacts, policy_channel_sender
from app.services.host_repeater_settings import HostRepeaterSettings, PolicyRule
from tests.test_host_repeater_api import snapshot
from tests.test_policy_verdict import PUBLIC, group_text_frame

BOT_RULE = PolicyRule.model_validate(
    {
        "id": "spam:bots:test",
        "name": "spam:bots:test (bot list)",
        "enabled": True,
        "if": {
            "all": [
                {"field": "payload_type", "op": "equals", "value": 5},
                {"field": "channel_sender", "op": "in", "value": ["[NU]", "PingBot"]},
            ]
        },
        "then": {"action": "drop"},
    }
)


def decoded(sender: str, text: str) -> dict:
    """What the packet processor hands the host repeater, from the real decoder."""
    packet = parse_packet(group_text_frame(sender, text))
    assert packet is not None
    message = decrypt_group_text(packet.payload, bytes.fromhex(PUBLIC))
    assert message is not None
    return {"decrypted": True, "sender": message.sender, "message": message.message}


def test_the_decoder_gives_no_sender_for_a_bracketed_name():
    assert decoded("[NU]", "nieuws") == {
        "decrypted": True,
        "sender": None,
        "message": "[NU]: nieuws",
    }


def test_a_bracketed_name_is_the_channel_sender():
    assert policy_channel_sender(decoded("[NU]", "nieuws")) == "[NU]"


def test_a_plain_name_is_unchanged():
    assert policy_channel_sender(decoded("Dave", "hello")) == "Dave"


def test_text_without_a_sender_has_none():
    assert (
        policy_channel_sender({"decrypted": True, "sender": None, "message": "no prefix"}) is None
    )
    assert policy_channel_sender({"decrypted": True, "sender": None, "message": None}) is None
    assert policy_channel_sender({}) is None


def test_a_colon_in_the_prefix_is_not_a_name():
    result = {"decrypted": True, "sender": None, "message": "a:b: text"}
    assert policy_channel_sender(result) is None


async def judge(sender: str, text: str):
    rt = HostRepeaterRuntime()
    rt.settings = HostRepeaterSettings(shadow_enabled=True)
    rt.engine.configure(settings=rt.settings)
    rt.engine.set_managed_rules([BOT_RULE], [])
    return await rt.observe(
        group_text_frame(sender, text),
        snr=5.0,
        rssi=-80,
        arrival=time.monotonic(),
        result=decoded(sender, text),
        pre=PreFacts(),
        radio=snapshot(bytes([0xAB]) + bytes(31)),
    )


@pytest.mark.asyncio
async def test_the_host_engine_drops_a_bracketed_bot(test_db):
    decision = await judge("[NU]", "nieuws van vandaag")
    assert decision is not None
    assert (decision.forward, decision.reason) == (False, "policy_drop")
    assert decision.policy_rule_id == "spam:bots:test"


@pytest.mark.asyncio
async def test_the_host_engine_lets_another_bracketed_name_through(test_db):
    decision = await judge("[PA3XYZ]", "goedemorgen")
    assert decision is not None and decision.reason != "policy_drop"
