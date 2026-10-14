"""Why a channel message is malformed (the cause behind ``messages.malformed``)."""

from app.malformed import (
    MESHCORE_DEFAULT_RTC_EPOCH,
    is_malformed_channel_message,
    malformed_reason,
)

NOW = 1_800_000_000
GIBBERISH = "ŧ¸£Δ₁"
DEFAULT_CLOCK = MESHCORE_DEFAULT_RTC_EPOCH + 60


def test_names_the_cause():
    assert malformed_reason(GIBBERISH, NOW, NOW) == "text"
    assert malformed_reason("hello", DEFAULT_CLOCK, NOW) == "clock"
    assert malformed_reason(GIBBERISH, DEFAULT_CLOCK, NOW) == "both"
    assert malformed_reason("hello", NOW, NOW) is None


def test_agrees_with_the_flag():
    cases = [(GIBBERISH, NOW), ("hello", DEFAULT_CLOCK), (GIBBERISH, DEFAULT_CLOCK), ("hello", NOW)]
    for body, sent in cases:
        flagged = is_malformed_channel_message(body, sent, NOW)
        assert (malformed_reason(body, sent, NOW) is not None) is flagged
