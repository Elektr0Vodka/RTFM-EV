"""Tests for workspace URL keys (plan 30, D7 to D10)."""

from __future__ import annotations

from app.gateway.keys import Resolution, assign_url_keys, resolve
from app.gateway.registry import RadioEntry, TcpTransport

KEY_A = "0d1d00147f96" + "57ab" * 13
KEY_B = "b1b2b3b4b5b6" + "00" * 26
KEY_OLD = "0123456789ab" + "cd" * 26


def _radio(radio_id: int, key: str | None, history: list[str] | None = None) -> RadioEntry:
    return RadioEntry(
        id=radio_id,
        name=f"r{radio_id}",
        transport=TcpTransport(host=f"10.0.0.{radio_id}"),
        database_path=f"data/{radio_id}.db",
        public_key=key,
        key_history=history or [],
    )


def test_url_key_is_first_12_hex_lower_case():
    assert assign_url_keys([_radio(1, KEY_A)]) == {1: "0d1d00147f96"}


def test_radio_without_key_has_no_url_key():
    assert assign_url_keys([_radio(1, None), _radio(2, KEY_B)]) == {2: "b1b2b3b4b5b6"}


def test_same_key_gets_suffix_in_id_order():
    radios = [_radio(3, KEY_A), _radio(1, KEY_A), _radio(2, KEY_A)]
    assert assign_url_keys(radios) == {
        1: "0d1d00147f96",
        2: "0d1d00147f96-2",
        3: "0d1d00147f96-3",
    }


def test_current_key_resolves_without_redirect():
    radios = [_radio(1, KEY_A), _radio(2, KEY_A)]
    assert resolve("0d1d00147f96", radios) == Resolution(1, None)
    assert resolve("0d1d00147f96-2", radios) == Resolution(2, None)


def test_upper_case_redirects_to_canonical():
    assert resolve("0D1D00147F96", [_radio(1, KEY_A)]) == Resolution(1, "0d1d00147f96")


def test_longer_form_redirects_to_short_key():
    radios = [_radio(1, KEY_A)]
    assert resolve(KEY_A, radios) == Resolution(1, "0d1d00147f96")
    assert resolve(KEY_A[:20], radios) == Resolution(1, "0d1d00147f96")


def test_longer_form_that_is_not_the_full_key_is_unknown():
    assert resolve("0d1d00147f96ffff", [_radio(1, KEY_A)]) is None


def test_old_key_redirects_to_current():
    radios = [_radio(1, KEY_A, history=[KEY_OLD])]
    assert resolve("0123456789ab", radios) == Resolution(1, "0d1d00147f96")
    assert resolve(KEY_OLD, radios) == Resolution(1, "0d1d00147f96")


def test_current_key_wins_over_history():
    radios = [_radio(1, KEY_B, history=[KEY_A]), _radio(2, KEY_A)]
    assert resolve("0d1d00147f96", radios) == Resolution(2, None)


def test_unknown_and_malformed_segments():
    radios = [_radio(1, KEY_A)]
    assert resolve("ffffffffffff", radios) is None
    assert resolve("0d1d", radios) is None
    assert resolve("not-a-key", radios) is None
    assert resolve("", radios) is None
