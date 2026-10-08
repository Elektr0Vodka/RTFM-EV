"""Tests for scripts/buddy/acs_to_clippy.py (Microsoft Agent .acs to clippyjs agent)."""

import importlib.util
import json
import random
import struct
import sys
import zlib
from pathlib import Path

import pytest

_SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "buddy" / "acs_to_clippy.py"
_spec = importlib.util.spec_from_file_location("acs_to_clippy", _SCRIPT)
assert _spec and _spec.loader
acs = importlib.util.module_from_spec(_spec)
sys.modules["acs_to_clippy"] = acs
_spec.loader.exec_module(acs)

# Palette index 0 is the transparent colour in the synthetic character.
CLEAR = 0
WIDTH, HEIGHT = 6, 4

# Top-to-bottom rows, so a wrong row order or stride shows up in the assertions.
BODY = [
    [1, 1, 1, 1, 1, 1],
    [2, 0, 0, 0, 0, 2],
    [3, 0, 0, 0, 0, 3],
    [1, 2, 3, 1, 2, 3],
]
PATCH = [
    [3, 3],
    [0, 2],
]


def _string(text: str) -> bytes:
    if not text:
        return struct.pack("<I", 0)
    return struct.pack("<I", len(text)) + text.encode("utf-16-le") + b"\x00\x00"


def _pack_bits(bits: list[int]) -> bytes:
    while len(bits) % 8:
        bits.append(1)
    body = bytes(
        sum(bit << i for i, bit in enumerate(bits[n : n + 8])) for n in range(0, len(bits), 8)
    )
    return b"\x00" + body + b"\xff" * 6


def _number(value: int, width: int) -> list[int]:
    return [(value >> i) & 1 for i in range(width)]


def _literal_compress(raw: bytes) -> bytes:
    """Valid compressed block that uses literals only, then the end marker."""
    bits: list[int] = []
    for byte in raw:
        bits += [0] + _number(byte, 8)
    return _pack_bits(bits + [1] * 24)


# (largest offset, selector bits, offset width, offset base, shortest copy)
_TIERS = (
    (64, [0], 6, 1, 2),
    (576, [1, 0], 9, 65, 2),
    (4672, [1, 1, 0], 12, 577, 2),
    (4673 + 0xFFFFE, [1, 1, 1], 20, 4673, 3),
)


def lz_compress(raw: bytes, widths: set[int] | None = None) -> bytes:
    """Greedy encoder for the Agent bit stream, written from the spec.

    Independent of the decoder under test, so a round trip checks every offset
    width and length code, not only the ones in the spec's worked example.
    """
    bits: list[int] = []
    seen: dict[bytes, list[int]] = {}
    pos = 0
    while pos < len(raw):
        best_length, best_offset = 0, 0
        for start in reversed(seen.get(raw[pos : pos + 3], [])[-8:]):
            length = 0
            while pos + length < len(raw) and raw[start + length] == raw[pos + length]:
                length += 1
            if length > best_length:
                best_length, best_offset = length, pos - start
        tier = next((t for t in _TIERS if best_offset <= t[0]), None)
        if tier is None or best_length < 3:
            bits += [0] + _number(raw[pos], 8)
            step = 1
        else:
            _limit, selector, width, base, shortest = tier
            if widths is not None:
                widths.add(width)
            step = min(best_length, shortest + 4094)
            extra = step - shortest
            ones = (extra + 1).bit_length() - 1
            bits += [1] + selector + _number(best_offset - base, width)
            bits += [1] * ones + [0] + _number(extra - ((1 << ones) - 1), ones)
        for i in range(pos, pos + step):
            seen.setdefault(raw[i : i + 3], []).append(i)
        pos += step
    return _pack_bits(bits + [1] * 24)


def _image(rows: list[list[int]], compressed: bool, size_prefix: bool = True) -> bytes:
    width, height = len(rows[0]), len(rows)
    stride = (width + 3) & ~3
    pixels = b"".join(bytes(row) + b"\x00" * (stride - width) for row in reversed(rows))
    head = struct.pack("<BHHB", 0, width, height, int(compressed))
    if compressed:
        packed = lz_compress(pixels)
        body = struct.pack("<I", len(packed)) + packed
    else:
        body = (struct.pack("<I", len(pixels)) if size_prefix else b"") + pixels
    return head + body + struct.pack("<II", 0, 0)


