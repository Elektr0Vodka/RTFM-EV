"""The aggregator behind GET /api/filter-stats: rows in, report out."""

import json
import re

from app.services.filter_stats import (
    DIRECT,
    ChannelInfo,
    MessageRow,
    aggregate_filter_stats,
    channel_is_public,
    clean_policy_rules,
    first_hop,
)

PUBLIC = "8B3387E9C5CDEA6AC9E5EDBAA115CD72"
FAMILY = "EE" * 16
CHANNELS = {PUBLIC: ChannelInfo("Public", True), FAMILY: ChannelInfo("Family", False)}


def row(message_id: int, **over) -> MessageRow:
    values = {
        "id": message_id,
        "received_at": 1000,
        "channel": PUBLIC,
        "sender_name": "Alice",
        "sender_key": None,
        "first_hop": "27",
        "spam": False,
        "malformed": False,
        "duplicate": False,
        "bot": False,
        "malformed_reason": None,
        "spam_outcome": None,
        "spam_block": None,
        "spam_enforced": None,
        "spam_label": None,
    }
    values.update(over)
    return MessageRow(**values)


def run(rows, **over):
    options = {
        "start_ts": 0,
        "end_ts": 4000,
        "buckets": 4,
        "limit": 10,
        "bot_names": {},
        "bot_keys": {},
        "channels": CHANNELS,
        "policy_rules": [],
    }
    options.update(over)
    return aggregate_filter_stats(rows, **options)


class TestTotals:
    def test_counts_each_flag_and_messages_with_more_than_one(self):
        report = run(
            [
                row(1),
                row(2, spam=True),
                row(3, malformed=True, malformed_reason="text"),
                row(4, duplicate=True),
                row(5, spam=True, malformed=True, malformed_reason="clock"),
            ]
        )
        totals = report["totals"]
        assert (totals["messages"], totals["spam"], totals["malformed"]) == (5, 2, 2)
        assert (totals["duplicate"], totals["flagged"], totals["multi_flag"]) == (1, 4, 1)

    def test_malformed_cause_with_a_bucket_for_rows_without_one(self):
        report = run(
            [
                row(1, malformed=True, malformed_reason="text"),
                row(2, malformed=True, malformed_reason="clock"),
                row(3, malformed=True, malformed_reason="both"),
                row(4, malformed=True),
            ]
        )
        totals = report["totals"]
        assert (
            totals["malformed_text"],
            totals["malformed_clock"],
            totals["malformed_both"],
            totals["malformed_unknown"],
        ) == (1, 1, 1, 1)

    def test_empty_window(self):
        report = run([])
        assert report["totals"]["messages"] == 0
        assert len(report["series"]) == 4
        assert report["senders"] == report["channels"] == report["sources"] == []
        assert report["filters"]["stop_rate"] is None

    def test_more_buckets_than_seconds(self):
        report = run([row(1, received_at=1, spam=True)], start_ts=0, end_ts=3, buckets=200)
        assert report["window"]["bucket_seconds"] == 1
        assert sum(bucket["spam"] for bucket in report["series"]) == 1


class TestSeries:
    def test_buckets_and_window_edges(self):
        report = run(
            [
                row(1, received_at=0, spam=True),
                row(2, received_at=999, spam=True),
                row(3, received_at=1000),
                row(4, received_at=3999, malformed=True),
                row(5, received_at=4000, spam=True),  # the end is exclusive
                row(6, received_at=-1, spam=True),
            ]
        )
        assert report["window"]["bucket_seconds"] == 1000
        assert [bucket["bucket_ts"] for bucket in report["series"]] == [0, 1000, 2000, 3000]
        assert [bucket["messages"] for bucket in report["series"]] == [2, 1, 0, 1]
        assert [bucket["spam"] for bucket in report["series"]] == [2, 0, 0, 0]
        assert report["totals"]["messages"] == 4


class TestBots:
    def test_both_numbers_and_their_differences(self):
        report = run(
            [
                row(1, sender_name="PingBot", bot=True),  # listed then and now
                row(2, sender_name="NewBot"),  # listed later
                # No longer listed. Spam too, or it would not be in the senders table.
                row(3, sender_name="OldBot", bot=True, spam=True),
                row(4, sender_name="Renamed", sender_key="AB" * 32),  # matched by key
                row(5),
            ],
            bot_names={"PingBot": ["Mine"], "NewBot": ["Mine", "Shared"]},
            bot_keys={"ab" * 32: ["Shared"]},
        )
        totals = report["totals"]
        assert (totals["bot_now"], totals["bot_flagged"]) == (3, 2)
        assert (totals["bot_listed_later"], totals["bot_no_longer_listed"]) == (2, 1)
        by_name = {sender["name"]: sender for sender in report["senders"]}
        assert by_name["NewBot"]["bot_lists"] == ["Mine", "Shared"]
        assert by_name["Renamed"]["bot_lists"] == ["Shared"]
        assert by_name["OldBot"]["bot_lists"] == []
        assert by_name["OldBot"]["bot_flagged"] == 1


