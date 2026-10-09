"""Spam Guard text analysis: normalising, similarity, names, shared text."""

import re

import pytest

from app.spam import text as t

DEFAULT_PATTERNS = (re.compile(r"(?=.*\d)(?=.*[a-z])[a-z0-9]{8}", re.I),)


class TestNormalise:
    def test_case_and_punctuation_fold(self):
        assert t.normalise("Hello,   WORLD!!") == "hello world"

    def test_lookalike_letters_fold_to_latin(self):
        # Cyrillic e and o inside Latin words
        assert t.normalise("frее mоnеy") == t.normalise("free money")

    def test_leetspeak_folds(self):
        assert t.normalise("fr33 m0n3y") == t.normalise("free money")

    def test_symbols_fold_only_inside_words(self):
        assert t.normalise("fr!ends p@ypal") == "friends paypal"
        assert t.normalise("hi! you @ home") == "hi you home"

    def test_zero_width_and_tag_characters_removed(self):
        assert t.normalise("fr​ee mo\U000e0041ney") == "free money"

    def test_emoji_between_words_removed(self):
        assert t.normalise("free \U0001f525 money \U0001f4b0 now") == "free money now"

    def test_mentions_removed(self):
        assert t.normalise("@[Rob-M0YNW] are you there") == "are you there"

    def test_emoji_only_message_described_by_base_emoji(self):
        plain = t.normalise("\U0001f4a9\U0001f4a9\U0001f4a9")
        toned = t.normalise("\U0001f4a9\U0001f3fd\U0001f4a9\U0001f3fd\U0001f4a9\U0001f3fd")
        assert plain.startswith("emoji ")
        assert plain == toned

    def test_single_thumbs_up_is_not_an_emoji_message(self):
        assert t.normalise("\U0001f44d") == ""


class TestSimilar:
    def sh(self, text: str) -> frozenset[str]:
        return t.shingles(t.normalise(text))

    def test_identical(self):
        assert t.similar(
            self.sh("buy cheap radios at example dot com"),
            self.sh("buy cheap radios at example dot com"),
            0.65,
        )

    def test_padded_copy_still_matches(self):
        a = self.sh("buy cheap radios at example dot com today")
        b = self.sh("zxqv buy cheap radios at example dot com today lkjh")
        assert t.similar(a, b, 0.65)

    def test_unrelated_do_not_match(self):
        assert not t.similar(
            self.sh("anyone on the repeater tonight"),
            self.sh("buy cheap radios at example dot com"),
            0.65,
        )

    def test_empty_never_matches(self):
        assert not t.similar(frozenset(), self.sh("hello there everyone"), 0.5)

    def test_much_shorter_text_does_not_match(self):
        assert not t.similar(
            self.sh("radios"),
            self.sh("buy cheap radios at example dot com today or tomorrow"),
            0.65,
        )

    def test_short_text_is_one_shingle(self):
        assert t.shingles("abc") == frozenset({"abc"})
        assert t.shingles("") == frozenset()


class TestDisguise:
    @pytest.mark.parametrize(
        "text",
        [
            "Bu\U0001f525ilt for speed",  # emoji inside a word
            "hid​den",  # zero-width inside a word
            "t\U000e0041est",  # invisible tag letter
            "pаypal",  # Cyrillic a in a Latin word
        ],
    )
    def test_disguised(self, text):
        assert t.is_disguised(text)

    @pytest.mark.parametrize(
        "text",
        [
            "nice one \U0001f44d",
            "family \U0001f468‍\U0001f469‍\U0001f467 day",
            "England \U0001f3f4\U000e0067\U000e0062\U000e0065\U000e006e\U000e0067\U000e007f",
            "Привет all",  # a whole Cyrillic word next to Latin
        ],
    )
    def test_not_disguised(self, text):
        assert not t.is_disguised(text)

    def test_symbol_inside_a_name_is_styling(self):
        assert not t.is_disguised("HDZ✝rt", name=True)
        assert t.is_disguised("HDZ✝rt")


class TestNameScore:
    @pytest.mark.parametrize("name", ["UD6DWREK", "UD6DWREK\U0001f525", "xk7qz2pw", "QZXKVBNM"])
    def test_generated_names_score_high(self, name):
        assert t.name_score(name, DEFAULT_PATTERNS) >= 3

    @pytest.mark.parametrize(
        "name",
        [
            "Dave1985",
            "Bob42",
            "Sarah2",
            "r3dm0zzy",
            "Dave M",
            "BOT-01-X",
            "Ohm\U0001f50c",
            "Richard",
            "Newcomer",
            "",
        ],
    )
    def test_human_names_score_low(self, name):
        assert t.name_score(name, DEFAULT_PATTERNS) <= 1

    def test_three_different_emoji_only_looks_generated(self):
        assert t.name_score("\U0001f525\U0001f4a9\U0001f680") == 3

    def test_single_emoji_name_is_mild(self):
        assert t.name_score("\U0001f525") == 1

    def test_score_is_capped(self):
        assert 0 <= t.name_score("X9Z8Q7W6K5J4", DEFAULT_PATTERNS) <= 6


class TestRuleText:
    def test_middle_piece_returns_short_text_whole(self):
        assert t.middle_piece("short text", 40) == "short text"

    def test_middle_piece_cuts_on_word_boundaries(self):
        text = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo"
        piece = t.middle_piece(text, 30)
        assert piece in text
        assert len(piece) <= 30
        assert not piece.startswith(" ") and not piece.endswith(" ")
        assert all(word in text.split() for word in piece.split())

    def test_rule_length_counts_emoji_as_three(self):
        assert t.rule_length("abc") == 3
        assert t.rule_length("\U0001f525\U0001f525") == 6

    def test_shared_text_survives_added_words(self):
        copies = [
            "xx visit cheap radios dot example today",
            "visit cheap radios dot example today yy zz",
            "qq visit cheap radios dot example today",
        ]
        assert t.shared_text(copies, 14) == "visit cheap radios dot example today"

    def test_shared_text_never_ends_on_a_half_word(self):
        shared = t.shared_text(
            ["join the meeting starts at noon", "join the meetings start at noon ok"], 8
        )
        assert shared == "join the"

    def test_shared_text_none_when_too_short(self):
        assert t.shared_text(["hello there", "goodbye now"], 14) is None

    def test_shared_text_none_without_texts(self):
        assert t.shared_text([], 14) is None

    def test_shared_words_survive_emoji_moving_around(self):
        copies = [
            "Amazing \U0001f525 bargain radios \U0001f4b0 available tonight",
            "Amazing bargain \U0001f680 radios available \U0001f525 tonight",
        ]
        words = t.shared_words(copies, 14)
        assert words is not None
        assert set(words) <= {"Amazing", "bargain", "radios", "available", "tonight"}
        assert len(words) >= 3
        assert all(w in c for w in words for c in copies)

    def test_shared_words_none_for_single_text(self):
        assert t.shared_words(["only one copy here"], 14) is None

    def test_mentions_split_pieces(self):
        stripped = t.strip_mentions("@[Rob] hello there everyone @[Sue] ok")
        assert t.longest_piece(stripped) == "hello there everyone"

    def test_hops_related_across_widths(self):
        assert t.hops_related("27", "27AB")
        assert t.hops_related("27AB01", "27")
        assert not t.hops_related("27", "28AB")
