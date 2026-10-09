"""Spam Guard replay: an evidence log run through a fresh detector with other settings."""

from app.spam import evidence as ev
from app.spam.detector import SpamDetector
from app.spam.replay import replay
from app.spam.settings import SpamConfig

PUBLIC = "8B3387E9C5CDEA6AC9E5EDBAA115CD72"
CHANNEL = ev.channel_id(PUBLIC)
NOW = 1_800_000_000.0
SPAM = "Amazing offer cheap radios available now at the usual place come quickly"
GENERATED = ["UD6DWREK", "QK3ZP9XV", "ZX8CV2BN", "PL4MN8QR"]
# Text rules only, so each scenario shows one mechanism.
TEXT_ONLY = {"dedupe_enabled": False, "enable_hop_rules": False, "enable_rotation_guard": False}


def config(sensitivity="balanced", **overrides) -> SpamConfig:
    return SpamConfig(
        sensitivity=sensitivity,
        overrides=overrides,
        channels=[{"key": PUBLIC, "name": "Public"}],
    )


def msg(index: int, sender: str, text: str, *, path=("27", "B1"), **extra) -> dict:
    return {
        "type": "msg",
        "ts": NOW + index * 5,
        "channel": CHANNEL,
        "sender": sender,
        "text": text,
        "path": list(path),
        "length": 80,
        "message_id": 100 + index,
        **extra,
    }


def label(message_id: int, verdict: str, *, index: int = 99) -> dict:
    return {"type": "label", "ts": NOW + index * 5, "label": verdict, "message_id": message_id}


def campaign() -> list[dict]:
    return [msg(i, name, f"{SPAM} {i}") for i, name in enumerate(GENERATED)]


class TestOutcome:
    def test_a_campaign_is_stopped_from_the_copy_that_confirms_it(self):
        result = replay(campaign(), config(**TEXT_ONLY))
        assert result["messages"] == 4
        # Copies 3 and 4 arrive with the block in place; 1 and 2 are flagged afterwards.
        assert result["stopped"] == 2
        assert result["flagged"] == 4
        # The text block, and links from unknown names held while the campaign runs.
        assert result["blocks"] == {"text": 1, "links": 1}
        assert result["duplicate_blocks"] == 0

    def test_other_settings_give_another_outcome(self):
        relaxed = replay(campaign(), config("relaxed", **TEXT_ONLY))
        assert relaxed["stopped"] == 1  # four names needed: only the last copy
        strict = replay(campaign(), config("strict", **TEXT_ONLY))
        assert strict["stopped"] == 3  # two names suffice

    def test_what_happened_live_is_reported_next_to_it(self):
        records = campaign()
        records[3]["matched"] = "text:abc"
        result = replay(records, config(**TEXT_ONLY))
        assert result["recorded_stopped"] == 1

    def test_records_are_replayed_in_time_order(self):
        result = replay(list(reversed(campaign())), config(**TEXT_ONLY))
        assert result["stopped"] == 2
        assert result["first_ts"] == NOW
        assert result["last_ts"] == NOW + 15

    def test_nothing_to_replay(self):
        result = replay([], config())
        assert result["messages"] == 0
        assert result["stopped"] == 0
        assert result["first_ts"] is None

    def test_a_block_that_ran_out_no_longer_stops_anything(self):
        records = [*campaign(), msg(4, "Dave", f"{SPAM} later")]
        records[-1]["ts"] = NOW + 10 * 86400  # long after the text block ended
        result = replay(records, config(**TEXT_ONLY))
        assert result["stopped"] == 2