class TestOffenders:
    def test_senders_sorted_by_flagged_and_cut_to_the_limit(self):
        rows = [row(1, sender_name="Quiet")]
        rows += [row(10 + i, sender_name="Loud", spam=True, received_at=100 + i) for i in range(3)]
        rows += [row(20, sender_name="Once", malformed=True, channel=FAMILY, sender_key="CD" * 32)]
        rows += [row(30, sender_name=None, spam=True)]
        report = run(rows, limit=2)
        assert [sender["name"] for sender in report["senders"]] == ["Loud", ""]
        assert report["senders_truncated"] is True
        loud = report["senders"][0]
        assert (loud["messages"], loud["spam"], loud["flagged"]) == (3, 3, 3)
        assert (loud["first_seen"], loud["last_seen"], loud["channels"]) == (100, 102, 1)

        full = run(rows)
        assert "Quiet" not in [sender["name"] for sender in full["senders"]]
        assert full["senders_truncated"] is False
        once = next(sender for sender in full["senders"] if sender["name"] == "Once")
        assert once["public_key"] == "cd" * 32

    def test_channels_carry_name_and_public_flag(self):
        report = run(
            [
                row(1, spam=True),
                row(2),
                row(3, channel=FAMILY, malformed=True),
                row(4, channel="AA" * 16),
            ]
        )
        by_key = {channel["key"]: channel for channel in report["channels"]}
        assert (by_key[PUBLIC]["name"], by_key[PUBLIC]["public"]) == ("Public", True)
        assert (by_key[PUBLIC]["messages"], by_key[PUBLIC]["flagged"]) == (2, 1)
        assert (by_key[FAMILY]["name"], by_key[FAMILY]["public"]) == ("Family", False)
        assert (by_key["AA" * 16]["name"], by_key["AA" * 16]["public"]) == ("", False)

    def test_channels_say_whether_spam_guard_protects_them(self):
        report = run([row(1), row(2, channel=FAMILY)], protected={FAMILY})
        by_key = {channel["key"]: channel for channel in report["channels"]}
        assert by_key[PUBLIC]["protected"] is False
        assert by_key[FAMILY]["protected"] is True

    def test_sources_group_by_first_hop_and_skip_unknown_paths(self):
        report = run(
            [
                row(1, first_hop="27", spam=True, received_at=50),
                row(2, first_hop="27", received_at=60),
                row(3, first_hop=DIRECT, malformed=True),
                row(4, first_hop=None, spam=True),
                row(5, first_hop="B1"),
            ]
        )
        # Equal flagged counts: the busier repeater comes first.
        assert [(s["hop"], s["messages"], s["flagged"]) for s in report["sources"]] == [
            ("27", 2, 1),
            (DIRECT, 1, 1),
        ]
        assert report["sources"][0]["last_seen"] == 60
        assert report["totals"]["spam"] == 2


class TestFilters:
    def test_outcome_split_and_stop_rate(self):
        report = run(
            [
                row(1, spam_outcome="clean"),
                row(
                    2, spam=True, spam_outcome="stopped", spam_block="campaign", spam_enforced=True
                ),
                row(3, spam=True, spam_outcome="stopped", spam_block="dedupe", spam_enforced=False),
                row(4, spam=True, spam_outcome="stopped", spam_enforced=False),
                row(5, spam_outcome="let_through"),
                row(6, spam_outcome="held", spam_block="hop"),
                row(7, spam=True, spam_outcome="clean"),  # flagged after it settled
                row(8),
                row(9, spam_outcome="something else"),
            ]
        )
        filters = report["filters"]
        assert (filters["analysed"], filters["not_recorded"]) == (7, 2)
        assert (filters["clean"], filters["stopped"], filters["let_through"], filters["held"]) == (
            1,
            3,
            2,
            1,
        )
        assert (filters["enforced"], filters["not_enforced"]) == (1, 2)
        assert filters["flagged_later"] == 1
        assert filters["stop_rate"] == 60
        assert filters["blocks"] == [
            {"source": "campaign", "count": 1},
            {"source": "dedupe", "count": 1},
            {"source": "expired", "count": 1},
            {"source": "hop", "count": 1},
        ]

    def test_labels(self):
        report = run(
            [
                row(1, spam_label="spam", spam_outcome="stopped"),
                row(2, spam_label="spam", spam_outcome="clean"),
                row(3, spam_label="spam"),
                row(4, spam_label="genuine", spam_outcome="stopped"),
                row(5, spam_label="genuine", spam_outcome="held"),
                row(6, spam_label="genuine", spam_outcome="clean"),
            ]
        )
        filters = report["filters"]
        assert (filters["confirmed"], filters["missed"], filters["false_positive"]) == (1, 2, 2)

    def test_policy_rules_and_window_pass_through(self):
        rules = [{"action": "drop", "rule": "spam:text:1", "packets": 4}]
        report = run([], policy_rules=rules, channel=PUBLIC)
        assert report["policy_rules"] == rules
        assert report["window"] == {
            "start_ts": 0,
            "end_ts": 4000,
            "bucket_seconds": 1000,
            "channel": PUBLIC,
        }


