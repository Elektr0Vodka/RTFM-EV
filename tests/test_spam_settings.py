"""Spam Guard settings: tunables, presets, layering."""

from hashlib import sha256

import pytest
from pydantic import ValidationError

from app.spam.settings import PRESETS, ProtectedChannel, SpamConfig, SpamTunables, effective

PUBLIC = "8B3387E9C5CDEA6AC9E5EDBAA115CD72"


def test_defaults_are_the_balanced_preset():
    tun = SpamTunables()
    for key, value in PRESETS["balanced"].items():
        assert getattr(tun, key) == value
    assert tun.window_seconds == 600
    assert tun.long_window_seconds == 7200
    assert tun.block_ttl_seconds == 6 * 3600
    assert tun.hop_block_ttl_seconds == 2 * 3600
    assert tun.spam_text_days == 7
    assert tun.min_rule_chars == 14
    assert tun.text_rule_chars == 40
    assert tun.known_min_msgs == 1
    assert tun.known_days == 30
    assert tun.hold_links == "campaign"
    assert tun.hop_match_mode == "contains_known"
    assert tun.max_total_rules == 300
    assert tun.evidence_log is False


def test_config_starts_in_monitor():
    cfg = SpamConfig()
    assert cfg.mode == "monitor"
    assert cfg.paused is False
    assert cfg.sensitivity == "balanced"


@pytest.mark.parametrize("name", ["relaxed", "balanced", "strict"])
def test_preset_applies(name):
    tun = effective(SpamConfig(sensitivity=name))
    for key, value in PRESETS[name].items():
        assert getattr(tun, key) == value


def test_presets_cover_the_same_settings():
    assert set(PRESETS["relaxed"]) == set(PRESETS["balanced"]) == set(PRESETS["strict"])


def test_override_beats_preset():
    tun = effective(SpamConfig(sensitivity="strict", overrides={"similarity": 90}))
    assert tun.similarity == 90
    assert tun.text_distinct_senders == PRESETS["strict"]["text_distinct_senders"]


def test_unknown_override_rejected():
    with pytest.raises(ValidationError):
        SpamConfig(overrides={"no_such_setting": 1})


def test_out_of_range_override_rejected():
    with pytest.raises(ValidationError):
        SpamConfig(overrides={"similarity": 5})


def test_bad_name_pattern_rejected():
    with pytest.raises(ValidationError):
        SpamConfig(overrides={"random_name_patterns": ["("]})


def test_long_name_pattern_rejected():
    with pytest.raises(ValidationError):
        SpamConfig(overrides={"random_name_patterns": ["a" * 129]})


def test_allow_hops_normalised_and_validated():
    cfg = SpamConfig(allow_hops=["27", "0x27ab"])
    assert cfg.allow_hops == ["27", "27AB"]
    with pytest.raises(ValidationError):
        SpamConfig(allow_hops=["2"])


def test_channel_key_normalised():
    cfg = SpamConfig(channels=[{"key": "8b3387e9c5cdea6ac9e5edbaa115cd72", "name": "Public"}])
    assert cfg.channels[0].key == "8B3387E9C5CDEA6AC9E5EDBAA115CD72"
    with pytest.raises(ValidationError):
        SpamConfig(channels=[{"key": "nothex", "name": "x"}])


def test_short_allowed_text_rejected():
    with pytest.raises(ValidationError):
        SpamConfig(allow_texts=["ab"])


class TestKeySharing:
    """Whether a channel's key may be copied into an OpenHop node's policy file."""

    def test_public_and_hashtag_keys_are_public_knowledge(self):
        assert ProtectedChannel(key=PUBLIC, name="Public").key_is_public
        hashtag = sha256(b"#test").digest()[:16].hex()
        assert ProtectedChannel(key=hashtag, name="#test").key_is_public

    def test_a_private_key_is_not(self):
        assert not ProtectedChannel(key="AA" * 16, name="Club").key_is_public
        # A name that only looks like a hashtag does not make its key public.
        assert not ProtectedChannel(key="AA" * 16, name="#test").key_is_public

    def test_sharing_a_private_key_is_off_until_the_user_agrees(self):
        cfg = SpamConfig(
            channels=[
                {"key": PUBLIC, "name": "Public"},
                {"key": "AA" * 16, "name": "Club"},
                {"key": "BB" * 16, "name": "Team", "share_key": True},
            ]
        )
        assert [c.share_key for c in cfg.channels] == [False, False, True]
        assert cfg.shareable_channels() == {PUBLIC, "BB" * 16}
        assert [c.key for c in cfg.private_unshared_channels()] == ["AA" * 16]
