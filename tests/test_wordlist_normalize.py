"""Tests for the canonical channel-finder wordlist normalizer."""

from app.wordlist_normalize import normalize_word, normalize_wordlist_text


class TestNormalizeWord:
    def test_lowercases(self):
        assert normalize_word("Amsterdam") == "amsterdam"

    def test_strips_spaces_and_apostrophes(self):
        assert normalize_word("10 eurobiljet") == "10eurobiljet"
        assert normalize_word("auto's") == "autos"
        assert normalize_word("100+'er") == "100er"

    def test_keeps_digits_and_single_hyphens(self):
        assert normalize_word("06-dealer") == "06-dealer"
        assert normalize_word("010") == "010"

    def test_collapses_double_hyphens_and_trims_edges(self):
        assert normalize_word("-foo--bar-") == "foo-bar"

    def test_drops_empty_after_stripping(self):
        assert normalize_word("###") is None
        assert normalize_word("   ") is None

    def test_drops_over_30_chars(self):
        assert normalize_word("a" * 31) is None
        assert normalize_word("a" * 30) == "a" * 30


class TestNormalizeWordlistText:
    def test_dedupes_case_insensitively_preserving_order(self):
        assert normalize_wordlist_text("Amsterdam\nauto's\nAUTOS\namsterdam") == [
            "amsterdam",
            "autos",
        ]

    def test_drops_blank_and_invalid_lines(self):
        assert normalize_wordlist_text("ok\n\n###\nfine") == ["ok", "fine"]

    def test_handles_crlf(self):
        assert normalize_wordlist_text("a\r\nb\r\n") == ["a", "b"]
