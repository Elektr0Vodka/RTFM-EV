"""meshcomod companion receive filter: reply parsers and CLI command building.

Reply strings follow meshcomod examples/companion_radio/CompanionFilter.cpp and
filter/FilterStats.h.
"""

from unittest.mock import AsyncMock, patch

import pytest

from app.services import companion_filter as cf


class TestParseSummary:
    def test_on(self):
        reply = "> Filter on: Hidden [ Malformed: 3 | Age: 0 | Path: 12 | Sender: 41 | Text: 7 ]"
        assert cf.parse_summary(reply) == {
            "enabled": True,
            "malformed": 3,
            "age": 0,
            "path": 12,
            "sender": 41,
            "text": 7,
        }

    def test_off(self):
        reply = "> Filter off: Hidden [ Malformed: 0 | Age: 0 | Path: 0 | Sender: 0 | Text: 0 ]"
        assert cf.parse_summary(reply)["enabled"] is False

    @pytest.mark.parametrize("reply", ["Unknown command", "filter", "", "> Filter: on"])
    def test_not_a_summary(self, reply):
        assert cf.parse_summary(reply) is None


class TestParseSettings:
    def test_malformed(self):
        assert cf.parse_malformed_setting("> Filter: malformed text scan on") is True
        assert cf.parse_malformed_setting("> Filter: malformed text scan off") is False
        assert cf.parse_malformed_setting("Failed") is None

    def test_age_off(self):
        assert cf.parse_age("> Filter: message age limit off") == {
            "age_mins": 0,
            "dropped": None,
            "clock_set": None,
        }

    def test_age_on(self):
        assert cf.parse_age("> Message age: max 60m, dropped 4") == {
            "age_mins": 60,
            "dropped": 4,
            "clock_set": True,
        }

    def test_age_clock_not_set(self):
        parsed = cf.parse_age("> Message age: max 60m, dropped 0 (clock not set, inactive)")
        assert parsed["clock_set"] is False

    def test_malformed_stats(self):
        assert cf.parse_malformed_stats("> Filter: no malformed drops recorded")["total"] == 0
        assert cf.parse_malformed_stats("> Blocked 3 [ short:0 time:2 empty:0 utf8:1 ]") == {
            "total": 3,
            "short": 0,
            "time": 2,
            "empty": 0,
            "utf8": 1,
        }


class TestParseLists:
    def test_path_list(self):
        assert cf.parse_path_list("None") == ([], False)
        assert cf.parse_path_list("A1B2,C3") == (["A1B2", "C3"], False)

    def test_path_list_truncated_drops_last(self):
        assert cf.parse_path_list("A1B2,C3D4,E5..") == (["A1B2", "C3D4"], True)

    def test_path_stats(self):
        assert cf.parse_path_stats("A1B2: 12,C3: 0") == ({"A1B2": 12, "C3": 0}, False)
        assert cf.parse_path_stats("None") == ({}, False)

    def test_rule_list(self):
        rules, truncated = cf.parse_rule_list("Bot* block,^!ping throttle 300s,spam block 50%")
        assert truncated is False
        assert rules == [
            {"pattern": "Bot*", "secs": 0, "prob": 100},
            {"pattern": "^!ping", "secs": 300, "prob": 100},
            {"pattern": "spam", "secs": 0, "prob": 50},
        ]

    def test_rule_list_pattern_with_comma(self):
        rules, _ = cf.parse_rule_list("a,b block,c throttle 5s 20%")
        assert [r["pattern"] for r in rules] == ["a,b", "c"]
        assert rules[1] == {"pattern": "c", "secs": 5, "prob": 20}

    def test_rule_list_truncated_drops_partial_entry(self):
        # The cut can remove a trailing " 50%", so the last entry is not trusted.
        rules, truncated = cf.parse_rule_list("aaa block,bbb throttle 300s..")
        assert truncated is True
        assert rules == [{"pattern": "aaa", "secs": 0, "prob": 100}]

    def test_rule_list_truncated_after_comma(self):
        rules, truncated = cf.parse_rule_list("aaa block,bbb block,..")
        assert truncated is True
        assert [r["pattern"] for r in rules] == ["aaa"]

    def test_rule_list_truncated_single_entry(self):
        assert cf.parse_rule_list("aaa thro..") == ([], True)

    def test_rule_list_none(self):
        assert cf.parse_rule_list("None") == ([], False)

    def test_rule_list_garbage(self):
        assert cf.parse_rule_list("Unknown command") is None

    def test_rule_stats(self):
        stats, truncated = cf.parse_rule_stats("Bot*: 41 (pass 3),^!ping: 7,a:: 2")
        assert truncated is False
        assert stats == {
            "Bot*": {"hidden": 41, "passes": 3},
            "^!ping": {"hidden": 7, "passes": 0},
            "a:": {"hidden": 2, "passes": 0},
        }


