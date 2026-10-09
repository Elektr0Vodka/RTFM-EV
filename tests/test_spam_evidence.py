"""Spam Guard evidence log: record shapes, scrambled export, parsing."""

import json

from app.spam import evidence as ev
from app.spam.detector import SpamDetector
from app.spam.settings import SpamConfig

PUBLIC = "8B3387E9C5CDEA6AC9E5EDBAA115CD72"
CLUB = "CC" * 16
NOW = 1_800_000_000.0


class Clock:
    def __init__(self) -> None:
        self.now = NOW

    def __call__(self) -> float:
        return self.now


def detector() -> tuple[SpamDetector, Clock]:
    clock = Clock()
    config = SpamConfig(channels=[{"key": PUBLIC, "name": "Public"}, {"key": CLUB, "name": "Club"}])
    return SpamDetector(config, clock=clock), clock


def heard(det, clock, sender, text, *, channel=PUBLIC, message_id=7):
    clock.now += 5
    return det.ingest(
        ts=clock.now,
        path=("27", "B1"),
        sender=sender,
        text=text,
        channel=channel,
        length=80,
        message_id=message_id,
    )


class TestRecords:
    def test_message_record_holds_what_replay_needs_and_the_signals(self):
        det, clock = detector()
        event = heard(det, clock, "UD6DWREK", "hello @[Dave] there")
        record = ev.message_record(event, known=False, channel_name="Public")
        assert record == {
            "type": "msg",
            "ts": event.ts,
            "channel": ev.channel_id(PUBLIC),
            "channel_name": "Public",
            "sender": "UD6DWREK",
            "text": "hello @[Dave] there",
            "path": ["27", "B1"],
            "length": 80,
            "message_id": 7,
            "name_score": event.name_score,
            "name_disguised": False,
            "random": True,
            "known": False,
            "exempt": False,
            "matched": None,
            "spam": False,
        }
        json.dumps(record)

    def test_a_record_never_holds_the_channel_key(self):
        det, clock = detector()
        event = heard(det, clock, "Dave", "club talk", channel=CLUB)
        record = ev.message_record(event, known=True, channel_name="Club")
        assert CLUB.lower() not in json.dumps(record).lower()
        assert record["channel"] == ev.channel_id(CLUB)
        assert ev.channel_id(CLUB) != ev.channel_id(PUBLIC)
        assert ev.channel_id(CLUB) == ev.channel_id(CLUB.lower())

    def test_a_styled_name_is_recorded_as_disguised_only_when_it_is(self):
        det, clock = detector()
        plain = ev.message_record(heard(det, clock, "Dave", "hi"), known=False)
        faked = ev.message_record(heard(det, clock, "pаypal", "hi"), known=False)
        assert plain["name_disguised"] is False
        assert faked["name_disguised"] is True

    def test_label_record(self):
        record = ev.label_record(
            ts=NOW, label="spam", message_id=7, sender="UD6DWREK", text="buy now", channel=PUBLIC
        )
        assert record == {
            "type": "label",
            "ts": NOW,
            "label": "spam",
            "message_id": 7,
            "sender": "UD6DWREK",
            "text": "buy now",
            "channel": ev.channel_id(PUBLIC),
        }


def records() -> list[dict]:
    det, clock = detector()
    out = [
        ev.message_record(
            heard(det, clock, "UD6DWREK", "hello @[Dave] and @[Sarah]", message_id=1),
            known=False,
            channel_name="Public",
        ),
        ev.message_record(
            heard(det, clock, "Dave", "hi @[UD6DWREK]", channel=CLUB, message_id=2),
            known=True,
            channel_name="Club",
        ),
    ]
    out.append(
        ev.label_record(
            ts=NOW + 60,
            label="spam",
            message_id=1,
            sender="UD6DWREK",
            text="hello @[Dave] and @[Sarah]",
            channel=PUBLIC,
        )
    )
    return out


def parsed(lines) -> list[dict]:
    return [json.loads(line) for line in lines]


class TestExport:
    def test_plain_export_is_a_header_and_the_records(self):
        lines = list(ev.export_lines(records(), scramble=False, now=NOW + 100, days=7))
        assert all(line.endswith("\n") for line in lines)
        meta, *rest = parsed(lines)
        assert meta == {
            "type": "meta",
            "version": ev.FORMAT_VERSION,
            "exported_at": NOW + 100,
            "days": 7,
            "scrambled": False,
        }
        assert rest == records()

    def test_scrambled_export_has_no_name_left(self):
        lines = list(ev.export_lines(records(), scramble=True, now=NOW, days=7))
        text = "".join(lines)
        for name in ("UD6DWREK", "Dave", "Sarah", "Club", "Public"):
            assert name not in text
        meta, first, second, label = parsed(lines)
        assert meta["scrambled"] is True
        assert "channel_name" not in first and "channel_name" not in second

    def test_one_name_gets_one_code_everywhere_in_an_export(self):
        _, first, second, label = parsed(ev.export_lines(records(), scramble=True, now=NOW, days=7))
        generated, dave = first["sender"], second["sender"]
        assert generated != dave
        # Dave is mentioned in the first message and sends the second one.
        assert first["text"].startswith(f"hello @[{dave}] and @[")
        assert second["text"] == f"hi @[{generated}]"
        assert label["sender"] == generated
        assert label["text"] == first["text"]

    def test_codes_differ_between_exports(self):
        one = parsed(ev.export_lines(records(), scramble=True, now=NOW, days=7))[1]["sender"]
        two = parsed(ev.export_lines(records(), scramble=True, now=NOW, days=7))[1]["sender"]
        assert one != two

    def test_scrambling_keeps_everything_else(self):
        plain = parsed(ev.export_lines(records(), scramble=False, now=NOW, days=7))[1]
        mixed = parsed(ev.export_lines(records(), scramble=True, now=NOW, days=7))[1]
        for key in (
            "ts",
            "channel",
            "path",
            "length",
            "message_id",
            "name_score",
            "name_disguised",
            "random",
            "known",
            "exempt",
            "matched",
            "spam",
        ):
            assert mixed[key] == plain[key], key


class TestParse:
    def test_round_trip(self):
        text = "".join(ev.export_lines(records(), scramble=False, now=NOW, days=7))
        result = ev.parse_lines(text)
        assert result.records == records()
        assert result.scrambled is False
        assert result.skipped == 0

    def test_scrambled_flag_comes_from_the_header(self):
        text = "".join(ev.export_lines(records(), scramble=True, now=NOW, days=7))
        assert ev.parse_lines(text).scrambled is True

    def test_garbage_lines_are_skipped_and_counted(self):
        good = json.dumps(records()[0])
        text = "\n".join(["not json", good, "[1, 2]", '{"type": "other"}', '{"type": "msg"}', ""])
        result = ev.parse_lines(text)
        assert result.records == [records()[0]]
        assert result.skipped == 4

    def test_too_many_records_is_an_error(self):
        line = json.dumps(records()[0])
        try:
            ev.parse_lines("\n".join([line] * 6), limit=5)
        except ValueError as exc:
            assert "5" in str(exc)
        else:
            raise AssertionError("expected ValueError")


class TestRetentionDays:
    def test_default_when_never_saved(self):
        assert ev.retention_days(None) == 7

    def test_follows_the_override(self):
        assert ev.retention_days({"overrides": {"evidence_days": 21}}) == 21

    def test_invalid_settings_fall_back_to_the_default(self):
        assert ev.retention_days({"overrides": {"evidence_days": 999}}) == 7
        assert ev.retention_days({"nonsense": True}) == 7
