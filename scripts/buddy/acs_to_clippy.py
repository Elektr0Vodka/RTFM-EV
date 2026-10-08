#!/usr/bin/env python3
"""Convert a Microsoft Agent character file (.acs) into a clippyjs agent.

Reads Agent 2.0 files and the older Agent 1.5 files (OLE containers). The
result loads in the clippyjs library as it is, so the app's desktop buddy can
show the character. See scripts/buddy/README.md.

Usage:
    python scripts/buddy/acs_to_clippy.py Robby.acs --info
    python scripts/buddy/acs_to_clippy.py Robby.acs --out out/robby --preview

Output (in --out):
    agent.json    animation data in the shape clippyjs' Animator reads
    map.png       sprite sheet, one cell per unique composited frame
    preview.html  self-contained player to eyeball the result (--preview)
    sounds/N.wav  the character's sound effects (--sounds)

Format reference for 2.0: "MS Agent Character Data Specification" by Remy
Lebeau (https://uploads.s.zeid.me/ms-agent-format-spec.html). The 1.5 layout
is described next to its reader below. Standard library only.
"""

from __future__ import annotations

import argparse
import base64
import json
import math
import struct
import sys
import zlib
from dataclasses import dataclass, field
from pathlib import Path

ACS_SIGNATURE = 0xABCDABC3
NO_SOUND = 0xFFFF
TRANSITION_RETURN = 0
TRANSITION_EXIT_BRANCHES = 1
TRANSITION_NONE = 2
TRANSITION_NAMES = {
    TRANSITION_RETURN: "return animation",
    TRANSITION_EXIT_BRANCHES: "exit branches",
    TRANSITION_NONE: "none",
}

# (voice flag, balloon flag) candidates for ACSCHARACTERINFO.flags. The spec and
# other readers disagree on the voice bit, so the reader tries each and keeps the
# first that parses to a sane palette. 0 means "block is always present".
_FLAG_LAYOUTS = ((0x20, 0x200), (0x20, 0), (0x10, 0x200), (0x10, 0))


class AcsError(ValueError):
    """The file is not a readable Microsoft Agent 2.0 character."""


# --------------------------------------------------------------------------- #
# Compression
# --------------------------------------------------------------------------- #


