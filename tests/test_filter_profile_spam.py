"""Tests for Spam Guard as a kind of filter profile."""

import pytest

from app.filter_profiles.kinds import ProfileError
from app.repository import ChannelRepository
from app.services import spam_guard as spam_guard_module
from app.services.filter_profile_spam import KIND, LOCAL_KEYS, SpamGuardProfiles
from app.services.host_repeater import HostRepeaterRuntime
from app.services.spam_backend_host import HostBackend
from app.services.spam_guard import REFUSALS, SpamGuardRuntime
from app.spam.settings import PRESETS, SpamConfig

PUBLIC = "8B3387E9C5CDEA6AC9E5EDBAA115CD72"
STRICT = {"mode": "protect", "sensitivity": "strict", "overrides": {"dedupe_seconds": 3600}}


@pytest.fixture
async def runtime(test_db, monkeypatch):
    rt = SpamGuardRuntime()
    rt.host = HostBackend(HostRepeaterRuntime())
    monkeypatch.setattr(spam_guard_module, "spam_guard", rt)
    monkeypatch.setattr(spam_guard_module, "broadcast_event", lambda *args, **kwargs: None)
    await ChannelRepository.upsert(key=PUBLIC, name="Public")
    await rt.load()
    await rt.set_enabled(True)
    yield rt
    await rt.stop()


def live(**fields) -> SpamConfig:
    return SpamConfig(channels=[{"key": PUBLIC, "name": "Public"}], **fields)


async def save(rt: SpamGuardRuntime, config: SpamConfig) -> None:
    assert await rt.save_config(rt.version, config) is not None


def test_the_kind_name():
    assert SpamGuardProfiles.kind == KIND == "spam_guard"
    assert set(LOCAL_KEYS) == {"evidence_log", "evidence_days"}


def test_validate_returns_the_stored_form():
    kind = SpamGuardProfiles()
    assert kind.validate(STRICT) == STRICT
    assert kind.validate({"mode": "monitor", "sensitivity": "relaxed"}) == {
        "mode": "monitor",
        "sensitivity": "relaxed",
        "overrides": {},
    }


def test_a_profile_saved_with_an_old_rule_ceiling_still_applies():
    clean = SpamGuardProfiles().validate({**STRICT, "overrides": {"max_total_rules": 2000}})
    assert clean["overrides"] == {"max_total_rules": 500}


def test_validate_stores_values_as_the_settings_read_them():
    # A hand-edited file: pydantic takes 1 for a switch and "80" for a number.
    # Stored as written, the settings form would show the switch as off.
    clean = SpamGuardProfiles().validate(
        {**STRICT, "overrides": {"malformed_signal": 1, "similarity": "80"}}
    )
    assert clean["overrides"] == {"malformed_signal": True, "similarity": 80}
    assert clean["overrides"]["malformed_signal"] is True
    assert type(clean["overrides"]["similarity"]) is int


@pytest.mark.parametrize(
    ("payload", "says"),
    [
        ({**STRICT, "channels": []}, "channels"),
        ({**STRICT, "paused": True}, "paused"),
        ({**STRICT, "allow_senders": ["Sue"]}, "allow_senders"),
        ({"sensitivity": "strict"}, "mode"),
        ({**STRICT, "mode": "lockdown"}, "mode"),
        ({**STRICT, "sensitivity": "paranoid"}, "sensitivity"),
        ({**STRICT, "overrides": {"evidence_log": True}}, "evidence_log"),
        ({**STRICT, "overrides": {"evidence_days": 3}}, "evidence_days"),
        ({**STRICT, "overrides": {"no_such_setting": 1}}, "no_such_setting"),
        ({**STRICT, "overrides": {"similarity": 5}}, "similarity"),
        ({**STRICT, "overrides": {"random_name_patterns": ["("]}}, "name pattern"),
        ({**STRICT, "overrides": [1]}, "overrides"),
    ],
)
def test_validate_refuses(payload, says):
    with pytest.raises(ValueError) as caught:
        SpamGuardProfiles().validate(payload)
    assert not isinstance(caught.value, ProfileError)
    assert says in str(caught.value)


