"""Tests for app.radio_stamp: the radio settings a packet or message was heard on."""

from unittest.mock import patch

from app.models import RadioStamp
from app.radio_stamp import current_radio_stamp, stamps_equal


class _FakeManager:
    def __init__(self, self_info):
        self._self_info = self_info

    @property
    def meshcore(self):
        if self._self_info is None:
            return None
        return type("MC", (), {"self_info": self._self_info})()


def test_current_radio_stamp_none_without_radio():
    with patch("app.radio_stamp.radio_manager", _FakeManager(None)):
        assert current_radio_stamp() is None


def test_current_radio_stamp_none_when_sf_zero():
    info = {"radio_freq": 0.0, "radio_bw": 0.0, "radio_sf": 0, "radio_cr": 0}
    with patch("app.radio_stamp.radio_manager", _FakeManager(info)):
        assert current_radio_stamp() is None


def test_current_radio_stamp_from_self_info():
    info = {"radio_freq": 869.618, "radio_bw": 62.5, "radio_sf": 8, "radio_cr": 8}
    with patch("app.radio_stamp.radio_manager", _FakeManager(info)):
        assert current_radio_stamp() == RadioStamp(freq=869.618, bw=62.5, sf=8, cr=8)


def test_stamps_equal_within_tolerance():
    a = RadioStamp(freq=869.618, bw=62.5, sf=8, cr=8)
    b = RadioStamp(freq=869.6185, bw=62.5004, sf=8, cr=8)
    assert stamps_equal(a, b)


def test_stamps_differ_on_sf():
    a = RadioStamp(freq=869.618, bw=62.5, sf=7, cr=8)
    b = RadioStamp(freq=869.618, bw=62.5, sf=8, cr=8)
    assert not stamps_equal(a, b)


def test_stamps_differ_on_freq():
    a = RadioStamp(freq=869.618, bw=62.5, sf=8, cr=8)
    b = RadioStamp(freq=869.525, bw=62.5, sf=8, cr=8)
    assert not stamps_equal(a, b)