class TestLabels:
    def records(self) -> list[dict]:
        return [
            *campaign(),
            msg(4, "Dave", "evening all, anyone on the repeater tonight", path=("44",)),
            msg(5, "TR9XK2LM", "a one off advert nobody repeats at all", path=("55",)),
        ]

    def test_spam_labels_split_into_caught_flagged_later_and_missed(self):
        records = [
            *self.records(),
            label(103, "spam"),  # stopped on arrival
            label(100, "spam"),  # let through, flagged once the campaign showed
            label(105, "spam"),  # never recognised
        ]
        result = replay(records, config(**TEXT_ONLY))
        assert result["labels"] == {"spam": 3, "genuine": 0}
        assert (result["caught"], result["flagged_later"], result["missed"]) == (1, 1, 1)
        assert [sample["sender"] for sample in result["missed_samples"]] == ["TR9XK2LM"]

    def test_genuine_labels_split_into_passed_and_wrongly_held(self):
        records = [
            *self.records(),
            label(104, "genuine"),  # Dave passes
            label(102, "genuine"),  # the user says a stopped copy was fine
        ]
        result = replay(records, config(**TEXT_ONLY))
        assert result["labels"] == {"spam": 0, "genuine": 2}
        assert (result["passed"], result["wrongly_held"]) == (1, 1)
        held = result["wrongly_held_samples"][0]
        assert held["sender"] == "ZX8CV2BN"
        assert held["matched"].startswith("text:")

    def test_the_last_label_on_a_message_counts(self):
        records = [*self.records(), label(104, "spam", index=50), label(104, "genuine", index=60)]
        result = replay(records, config(**TEXT_ONLY))
        assert result["labels"] == {"spam": 0, "genuine": 1}

    def test_a_label_for_a_message_not_in_the_log_is_ignored(self):
        result = replay([*self.records(), label(999, "spam")], config(**TEXT_ONLY))
        assert result["labels"] == {"spam": 0, "genuine": 0}

    def test_samples_are_capped(self):
        texts = [
            "weather is nice today",
            "anyone seen my antenna",
            "testing one two three",
            "the net starts at eight",
            "coffee later at the club",
            "battery swap went fine",
            "new mast is up at last",
            "see you all on sunday",
        ]
        records = [msg(i, f"Name{i}", text) for i, text in enumerate(texts)]
        records += [label(100 + i, "spam") for i in range(8)]
        result = replay(records, config(**TEXT_ONLY), sample_limit=3)
        assert result["missed"] == 8
        assert len(result["missed_samples"]) == 3


class TestScrambled:
    def recorded(self) -> list[dict]:
        """Evidence as the runtime writes it, from a live detector."""

        class Clock:
            now = NOW

            def __call__(self) -> float:
                return self.now

        clock = Clock()
        live = SpamDetector(config(**TEXT_ONLY), clock=clock)
        out = []
        senders = [*GENERATED, "Dave", "pаypal"]
        for index, sender in enumerate(senders):
            clock.now += 5
            text = f"{SPAM} {index}" if sender in GENERATED else f"hello from {index} @[Dave]"
            event = live.ingest(
                ts=clock.now,
                path=("27", "B1"),
                sender=sender,
                text=text,
                channel=PUBLIC,
                length=80,
                message_id=index,
            )
            live.decide(rematch=event)
            out.append(ev.message_record(event, known=live.is_known(sender)))
        return out

    def test_a_scrambled_export_replays_like_the_plain_one(self):
        records = self.recorded()
        plain = replay(records, config(**TEXT_ONLY))
        text = "".join(ev.export_lines(records, scramble=True, now=NOW, days=7))
        parsed = ev.parse_lines(text)
        assert parsed.scrambled
        scrambled = replay(parsed.records, config(**TEXT_ONLY), scrambled=True)
        for key in ("messages", "stopped", "flagged", "blocks"):
            assert scrambled[key] == plain[key], key
        assert plain["stopped"] == 2

    def test_recorded_name_signals_stand_in_for_the_look_of_a_code(self):
        # A scrambled name is a code; what the real name looked like was recorded.
        det = SpamDetector(config())

        def heard(**signals):
            return det.ingest(
                ts=NOW,
                path=("27",),
                sender="user-1a2b3c4d",
                text="hello",
                channel=PUBLIC,
                **signals,
            )

        assert heard(name_score=0, name_disguised=False).random is False
        assert heard(name_score=5, name_disguised=False).random is True
        assert heard(name_score=0, name_disguised=True).random is True