@pytest.mark.asyncio
async def test_capture_leaves_out_what_a_profile_never_holds(runtime):
    await save(
        runtime,
        live(
            mode="protect",
            paused=True,
            sensitivity="relaxed",
            overrides={"similarity": 80, "evidence_log": True, "evidence_days": 3},
            allow_senders=["Sue"],
        ),
    )
    assert await SpamGuardProfiles().capture() == {
        "mode": "protect",
        "sensitivity": "relaxed",
        "overrides": {"similarity": 80},
    }


@pytest.mark.asyncio
async def test_apply_changes_only_what_a_profile_holds(runtime):
    await save(
        runtime,
        live(
            mode="protect",
            paused=True,
            sensitivity="relaxed",
            overrides={"similarity": 80, "evidence_log": True, "evidence_days": 3},
            allow_hops=["27"],
            allow_senders=["Sue"],
            allow_texts=["hello there"],
        ),
    )
    before = runtime.version

    await SpamGuardProfiles().apply(STRICT, confirmed=False)

    config = runtime.config
    assert runtime.version == before + 1
    assert (config.mode, config.sensitivity) == ("protect", "strict")
    # The profile's overrides replace the old ones; the evidence choice stays.
    assert config.overrides == {"dedupe_seconds": 3600, "evidence_log": True, "evidence_days": 3}
    assert config.paused is True
    assert [c.key for c in config.channels] == [PUBLIC]
    assert (config.allow_hops, config.allow_senders, config.allow_texts) == (
        ["27"],
        ["Sue"],
        ["hello there"],
    )


@pytest.mark.asyncio
async def test_switching_to_protect_needs_a_yes(runtime):
    kind = SpamGuardProfiles()
    assert runtime.config.mode == "monitor"

    with pytest.raises(ProfileError) as caught:
        await kind.apply(STRICT, confirmed=False)
    assert (caught.value.code, caught.value.status) == ("needs_confirm", 409)
    assert runtime.version == 0 and runtime.config.mode == "monitor"

    await kind.apply(STRICT, confirmed=True)
    assert runtime.config.mode == "protect"

    # Already Protect: nothing to confirm. Back to Monitor: nothing to confirm.
    await kind.apply({**STRICT, "sensitivity": "balanced"}, confirmed=False)
    await kind.apply(
        {"mode": "monitor", "sensitivity": "balanced", "overrides": {}}, confirmed=False
    )
    assert runtime.config.mode == "monitor"


@pytest.mark.asyncio
async def test_apply_works_before_spam_guard_was_ever_saved_or_enabled(runtime):
    await runtime.set_enabled(False)
    assert runtime.version == 0

    await SpamGuardProfiles().apply(
        {"mode": "monitor", "sensitivity": "strict", "overrides": {}}, confirmed=False
    )

    assert runtime.version == 1
    assert runtime.config.sensitivity == "strict"
    # The channel a fresh install reads is still there.
    assert [c.key for c in runtime.config.channels] == [PUBLIC]


@pytest.mark.asyncio
async def test_first_hop_matching_is_refused_on_openhop(runtime, monkeypatch):
    monkeypatch.setattr(runtime, "backend_name", lambda: "openhop")
    payload = {
        "mode": "monitor",
        "sensitivity": "balanced",
        "overrides": {"hop_match_mode": "starts_at"},
    }
    assert runtime.refusal(live(overrides=payload["overrides"])) == "openhop_starts_at"
    assert "openhop_starts_at" in REFUSALS

    with pytest.raises(ProfileError) as caught:
        await SpamGuardProfiles().apply(payload, confirmed=False)
    assert (caught.value.code, caught.value.status) == ("openhop_starts_at", 409)
    assert runtime.version == 0