def decompress(src: bytes) -> bytes:
    """Undo the LZ-style bit stream used for image and region data.

    Layout: one 0x00 byte, the bit stream (least significant bit first), then
    six 0xFF bytes. A 0 bit is followed by a literal byte. A 1 bit starts a
    back-reference: an offset in one of four widths, then a length.
    """
    if not src or src[0] != 0:
        raise AcsError("compressed block does not start with 0x00")
    data = src + b"\x00\x00\x00\x00"
    limit = len(src) * 8
    out = bytearray()
    pos = 8
    while pos < limit:
        word = int.from_bytes(data[pos >> 3 : (pos >> 3) + 4], "little") >> (pos & 7)
        if not word & 1:
            out.append((word >> 1) & 0xFF)
            pos += 9
            continue
        if not word & 0b0010:
            width, base, prefix = 6, 1, 2
        elif not word & 0b0100:
            width, base, prefix = 9, 65, 3
        elif not word & 0b1000:
            width, base, prefix = 12, 577, 4
        else:
            width, base, prefix = 20, 4673, 4
        pos += prefix
        word = int.from_bytes(data[pos >> 3 : (pos >> 3) + 4], "little") >> (pos & 7)
        value = word & ((1 << width) - 1)
        pos += width
        length = 2
        if width == 20:
            if value == 0xFFFFF:
                return bytes(out)
            length = 3
        offset = value + base
        if offset > len(out):
            raise AcsError("back-reference before the start of the output")
        word = int.from_bytes(data[pos >> 3 : (pos >> 3) + 4], "little") >> (pos & 7)
        ones = 0
        while ones < 11 and (word >> ones) & 1:
            ones += 1
        if (word >> ones) & 1:
            raise AcsError("malformed length in compressed block")
        pos += ones + 1
        word = int.from_bytes(data[pos >> 3 : (pos >> 3) + 4], "little") >> (pos & 7)
        length += (1 << ones) - 1 + (word & ((1 << ones) - 1))
        pos += ones
        start = len(out) - offset
        if offset >= length:
            out += out[start : start + length]
        else:
            # Overlapping copy: the last `offset` bytes repeat.
            chunk = bytes(out[start:])
            out += (chunk * (length // offset + 1))[:length]
    raise AcsError("compressed block has no end marker")


# --------------------------------------------------------------------------- #
# Parsing
# --------------------------------------------------------------------------- #


class Reader:
    def __init__(self, data: bytes, pos: int = 0, terminated_strings: bool = True) -> None:
        self.data = data
        self.pos = pos
        # Agent 2.0 strings end in an uncounted terminator, 1.5 strings do not.
        self.terminated_strings = terminated_strings

    def _take(self, fmt: str, size: int) -> int:
        if self.pos + size > len(self.data):
            raise AcsError("unexpected end of file")
        (value,) = struct.unpack_from(fmt, self.data, self.pos)
        self.pos += size
        return value

    def u8(self) -> int:
        return self._take("<B", 1)

    def u16(self) -> int:
        return self._take("<H", 2)

    def i16(self) -> int:
        return self._take("<h", 2)

    def u32(self) -> int:
        return self._take("<I", 4)

    def i32(self) -> int:
        return self._take("<i", 4)

    def raw(self, size: int) -> bytes:
        if size < 0 or self.pos + size > len(self.data):
            raise AcsError("unexpected end of file")
        chunk = self.data[self.pos : self.pos + size]
        self.pos += size
        return chunk

    def string(self) -> str:
        """Character count, then UTF-16LE characters (and their terminator)."""
        count = self.u32()
        if count == 0:
            return ""
        chunk = self.raw((count + self.terminated_strings) * 2)
        return chunk[: count * 2].decode("utf-16-le", errors="replace")

    def locator(self) -> tuple[int, int]:
        return self.u32(), self.u32()


@dataclass
class FrameImage:
    image_index: int
    x: int
    y: int


@dataclass
class Frame:
    images: list[FrameImage]
    sound_index: int
    duration: int  # 1/100 s
    exit_frame: int
    branches: list[tuple[int, int]]  # (frame index, probability %)
    overlay_count: int


@dataclass
class Animation:
    name: str
    transition: int
    return_animation: str
    frames: list[Frame]


@dataclass
class Image:
    width: int
    height: int
    pixels: bytes  # palette indexes, bottom-up rows padded to 4 bytes

    @property
    def stride(self) -> int:
        return (self.width + 3) & ~3


@dataclass
class Character:
    name: str
    description: str
    version: tuple[int, int]
    width: int
    height: int
    transparent_index: int
    flags: int
    flag_layout: tuple[int, int]
    palette: list[tuple[int, int, int]]
    states: dict[str, list[str]]
    animations: list[Animation]
    images: list[Image | None]
    sounds: list[bytes]
    warnings: list[str] = field(default_factory=list)


def _read_character_info(
    data: bytes, offset: int, size: int, voice_flag: int, balloon_flag: int
) -> dict:
    r = Reader(data, offset)
    minor, major = r.u16(), r.u16()
    localized = r.locator()
    r.raw(16)  # GUID
    width, height = r.u16(), r.u16()
    transparent_index = r.u8()
    flags = r.u32()
    r.raw(4)  # animation set version

    if flags & voice_flag:
        r.raw(16 + 16 + 4 + 2)  # engine id, mode id, speed, pitch
        if r.u8():
            r.u16()  # language id
            r.string()  # dialect
            r.raw(4)  # gender, age
            r.string()  # style
    if balloon_flag == 0 or flags & balloon_flag:
        r.raw(2 + 4 + 4 + 4)  # lines, chars per line, three colours
        r.string()  # font name
        r.raw(4 + 4 + 1 + 1)  # height, weight, italic, unknown

    palette_count = r.u32()
    if not 1 <= palette_count <= 256:
        raise AcsError(f"implausible palette size {palette_count}")
    palette = []
    for _ in range(palette_count):
        blue, green, red, _reserved = r.raw(4)
        palette.append((red, green, blue))

    tray_flag = r.u8()
    if tray_flag not in (0, 1):
        raise AcsError(f"implausible tray icon flag {tray_flag}")
    if tray_flag:
        r.raw(r.u32())  # monochrome mask
        r.raw(r.u32())  # colour bitmap

    states: dict[str, list[str]] = {}
    for _ in range(r.u16()):
        state = r.string()
        states[state] = [r.string() for _ in range(r.u16())]

    # Reading past the block means this flag layout is the wrong guess.
    if size and r.pos > offset + size:
        raise AcsError("character info overruns its block")

    return {
        "version": (major, minor),
        "localized": localized,
        "width": width,
        "height": height,
        "transparent_index": transparent_index,
        "flags": flags,
        "palette": palette,
        "states": states,
    }


def _read_localized(data: bytes, locator: tuple[int, int]) -> tuple[str, str]:
    """Name and description, preferring an English entry (primary language 0x09)."""
    offset, size = locator
    if not size:
        return "", ""
    entries: list[tuple[int, str, str]] = []
    try:
        r = Reader(data, offset)
        for _ in range(r.u16()):
            lang = r.u16()
            name, description, _extra = r.string(), r.string(), r.string()
            entries.append((lang, name, description))
    except AcsError:
        pass
    if not entries:
        return "", ""
    entries.sort(key=lambda entry: entry[0] & 0x3FF != 0x09)
    return entries[0][1], entries[0][2]


def _read_frame(r: Reader) -> Frame:
    images = [FrameImage(r.u32(), r.i16(), r.i16()) for _ in range(r.u16())]
    sound_index = r.u16()
    duration = r.u16()
    exit_frame = r.i16()
    branches = [(r.u16(), r.u16()) for _ in range(r.u8())]
    overlay_count = r.u8()
    for _ in range(overlay_count):
        r.raw(1 + 1 + 2 + 1)  # type, replace flag, image index, unknown
        has_region = r.u8()
        r.raw(2 + 2 + 2 + 2)  # x, y, width, height
        if has_region:
            r.raw(r.u32())
    return Frame(images, sound_index, duration, exit_frame, branches, overlay_count)


# unknown byte, width, height, compression flag, data size
_IMAGE_HEADER_SIZE = 1 + 2 + 2 + 1 + 4


def _read_image(data: bytes, offset: int) -> Image:
    r = Reader(data, offset)
    r.u8()  # unknown
    width, height = r.u16(), r.u16()
    compressed = r.u8()
    expected = ((width + 3) & ~3) * height
    size = r.u32()
    if compressed:
        pixels = decompress(r.raw(size))
    elif size == expected:
        pixels = r.raw(size)
    else:
        # Some writers leave the size prefix off uncompressed data.
        r.pos -= 4
        pixels = r.raw(expected)
    if len(pixels) < expected:
        raise AcsError(f"image has {len(pixels)} bytes, expected {expected}")
    return Image(width, height, pixels[:expected])


# --------------------------------------------------------------------------- #
# Agent 1.5 files
# --------------------------------------------------------------------------- #
#
# An Agent 1.5 .acs file is an OLE compound file holding one "char.acf" stream
# and one ".aaf" stream per animation. The spec above does not cover it; this
# layout was worked out from real files and is accepted only when a stream is
# read to its last byte.
#
#   char.acf   ULONG 0xABCDABC1, ULONG size, ULONG compressed size, then the
#              block (same compression as 2.0):
#                USHORT minor, USHORT major
#                USHORT count, then per animation: STRING name, STRING stream
#                  name, STRING return animation, ULONG checksum
#                GUID, STRING name, STRING description, STRING extra data
#                USHORT width, USHORT height, BYTE transparent index, ULONG flags
#                voice (flag 0x20): GUID, GUID, ULONG speed, USHORT pitch
#                balloon (flag 0x200): as in 2.0, in version 1.30 one byte shorter
#                ULONG count, RGBQUAD palette
#                USHORT count, states as in 2.0
#              Strings are a ULONG character count and UTF-16LE characters,
#              without the terminator 2.0 adds.
#   *.aaf      USHORT minor, USHORT major, ULONG checksum, BYTE compressed,
#              [ULONG size, ULONG compressed size], then the block:
#                USHORT count, sounds: ULONG size, RIFF data
#                USHORT count, images: ULONG size, BYTE 0, pixels, ULONG size,
#                  region data. Every image has the size of the character.
#                USHORT count, frames: USHORT image, USHORT sound (0xFFFF none),
#                  USHORT duration, ULONG 0, BYTE count + branches as in 2.0,
#                  BYTE count + mouth overlays: BYTE shape, ULONG size and, when
#                  the size is not 0: BYTE 0, SHORT x, SHORT y, USHORT width,
#                  USHORT height, pixels.
#              There are no exit branches and no layered images.

OLE_SIGNATURE = bytes.fromhex("d0cf11e0a1b11ae1")
ACF_V15_SIGNATURE = 0xABCDABC1
_CFB_END_OF_CHAIN = 0xFFFFFFFE  # 0xFFFFFFFF marks a free sector
_CFB_STREAM, _CFB_ROOT = 2, 5


def read_compound_file(data: bytes) -> dict[str, bytes]:
    """Streams of an OLE compound file, by lower-case name."""
    if data[:8] != OLE_SIGNATURE or len(data) < 512:
        raise AcsError("not an OLE compound file")
    sector_shift, mini_shift = struct.unpack_from("<HH", data, 30)
    if sector_shift not in (9, 12) or mini_shift != 6:
        raise AcsError("unsupported compound file sector size")
    fat_count, dir_start, _tx, cutoff, minifat_start, _n, difat_start, _m = struct.unpack_from(
        "<8I", data, 44
    )
    size = 1 << sector_shift
    per_sector = size // 4

    def sector(index: int) -> bytes:
        start = (index + 1) << sector_shift
        if start >= len(data):
            raise AcsError("compound file sector is outside the file")
        return data[start : start + size].ljust(size, b"\x00")

    def chain(start: int, table, read) -> bytes:
        out = bytearray()
        index, steps = start, 0
        while index < _CFB_END_OF_CHAIN:
            if index >= len(table) or steps > len(table):
                raise AcsError("compound file sector chain is broken")
            out += read(index)
            index = table[index]
            steps += 1
        return bytes(out)

    difat = list(struct.unpack_from("<109I", data, 76))
    more = difat_start
    while more < _CFB_END_OF_CHAIN and len(difat) < fat_count + per_sector:
        entries = struct.unpack(f"<{per_sector}I", sector(more))
        difat += entries[:-1]
        more = entries[-1]
    fat: list[int] = []
    for index in difat[:fat_count]:
        fat += struct.unpack(f"<{per_sector}I", sector(index))

    directory = chain(dir_start, fat, sector)
    entries = []
    for pos in range(0, len(directory) - 127, 128):
        name_size, kind = struct.unpack_from("<HB", directory, pos + 64)
        start, length = struct.unpack_from("<II", directory, pos + 116)
        name = directory[pos : pos + max(min(name_size, 64) - 2, 0)].decode("utf-16-le", "replace")
        entries.append((name, kind, start, length))
    root = next((entry for entry in entries if entry[1] == _CFB_ROOT), None)
    if root is None:
        raise AcsError("compound file has no root entry")

    # Streams below the cutoff live in 64-byte sectors inside the root's stream.
    mini_stream = chain(root[2], fat, sector)[: root[3]]
    mini_raw = chain(minifat_start, fat, sector)
    minifat = struct.unpack(f"<{len(mini_raw) // 4}I", mini_raw)
    mini = 1 << mini_shift

    def mini_sector(index: int) -> bytes:
        return mini_stream[index * mini : (index + 1) * mini]

    streams: dict[str, bytes] = {}
    for name, kind, start, length in entries:
        if kind != _CFB_STREAM:
            continue
        if length < cutoff:
            body = chain(start, minifat, mini_sector)
        else:
            body = chain(start, fat, sector)
        streams[name.lower()] = body[:length]
    return streams


def _unpack_v15_stream(blob: bytes, name: str) -> bytes:
    """The block inside char.acf or an .aaf stream, decompressed."""
    r = Reader(blob)
    if blob[:4] == struct.pack("<I", ACF_V15_SIGNATURE):
        r.u32()
    else:
        r.raw(2 + 2 + 4)  # version, checksum
        if not r.u8():
            return blob[r.pos :]
    size, packed = r.u32(), r.u32()
    body = decompress(r.raw(packed)) if packed else r.raw(size)
    if len(body) != size:
        raise AcsError(f"{name} is damaged ({len(body)} bytes where {size} are stated)")
    return body


def _read_v15_character_info(
    body: bytes, voice_flag: int, balloon_flag: int, balloon_tail: int
) -> dict:
    r = Reader(body, terminated_strings=False)
    minor, major = r.u16(), r.u16()
    animations = []
    for _ in range(r.u16()):
        name, stream, return_animation = r.string(), r.string(), r.string()
        r.u32()  # checksum
        animations.append((name, stream, return_animation))
    r.raw(16)  # GUID
    name, description = r.string(), r.string()
    r.string()  # extra data
    width, height = r.u16(), r.u16()
    transparent_index = r.u8()
    flags = r.u32()
    if flags & voice_flag:
        r.raw(16 + 16 + 4 + 2)  # engine id, mode id, speed, pitch
    if balloon_flag == 0 or flags & balloon_flag:
        r.raw(2 + 4 + 4 + 4)  # lines, chars per line, three colours
        r.string()  # font name
        r.raw(4 + 4 + balloon_tail)  # height, weight, italic (and one more byte)

    palette_count = r.u32()
    if not 1 <= palette_count <= 256:
        raise AcsError(f"implausible palette size {palette_count}")
    palette = []
    for _ in range(palette_count):
        blue, green, red, _reserved = r.raw(4)
        palette.append((red, green, blue))

    states: dict[str, list[str]] = {}
    for _ in range(r.u16()):
        state = r.string()
        states[state] = [r.string() for _ in range(r.u16())]
    if r.pos != len(body):
        raise AcsError("character info has unread bytes")
    return {
        "version": (major, minor),
        "animations": animations,
        "name": name,
        "description": description,
        "width": width,
        "height": height,
        "transparent_index": transparent_index,
        "flags": flags,
        "palette": palette,
        "states": states,
    }


def _read_v15_animation(
    body: bytes, width: int, height: int, image_base: int, sound_base: int
) -> tuple[list[Frame], list[Image], list[bytes]]:
    r = Reader(body)
    sounds = [r.raw(r.u32()) for _ in range(r.u16())]
    expected = ((width + 3) & ~3) * height
    images = []
    for _ in range(r.u16()):
        size = r.u32()
        r.u8()  # always 0
        if size != expected:
            raise AcsError(f"image has {size} bytes, the character size needs {expected}")
        images.append(Image(width, height, r.raw(size)))
        r.raw(r.u32())  # region data

    frames = []
    for _ in range(r.u16()):
        image_index, sound_index, duration = r.u16(), r.u16(), r.u16()
        r.u32()  # always 0
        branches = [(r.u16(), r.u16()) for _ in range(r.u8())]
        overlay_count = r.u8()
        for _ in range(overlay_count):
            r.u8()  # mouth shape
            size = r.u32()
            if size:
                r.raw(1 + 2 + 2 + 2 + 2)  # always 0, x, y, width, height
                r.raw(size)
        placed = [FrameImage(image_base + image_index, 0, 0)] if image_index < len(images) else []
        sound = sound_base + sound_index if sound_index < len(sounds) else NO_SOUND
        frames.append(Frame(placed, sound, duration, -1, branches, overlay_count))
    if r.pos != len(body):
        raise AcsError("animation has unread bytes")
    return frames, images, sounds


def parse_v15(data: bytes) -> Character:
    streams = read_compound_file(data)
    if "char.acf" not in streams:
        raise AcsError("compound file has no char.acf stream: not an Agent 1.5 character")
    body = _unpack_v15_stream(streams["char.acf"], "char.acf")
    info = None
    layout = _FLAG_LAYOUTS[0]
    error: AcsError | None = None
    # Version 1.30 has one byte after the balloon font weight, 1.31 has two.
    # The right combination is the one that ends on the last byte.
    for layout, balloon_tail in ((flags, tail) for flags in _FLAG_LAYOUTS for tail in (2, 1)):
        try:
            info = _read_v15_character_info(body, *layout, balloon_tail)
            break
        except AcsError as exc:
            error = exc
    if info is None:
        raise AcsError(f"cannot read character info: {error}")

    warnings: list[str] = []
    animations: list[Animation] = []
    images: list[Image | None] = []
    sounds: list[bytes] = []
    for name, stream, return_animation in info["animations"]:
        try:
            if stream.lower() not in streams:
                raise AcsError(f"stream {stream} is missing")
            frames, new_images, new_sounds = _read_v15_animation(
                _unpack_v15_stream(streams[stream.lower()], stream),
                info["width"],
                info["height"],
                len(images),
                len(sounds),
            )
        except AcsError as exc:
            # One damaged stream costs one animation, not the character.
            warnings.append(f'animation "{name}" left out: {exc}')
            continue
        images += new_images
        sounds += new_sounds
        transition = TRANSITION_RETURN if return_animation else TRANSITION_NONE
        animations.append(Animation(name, transition, return_animation, frames))

    return Character(
        name=info["name"],
        description=info["description"],
        version=info["version"],
        width=info["width"],
        height=info["height"],
        transparent_index=info["transparent_index"],
        flags=info["flags"],
        flag_layout=layout,
        palette=info["palette"],
        states=info["states"],
        animations=animations,
        images=images,
        sounds=sounds,
        warnings=warnings,
    )


def parse_acs(data: bytes) -> Character:
    if data[:8] == OLE_SIGNATURE:
        return parse_v15(data)
    r = Reader(data)
    signature = r.u32()
    if signature != ACS_SIGNATURE:
        raise AcsError(f"not an Agent character file: signature 0x{signature:08X}")
    info_loc, anim_loc, image_loc, audio_loc = r.locator(), r.locator(), r.locator(), r.locator()

    info = None
    layout = _FLAG_LAYOUTS[0]
    error: AcsError | None = None
    for layout in _FLAG_LAYOUTS:
        try:
            info = _read_character_info(data, info_loc[0], info_loc[1], *layout)
            break
        except AcsError as exc:
            error = exc
    if info is None:
        raise AcsError(f"cannot read character info: {error}")
    name, description = _read_localized(data, info["localized"])

    warnings: list[str] = []

    r = Reader(data, anim_loc[0])
    animations = []
    for _ in range(r.u32()):
        anim_name = r.string()
        offset, _size = r.locator()
        a = Reader(data, offset)
        a.string()  # the same name in upper case
        transition = a.u8()
        return_animation = a.string()
        frames = [_read_frame(a) for _ in range(a.u16())]
        animations.append(Animation(anim_name, transition, return_animation, frames))

    r = Reader(data, image_loc[0])
    image_locs = []
    for _ in range(r.u32()):
        image_locs.append(r.locator())
        r.u32()  # checksum
    used = {img.image_index for anim in animations for fr in anim.frames for img in fr.images}
    images: list[Image | None] = [None] * len(image_locs)
    empty = 0
    for index in sorted(used):
        if index >= len(image_locs):
            warnings.append(f"frame references missing image {index}")
            continue
        offset, size = image_locs[index]
        if size < _IMAGE_HEADER_SIZE:
            # Some editors write a one-byte entry for an image that was deleted.
            empty += 1
            continue
        try:
            images[index] = _read_image(data, offset)
        except AcsError as exc:
            warnings.append(f"image {index} unreadable: {exc}")
    if empty:
        warnings.append(f"{empty} empty image entries are drawn as nothing")

    r = Reader(data, audio_loc[0])
    sounds = []
    for _ in range(r.u32()):
        offset, size = r.locator()
        r.u32()  # checksum
        sounds.append(data[offset : offset + size])

    return Character(
        name=name,
        description=description,
        version=info["version"],
        width=info["width"],
        height=info["height"],
        transparent_index=info["transparent_index"],
        flags=info["flags"],
        flag_layout=layout,
        palette=info["palette"],
        states=info["states"],
        animations=animations,
        images=images,
        sounds=sounds,
        warnings=warnings,
    )


# --------------------------------------------------------------------------- #
# Rendering
# --------------------------------------------------------------------------- #


def composite_frame(char: Character, frame: Frame) -> bytes:
    """Flatten a frame's images into one character-sized cell of palette indexes.

    The first image in the list is the top-most one, so draw from last to first.
    """
    width, height, clear = char.width, char.height, char.transparent_index
    canvas = bytearray([clear]) * (width * height)
    # 0xFF where a source pixel is opaque, so a row blends with integer ops
    # instead of a Python loop per pixel (real characters have thousands of frames).
    opaque = bytes(0 if value == clear else 0xFF for value in range(256))
    for placed in reversed(frame.images):
        image = char.images[placed.image_index] if placed.image_index < len(char.images) else None
        if image is None:
            continue
        left = max(placed.x, 0)
        right = min(placed.x + image.width, width)
        if left >= right:
            continue
        for row in range(image.height):
            y = placed.y + row
            if not 0 <= y < height:
                continue
            src = (image.height - 1 - row) * image.stride + (left - placed.x)
            line = image.pixels[src : src + (right - left)]
            dst = y * width + left
            if clear not in line:
                canvas[dst : dst + len(line)] = line
                continue
            count = len(line)
            mask = int.from_bytes(line.translate(opaque), "little")
            below = int.from_bytes(canvas[dst : dst + count], "little")
            blended = (int.from_bytes(line, "little") & mask) | (below & ~mask)
            canvas[dst : dst + count] = blended.to_bytes(count, "little")
    return bytes(canvas)


def _png_chunk(tag: bytes, payload: bytes) -> bytes:
    crc = zlib.crc32(tag + payload) & 0xFFFFFFFF
    return struct.pack(">I", len(payload)) + tag + payload + struct.pack(">I", crc)


def encode_indexed_png(
    width: int,
    height: int,
    pixels: bytes,
    palette: list[tuple[int, int, int]],
    transparent_index: int,
) -> bytes:
    """8-bit palette PNG with one fully transparent palette entry."""
    colours = list(palette) + [(0, 0, 0)] * (256 - len(palette))
    alpha = bytes(0 if i == transparent_index else 255 for i in range(transparent_index + 1))
    rows = b"".join(b"\x00" + pixels[y * width : (y + 1) * width] for y in range(height))
    return (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 3, 0, 0, 0))
        + _png_chunk(b"PLTE", b"".join(bytes(colour) for colour in colours))
        + _png_chunk(b"tRNS", alpha)
        + _png_chunk(b"IDAT", zlib.compress(rows, 9))
        + _png_chunk(b"IEND", b"")
    )