class TestSuccessReply:
    @pytest.mark.parametrize(
        "reply",
        [
            "> Filter: on",
            "> Filter: path A1B2 added",
            "> Filter: OK",
            "> Filter: preferences reset",
        ],
    )
    def test_success(self, reply):
        assert cf.is_success_reply(reply) is True

    @pytest.mark.parametrize(
        "reply",
        [
            "Failed",
            "> Filter: error path prefix is 2-8 hex digits",
            "> Filter: syntax error 'filter malformed <on | off>'",
            "> Filter: command error",
            "Unknown command",
        ],
    )
    def test_failure(self, reply):
        assert cf.is_success_reply(reply) is False


class TestValidation:
    @pytest.mark.parametrize("value", ["a1", "A1B2", "a1b2c3d4", " c3 "])
    def test_path_ok(self, value):
        assert cf.normalize_path_prefix(value) == value.strip().upper()

    @pytest.mark.parametrize("value", ["", "a", "abc", "a1b2c3d4e5", "zz"])
    def test_path_bad(self, value):
        with pytest.raises(ValueError):
            cf.normalize_path_prefix(value)

    def test_pattern_rules(self):
        assert cf.validate_pattern("sender", "Bot*") == "Bot*"
        with pytest.raises(ValueError):
            cf.validate_pattern("sender", "two words")
        with pytest.raises(ValueError):
            cf.validate_pattern("sender", "x" * 16)
        assert cf.validate_pattern("text", "x" * 23)
        with pytest.raises(ValueError):
            cf.validate_pattern("text", "x" * 24)
        with pytest.raises(ValueError):
            cf.validate_pattern("other", "x")

    def test_rule_add_command(self):
        assert cf.rule_add_command("sender", "Bot*", 0, 100) == "filter sender add Bot*"
        assert cf.rule_add_command("text", "^!ping", 300, 100) == "filter text add ^!ping 300"
        assert cf.rule_add_command("text", "spam", 0, 50) == "filter text add spam 0 50"
        with pytest.raises(ValueError):
            cf.rule_add_command("text", "spam", 70000, 100)
        with pytest.raises(ValueError):
            cf.rule_add_command("text", "spam", 0, 0)


def _sample(ts, n, radio=1):
    return {
        "timestamp": ts,
        "malformed": n,
        "age": 0,
        "path": n * 2,
        "sender": 0,
        "text": 0,
        "radio_identity_id": radio,
    }


class TestCounterDeltas:
    def test_deltas_and_reboot(self):
        rows = cf.counter_deltas([_sample(0, 1), _sample(60, 4), _sample(120, 2)])
        assert rows == [
            {"timestamp": 60, "malformed": 3, "age": 0, "path": 6, "sender": 0, "text": 0},
            # counters dropped: the radio restarted, the interval counts the new value
            {"timestamp": 120, "malformed": 2, "age": 0, "path": 4, "sender": 0, "text": 0},
        ]

    def test_single_sample_has_no_interval(self):
        assert cf.counter_deltas([_sample(0, 1)]) == []

    def test_no_delta_across_radios(self):
        rows = cf.counter_deltas(
            [_sample(0, 1, radio=1), _sample(60, 50, radio=2), _sample(120, 3, radio=1)]
        )
        assert rows == [
            {"timestamp": 120, "malformed": 2, "age": 0, "path": 4, "sender": 0, "text": 0}
        ]

    def test_bin_deltas(self):
        deltas = [
            {"timestamp": 10, "malformed": 1, "age": 0, "path": 0, "sender": 2, "text": 0},
            {"timestamp": 20, "malformed": 1, "age": 0, "path": 0, "sender": 0, "text": 0},
            {"timestamp": 90, "malformed": 0, "age": 0, "path": 5, "sender": 0, "text": 0},
            {"timestamp": 500, "malformed": 9, "age": 9, "path": 9, "sender": 9, "text": 9},
        ]
        bins = cf.bin_deltas(deltas, 0, 100, 2)
        assert bins == [
            {"timestamp": 0, "malformed": 2, "age": 0, "path": 0, "sender": 2, "text": 0},
            {"timestamp": 50, "malformed": 0, "age": 0, "path": 5, "sender": 0, "text": 0},
        ]


