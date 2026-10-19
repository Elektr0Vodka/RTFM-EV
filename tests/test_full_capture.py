"""Full capture: decode and reassemble meshcomod 0xC0 pushes (app/full_capture.py)."""

from app.full_capture import (
    STATUS_CRC,
    STATUS_DROPS,
    STATUS_OK,
    CapturedFrame,
    Reassembler,
    build_set_full_capture_frame,
    parse_part,
)

RAW_255 = bytes(i % 251 for i in range(255))


def part(tag, index, count, status, total_len, chunk, snr_x4=0x10, rssi=0xC4) -> bytes:
    """One 0xC0 push: [0xC0][tag][index<<4|count][status][snr_x4][rssi][total_len][chunk]."""
    return bytes([0xC0, tag, index << 4 | count, status, snr_x4, rssi, total_len]) + chunk


def test_build_set_full_capture_frame():
    assert build_set_full_capture_frame(3) == bytes([0xE0, 0x03])
    assert build_set_full_capture_frame(0xFF) == bytes([0xE0, 0x07])


def test_single_part_frame():
    raw = bytes(range(40))
    r = Reassembler()
    frame = r.feed(parse_part(part(7, 0, 1, STATUS_CRC, 40, raw)), now=1.0)
    assert frame == CapturedFrame(status=STATUS_CRC, snr=4.0, rssi=-60, data=raw, dropped=None)


def test_two_parts_in_order():
    r = Reassembler()
    first = parse_part(part(9, 0, 2, STATUS_OK, 255, RAW_255[:169]))
    second = parse_part(part(9, 1, 2, STATUS_OK, 255, RAW_255[169:]))
    assert r.feed(first, now=1.0) is None
    frame = r.feed(second, now=1.1)
    assert frame is not None and frame.data == RAW_255 and frame.status == STATUS_OK


def test_two_parts_reversed():
    r = Reassembler()
    second = parse_part(part(9, 1, 2, STATUS_OK, 255, RAW_255[169:]))
    first = parse_part(part(9, 0, 2, STATUS_OK, 255, RAW_255[:169]))
    assert r.feed(second, now=1.0) is None
    frame = r.feed(first, now=1.1)
    assert frame is not None and frame.data == RAW_255


def test_total_len_mismatch_is_dropped():
    r = Reassembler()
    assert r.feed(parse_part(part(1, 0, 2, STATUS_OK, 200, bytes(169))), now=1.0) is None
    assert r.feed(parse_part(part(1, 1, 2, STATUS_OK, 200, bytes(5))), now=1.1) is None
    assert r.incomplete_dropped == 1


def test_single_part_length_mismatch_is_dropped():
    r = Reassembler()
    assert r.feed(parse_part(part(1, 0, 1, STATUS_CRC, 41, bytes(40))), now=1.0) is None
    assert r.incomplete_dropped == 1


def test_missing_second_part_expires():
    r = Reassembler()
    assert r.feed(parse_part(part(4, 0, 2, STATUS_OK, 200, bytes(169))), now=1.0) is None
    assert r.expire(now=2.9) == 0
    assert r.expire(now=3.1) == 1
    assert r.incomplete_dropped == 1
    # The same tag assembles again later.
    assert r.feed(parse_part(part(4, 0, 2, STATUS_OK, 174, bytes(169))), now=5.0) is None
    frame = r.feed(parse_part(part(4, 1, 2, STATUS_OK, 174, bytes(5))), now=5.1)
    assert frame is not None and len(frame.data) == 174


def test_tag_wraps():
    r = Reassembler()
    a = r.feed(parse_part(part(255, 0, 1, STATUS_CRC, 3, b"abc")), now=1.0)
    b = r.feed(parse_part(part(0, 0, 1, STATUS_CRC, 3, b"def")), now=1.0)
    assert (a.data, b.data) == (b"abc", b"def")


def test_drop_notice():
    r = Reassembler()
    frame = r.feed(parse_part(part(2, 0, 1, STATUS_DROPS, 12, b"")), now=1.0)
    assert frame == CapturedFrame(status=STATUS_DROPS, snr=4.0, rssi=-60, data=b"", dropped=12)


def test_parse_rejects():
    assert parse_part(bytes([0x88]) + bytes(10)) is None
    assert parse_part(part(1, 0, 1, STATUS_OK, 0, b"")[:6]) is None
    assert parse_part(part(1, 0, 3, STATUS_OK, 3, b"abc")) is None
    assert parse_part(part(1, 1, 1, STATUS_OK, 3, b"abc")) is None
    assert parse_part(part(1, 0, 1, 5, 3, b"abc")) is None
    assert parse_part(part(1, 0, 1, STATUS_OK, 170, bytes(170))) is None  # chunk over 169


def test_snr_and_rssi_decode():
    p = parse_part(part(1, 0, 1, STATUS_CRC, 1, b"x", snr_x4=0xF6, rssi=0xC4))
    assert (p.snr, p.rssi) == (-2.5, -60)
