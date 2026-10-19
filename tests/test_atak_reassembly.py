"""Reassembly of envelope chunks / CoT fragments and frame dedup."""

from app.atak_payloads import CotFragment, EnvelopeChunk
from app.services.atak_reassembly import AtakReassembler


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def _make(**kwargs) -> tuple[AtakReassembler, FakeClock]:
    clock = FakeClock()
    return AtakReassembler(clock=clock, **kwargs), clock


def test_single_chunk_passthrough():
    r, _ = _make()
    assert r.add_chunk("CH", EnvelopeChunk("1", 1, 1, b"abc")) == b"abc"


def test_three_chunks_out_of_order():
    r, _ = _make()
    assert r.add_chunk("CH", EnvelopeChunk("9", 3, 3, b"ccc")) is None
    assert r.add_chunk("CH", EnvelopeChunk("9", 1, 3, b"aaa")) is None
    assert r.add_chunk("CH", EnvelopeChunk("9", 2, 3, b"bbb")) == b"aaabbbccc"


def test_same_msg_id_other_channel_kept_apart():
    r, _ = _make()
    assert r.add_chunk("A", EnvelopeChunk("9", 1, 2, b"a1")) is None
    assert r.add_chunk("B", EnvelopeChunk("9", 2, 2, b"b2")) is None
    assert r.add_chunk("A", EnvelopeChunk("9", 2, 2, b"a2")) == b"a1a2"


def test_partial_expires():
    r, clock = _make(ttl_s=60.0)
    assert r.add_chunk("CH", EnvelopeChunk("5", 1, 2, b"aa")) is None
    clock.now += 61
    assert r.add_chunk("CH", EnvelopeChunk("5", 2, 2, b"bb")) is None


def test_max_pending_evicts_oldest():
    r, clock = _make(max_pending=2)
    r.add_chunk("CH", EnvelopeChunk("1", 1, 2, b"x1"))
    clock.now += 1
    r.add_chunk("CH", EnvelopeChunk("2", 1, 2, b"y1"))
    clock.now += 1
    r.add_chunk("CH", EnvelopeChunk("3", 1, 2, b"z1"))
    assert r.add_chunk("CH", EnvelopeChunk("1", 2, 2, b"x2")) is None
    assert r.add_chunk("CH", EnvelopeChunk("3", 2, 2, b"z2")) == b"z1z2"


def test_cot_fragments_join():
    r, _ = _make()
    assert r.add_cot_fragment("JSTR25", CotFragment(7, 2, 2, b"tail")) is None
    assert r.add_cot_fragment("JSTR25", CotFragment(7, 1, 2, b"head")) == b"headtail"


def test_duplicate_frame_suppressed():
    r, clock = _make(dedup_ttl_s=120.0)
    assert r.seen_frame("CH", b"frame") is False
    assert r.seen_frame("CH", b"frame") is True
    clock.now += 121
    assert r.seen_frame("CH", b"frame") is False