def _frame(images, sound=0xFFFF, duration=10, exit_frame=-2, branches=(), overlays=0) -> bytes:
    out = struct.pack("<H", len(images))
    for index, x, y in images:
        out += struct.pack("<Ihh", index, x, y)
    out += struct.pack("<HHh", sound, duration, exit_frame)
    out += struct.pack("<B", len(branches))
    for target, weight in branches:
        out += struct.pack("<HH", target, weight)
    out += struct.pack("<B", overlays)
    for _ in range(overlays):
        region = b"\xaa" * 5
        out += struct.pack("<BBHBBhhHH", 1, 0, 1, 0, 1, 0, 0, 1, 1)
        out += struct.pack("<I", len(region)) + region
    return out


def _animation(name: str, transition: int, return_animation: str, frames: list[bytes]) -> bytes:
    return (
        _string(name.upper())
        + struct.pack("<B", transition)
        + _string(return_animation)
        + struct.pack("<H", len(frames))
        + b"".join(frames)
    )


def make_acs(
    *,
    width: int,
    height: int,
    clear: int,
    palette: list[tuple[int, int, int]],
    images: list[bytes],
    animations: dict[str, bytes],
    states: dict[str, list[str]],
    sounds: list[bytes],
    names: dict[int, tuple[str, str]],
    flags: int = 0x220,
) -> bytes:
    """Lay a character out as an .acs file, following the spec's structures."""
    blobs: list[bytes] = []
    cursor = 36  # header size

    def place(blob: bytes) -> tuple[int, int]:
        nonlocal cursor
        offset = cursor
        blobs.append(blob)
        cursor += len(blob)
        return offset, len(blob)

    localized = struct.pack("<H", len(names))
    for lang, (name, description) in names.items():
        localized += struct.pack("<H", lang) + _string(name) + _string(description) + _string("")
    localized_loc = place(localized)

    info = struct.pack("<HH", 0, 2) + struct.pack("<II", *localized_loc) + bytes(16)
    info += struct.pack("<HHBI", width, height, clear, flags) + struct.pack("<HH", 2, 0)
    if flags & 0x20:
        info += bytes(16) + bytes(16) + struct.pack("<IHB", 150, 100, 1)
        info += struct.pack("<H", 0x0409) + _string("en-US") + struct.pack("<HH", 1, 30)
        info += _string("Casual")
    if flags & 0x200:
        info += struct.pack("<BB", 2, 28) + bytes(12) + _string("Arial")
        info += struct.pack("<iiBB", -12, 400, 0, 0)
    # RGBQUADs are stored blue, green, red, reserved.
    info += struct.pack("<I", len(palette))
    info += b"".join(bytes((blue, green, red, 0)) for red, green, blue in palette)
    info += struct.pack("<B", 1) + struct.pack("<I", 3) + b"abc" + struct.pack("<I", 2) + b"de"
    info += struct.pack("<H", len(states))
    for state, state_animations in states.items():
        info += _string(state) + struct.pack("<H", len(state_animations))
        info += b"".join(_string(name) for name in state_animations)
    info_loc = place(info)

    image_locs = [place(image) for image in images]
    sound_locs = [place(sound) for sound in sounds]

    anim_list = struct.pack("<I", len(animations))
    for name, blob in animations.items():
        anim_list += _string(name) + struct.pack("<II", *place(blob))
    anim_loc = place(anim_list)

    image_list = struct.pack("<I", len(image_locs))
    for loc in image_locs:
        image_list += struct.pack("<III", *loc, 0)
    image_loc = place(image_list)

    audio_list = struct.pack("<I", len(sound_locs))
    for loc in sound_locs:
        audio_list += struct.pack("<III", *loc, 0)
    audio_loc = place(audio_list)

    header = struct.pack("<I", acs.ACS_SIGNATURE)
    for loc in (info_loc, anim_loc, image_loc, audio_loc):
        header += struct.pack("<II", *loc)
    assert len(header) == 36
    return header + b"".join(blobs)