@dataclass
class Plan:
    """Which animations the clippyjs agent gets, and how they differ from the file.

    clippyjs finds animations by exact name ("Show", "Hide", "Idle...") and
    knows nothing about Agent's states or return animations. Both are resolved
    here, so a character made for Microsoft Agent behaves under clippyjs.
    """

    # name -> (animation, return animation whose frames are appended)
    animations: dict[str, tuple[Animation, Animation | None]]
    # extra name -> the animation it copies
    aliases: dict[str, str]
    # extra name -> the one frame it shows (None: nothing, the buddy is hidden)
    synthesized: dict[str, Frame | None]
    notes: list[str]


def plan_animations(char: Character, chain_returns: bool = True, aliases: bool = True) -> Plan:
    notes: list[str] = []
    by_upper = {anim.name.upper(): anim for anim in char.animations if anim.frames}

    animations: dict[str, tuple[Animation, Animation | None]] = {}
    unresolved = 0
    for anim in char.animations:
        if not anim.frames:
            # clippyjs' animator throws on an animation without frames.
            notes.append(f'animation "{anim.name}" has no frames and is left out')
            continue
        back = None
        if anim.transition == TRANSITION_RETURN and anim.return_animation:
            back = by_upper.get(anim.return_animation.upper())
            if back is anim:
                back = None
            unresolved += back is None
        animations[anim.name] = (anim, back if chain_returns else None)
    with_return = sum(a.transition == TRANSITION_RETURN for a, _back in animations.values())
    chained = sum(back is not None for _a, back in animations.values())
    if chained:
        notes.append(f"{chained} animations continue into their return animation")
    elif with_return:
        notes.append(f"{with_return} animations have a return animation that is not chained")
    if chain_returns and unresolved:
        notes.append(f"{unresolved} return animations are missing or empty")

    copies: dict[str, str] = {}
    synthesized: dict[str, Frame | None] = {}
    if aliases:
        actual = {name.upper(): name for name in animations}
        states = {state.upper(): names for state, names in char.states.items()}

        def in_state(state: str) -> list[str]:
            found: list[str] = []
            for name in states.get(state, []):
                match = actual.get(name.upper())
                if match and match not in found:
                    found.append(match)
            return found

        for wanted, state in (("Show", "SHOWING"), ("Hide", "HIDING")):
            if wanted in animations:
                continue
            candidates = [actual[wanted.upper()]] if wanted.upper() in actual else in_state(state)
            if candidates:
                copies[wanted] = candidates[0]
                notes.append(f'"{wanted}" copies "{candidates[0]}"')
        if not any(name.startswith("Idle") for name in animations):
            for level in (1, 2, 3):
                for n, target in enumerate(in_state(f"IDLINGLEVEL{level}"), start=1):
                    copies[f"Idle{level}_{n}"] = target
            if copies.keys() - {"Show", "Hide"}:
                idle = sorted(set(copies) - {"Show", "Hide"})
                notes.append(f"idle animations taken from the idling states: {', '.join(idle)}")

        if "Show" not in animations and "Show" not in copies and animations:
            # Without "Show" clippyjs never draws the buddy.
            rest = actual.get("RESTPOSE") or next(iter(animations))
            synthesized["Show"] = animations[rest][0].frames[0]
            notes.append(f'"Show" made from the first frame of "{rest}" (the file has none)')
        if "Hide" not in animations and "Hide" not in copies:
            # Without "Hide" clippyjs never finishes dismissing the buddy.
            synthesized["Hide"] = None
            notes.append('"Hide" made as one empty frame (the file has none)')

    names = animations.keys() | copies.keys() | synthesized.keys()
    for required in ("Show", "Hide"):
        if required not in names:
            notes.append(f'no "{required}" animation: agent.{required.lower()}() will not work')
    if not any(name.startswith("Idle") for name in names):
        notes.append('no animation named "Idle...": the buddy stands still between actions')
    overlays = sum(fr.overlay_count for anim in char.animations for fr in anim.frames)
    if overlays:
        notes.append(f"{overlays} mouth overlays dropped (clippyjs has no lip sync)")
    return Plan(animations, copies, synthesized, notes)