@pytest.mark.asyncio
async def test_the_host_repeater_takes_first_hop_matching(runtime):
    payload = {
        "mode": "monitor",
        "sensitivity": "balanced",
        "overrides": {"hop_match_mode": "starts_at"},
    }
    assert runtime.refusal(live(overrides=payload["overrides"])) is None
    await SpamGuardProfiles().apply(payload, confirmed=False)
    assert runtime.config.overrides == {"hop_match_mode": "starts_at"}


@pytest.mark.asyncio
async def test_a_save_that_lost_the_race_is_a_conflict(runtime, monkeypatch):
    async def lost(expected_version, config):
        return None

    monkeypatch.setattr(runtime, "save_config", lost)
    with pytest.raises(ProfileError) as caught:
        await SpamGuardProfiles().apply(
            {"mode": "monitor", "sensitivity": "strict", "overrides": {}}, confirmed=False
        )
    assert (caught.value.code, caught.value.status) == ("conflict", 409)


@pytest.mark.asyncio
async def test_matches_compares_the_values_in_force(runtime):
    kind = SpamGuardProfiles()
    relaxed = {"mode": "monitor", "sensitivity": "relaxed", "overrides": {}}
    await save(runtime, live(sensitivity="relaxed"))
    assert await kind.matches(relaxed) is True

    # An override equal to the preset's own value is no change.
    same = PRESETS["relaxed"]["similarity"]
    await save(runtime, live(sensitivity="relaxed", overrides={"similarity": same}))
    assert await kind.matches(relaxed) is True

    # The evidence choice is not part of a profile, so it is no change either.
    await save(runtime, live(sensitivity="relaxed", overrides={"evidence_log": True}))
    assert await kind.matches(relaxed) is True

    await save(runtime, live(sensitivity="relaxed", overrides={"similarity": same + 1}))
    assert await kind.matches(relaxed) is False

    await save(runtime, live(sensitivity="relaxed", mode="protect"))
    assert await kind.matches(relaxed) is False


@pytest.mark.asyncio
async def test_reset_settings_shows_as_a_change(runtime):
    kind = SpamGuardProfiles()
    strict = {"mode": "monitor", "sensitivity": "strict", "overrides": {}}
    await kind.apply(strict, confirmed=False)
    assert await kind.matches(strict)
    await runtime.action("reset_settings", {})
    assert not await kind.matches(strict)


@pytest.mark.asyncio
async def test_changes_lists_old_and_new(runtime):
    await save(runtime, live(sensitivity="balanced", overrides={"evidence_log": True}))
    changes = await SpamGuardProfiles().changes(
        {
            "mode": "protect",
            "sensitivity": "balanced",
            "overrides": {"similarity": 80, "random_name_patterns": ["[a-z]{9}"]},
        }
    )
    by_key = {change["key"]: change for change in changes}
    assert set(by_key) == {"mode", "similarity", "random_name_patterns"}
    assert by_key["mode"] == {"key": "mode", "from": "monitor", "to": "protect"}
    assert by_key["similarity"] == {
        "key": "similarity",
        "from": PRESETS["balanced"]["similarity"],
        "to": 80,
    }
    assert by_key["random_name_patterns"]["to"] == ["[a-z]{9}"]
    # Mode first: it is the change that matters most.
    assert changes[0]["key"] == "mode"


@pytest.mark.asyncio
async def test_changes_is_empty_when_the_profile_matches(runtime):
    kind = SpamGuardProfiles()
    assert await kind.changes(await kind.capture()) == []


@pytest.mark.asyncio
async def test_changes_and_matches_refuse_a_bad_payload(runtime):
    kind = SpamGuardProfiles()
    bad = {**STRICT, "overrides": {"similarity": 5}}
    with pytest.raises(ValueError):
        await kind.changes(bad)
    with pytest.raises(ValueError):
        await kind.matches(bad)
    with pytest.raises(ValueError):
        await kind.apply(bad, confirmed=True)
    assert runtime.version == 0