def build_acs(flags: int = 0x220, size_prefix: bool = True) -> bytes:
    """A complete two-image, three-animation character."""
    return make_acs(
        width=WIDTH,
        height=HEIGHT,
        clear=CLEAR,
        palette=[(255, 0, 255), (255, 0, 0), (0, 255, 0), (0, 0, 255)],
        images=[
            _image(BODY, compressed=True),
            _image(PATCH, compressed=False, size_prefix=size_prefix),
        ],
        animations={
            "Show": _animation("Show", 2, "", [_frame([(0, 0, 0)])]),
            "Idle1_1": _animation(
                "Idle1_1",
                0,
                "RESTPOSE",
                [
                    # First image is the top-most: the patch sits over the body.
                    _frame(
                        [(1, 3, 1), (0, 0, 0)],
                        sound=0,
                        duration=5,
                        exit_frame=1,
                        branches=[(0, 30), (1, 70)],
                        overlays=1,
                    ),
                    _frame([(0, 0, 0)]),
                ],
            ),
            "Wave": _animation("Wave", 1, "", [_frame([], duration=0), _frame([(1, 5, 3)])]),
        },
        states={"SHOWING": ["Show"], "IDLINGLEVEL1": ["Idle1_1"]},
        sounds=[b"RIFF\x04\x00\x00\x00WAVE"],
        names={0x0413: ("Testje", "NL"), 0x0409: ("Tester", "A test")},
        flags=flags,
    )


def decode_png(png: bytes) -> dict:
    """Minimal reader for the PNGs the converter writes (palette, filter 0)."""
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    pos, chunks = 8, {}
    while pos < len(png):
        (length,) = struct.unpack_from(">I", png, pos)
        tag = png[pos + 4 : pos + 8]
        payload = png[pos + 8 : pos + 8 + length]
        (crc,) = struct.unpack_from(">I", png, pos + 8 + length)
        assert crc == zlib.crc32(tag + payload) & 0xFFFFFFFF
        chunks[tag] = payload
        pos += 12 + length
    width, height, depth, colour_type = struct.unpack_from(">IIBB", chunks[b"IHDR"])
    assert (depth, colour_type) == (8, 3)
    raw = zlib.decompress(chunks[b"IDAT"])
    rows = []
    for y in range(height):
        line = raw[y * (width + 1) : (y + 1) * (width + 1)]
        assert line[0] == 0
        rows.append(list(line[1:]))
    return {
        "width": width,
        "height": height,
        "rows": rows,
        "palette": chunks[b"PLTE"],
        "alpha": chunks[b"tRNS"],
    }


def cell(image: dict, xy: list[int]) -> list[list[int]]:
    x, y = xy
    return [row[x : x + WIDTH] for row in image["rows"][y : y + HEIGHT]]


class TestDecompress:
    def test_spec_worked_example(self):
        packed = bytes.fromhex("0040000410D0908042ED9801B7FFFFFFFFFFFF")
        expected = bytes.fromhex("2000000001000000" + "00000000A8000000" + "00" * 16)
        assert acs.decompress(packed) == expected

    def test_literal_round_trip(self):
        raw = bytes(range(256)) * 3
        assert acs.decompress(_literal_compress(raw)) == raw

    def test_round_trip_through_every_offset_width_and_length_code(self):
        rng = random.Random(1)
        phrase = rng.randbytes(50)
        # The phrase repeats 50, 350, 2350 and 8350 bytes back (6, 9, 12 and
        # 20 bit offsets); the zero run is longer than one length code holds.
        raw = (
            phrase
            + phrase
            + rng.randbytes(300)
            + phrase
            + rng.randbytes(2300)
            + phrase
            + rng.randbytes(8300)
            + phrase
            + bytes(9000)
        )
        widths: set[int] = set()
        packed = lz_compress(raw, widths)
        assert widths == {6, 9, 12, 20}
        assert len(packed) < len(raw)
        assert acs.decompress(packed) == raw

    def test_rejects_missing_leading_zero(self):
        with pytest.raises(acs.AcsError):
            acs.decompress(b"\x01\xff\xff\xff")

    def test_rejects_missing_end_marker(self):
        with pytest.raises(acs.AcsError):
            acs.decompress(b"\x00\x40\x00")

    def test_rejects_reference_before_start(self):
        # Back-reference (offset 1, length 2) with nothing written yet.
        with pytest.raises(acs.AcsError):
            acs.decompress(b"\x00\x01\x00\x00")