@dataclass
class Conversion:
    agent: dict
    png: bytes
    sheet_size: tuple[int, int]
    cells: int
    frames: int
    notes: list[str]


def convert(
    char: Character,
    columns: int | None = None,
    chain_returns: bool = True,
    aliases: bool = True,
) -> Conversion:
    width, height = char.width, char.height
    if not width or not height:
        raise AcsError("character has no frame size")
    plan = plan_animations(char, chain_returns, aliases)

    cells: dict[bytes, int] = {}
    blank = bytes([char.transparent_index]) * (width * height)
    frame_cells: dict[int, int | None] = {}
    total_frames = 0
    for anim in char.animations:
        for frame in anim.frames:
            total_frames += 1
            cell = composite_frame(char, frame)
            # A frame with nothing visible hides the buddy; it needs no cell.
            frame_cells[id(frame)] = None if cell == blank else cells.setdefault(cell, len(cells))

    count = max(len(cells), 1)
    if columns is None:
        columns = max(1, math.ceil(math.sqrt(count * height / width)))
    columns = min(columns, count)
    rows = math.ceil(count / columns)
    sheet_w, sheet_h = columns * width, rows * height
    sheet = bytearray([char.transparent_index]) * (sheet_w * sheet_h)
    for cell, index in cells.items():
        ox, oy = (index % columns) * width, (index // columns) * height
        for y in range(height):
            dst = (oy + y) * sheet_w + ox
            sheet[dst : dst + width] = cell[y * width : (y + 1) * width]

    def sprite(frame: Frame) -> list[list[int]]:
        index = frame_cells[id(frame)]
        if index is None:
            return []
        return [[(index % columns) * width, (index // columns) * height]]

    def frame_data(frame: Frame, shift: int = 0) -> dict:
        """One clippyjs frame; `shift` moves frame indexes of an appended animation."""
        out: dict = {"duration": frame.duration * 10, "images": sprite(frame)}
        if frame.sound_index != NO_SOUND and frame.sound_index < len(char.sounds):
            out["sound"] = str(frame.sound_index + 1)
        if frame.exit_frame >= 0:
            out["exitBranch"] = frame.exit_frame + shift
        if frame.branches:
            out["branching"] = {
                "branches": [
                    {"frameIndex": target + shift, "weight": weight}
                    for target, weight in frame.branches
                ]
            }
        return out

    animations: dict[str, dict] = {}
    for name, (anim, back) in plan.animations.items():
        frames = [frame_data(frame) for frame in anim.frames]
        if back is not None:
            frames += [frame_data(frame, len(anim.frames)) for frame in back.frames]
        entry: dict = {"frames": frames}
        if anim.transition == TRANSITION_EXIT_BRANCHES:
            entry["useExitBranching"] = True
        animations[name] = entry
    for name, target in plan.aliases.items():
        animations[name] = animations[target]
    for name, frame in plan.synthesized.items():
        images = sprite(frame) if frame is not None else []
        animations[name] = {"frames": [{"duration": 100, "images": images}]}

    agent = {
        "overlayCount": 1,
        "sounds": [str(i + 1) for i in range(len(char.sounds))],
        "framesize": [width, height],
        "animations": animations,
    }
    png = encode_indexed_png(sheet_w, sheet_h, bytes(sheet), char.palette, char.transparent_index)
    return Conversion(agent, png, (sheet_w, sheet_h), len(cells), total_frames, plan.notes)


# --------------------------------------------------------------------------- #
# Reporting
# --------------------------------------------------------------------------- #


def describe(char: Character, plan: Plan) -> str:
    frames = sum(len(anim.frames) for anim in char.animations)
    used_images = sum(image is not None for image in char.images)
    lines = [
        f"name:         {char.name or '(none)'}",
        f"description:  {char.description or '(none)'}",
        f"version:      {char.version[0]}.{char.version[1]}",
        f"frame size:   {char.width} x {char.height}",
        f"palette:      {len(char.palette)} colours, transparent index {char.transparent_index}",
        f"flags:        0x{char.flags:08X} (voice bit 0x{char.flag_layout[0]:X}, "
        f"balloon bit 0x{char.flag_layout[1]:X})",
        f"animations:   {len(char.animations)} ({frames} frames)",
        f"images:       {len(char.images)} ({used_images} used by frames)",
        f"sounds:       {len(char.sounds)}",
        "",
        "states:",
    ]
    lines += [f"  {state}: {', '.join(anims)}" for state, anims in char.states.items()]
    lines += ["", "animations:"]
    for anim in char.animations:
        transition = TRANSITION_NAMES.get(anim.transition, f"unknown {anim.transition}")
        if anim.transition == TRANSITION_RETURN and anim.return_animation:
            transition += f" -> {anim.return_animation}"
        lines.append(f"  {anim.name}: {len(anim.frames)} frames, transition: {transition}")
    notes = plan.notes + char.warnings
    if notes:
        lines += ["", "notes:"] + [f"  - {note}" for note in notes]
    return "\n".join(lines)


_PREVIEW = """<!doctype html>
<meta charset="utf-8">
<title>__TITLE__ (ACS conversion preview)</title>
<style>
  body { font: 14px/1.4 sans-serif; margin: 16px; background: #008080; color: #fff; }
  #stage { display: inline-block; background: #c0c0c0; padding: 24px; border: 2px outset #fff; }
  #agent { background-repeat: no-repeat; image-rendering: pixelated; }
  button { margin: 2px; font: inherit; }
  button.idle { font-style: italic; }
  #state { font-family: monospace; white-space: pre; }
  img { background: #c0c0c0; max-width: 100%; }
</style>
<h1>__TITLE__</h1>
<div id="stage"><div id="agent"></div></div>
<p><button id="exit">Exit animation</button> <label><input id="auto" type="checkbox" checked>
  exit after 5 s (like agent.play)</label></p>
<p id="state">click an animation</p>
<div id="anims"></div>
<details><summary>Sprite sheet</summary><img id="sheet" alt="sprite sheet"></details>
<script>
const data = __DATA__;
const map = "__MAP__";
// Same stepping rules as clippyjs' Animator, so what plays here plays there.
const el = document.getElementById('agent');
const state = document.getElementById('state');
el.style.width = data.framesize[0] + 'px';
el.style.height = data.framesize[1] + 'px';
el.style.backgroundImage = `url(${map})`;
document.getElementById('sheet').src = map;
let anim = null, name = '', index = 0, frame = null, exiting = false, timer = 0, autoExit = 0;
function nextIndex() {
  if (!frame) return 0;
  if (exiting && frame.exitBranch !== undefined) return frame.exitBranch;
  if (frame.branching) {
    let rnd = Math.random() * 100;
    for (const branch of frame.branching.branches) {
      if (rnd <= branch.weight) return branch.frameIndex;
      rnd -= branch.weight;
    }
  }
  return index + 1;
}
function step() {
  const last = anim.frames.length - 1;
  index = Math.min(nextIndex(), last);
  const atLast = index >= last;
  if (!(atLast && anim.useExitBranching) || !frame) frame = anim.frames[index];
  const xy = (frame.images || [])[0];
  el.style.visibility = xy ? 'visible' : 'hidden';
  if (xy) el.style.backgroundPosition = `${-xy[0]}px ${-xy[1]}px`;
  const waiting = atLast && anim.useExitBranching && !exiting;
  const ended = atLast && !waiting;
  state.textContent = `${name}  frame ${index}/${last}  ${frame.duration} ms` +
    (exiting ? '  [exiting]' : '') + (waiting ? '  [waiting for exit]' : '') +
    (ended ? '  [ended]' : '') + '\\n' + JSON.stringify(frame);
  if (ended) return;
  timer = setTimeout(step, frame.duration);
}
function play(n) {
  clearTimeout(timer); clearTimeout(autoExit);
  name = n; anim = data.animations[n]; index = 0; frame = null; exiting = false;
  if (document.getElementById('auto').checked) autoExit = setTimeout(() => { exiting = true; }, 5000);
  step();
}
document.getElementById('exit').onclick = () => { exiting = true; };
const list = document.getElementById('anims');
for (const n of Object.keys(data.animations).sort()) {
  const button = document.createElement('button');
  button.textContent = `${n} (${data.animations[n].frames.length})`;
  if (n.startsWith('Idle')) button.className = 'idle';
  button.onclick = () => play(n);
  list.appendChild(button);
}
</script>
"""


def render_preview(title: str, agent: dict, png: bytes) -> str:
    return (
        _PREVIEW.replace("__TITLE__", title.replace("<", "&lt;"))
        .replace("__DATA__", json.dumps(agent, separators=(",", ":")).replace("</", "<\\/"))
        .replace("__MAP__", "data:image/png;base64," + base64.b64encode(png).decode("ascii"))
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("acs", type=Path, help="Microsoft Agent 2.0 character file")
    parser.add_argument("--out", type=Path, help="output directory for agent.json and map.png")
    parser.add_argument("--info", action="store_true", help="print what the file contains")
    parser.add_argument("--columns", type=int, help="sprite sheet columns (default: near square)")
    parser.add_argument("--preview", action="store_true", help="also write preview.html")
    parser.add_argument("--sounds", action="store_true", help="also write sounds/N.wav")
    parser.add_argument(
        "--no-chain-returns",
        action="store_true",
        help="do not append return animations to the animations that name one",
    )
    parser.add_argument(
        "--no-aliases",
        action="store_true",
        help="do not add Show, Hide and Idle names that clippyjs needs",
    )
    args = parser.parse_args(argv)
    # Character names come in any script; a legacy console code page must not crash on them.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")
    if not args.info and not args.out:
        parser.error("give --out, --info, or both")

    try:
        char = parse_acs(args.acs.read_bytes())
        chain, aliases = not args.no_chain_returns, not args.no_aliases
        if args.info:
            print(describe(char, plan_animations(char, chain, aliases)))
        if not args.out:
            return 0
        result = convert(char, args.columns, chain, aliases)
    except AcsError as exc:
        print(f"error: {args.acs}: {exc}", file=sys.stderr)
        return 1

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "agent.json").write_text(
        json.dumps(result.agent, separators=(",", ":")), encoding="utf-8"
    )
    (args.out / "map.png").write_bytes(result.png)
    if args.preview:
        title = char.name or args.acs.stem
        (args.out / "preview.html").write_text(
            render_preview(title, result.agent, result.png), encoding="utf-8"
        )
    if args.sounds:
        sound_dir = args.out / "sounds"
        sound_dir.mkdir(exist_ok=True)
        for i, sound in enumerate(char.sounds, start=1):
            (sound_dir / f"{i}.wav").write_bytes(sound)

    print(
        f"{args.acs.name}: {len(char.animations)} animations, {result.frames} frames, "
        f"{result.cells} unique cells, sheet {result.sheet_size[0]}x{result.sheet_size[1]} "
        f"({len(result.png) / 1024:.0f} KiB) -> {args.out}"
    )
    for note in result.notes + char.warnings:
        print(f"  note: {note}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