REPLIES = {
    "filter": "> Filter on: Hidden [ Malformed: 3 | Age: 1 | Path: 12 | Sender: 41 | Text: 7 ]",
    "filter malformed": "> Filter: malformed text scan on",
    "filter age": "> Message age: max 60m, dropped 1",
    "filter path list": "A1B2",
    "filter sender list": "Bot* block",
    "filter text list": "^!ping throttle 300s 50%",
    "filter stats malformed": "> Blocked 3 [ short:0 time:2 empty:0 utf8:1 ]",
    "filter stats path": "A1B2: 12",
    "filter stats sender": "Bot*: 41",
    "filter stats text": "^!ping: 7 (pass 2)",
}


@pytest.mark.asyncio
async def test_read_filter_combines_replies():
    async def fake_cli(_mc, command):
        return REPLIES[command]

    with patch.object(cf, "run_local_cli", side_effect=fake_cli):
        data = await cf.read_filter(object())

    assert data["config"] == {
        "enabled": True,
        "malformed": True,
        "age_mins": 60,
        "paths": ["A1B2"],
        "sender_rules": [{"pattern": "Bot*", "secs": 0, "prob": 100}],
        "text_rules": [{"pattern": "^!ping", "secs": 300, "prob": 50}],
    }
    assert data["counters"] == {"malformed": 3, "age": 1, "path": 12, "sender": 41, "text": 7}
    assert data["path_hits"] == [{"prefix": "A1B2", "hidden": 12}]
    assert data["text_rules"][0]["passes"] == 2
    assert data["malformed_reasons"] == {"short": 0, "time": 2, "empty": 0, "utf8": 1}
    assert data["truncated"] == {"path": False, "sender": False, "text": False}
    assert data["age_clock_set"] is True


@pytest.mark.asyncio
async def test_read_filter_rejects_unexpected_reply():
    async def fake_cli(_mc, command):
        return "Unknown command" if command == "filter" else REPLIES[command]

    with (
        patch.object(cf, "run_local_cli", side_effect=fake_cli),
        pytest.raises(cf.CompanionFilterError),
    ):
        await cf.read_filter(object())


@pytest.mark.asyncio
async def test_change_raises_on_failed_reply():
    with (
        patch.object(cf, "run_local_cli", AsyncMock(return_value="Failed")),
        pytest.raises(cf.CompanionFilterError, match="Failed"),
    ):
        await cf.add_path(object(), "a1b2")


@pytest.mark.asyncio
async def test_restore_replays_in_order():
    sent: list[str] = []

    async def fake_cli(_mc, command):
        sent.append(command)
        return "> Filter: OK"

    config = {
        "enabled": True,
        "malformed": True,
        "age_mins": 0,
        "paths": ["A1B2"],
        "sender_rules": [{"pattern": "Bot*", "secs": 0, "prob": 100}],
        "text_rules": [{"pattern": "^!ping", "secs": 300, "prob": 50}],
    }
    with patch.object(cf, "run_local_cli", side_effect=fake_cli):
        await cf.restore_config(object(), config)

    assert sent == [
        "filter reset",
        "filter malformed on",
        "filter age off",
        "filter path add A1B2",
        "filter sender add Bot*",
        "filter text add ^!ping 300 50",
        "filter on",
    ]


@pytest.mark.asyncio
async def test_probe():
    with patch.object(cf, "run_local_cli", AsyncMock(return_value=REPLIES["filter"])):
        assert await cf.probe_filter(object()) is True
    with patch.object(cf, "run_local_cli", AsyncMock(return_value="Unknown command")):
        assert await cf.probe_filter(object()) is False
    with patch.object(cf, "run_local_cli", AsyncMock(side_effect=RuntimeError("boom"))):
        assert await cf.probe_filter(object()) is False