class TestParse:
    def test_reads_character(self):
        char = acs.parse_acs(build_acs())
        assert (char.name, char.description) == ("Tester", "A test")
        assert (char.width, char.height, char.transparent_index) == (WIDTH, HEIGHT, CLEAR)
        assert char.palette == [(255, 0, 255), (255, 0, 0), (0, 255, 0), (0, 0, 255)]
        assert char.states == {"SHOWING": ["Show"], "IDLINGLEVEL1": ["Idle1_1"]}
        assert [a.name for a in char.animations] == ["Show", "Idle1_1", "Wave"]
        assert char.sounds == [b"RIFF\x04\x00\x00\x00WAVE"]
        assert char.warnings == []

    def test_reads_frames(self):
        idle = acs.parse_acs(build_acs()).animations[1]
        assert (idle.transition, idle.return_animation) == (acs.TRANSITION_RETURN, "RESTPOSE")
        first = idle.frames[0]
        assert [(i.image_index, i.x, i.y) for i in first.images] == [(1, 3, 1), (0, 0, 0)]
        assert (first.sound_index, first.duration, first.exit_frame) == (0, 5, 1)
        assert first.branches == [(0, 30), (1, 70)]
        assert first.overlay_count == 1
        assert idle.frames[1].exit_frame == -2

    @pytest.mark.parametrize("flags", [0x220, 0x020, 0x200, 0x000])
    def test_optional_voice_and_balloon_blocks(self, flags):
        char = acs.parse_acs(build_acs(flags=flags))
        assert len(char.palette) == 4
        assert len(char.animations) == 3

    def test_uncompressed_image_without_size_prefix(self):
        char = acs.parse_acs(build_acs(size_prefix=False))
        assert char.warnings == []
        assert char.images[1].pixels[:2] == bytes(PATCH[1])

    def test_rejects_other_files(self):
        with pytest.raises(acs.AcsError, match="signature"):
            acs.parse_acs(b"not an acs file at all")
        with pytest.raises(acs.AcsError, match="Agent 1.5"):
            acs.parse_acs(b"\xd0\xcf\x11\xe0" + bytes(64))


class TestConvert:
    def test_agent_data_matches_clippyjs_shape(self):
        result = acs.convert(acs.parse_acs(build_acs()), columns=2)
        agent = result.agent
        assert agent["overlayCount"] == 1
        assert agent["framesize"] == [WIDTH, HEIGHT]
        assert agent["sounds"] == ["1"]
        # The file has no "Hide"; clippyjs needs one to dismiss the buddy.
        assert list(agent["animations"]) == ["Show", "Idle1_1", "Wave", "Hide"]
        assert agent["animations"]["Hide"] == {"frames": [{"duration": 100, "images": []}]}

        show = agent["animations"]["Show"]
        assert show == {"frames": [{"duration": 100, "images": [[0, 0]]}]}

        idle = agent["animations"]["Idle1_1"]["frames"]
        assert idle[0] == {
            "duration": 50,
            "images": [[WIDTH, 0]],
            "sound": "1",
            "exitBranch": 1,
            "branching": {
                "branches": [{"frameIndex": 0, "weight": 30}, {"frameIndex": 1, "weight": 70}]
            },
        }
        # Same picture as the Show frame, so it reuses that cell.
        assert idle[1] == {"duration": 100, "images": [[0, 0]]}

        wave = agent["animations"]["Wave"]
        assert wave["useExitBranching"] is True
        assert wave["frames"][0] == {"duration": 0, "images": []}
        assert wave["frames"][1]["images"] == [[0, HEIGHT]]
        assert "useExitBranching" not in agent["animations"]["Idle1_1"]

    def test_sprite_sheet_pixels(self):
        result = acs.convert(acs.parse_acs(build_acs()), columns=2)
        image = decode_png(result.png)
        assert (image["width"], image["height"]) == (2 * WIDTH, 2 * HEIGHT)
        assert result.sheet_size == (2 * WIDTH, 2 * HEIGHT)
        assert (result.cells, result.frames) == (3, 5)
        assert image["palette"][:12] == bytes([255, 0, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255])
        assert image["alpha"] == b"\x00"

        frames = result.agent["animations"]
        assert cell(image, frames["Show"]["frames"][0]["images"][0]) == BODY
        # Patch over the body at (3, 1); its transparent pixel lets the body show.
        assert cell(image, frames["Idle1_1"]["frames"][0]["images"][0]) == [
            [1, 1, 1, 1, 1, 1],
            [2, 0, 0, 3, 3, 2],
            [3, 0, 0, 0, 2, 3],
            [1, 2, 3, 1, 2, 3],
        ]
        # Patch at (5, 3) is clipped to the one pixel that fits.
        assert cell(image, frames["Wave"]["frames"][1]["images"][0]) == [
            [0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 3],
        ]
        # The unused fourth cell stays transparent.
        assert cell(image, [WIDTH, HEIGHT]) == [[CLEAR] * WIDTH] * HEIGHT

    def test_notes(self):
        notes = acs.plan_animations(acs.parse_acs(build_acs())).notes
        assert '"Hide" made as one empty frame (the file has none)' in notes
        assert not any('"Show"' in note for note in notes)
        assert any("mouth overlays" in note for note in notes)
        # Idle1_1 names RESTPOSE as its return animation; the file has none.
        assert "1 return animations are missing or empty" in notes