class TestHelpers:
    def test_first_hop(self):
        def paths(**entry):
            return json.dumps([entry])

        assert first_hop(paths(path="27b1", path_len=2)) == "27"
        assert first_hop(paths(path="27ab01cd", path_len=2)) == "27AB"
        assert first_hop(paths(path="27b1")) == "27"  # no hop count: one byte per hop
        assert first_hop(paths(path="", path_len=0)) == DIRECT
        assert (
            first_hop(json.dumps([{"path": "b1", "path_len": 1}, {"path": "27", "path_len": 1}]))
            == "B1"
        )

    def test_first_hop_of_a_path_that_cannot_be_read(self):
        for stored in (None, "", "not json", "{}", "[]", "[1]", json.dumps([{"rssi": -90}])):
            assert first_hop(stored) is None

    def test_channel_is_public(self):
        assert channel_is_public(PUBLIC, "Public") is True
        assert channel_is_public(PUBLIC.lower(), "anything") is True
        # A #name whose key derives from the name is public knowledge.
        from hashlib import sha256

        derived = sha256(b"#test").digest()[:16].hex().upper()
        assert channel_is_public(derived, "#test") is True
        assert channel_is_public(derived, "#other") is False
        assert channel_is_public(FAMILY, "Family") is False


class TestRuleNames:
    """Spam Guard names its OpenHop rules after the channel key they guard."""

    def test_a_channel_key_never_leaves_in_a_rule_name(self):
        unknown = "AB" * 16
        rules = [
            {"action": "allow", "rule": f"rtfm-spam:known-people:{FAMILY}", "packets": 5},
            {"action": "drop", "rule": f"rtfm-spam:bots:{PUBLIC.lower()} (bot list)", "packets": 2},
            {"action": "drop", "rule": f"rtfm-spam:text:0123456789:{unknown}", "packets": 1},
            {"action": "drop", "rule": "my-own-rule", "packets": 4},
            {"action": "drop", "rule": None, "packets": 3},
        ]
        cleaned = clean_policy_rules(rules, CHANNELS)
        text = json.dumps(cleaned).upper()
        assert FAMILY not in text
        assert unknown not in text
        assert PUBLIC not in text
        # A private or unknown key becomes a short one-way id, a public one its name.
        assert re.fullmatch(r"rtfm-spam:known-people:channel-[0-9a-f]{8}", cleaned[0]["rule"])
        assert cleaned[1]["rule"] == "rtfm-spam:bots:Public (bot list)"
        assert re.fullmatch(r"rtfm-spam:text:0123456789:channel-[0-9a-f]{8}", cleaned[2]["rule"])
        assert cleaned[3:] == rules[3:]
        assert [rule["packets"] for rule in cleaned] == [5, 2, 1, 4, 3]

    def test_the_same_key_gives_the_same_id_and_equal_rows_are_merged(self):
        rules = [
            {"action": "drop", "rule": f"x:{FAMILY}", "packets": 2},
            {"action": "allow", "rule": f"x:{FAMILY}", "packets": 7},
            {"action": "drop", "rule": f"x:{FAMILY.lower()}", "packets": 3},
        ]
        cleaned = clean_policy_rules(rules, CHANNELS)
        assert [(rule["action"], rule["packets"]) for rule in cleaned] == [
            ("drop", 5),
            ("allow", 7),
        ]
        assert cleaned[0]["rule"] == cleaned[1]["rule"]

    def test_hex_that_is_not_a_channel_key_is_left_alone(self):
        long_key = "cd" * 32
        rules = [{"action": "drop", "rule": f"node:{long_key}:text:0123456789", "packets": 1}]
        assert clean_policy_rules(rules, CHANNELS) == rules