def build_quirky_acs(states: dict[str, list[str]] | None = None) -> bytes:
    """What real third-party characters do: upper-case names, states instead of
    the "Show"/"Idle" names clippyjs looks for, return animations, an animation
    without frames and a deleted image."""
    body = [(0, 0, 0)]
    if states is None:
        states = {
            "SHOWING": ["APPEAR"],
            "IdlingLevel1": ["BLINK", "BLINK"],
            "IDLINGLEVEL2": ["RESTPOSE", "GONE"],
        }
    return make_acs(
        width=WIDTH,
        height=HEIGHT,
        clear=CLEAR,
        palette=[(255, 0, 255), (255, 0, 0), (0, 255, 0), (0, 0, 255)],
        images=[_image(BODY, compressed=True), _image(PATCH, compressed=False), b"\x00"],
        animations={
            "RESTPOSE": _animation("RESTPOSE", 2, "", [_frame(body)]),
            "BLINK": _animation("BLINK", 2, "", [_frame([(1, 0, 0)]), _frame(body)]),
            "LookLeft": _animation(
                "LookLeft",
                0,
                "LOOKLEFTRETURN",
                [_frame([(1, 0, 0)], branches=[(0, 50)]), _frame([(1, 1, 0)], exit_frame=1)],
            ),
            "LookLeftReturn": _animation(
                "LookLeftReturn",
                2,
                "",
                [_frame([(1, 2, 0)], exit_frame=1, branches=[(1, 100)]), _frame(body)],
            ),
            "Empty": _animation("Empty", 2, "", []),
            "Appear": _animation("Appear", 2, "", [_frame([(2, 0, 0)]), _frame(body)]),
        },
        states=states,
        sounds=[],
        names={0x0407: ("Schrullig", ""), 0x0809: ("Quirky", "")},
    )


class TestClippyjsCompatibility:
    def test_return_animation_is_appended_with_shifted_frame_indexes(self):
        agent = acs.convert(acs.parse_acs(build_quirky_acs())).agent
        frames = agent["animations"]["LookLeft"]["frames"]
        assert len(frames) == 4
        assert frames[0]["branching"] == {"branches": [{"frameIndex": 0, "weight": 50}]}
        assert frames[1]["exitBranch"] == 1
        # The two frames of LookLeftReturn, pointing at their new positions.
        assert frames[2]["exitBranch"] == 3
        assert frames[2]["branching"] == {"branches": [{"frameIndex": 3, "weight": 100}]}
        assert frames[2:] != agent["animations"]["LookLeftReturn"]["frames"]
        assert frames[3] == agent["animations"]["LookLeftReturn"]["frames"][1]

    def test_return_animations_can_be_left_alone(self):
        result = acs.convert(acs.parse_acs(build_quirky_acs()), chain_returns=False)
        assert len(result.agent["animations"]["LookLeft"]["frames"]) == 2
        assert "1 animations have a return animation that is not chained" in result.notes

    def test_names_clippyjs_needs_come_from_the_states(self):
        result = acs.convert(acs.parse_acs(build_quirky_acs()))
        animations = result.agent["animations"]
        assert animations["Show"] == animations["Appear"]
        assert animations["Idle1_1"] == animations["BLINK"]
        assert animations["Idle2_1"] == animations["RESTPOSE"]
        assert "Idle1_2" not in animations  # BLINK was listed twice
        assert "Idle2_2" not in animations  # GONE is not an animation
        assert animations["Hide"] == {"frames": [{"duration": 100, "images": []}]}
        assert '"Show" copies "Appear"' in result.notes
        assert "idle animations taken from the idling states: Idle1_1, Idle2_1" in result.notes

    def test_show_is_made_from_the_rest_pose_when_no_state_names_one(self):
        result = acs.convert(acs.parse_acs(build_quirky_acs(states={})))
        animations = result.agent["animations"]
        rest = animations["RESTPOSE"]["frames"][0]["images"]
        assert animations["Show"] == {"frames": [{"duration": 100, "images": rest}]}
        assert not any(name.startswith("Idle") for name in animations)
        assert any("stands still" in note for note in result.notes)

    def test_upper_case_show_and_hide_get_the_exact_names(self):
        data = make_acs(
            width=WIDTH,
            height=HEIGHT,
            clear=CLEAR,
            palette=[(255, 0, 255), (255, 0, 0)],
            images=[_image(BODY, compressed=True)],
            animations={
                "SHOW": _animation("SHOW", 2, "", [_frame([(0, 0, 0)])]),
                "HIDE": _animation("HIDE", 2, "", [_frame([])]),
            },
            states={},
            sounds=[],
            names={},
        )
        result = acs.convert(acs.parse_acs(data))
        animations = result.agent["animations"]
        assert animations["Show"] == animations["SHOW"]
        assert animations["Hide"] == animations["HIDE"]
        assert acs.parse_acs(data).name == ""

    def test_names_are_left_alone_on_request(self):
        result = acs.convert(acs.parse_acs(build_quirky_acs()), aliases=False)
        assert list(result.agent["animations"]) == [
            "RESTPOSE",
            "BLINK",
            "LookLeft",
            "LookLeftReturn",
            "Appear",
        ]
        assert 'no "Show" animation: agent.show() will not work' in result.notes
        assert 'no "Hide" animation: agent.hide() will not work' in result.notes

    def test_animation_without_frames_is_left_out(self):
        result = acs.convert(acs.parse_acs(build_quirky_acs()))
        assert "Empty" not in result.agent["animations"]
        assert 'animation "Empty" has no frames and is left out' in result.notes

    def test_deleted_image_is_drawn_as_nothing(self):
        char = acs.parse_acs(build_quirky_acs())
        assert char.images[2] is None
        assert char.warnings == ["1 empty image entries are drawn as nothing"]
        appear = acs.convert(char).agent["animations"]["Appear"]["frames"]
        assert appear[0]["images"] == []
        assert appear[1]["images"] != []

    def test_english_name_is_found_by_primary_language(self):
        assert acs.parse_acs(build_quirky_acs()).name == "Quirky"


class TestCli:
    def test_writes_agent_files(self, tmp_path, capsys):
        source = tmp_path / "tester.acs"
        source.write_bytes(build_acs())
        out = tmp_path / "out"
        code = acs.main([str(source), "--out", str(out), "--info", "--preview", "--sounds"])
        assert code == 0
        agent = json.loads((out / "agent.json").read_text(encoding="utf-8"))
        assert agent["framesize"] == [WIDTH, HEIGHT]
        assert decode_png((out / "map.png").read_bytes())["height"] % HEIGHT == 0
        assert (out / "sounds" / "1.wav").read_bytes().startswith(b"RIFF")
        preview = (out / "preview.html").read_text(encoding="utf-8")
        assert "data:image/png;base64," in preview and "Idle1_1" in preview
        printed = capsys.readouterr().out
        assert "name:         Tester" in printed
        assert "3 animations, 5 frames, 3 unique cells" in printed

    def test_reports_unreadable_file(self, tmp_path, capsys):
        source = tmp_path / "junk.acs"
        source.write_bytes(b"junk" * 20)
        assert acs.main([str(source), "--out", str(tmp_path / "out")]) == 1
        assert "not an Agent 2.0 character file" in capsys.readouterr().err
        assert not (tmp_path / "out").exists()
