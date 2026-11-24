"""MCOimg v3 decoder (receive only) for MCO Advanced channel pictures.

MCOimg v3 is a lossless palette image format from HDDen/meshcore-open
(MCO Advanced). It travels as one GRP_DATA datagram with ``data_type 0x0120``
(envelope ``senderNameLen(ULEB128) | senderName | subtypeVersion | body``,
``subtypeVersion 0x13``) or as channel text ``im3:<Base91(0x13 | body)>``.

This is a Python port of the decoder half of ``docs/mcoimg-js/
mcoimg-v3-codec.global.js`` and follows ``docs/mcoimg_v3_reference.md`` at
commit b04a027397aba45823e8e21725c419a905280f11. The encoder is not ported:
sending is out of scope. Palette tables live in ``app/mcoimg_palettes.py``.

Upstream licence (the ported code and palette data):

    MIT License

    Copyright (c) 2025 zjs81

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
"""

from __future__ import annotations

import base64
import hashlib
import re
import struct
import zlib
from dataclasses import dataclass
from functools import lru_cache

from app import mcoimg_palettes as pal

APP_DATA_TYPE = 0x0120
SUBTYPE_VERSION = 0x13
TEXT_PREFIX = "im3:"
# MeshCore channel-data limit for the whole app payload (envelope included).
MAX_APP_PAYLOAD = 165


class McoImgError(ValueError):
    """The payload is not a valid MCOimg v3 image."""


# --- enums (ids match the wire) ---------------------------------------------

PROFILE_NAMES = (
    "mono",
    "master4",
    "master8",
    "master16",
    "master32",
    "master64",
    "grayscale16",
    "grayscale32",
    "grayscale8",
    "dynamicGlobal8",
    "dynamicGlobal16",
    "dynamicGlobal32",
    "dynamicGlobal64",
    "dynamicGlobal128",
    "dynamicGlobal256",
    "dynamicGlobal512",
)
MONO, MASTER4, MASTER8, MASTER16, MASTER32, MASTER64 = range(6)
GRAYSCALE16, GRAYSCALE32, GRAYSCALE8 = 6, 7, 8
DYN8, DYN16, DYN32, DYN64, DYN128, DYN256, DYN512 = range(9, 16)

_PALETTE_SIZE = (2, 4, 8, 16, 32, 64, 16, 32, 8, 8, 16, 32, 64, 128, 256, 512)
_GLOBAL_BITS = (1, 2, 3, 4, 5, 6, 4, 5, 3, 3, 4, 5, 6, 7, 8, 9)
_DYNAMIC_INDICES = {
    DYN8: pal.DYNAMIC_GLOBAL8_INDICES,
    DYN16: pal.DYNAMIC_GLOBAL16_INDICES,
    DYN32: pal.DYNAMIC_GLOBAL32_INDICES,
    DYN64: pal.DYNAMIC_GLOBAL64_INDICES,
    DYN128: pal.DYNAMIC_GLOBAL128_INDICES,
    DYN256: pal.DYNAMIC_GLOBAL256_INDICES,
    DYN512: pal.DYNAMIC_GLOBAL512_INDICES,
}
_FIXED_COLORS = {
    MONO: pal.MONO,
    MASTER4: pal.MASTER4,
    MASTER8: pal.MASTER8,
    MASTER16: pal.MASTER16,
    MASTER32: pal.MASTER32,
    MASTER64: pal.MASTER64,
    GRAYSCALE16: pal.GRAYSCALE16,
    GRAYSCALE32: pal.GRAYSCALE32,
    GRAYSCALE8: pal.GRAYSCALE8,
}

SCAN_H, SCAN_V, SCAN_S, SCAN_SV = range(4)
SCAN_NAMES = ("h", "v", "s", "sv")

(
    C_BLOCK,
    C_COMPACT_BLOCK,
    C_BOUNDS_BLOCK,
    C_COMPACT_BOUNDS_BLOCK,
    C_REGIONS,
    C_COMPACT_REGIONS_STREAM,
    C_SOLID_BACKGROUND,
    C_SOLID_RECTS,
) = range(8)
CONTAINER_NAMES = (
    "block",
    "compactBlock",
    "boundsBlock",
    "compactBoundsBlock",
    "regions",
    "compactRegionsStream",
    "solidBackground",
    "solidRects",
)

(
    A_RAW_GLOBAL,
    A_RAW_LOCAL,
    A_COMPACT_RLE,
    A_COMPACT_SPARSE,
    A_BICOLOR_MASK,
    A_ROW_REPEAT,
    A_LZ_PIXELS,
    A_QUADTREE,
    A_BITPLANES,
    A_ADAPTIVE_BITPLANES,
    A_DIRECT_BITPLANES,
    A_COMPACT_ROW_DELTA,
    A_DIRECT_ROW_DELTA,
    A_ROW_DELTA,
    A_VARUINT_RLE,
    A_VARUINT_SPARSE,
) = range(16)
ALGORITHM_NAMES = (
    "rawGlobal",
    "rawLocal",
    "compactRle",
    "compactSparse",
    "biColorMask",
    "rowRepeat",
    "lzPixels",
    "quadtree",
    "bitplanes",
    "adaptiveBitplanes",
    "directBitplanes",
    "compactRowDelta",
    "directRowDelta",
    "rowDelta",
    "varUintRle",
    "varUintSparse",
)

_TRANSPARENT_FLAG = 0x80
_IMPLICIT_WHITE_FLAG = 0x40
_MAX_REGIONS = 32
_MIN_LZ_MATCH = 3
_HYBRID_MARKER = 31
_PRED_SAME, _PRED_LEFT, _PRED_RIGHT = 0, 1, 2

_BASE91_ALPHABET = (
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&()*+,./:;<=>?@[]^_`{|}~"'
)
_BASE91_DECODE = {ch: i for i, ch in enumerate(_BASE91_ALPHABET)}


@dataclass(frozen=True)
class McoImage:
    width: int
    height: int
    profile: int
    # Fixed profiles: indexes into the profile palette.
    # Dynamic profiles: Dynamic Global 512 indexes.
    pixels: tuple[int, ...]
    transparent_color: int | None
    container: int
    algorithm: int

    @property
    def profile_name(self) -> str:
        return PROFILE_NAMES[self.profile]

    @property
    def container_name(self) -> str:
        return CONTAINER_NAMES[self.container]

    @property
    def algorithm_name(self) -> str:
        return ALGORITHM_NAMES[self.algorithm]


# --- Base91 ------------------------------------------------------------------


def base91_decode(text: str) -> bytes:
    out = bytearray()
    value = -1
    queue = 0
    bit_count = 0
    for ch in text:
        decoded = _BASE91_DECODE.get(ch)
        if decoded is None:
            raise McoImgError("Invalid basE91 character")
        if value < 0:
            value = decoded
        else:
            value += decoded * 91
            queue |= value << bit_count
            bit_count += 13 if (value & 8191) > 88 else 14
            while bit_count > 7:
                out.append(queue & 0xFF)
                queue >>= 8
                bit_count -= 8
            value = -1
    if value >= 0:
        out.append((queue | (value << bit_count)) & 0xFF)
    return bytes(out)


def base91_encode(data: bytes) -> str:
    out = []
    queue = 0
    bit_count = 0
    for byte in data:
        queue |= byte << bit_count
        bit_count += 8
        if bit_count > 13:
            value = queue & 8191
            if value > 88:
                queue >>= 13
                bit_count -= 13
            else:
                value = queue & 16383
                queue >>= 14
                bit_count -= 14
            out.append(_BASE91_ALPHABET[value % 91])
            out.append(_BASE91_ALPHABET[value // 91])
    if bit_count > 0:
        out.append(_BASE91_ALPHABET[queue % 91])
        if bit_count > 7 or queue > 90:
            out.append(_BASE91_ALPHABET[queue // 91])
    return "".join(out)


# --- helpers -----------------------------------------------------------------


def _bit_length(value: int) -> int:
    if value < 0:
        raise McoImgError("Invalid non-negative integer")
    return value.bit_length()


def _is_dynamic(profile: int) -> bool:
    return DYN8 <= profile <= DYN512


def _is_grayscale(profile: int) -> bool:
    return profile in (GRAYSCALE8, GRAYSCALE16, GRAYSCALE32)


def _palette_size(profile: int) -> int:
    return _PALETTE_SIZE[profile]


def _global_bits(profile: int) -> int:
    return _GLOBAL_BITS[profile]


def _dynamic_palette(profile: int) -> list[int]:
    indices = _DYNAMIC_INDICES.get(profile)
    if indices is None:
        raise McoImgError("Not a dynamic palette profile")
    return list(indices)


def _global_index(profile: int, ref: int) -> int:
    if ref < 0 or ref >= _palette_size(profile):
        raise McoImgError("Palette reference out of range")
    if not _is_dynamic(profile):
        return ref
    return _DYNAMIC_INDICES[profile][ref]


def _white_index(_profile: int) -> int:
    # Fixed profiles use entry 0 for white; dynamic pixels are Global 512
    # indexes and white is 0 there too (matches the JS port).
    return 0


def _local_bits(color_count: int) -> int:
    if color_count <= 1:
        return 0
    return _bit_length(color_count - 1)


def _geometry_bits(size: int) -> int:
    if size <= 1:
        return 0
    return _bit_length(size - 1)


def _algorithm_from_id(value: int) -> int:
    if value < 0 or value >= len(ALGORITHM_NAMES):
        raise McoImgError(f"Unknown MCOimg v3 algorithm {value}")
    return value


def _scan_from_id(value: int) -> int:
    if value < 0 or value > 3:
        raise McoImgError(f"Unknown MCOimg v3 scan {value}")
    return value


def _can_use_compact_header(algorithm: int) -> bool:
    return algorithm in (A_RAW_GLOBAL, A_RAW_LOCAL, A_BICOLOR_MASK)


def _uses_background_ref(algorithm: int) -> bool:
    return algorithm in (A_COMPACT_SPARSE, A_VARUINT_SPARSE, A_BICOLOR_MASK)


class _BitReader:
    __slots__ = ("data", "byte_index", "bit_offset")

    def __init__(self, data: bytes, byte_index: int = 0) -> None:
        self.data = data
        self.byte_index = byte_index
        self.bit_offset = 0

    def read(self, bits: int) -> int:
        if bits < 0 or bits > 32:
            raise McoImgError("Invalid bit length")
        result = 0
        shift = 0
        remaining = bits
        data = self.data
        while remaining > 0:
            if self.byte_index >= len(data):
                raise McoImgError("Unexpected end of bits")
            take = min(8 - self.bit_offset, remaining)
            result |= ((data[self.byte_index] >> self.bit_offset) & ((1 << take) - 1)) << shift
            self.bit_offset += take
            if self.bit_offset == 8:
                self.byte_index += 1
                self.bit_offset = 0
            shift += take
            remaining -= take
        return result

    def var_uint(self) -> int:
        result = 0
        factor = 1
        for _ in range(5):
            byte = self.read(8)
            result += (byte & 0x7F) * factor
            if byte & 0x80 == 0:
                return result
            factor *= 128
        raise McoImgError("Varuint is too long")

    def compact_uint(self) -> int:
        if self.read(1) == 0:
            return self.read(2)
        if self.read(1) == 0:
            return self.read(4) + 4
        if self.read(1) == 0:
            return self.read(8) + 20
        return self.var_uint()

    def range_compact_uint(self, max_value: int) -> int:
        if max_value < 0:
            raise McoImgError("Invalid range compact uint limit")
        value = self.read(_bit_length(max_value)) if max_value <= 7 else self.compact_uint()
        if value > max_value:
            raise McoImgError("Range compact uint exceeds limit")
        return value

    def bounded_compact_uint(self, max_value: int) -> int:
        if max_value < 0:
            raise McoImgError("Invalid bounded compact uint limit")
        if max_value <= 7:
            return self.read(_bit_length(max_value))
        if self.read(1) == 0:
            value = self.read(2)
        elif self.read(1) == 0:
            value = self.read(4) + 4
        elif self.read(1) == 0:
            value = self.read(8) + 20
        else:
            if max_value < 276:
                raise McoImgError("Invalid bounded compact uint escape")
            value = self.read(_bit_length(max_value - 276)) + 276
        if value > max_value:
            raise McoImgError("Bounded compact uint exceeds limit")
        return value

    def finish(self) -> None:
        if self.bit_offset != 0:
            unused_mask = (0xFF << self.bit_offset) & 0xFF
            if self.data[self.byte_index] & unused_mask:
                raise McoImgError("Non-zero padding bits")
            self.byte_index += 1
            self.bit_offset = 0
        if self.byte_index != len(self.data):
            raise McoImgError("Trailing payload bytes")


def _read_dimensions(r: _BitReader) -> tuple[int, int]:
    mode = r.read(2)
    if mode == 0:
        width = r.read(6) + 1
        height = width
    elif mode == 1:
        width = r.read(5) + 1
        height = r.read(5) + 1
        if width == height:
            raise McoImgError("Non-canonical small square dimensions")
    elif mode == 2:
        width = r.read(6) + 1
        height = r.read(6) + 1
        if width == height or (width <= 32 and height <= 32):
            raise McoImgError("Non-canonical medium dimensions")
    else:
        if r.read(1) == 0:
            width = r.read(8) + 1
            height = width
            if width <= 64:
                raise McoImgError("Non-canonical extended square dimensions")
        else:
            width = r.read(8) + 1
            height = r.read(8) + 1
            if width == height or (width <= 64 and height <= 64):
                raise McoImgError("Non-canonical extended dimensions")
    if not (1 <= width <= 256 and 1 <= height <= 256):
        raise McoImgError("Image size must be 1..256 in both axes")
    return width, height


def _read_color_ref(r: _BitReader, profile: int) -> int:
    return _global_index(profile, r.read(_global_bits(profile)))


def _read_background_ref(r: _BitReader, profile: int, implicit_white: bool) -> int:
    return _white_index(profile) if implicit_white else _read_color_ref(r, profile)


def _read_solid_background_color(
    r: _BitReader, profile: int, context: int, implicit_white: bool
) -> int:
    if implicit_white:
        if context != 0:
            raise McoImgError("Implicit white solid background must use zero context")
        return _white_index(profile)
    total_bits = _global_bits(profile)
    low_bits = min(total_bits, 5)
    low_mask = (1 << low_bits) - 1
    if context & ~low_mask:
        raise McoImgError("Solid background color context is out of range")
    remaining = total_bits - low_bits
    ref = context | (r.read(remaining) << low_bits) if remaining > 0 else context
    return _global_index(profile, ref)


# --- local palettes ------------------------------------------------------------


def _read_local_palette_length(r: _BitReader, profile: int) -> int:
    size = _palette_size(profile)
    if size <= 64:
        return r.read(_global_bits(profile)) + 1
    if r.read(1) == 0:
        return r.read(6) + 1
    if r.read(1) == 0:
        return r.read(6) + 65
    if size <= 128:
        raise McoImgError("Invalid local palette length prefix")
    length = r.read(_bit_length(size - 129)) + 129
    if length > size:
        raise McoImgError("Invalid local palette size")
    return length


def _read_descriptor_refs(r: _BitReader, profile: int, descriptor: int) -> list[int]:
    size = _palette_size(profile)
    if descriptor == 0:  # bitmap
        return [ref for ref in range(size) if r.read(1)]
    if descriptor == 1:  # sorted delta
        count = _read_local_palette_length(r, profile)
        if count <= 0 or count > size:
            raise McoImgError("Invalid sorted local palette size")
        refs = [r.read(_global_bits(profile))]
        while len(refs) < count:
            refs.append(refs[-1] + r.compact_uint() + 1)
        return refs
    if descriptor == 2:  # range runs
        run_count = r.range_compact_uint(size - 1) + 1
        if run_count <= 0 or run_count > size:
            raise McoImgError("Invalid local palette range count")
        refs: list[int] = []
        previous_end = -1
        for _ in range(run_count):
            start = r.read(_global_bits(profile))
            length = r.compact_uint() + 1
            end = start + length - 1
            if start <= previous_end or end >= size or len(refs) + length > size:
                raise McoImgError("Invalid local palette range")
            refs.extend(range(start, start + length))
            previous_end = end
        return refs
    # descriptor 3: banked (dynamicGlobal512 only)
    if profile != DYN512:
        raise McoImgError("Bank palette descriptor requires dynamicGlobal512")
    if r.read(1) == 0:
        bank_mask = r.read(8)
        if bank_mask == 0:
            raise McoImgError("Empty bank bitmap palette")
        refs = []
        for bank in range(8):
            if not bank_mask & (1 << bank):
                continue
            before = len(refs)
            for offset in range(64):
                if r.read(1):
                    refs.append((bank << 6) | offset)
            if len(refs) == before:
                raise McoImgError("Bank bitmap palette contains an empty bank")
        return refs
    count = _read_local_palette_length(r, profile)
    if r.read(1) == 0:
        if count > 64:
            raise McoImgError("Single-bank palette contains too many colors")
        bank = r.read(3)
        return [(bank << 6) | r.read(6) for _ in range(count)]
    bank_mask = r.read(8)
    bank_total = bin(bank_mask).count("1")
    if bank_total <= 1:
        raise McoImgError("Invalid ordered banked palette mask")
    if count > bank_total * 64:
        raise McoImgError("Ordered banked palette contains too many colors")
    banks = [b for b in range(8) if bank_mask & (1 << b)]
    bank_bits = _bit_length(bank_total - 1)
    refs = []
    used = set()
    for _ in range(count):
        bank_index = r.read(bank_bits)
        if bank_index >= len(banks):
            raise McoImgError("Invalid ordered banked palette bank index")
        used.add(bank_index)
        refs.append((banks[bank_index] << 6) | r.read(6))
    if len(used) != bank_total:
        raise McoImgError("Ordered banked palette contains an unused bank")
    return refs


def _read_local_palette(r: _BitReader, profile: int) -> list[int]:
    size = _palette_size(profile)
    descriptor: int | None = None
    length = 0
    if size <= 64:
        if r.read(1):
            descriptor = r.read(2)
        else:
            length = r.read(_global_bits(profile)) + 1
    elif r.read(1) == 0:
        length = r.read(6) + 1
    elif r.read(1) == 0:
        length = r.read(6) + 65
    elif r.read(1) == 0:
        length = r.read(8) + 129
        if length > size:
            raise McoImgError("Invalid local palette size")
    elif r.read(1) == 0:
        length = r.read(7) + 385
        if length > size:
            raise McoImgError("Invalid local palette size")
    else:
        descriptor = r.read(2)

    if descriptor is not None:
        refs = _read_descriptor_refs(r, profile, descriptor)
        if not refs or len(refs) > size:
            raise McoImgError("Invalid compact local palette size")
        seen: set[int] = set()
        colors = []
        for ref in refs:
            if ref < 0 or ref >= size or ref in seen:
                raise McoImgError("Invalid compact local palette")
            seen.add(ref)
            colors.append(_global_index(profile, ref))
        return colors

    colors = []
    seen = set()
    for _ in range(length):
        color = _read_color_ref(r, profile)
        if color in seen:
            raise McoImgError("Duplicate local color")
        seen.add(color)
        colors.append(color)
    return colors


# --- geometry ------------------------------------------------------------------


def _read_region_geometry(
    r: _BitReader, image_w: int, image_h: int, compact: bool
) -> tuple[int, int, int, int]:
    x_bits = _geometry_bits(image_w) if compact else 8
    y_bits = _geometry_bits(image_h) if compact else 8
    x = r.read(x_bits)
    y = r.read(y_bits)
    if x >= image_w or y >= image_h:
        raise McoImgError("Invalid v3 region origin")
    w_bits = _geometry_bits(image_w - x) if compact else x_bits
    h_bits = _geometry_bits(image_h - y) if compact else y_bits
    w = r.read(w_bits) + 1
    h = r.read(h_bits) + 1
    if x + w > image_w or y + h > image_h:
        raise McoImgError("Invalid v3 region")
    return x, y, w, h


def _read_signed_compact_int(r: _BitReader) -> int:
    encoded = r.compact_uint()
    return encoded // 2 if encoded & 1 == 0 else -((encoded + 1) // 2)


def _read_delta_region_geometry(
    r: _BitReader, prev: tuple[int, int, int, int], image_w: int, image_h: int
) -> tuple[int, int, int, int]:
    x = prev[0] + _read_signed_compact_int(r)
    y = prev[1] + _read_signed_compact_int(r)
    w = prev[2] + _read_signed_compact_int(r)
    h = prev[3] + _read_signed_compact_int(r)
    if x < 0 or y < 0 or w <= 0 or h <= 0 or x + w > image_w or y + h > image_h:
        raise McoImgError("Invalid v3 delta region")
    return x, y, w, h


def _row_length_for_scan(scan: int, width: int, height: int) -> int:
    return width if scan in (SCAN_H, SCAN_S) else height


def _from_scan_order(linear: list[int], width: int, height: int, scan: int) -> list[int]:
    if len(linear) != width * height:
        raise McoImgError("Decoded pixel count does not match dimensions")
    if scan == SCAN_H:
        return list(linear)
    result = [0] * (width * height)
    index = 0
    if scan == SCAN_V:
        for x in range(width):
            for y in range(height):
                result[y * width + x] = linear[index]
                index += 1
    elif scan == SCAN_S:
        for y in range(height):
            xs = range(width) if y & 1 == 0 else range(width - 1, -1, -1)
            for x in xs:
                result[y * width + x] = linear[index]
                index += 1
    elif scan == SCAN_SV:
        for x in range(width):
            ys = range(height) if x & 1 == 0 else range(height - 1, -1, -1)
            for y in ys:
                result[y * width + x] = linear[index]
                index += 1
    else:
        raise McoImgError(f"Unknown scan mode {scan}")
    return result


def _blit(dst: list[int], dst_w: int, src: list[int], x: int, y: int, w: int, h: int) -> None:
    for row in range(h):
        d = (y + row) * dst_w + x
        dst[d : d + w] = src[row * w : row * w + w]


# --- block algorithms ------------------------------------------------------------


def _map_local(
    local: list[int], palette: list[int], label: str = "Color index out of range"
) -> list[int]:
    n = len(palette)
    out = []
    for index in local:
        if index >= n:
            raise McoImgError(label)
        out.append(palette[index])
    return out


def _read_quadtree_node(
    r: _BitReader,
    pixels: list[int],
    stride: int,
    x: int,
    y: int,
    w: int,
    h: int,
    palette: list[int],
    bits: int,
) -> None:
    if r.read(1):
        color_index = r.read(bits)
        if color_index >= len(palette):
            raise McoImgError("Quadtree color index out of range")
        color = palette[color_index]
        for dy in range(h):
            start = (y + dy) * stride + x
            pixels[start : start + w] = [color] * w
        return
    if w == 1 and h == 1:
        raise McoImgError("Quadtree splits a single pixel")
    if w == 1:
        top = h // 2
        _read_quadtree_node(r, pixels, stride, x, y, w, top, palette, bits)
        _read_quadtree_node(r, pixels, stride, x, y + top, w, h - top, palette, bits)
        return
    if h == 1:
        left = w // 2
        _read_quadtree_node(r, pixels, stride, x, y, left, h, palette, bits)
        _read_quadtree_node(r, pixels, stride, x + left, y, w - left, h, palette, bits)
        return
    left = w // 2
    top = h // 2
    _read_quadtree_node(r, pixels, stride, x, y, left, top, palette, bits)
    _read_quadtree_node(r, pixels, stride, x + left, y, w - left, top, palette, bits)
    _read_quadtree_node(r, pixels, stride, x, y + top, left, h - top, palette, bits)
    _read_quadtree_node(r, pixels, stride, x + left, y + top, w - left, h - top, palette, bits)


def _read_short_run_length(r: _BitReader, remaining: int) -> int:
    if remaining <= 0:
        raise McoImgError("Invalid remaining bitplane run length")
    if r.read(1) == 0:
        return 1
    if remaining < 2:
        raise McoImgError("Bitplane run exceeds remaining pixels")
    if r.read(1) == 0:
        return 2
    if remaining < 3:
        raise McoImgError("Bitplane run exceeds remaining pixels")
    if r.read(1) == 0:
        return 3
    if remaining < 4:
        raise McoImgError("Bitplane run exceeds remaining pixels")
    return r.range_compact_uint(remaining - 4) + 4


def _read_adaptive_runs(
    r: _BitReader, pixels: list[int], bit: int, count: int, short: bool
) -> None:
    value = r.read(1)
    position = 0
    mask = 1 << bit
    while position < count:
        length = (
            _read_short_run_length(r, count - position)
            if short
            else r.range_compact_uint(count - position - 1) + 1
        )
        if length <= 0 or position + length > count:
            raise McoImgError("Adaptive bitplane RLE exceeds pixel count")
        if value:
            for i in range(position, position + length):
                pixels[i] |= mask
        position += length
        value ^= 1


def _read_sparse_bitplane(
    r: _BitReader, pixels: list[int], bit: int, count: int, minority_bit: int
) -> None:
    n = r.range_compact_uint(count - 1) + 1
    if n > count:
        raise McoImgError("Sparse bitplane count exceeds pixel count")
    previous = -1
    mask = 1 << bit
    for i in range(n):
        remaining = n - i - 1
        max_gap = count - previous - remaining - 2
        gap = r.range_compact_uint(max_gap)
        position = previous + gap + 1
        if position <= previous or position >= count:
            raise McoImgError("Sparse bitplane position out of range")
        if minority_bit == 0:
            pixels[position] &= ~mask
        else:
            pixels[position] |= mask
        previous = position


def _decode_adaptive_bitplanes(r: _BitReader, count: int, palette: list[int]) -> list[int]:
    bits = _local_bits(len(palette))
    local = [0] * count
    for bit in range(bits):
        mask = 1 << bit
        if r.read(1) == 0:
            for i in range(count):
                local[i] |= r.read(1) << bit
            continue
        if r.read(1) == 0:
            _read_adaptive_runs(r, local, bit, count, False)
            continue
        if r.read(1) == 0:
            _read_adaptive_runs(r, local, bit, count, True)
            continue
        mode = r.read(2)
        if mode == 1:
            for i in range(count):
                local[i] |= mask
        elif mode == 2:
            _read_sparse_bitplane(r, local, bit, count, 1)
        elif mode == 3:
            for i in range(count):
                local[i] |= mask
            _read_sparse_bitplane(r, local, bit, count, 0)
    return _map_local(local, palette, "Adaptive bitplane color index out of range")


def _decode_bitplanes(r: _BitReader, count: int, palette: list[int]) -> list[int]:
    bits = _local_bits(len(palette))
    local = [0] * count
    for bit in range(bits):
        mask = 1 << bit
        if r.read(1) == 0:
            for i in range(count):
                local[i] |= r.read(1) << bit
            continue
        value = r.read(1)
        position = 0
        while position < count:
            length = r.range_compact_uint(count - position - 1) + 1
            if position + length > count:
                raise McoImgError("Bitplane RLE exceeds pixel count")
            if value:
                for i in range(position, position + length):
                    local[i] |= mask
            position += length
            value ^= 1
    return _map_local(local, palette, "Bitplane color index out of range")


def _read_compact_predictor(r: _BitReader) -> int:
    if r.read(1) == 0:
        return _PRED_SAME
    return _PRED_LEFT if r.read(1) == 0 else _PRED_RIGHT


def _predicted(
    values: list[int], row_len: int, row: int, x: int, predictor: int, virtual_base: bool
) -> int:
    if row == 0 and virtual_base:
        return 0
    prev = (row - 1) * row_len
    if predictor == _PRED_LEFT:
        return values[prev + (row_len - 1 if x == 0 else x - 1)]
    if predictor == _PRED_RIGHT:
        return values[prev + (0 if x + 1 == row_len else x + 1)]
    return values[prev + x]


def _copy_predicted_row(
    values: list[int], row_start: int, row_len: int, row: int, predictor: int, virtual_base: bool
) -> None:
    for x in range(row_len):
        values[row_start + x] = _predicted(values, row_len, row, x, predictor, virtual_base)


def _read_row_delta_value(r: _BitReader, value_bits: int, max_value: int) -> int:
    value = r.read(value_bits)
    if value > max_value:
        raise McoImgError("Row-delta value out of range")
    return value


def _read_row_delta_predictor(
    r: _BitReader, row: int, virtual_base: bool, allow_shift: bool
) -> int:
    if not allow_shift:
        return _PRED_SAME
    predictor = _read_compact_predictor(r)
    if row == 0 and virtual_base and predictor != _PRED_SAME:
        raise McoImgError("Shifted row-delta predictor cannot use virtual row")
    return predictor


def _read_row_delta(
    r: _BitReader, count: int, row_len: int, value_bits: int, max_value: int
) -> list[int]:
    if row_len <= 0 or count % row_len != 0:
        raise McoImgError("Invalid row-delta geometry")
    if count == 0:
        return []
    virtual_base = r.read(1) != 0
    allow_shift = r.read(1) != 0
    result = [0] * count
    if not virtual_base:
        for x in range(row_len):
            result[x] = _read_row_delta_value(r, value_bits, max_value)
    row_count = count // row_len
    row = 0 if virtual_base else 1
    while row < row_count:
        row_start = row * row_len
        op = r.read(2)
        if op == 0:  # raw
            for x in range(row_len):
                result[row_start + x] = _read_row_delta_value(r, value_bits, max_value)
            row += 1
            continue
        if op == 1:  # repeat
            _copy_predicted_row(result, row_start, row_len, row, _PRED_SAME, virtual_base)
            row += 1
            continue
        if op == 2:  # indexed
            predictor = _read_row_delta_predictor(r, row, virtual_base, allow_shift)
            _copy_predicted_row(result, row_start, row_len, row, predictor, virtual_base)
            change_count = r.read(_bit_length(row_len))
            if change_count > row_len:
                raise McoImgError("Row-delta change count exceeds row length")
            position_bits = _bit_length(row_len - 1)
            previous_x = -1
            for _ in range(change_count):
                x = r.read(position_bits)
                if x >= row_len or x <= previous_x:
                    raise McoImgError("Invalid row-delta change position")
                result[row_start + x] = _read_row_delta_value(r, value_bits, max_value)
                previous_x = x
            row += 1
            continue
        extended = r.read(2)
        if extended == 3:  # repeat run
            if row + 2 > row_count:
                raise McoImgError("Invalid row-delta repeat run")
            repeat_count = r.range_compact_uint(row_count - row - 2) + 2
            for rep in range(repeat_count):
                rr = row + rep
                _copy_predicted_row(result, rr * row_len, row_len, rr, _PRED_SAME, virtual_base)
            row += repeat_count
            continue
        predictor = _read_row_delta_predictor(r, row, virtual_base, allow_shift)
        _copy_predicted_row(result, row_start, row_len, row, predictor, virtual_base)
        if extended in (0, 2):  # mask / same-scalar mask
            positions = [x for x in range(row_len) if r.read(1)]
            if not positions:
                raise McoImgError("Empty row-delta mask")
            if extended == 2:
                value = _read_row_delta_value(r, value_bits, max_value)
                for x in positions:
                    result[row_start + x] = value
            else:
                for x in positions:
                    result[row_start + x] = _read_row_delta_value(r, value_bits, max_value)
        else:  # segments
            position_bits = _bit_length(row_len - 1)
            segment_count = r.read(_bit_length(row_len - 1)) + 1
            previous_end = -1
            for _ in range(segment_count):
                start = r.read(position_bits)
                length = r.read(position_bits) + 1
                if start <= previous_end or start + length > row_len:
                    raise McoImgError("Invalid row-delta segment")
                for x in range(start, start + length):
                    result[row_start + x] = _read_row_delta_value(r, value_bits, max_value)
                previous_end = start + length - 1
        row += 1
    return result


def _grayscale_delta_from_code(code: int) -> int:
    if code <= 0:
        raise McoImgError("Invalid grayscale delta")
    return (code + 1) // 2 if code & 1 else -(code // 2)


def _read_compact_row_delta_value(
    r: _BitReader,
    values: list[int],
    row_len: int,
    row: int,
    x: int,
    value_bits: int,
    predictor: int,
    virtual_base: bool,
    use_residual: bool,
    max_value: int,
) -> int:
    if use_residual:
        value = _predicted(
            values, row_len, row, x, predictor, virtual_base
        ) + _grayscale_delta_from_code(r.compact_uint() + 1)
    else:
        value = r.read(value_bits)
    if value < 0 or value > max_value:
        raise McoImgError("Compact row-delta value out of range")
    return value


def _read_compact_change_positions(r: _BitReader, count: int, row_len: int) -> list[int]:
    positions = []
    previous_x = -1
    for i in range(count):
        remaining = count - i - 1
        max_gap = row_len - previous_x - remaining - 2
        x = previous_x + 1 + r.range_compact_uint(max_gap)
        if x >= row_len:
            raise McoImgError("Compact row-delta position out of range")
        positions.append(x)
        previous_x = x
    return positions


def _read_compact_row_delta(
    r: _BitReader, count: int, row_len: int, value_bits: int, direct_grayscale: bool, max_value: int
) -> list[int]:
    if row_len <= 0 or count % row_len != 0:
        raise McoImgError("Invalid compact row-delta geometry")
    virtual_base = r.read(1) != 0
    result = [0] * count
    if not virtual_base:
        for x in range(row_len):
            value = r.read(value_bits)
            if value > max_value:
                raise McoImgError("Compact row-delta first row value out of range")
            result[x] = value
    row_count = count // row_len
    row = 0 if virtual_base else 1
    while row < row_count:
        row_start = row * row_len
        op = r.read(3)
        if op in (0, 6):  # repeat / repeat run
            repeat_count = 1 if op == 0 else r.range_compact_uint(row_count - row - 2) + 2
            if row + repeat_count > row_count:
                raise McoImgError("Compact row-delta repeat exceeds row count")
            for rep in range(repeat_count):
                rr = row + rep
                _copy_predicted_row(result, rr * row_len, row_len, rr, _PRED_SAME, virtual_base)
            row += repeat_count
            continue
        if op == 1:  # raw
            for x in range(row_len):
                value = r.read(value_bits)
                if value > max_value:
                    raise McoImgError("Compact row-delta raw value out of range")
                result[row_start + x] = value
            row += 1
            continue
        predictor = _read_compact_predictor(r)
        if row == 0 and virtual_base and predictor != _PRED_SAME:
            raise McoImgError("Shifted compact predictor cannot use virtual row")
        _copy_predicted_row(result, row_start, row_len, row, predictor, virtual_base)
        if op == 7:  # predicted, no changes
            row += 1
            continue
        use_residual = direct_grayscale and r.read(1) != 0

        if op in (2, 3):  # indexed / same scalar
            change_count = r.range_compact_uint(row_len - 1) + 1
            if change_count > row_len:
                raise McoImgError("Compact row-delta change count exceeds row length")
            positions = _read_compact_change_positions(r, change_count, row_len)
            if op == 3:
                value = _read_compact_row_delta_value(
                    r,
                    result,
                    row_len,
                    row,
                    positions[0],
                    value_bits,
                    predictor,
                    virtual_base,
                    use_residual,
                    max_value,
                )
                for x in positions:
                    result[row_start + x] = value
            else:
                for x in positions:
                    result[row_start + x] = _read_compact_row_delta_value(
                        r,
                        result,
                        row_len,
                        row,
                        x,
                        value_bits,
                        predictor,
                        virtual_base,
                        use_residual,
                        max_value,
                    )
            row += 1
            continue
        positions = []
        if op == 4:  # segments
            segment_count = r.range_compact_uint(row_len - 1) + 1
            if segment_count > row_len:
                raise McoImgError("Compact row-delta segment count exceeds row length")
            previous_end = 0
            for i in range(segment_count):
                remaining = segment_count - i - 1
                gap = r.range_compact_uint(row_len - previous_end - remaining - 1)
                start = previous_end + gap
                max_length = row_len - start - remaining
                length = r.range_compact_uint(max_length - 1) + 1
                if start < previous_end or start + length > row_len:
                    raise McoImgError("Invalid compact row-delta segment")
                positions.extend(range(start, start + length))
                previous_end = start + length
        else:  # op 5: trimmed mask
            start = r.range_compact_uint(row_len - 1)
            span = r.range_compact_uint(row_len - start - 1) + 1
            if start + span > row_len:
                raise McoImgError("Invalid compact row-delta mask bounds")
            positions = [start + offset for offset in range(span) if r.read(1)]
            if not positions:
                raise McoImgError("Empty compact row-delta mask")
        for x in positions:
            result[row_start + x] = _read_compact_row_delta_value(
                r,
                result,
                row_len,
                row,
                x,
                value_bits,
                predictor,
                virtual_base,
                use_residual,
                max_value,
            )
        row += 1
    return result


def _read_row_repeat(r: _BitReader, count: int, row_len: int, bits: int) -> list[int]:
    if row_len <= 0 or count % row_len != 0:
        raise McoImgError("Invalid row-repeat geometry")
    result = [0] * count
    for x in range(row_len):
        result[x] = r.read(bits)
    for row in range(1, count // row_len):
        start = row * row_len
        if r.read(1):
            result[start : start + row_len] = result[start - row_len : start]
        else:
            for x in range(row_len):
                result[start + x] = r.read(bits)
    return result


def _read_rle(r: _BitReader, count: int, palette: list[int], varuint: bool) -> list[int]:
    bits = _local_bits(len(palette))
    result: list[int] = []
    while len(result) < count:
        color_index = r.read(bits)
        if color_index >= len(palette):
            raise McoImgError("RLE color index out of range")
        length = r.var_uint() if varuint else r.bounded_compact_uint(count - len(result) - 1) + 1
        if length <= 0 or len(result) + length > count:
            raise McoImgError("Invalid RLE length")
        result.extend([palette[color_index]] * length)
    return result


def _read_lz(r: _BitReader, count: int, palette: list[int]) -> list[int]:
    bits = _local_bits(len(palette))
    result: list[int] = []
    while len(result) < count:
        if r.read(1):
            remaining = count - len(result)
            if not result or remaining < _MIN_LZ_MATCH:
                raise McoImgError("Invalid LZ pixel match")
            distance = r.range_compact_uint(len(result) - 1) + 1
            length = r.range_compact_uint(remaining - _MIN_LZ_MATCH) + _MIN_LZ_MATCH
            if distance > len(result) or len(result) + length > count:
                raise McoImgError("Invalid LZ pixel match")
            for _ in range(length):
                result.append(result[len(result) - distance])
        else:
            length = r.range_compact_uint(count - len(result) - 1) + 1
            if len(result) + length > count:
                raise McoImgError("Invalid LZ pixel literal length")
            for _ in range(length):
                color_index = r.read(bits)
                if color_index >= len(palette):
                    raise McoImgError("LZ pixel color index out of range")
                result.append(palette[color_index])
    return result


def _read_sparse(
    r: _BitReader, count: int, palette: list[int], background: int, varuint: bool
) -> list[int]:
    bits = _local_bits(len(palette))
    result = [background] * count
    segment_count = r.var_uint() if varuint else r.bounded_compact_uint(count - 1) + 1
    if segment_count <= 0 or segment_count > count:
        raise McoImgError("Invalid sparse segment count")
    pos = 0
    for _ in range(segment_count):
        if varuint:
            skip = r.var_uint()
            if skip > count - pos:
                raise McoImgError("Invalid varuint sparse skip")
            pos += skip
            if pos >= count:
                raise McoImgError("Invalid varuint sparse segment start")
        else:
            if pos >= count:
                raise McoImgError("Invalid compact sparse segment count")
            pos += r.bounded_compact_uint(count - pos - 1)
        color_index = r.read(bits)
        if color_index >= len(palette) or palette[color_index] == background:
            raise McoImgError("Invalid sparse color")
        length = r.var_uint() if varuint else r.bounded_compact_uint(count - pos - 1) + 1
        if length <= 0 or pos + length > count:
            raise McoImgError("Invalid sparse segment length")
        result[pos : pos + length] = [palette[color_index]] * length
        pos += length
    return result


def _decode_block(
    r: _BitReader,
    width: int,
    height: int,
    profile: int,
    algorithm: int,
    scan: int,
    implicit_white: bool,
    inherited_background: int | None = None,
) -> list[int]:
    count = width * height
    if algorithm == A_RAW_GLOBAL:
        return [_read_color_ref(r, profile) for _ in range(count)]
    if algorithm == A_RAW_LOCAL:
        palette = _read_local_palette(r, profile)
        bits = _local_bits(len(palette))
        return _map_local(
            [r.read(bits) for _ in range(count)], palette, "Local color index out of range"
        )
    if algorithm in (A_COMPACT_RLE, A_VARUINT_RLE):
        return _read_rle(r, count, _read_local_palette(r, profile), algorithm == A_VARUINT_RLE)
    if algorithm == A_LZ_PIXELS:
        return _read_lz(r, count, _read_local_palette(r, profile))
    if algorithm == A_QUADTREE:
        if scan != SCAN_H:
            raise McoImgError("Quadtree requires horizontal scan")
        palette = _read_local_palette(r, profile)
        result = [palette[0]] * count
        _read_quadtree_node(
            r, result, width, 0, 0, width, height, palette, _local_bits(len(palette))
        )
        return result
    if algorithm == A_BITPLANES:
        return _decode_bitplanes(r, count, _read_local_palette(r, profile))
    if algorithm == A_ADAPTIVE_BITPLANES:
        return _decode_adaptive_bitplanes(r, count, _read_local_palette(r, profile))
    if algorithm == A_DIRECT_BITPLANES:
        if _is_grayscale(profile):
            return _decode_adaptive_bitplanes(r, count, list(range(_palette_size(profile))))
        if _is_dynamic(profile):
            return _decode_adaptive_bitplanes(r, count, _dynamic_palette(profile))
        raise McoImgError("Direct bitplanes require a grayscale or dynamic profile")
    if algorithm == A_ROW_DELTA:
        palette = _read_local_palette(r, profile)
        local = _read_row_delta(
            r,
            count,
            _row_length_for_scan(scan, width, height),
            _local_bits(len(palette)),
            len(palette) - 1,
        )
        return _map_local(local, palette, "Row-delta color index out of range")
    if algorithm == A_COMPACT_ROW_DELTA:
        palette = _read_local_palette(r, profile)
        local = _read_compact_row_delta(
            r,
            count,
            _row_length_for_scan(scan, width, height),
            _local_bits(len(palette)),
            False,
            len(palette) - 1,
        )
        return _map_local(local, palette, "Compact row-delta color index out of range")
    if algorithm == A_DIRECT_ROW_DELTA:
        row_len = _row_length_for_scan(scan, width, height)
        if _is_grayscale(profile):
            return _read_compact_row_delta(
                r, count, row_len, _global_bits(profile), True, _palette_size(profile) - 1
            )
        if _is_dynamic(profile):
            values = _read_compact_row_delta(
                r, count, row_len, _global_bits(profile), False, _palette_size(profile) - 1
            )
            palette = _dynamic_palette(profile)
            return [palette[i] for i in values]
        raise McoImgError("Direct row-delta requires a grayscale or dynamic profile")
    if algorithm in (A_COMPACT_SPARSE, A_VARUINT_SPARSE):
        background = (
            _read_background_ref(r, profile, implicit_white)
            if inherited_background is None
            else inherited_background
        )
        palette = _read_local_palette(r, profile)
        if background in palette:
            raise McoImgError("Sparse palette contains background")
        return _read_sparse(r, count, palette, background, algorithm == A_VARUINT_SPARSE)
    if algorithm == A_BICOLOR_MASK:
        background = (
            _read_background_ref(r, profile, implicit_white)
            if inherited_background is None
            else inherited_background
        )
        foreground = _read_color_ref(r, profile)
        return [foreground if r.read(1) else background for _ in range(count)]
    if algorithm == A_ROW_REPEAT:
        palette = _read_local_palette(r, profile)
        local = _read_row_repeat(
            r, count, _row_length_for_scan(scan, width, height), _local_bits(len(palette))
        )
        return _map_local(local, palette, "Row-repeat color index out of range")
    raise McoImgError(f"Unsupported MCOimg v3 algorithm {algorithm}")


def _decode_block_shared(
    r: _BitReader,
    width: int,
    height: int,
    algorithm: int,
    scan: int,
    palette: list[int],
    background: int,
) -> list[int]:
    count = width * height
    bits = _local_bits(len(palette))
    if algorithm == A_RAW_LOCAL:
        return _map_local([r.read(bits) for _ in range(count)], palette)
    if algorithm in (A_COMPACT_RLE, A_VARUINT_RLE):
        return _read_rle(r, count, palette, algorithm == A_VARUINT_RLE)
    if algorithm in (A_COMPACT_SPARSE, A_VARUINT_SPARSE):
        return _read_sparse(r, count, palette, background, algorithm == A_VARUINT_SPARSE)
    if algorithm == A_LZ_PIXELS:
        return _read_lz(r, count, palette)
    if algorithm == A_QUADTREE:
        if scan != SCAN_H:
            raise McoImgError("Quadtree requires horizontal scan")
        result = [palette[0]] * count
        _read_quadtree_node(r, result, width, 0, 0, width, height, palette, bits)
        return result
    if algorithm == A_BITPLANES:
        return _decode_bitplanes(r, count, palette)
    if algorithm == A_ADAPTIVE_BITPLANES:
        return _decode_adaptive_bitplanes(r, count, palette)
    if algorithm == A_ROW_DELTA:
        return _map_local(
            _read_row_delta(
                r, count, _row_length_for_scan(scan, width, height), bits, len(palette) - 1
            ),
            palette,
        )
    if algorithm == A_COMPACT_ROW_DELTA:
        return _map_local(
            _read_compact_row_delta(
                r, count, _row_length_for_scan(scan, width, height), bits, False, len(palette) - 1
            ),
            palette,
        )
    if algorithm == A_BICOLOR_MASK:
        foreground_index = r.read(bits)
        if foreground_index >= len(palette):
            raise McoImgError("Invalid shared bi-color foreground")
        foreground = palette[foreground_index]
        if foreground == background:
            raise McoImgError("Shared bi-color foreground equals background")
        return [foreground if r.read(1) else background for _ in range(count)]
    if algorithm == A_ROW_REPEAT:
        return _map_local(
            _read_row_repeat(r, count, _row_length_for_scan(scan, width, height), bits), palette
        )
    raise McoImgError("MCOimg v3 algorithm cannot use a shared region palette")


def _decode_bounds_block(
    r: _BitReader,
    width: int,
    height: int,
    profile: int,
    algorithm: int,
    scan: int,
    compact: bool,
    implicit_white: bool,
) -> list[int]:
    background = _read_background_ref(r, profile, implicit_white)
    x, y, w, h = _read_region_geometry(r, width, height, compact)
    linear = _decode_block(r, w, h, profile, algorithm, scan, implicit_white, background)
    pixels = [background] * (width * height)
    _blit(pixels, width, _from_scan_order(linear, w, h, scan), x, y, w, h)
    return pixels


def _decode_regions(
    r: _BitReader,
    width: int,
    height: int,
    profile: int,
    region_count_context: int,
    compact: bool,
    implicit_white: bool,
) -> list[int]:
    background = _read_background_ref(r, profile, implicit_white)
    region_count = region_count_context + 1
    if region_count > _MAX_REGIONS:
        raise McoImgError("Invalid v3 region count")
    has_common = compact and r.read(1) != 0
    has_delta = compact and r.read(1) != 0
    has_shared_palette = compact and r.read(1) != 0
    hybrid = False
    common_algorithm = 0
    common_scan = SCAN_H
    if has_common:
        common_id = r.read(5)
        hybrid = common_id == _HYBRID_MARKER
        common_algorithm = _algorithm_from_id(r.read(5) if hybrid else common_id)
        common_scan = (
            SCAN_H if _can_use_compact_header(common_algorithm) else _scan_from_id(r.read(2))
        )
    shared_palette = _read_local_palette(r, profile) if has_shared_palette else None
    pixels = [background] * (width * height)
    previous: tuple[int, int, int, int] | None = None
    for i in range(region_count):
        if has_delta and i > 0 and previous is not None:
            bounds = _read_delta_region_geometry(r, previous, width, height)
        else:
            bounds = _read_region_geometry(r, width, height, compact)
        previous = bounds
        individual = r.read(1) != 0 if hybrid else not has_common
        if individual:
            algorithm = _algorithm_from_id(r.read(5))
            scan = SCAN_H if _can_use_compact_header(algorithm) else _scan_from_id(r.read(2))
        else:
            algorithm = common_algorithm
            scan = common_scan
        x, y, w, h = bounds
        if shared_palette is None:
            linear = _decode_block(r, w, h, profile, algorithm, scan, implicit_white, background)
        else:
            linear = _decode_block_shared(r, w, h, algorithm, scan, shared_palette, background)
        _blit(pixels, width, _from_scan_order(linear, w, h, scan), x, y, w, h)
    return pixels


def _decode_solid_rects(
    r: _BitReader,
    width: int,
    height: int,
    profile: int,
    rect_count_context: int,
    implicit_white: bool,
) -> list[int]:
    background = _read_background_ref(r, profile, implicit_white)
    palette = _read_local_palette(r, profile)
    bits = _local_bits(len(palette))
    rect_count = rect_count_context + (r.read(1) << 5) + 1
    if rect_count > 64:
        raise McoImgError("Invalid solid rect count")
    pixels = [background] * (width * height)
    for _ in range(rect_count):
        x, y, w, h = _read_region_geometry(r, width, height, True)
        color_index = r.read(bits)
        if color_index >= len(palette):
            raise McoImgError("Solid rect color index out of range")
        _blit(pixels, width, [palette[color_index]] * (w * h), x, y, w, h)
    return pixels


# --- public API --------------------------------------------------------------------


def decode_body(body: bytes) -> McoImage:
    """Decode a bare v3 body (``packetNonce | imageHeader | ...``)."""
    if len(body) < 4:
        raise McoImgError("MCOimg v3 payload too short")
    header = body[1]
    scan = _scan_from_id((header & 0x30) >> 4)
    has_transparent = bool(header & _TRANSPARENT_FLAG)
    implicit_white = bool(header & _IMPLICIT_WHITE_FLAG)
    profile = header & 0x0F
    r = _BitReader(bytes(body), 2)
    width, height = _read_dimensions(r)
    container_byte = r.read(8)
    container = container_byte >> 5
    context = container_byte & 0x1F
    algorithm = (
        _algorithm_from_id(context)
        if container in (C_BLOCK, C_COMPACT_BLOCK, C_BOUNDS_BLOCK, C_COMPACT_BOUNDS_BLOCK)
        else A_RAW_GLOBAL
    )
    if container == C_BLOCK and _can_use_compact_header(algorithm):
        raise McoImgError("Scan-independent v3 block must use compactBlock")
    if container == C_COMPACT_BLOCK and not _can_use_compact_header(algorithm):
        raise McoImgError("compactBlock cannot be used with scan-dependent algorithms")
    requires_h = container in (
        C_COMPACT_BLOCK,
        C_REGIONS,
        C_COMPACT_REGIONS_STREAM,
        C_SOLID_BACKGROUND,
        C_SOLID_RECTS,
    ) or (container == C_COMPACT_BOUNDS_BLOCK and _can_use_compact_header(algorithm))
    if requires_h and scan != SCAN_H:
        raise McoImgError(f"{CONTAINER_NAMES[container]} requires horizontal top-level scan")
    if algorithm == A_QUADTREE and scan != SCAN_H:
        raise McoImgError("Quadtree requires horizontal scan")
    if (
        implicit_white
        and container in (C_BLOCK, C_COMPACT_BLOCK)
        and not _uses_background_ref(algorithm)
    ):
        raise McoImgError("Implicit white background is not valid for this container")

    transparent = _read_color_ref(r, profile) if has_transparent else None
    if container == C_BLOCK:
        pixels = _from_scan_order(
            _decode_block(r, width, height, profile, algorithm, scan, implicit_white),
            width,
            height,
            scan,
        )
    elif container == C_COMPACT_BLOCK:
        pixels = _decode_block(r, width, height, profile, algorithm, SCAN_H, implicit_white)
        if len(pixels) != width * height:
            raise McoImgError("Decoded pixel count does not match dimensions")
    elif container in (C_BOUNDS_BLOCK, C_COMPACT_BOUNDS_BLOCK):
        pixels = _decode_bounds_block(
            r,
            width,
            height,
            profile,
            algorithm,
            scan,
            container == C_COMPACT_BOUNDS_BLOCK,
            implicit_white,
        )
    elif container in (C_REGIONS, C_COMPACT_REGIONS_STREAM):
        pixels = _decode_regions(
            r,
            width,
            height,
            profile,
            context,
            container == C_COMPACT_REGIONS_STREAM,
            implicit_white,
        )
    elif container == C_SOLID_BACKGROUND:
        pixels = [_read_solid_background_color(r, profile, context, implicit_white)] * (
            width * height
        )
    else:
        pixels = _decode_solid_rects(r, width, height, profile, context, implicit_white)
    r.finish()
    return McoImage(
        width=width,
        height=height,
        profile=profile,
        pixels=tuple(pixels),
        transparent_color=transparent,
        container=container,
        algorithm=algorithm,
    )


def decode_app_payload(payload: bytes) -> McoImage:
    """Decode ``0x13 | body`` (app payload without sender)."""
    if len(payload) < 2 or payload[0] != SUBTYPE_VERSION:
        actual = "empty" if not payload else f"0x{payload[0]:02x}"
        raise McoImgError(f"Unsupported MCOimg app subtype/version {actual}")
    return decode_body(payload[1:])


def app_payload_from_text(text: str) -> bytes:
    """``im3:<base91>`` to ``0x13 | body``. Raises McoImgError if not im3 text."""
    if not text.startswith(TEXT_PREFIX):
        raise McoImgError("Missing im3: prefix")
    return base91_decode(text[len(TEXT_PREFIX) :])


def text_from_app_payload(payload: bytes) -> str:
    return TEXT_PREFIX + base91_encode(payload)


@dataclass(frozen=True)
class AppEnvelope:
    sender_name: str
    subtype_version: int
    body: bytes

    @property
    def app_payload(self) -> bytes:
        """``subtypeVersion | body`` (the canonical payload without sender)."""
        return bytes([self.subtype_version]) + self.body


def parse_app_envelope(blob: bytes) -> AppEnvelope | None:
    """Parse the MCO Advanced ``0x0120`` envelope, or None when malformed.

    ``senderNameLen(ULEB128, max 5 bytes) | senderName(UTF-8) | subtypeVersion | body``.
    """
    value = 0
    shift = 0
    pos = 0
    while True:
        if pos >= len(blob) or pos >= 5:
            return None
        byte = blob[pos]
        pos += 1
        value |= (byte & 0x7F) << shift
        shift += 7
        if byte & 0x80 == 0:
            break
    end = pos + value
    if end >= len(blob):  # need at least the subtypeVersion byte
        return None
    try:
        name = blob[pos:end].decode("utf-8")
    except UnicodeDecodeError:
        return None
    return AppEnvelope(sender_name=name, subtype_version=blob[end], body=bytes(blob[end + 1 :]))


def image_identity(app_payload: bytes) -> str:
    """Spec image identity: lowercase MD5 of ``0x13 | body`` with the nonce zeroed.

    The nonce is the first body byte (payload offset 1). Same picture, same id,
    across resends.
    """
    data = bytearray(app_payload)
    if len(data) > 1:
        data[1] = 0
    return hashlib.md5(bytes(data), usedforsecurity=False).hexdigest()


def rgba_palette_for(image: McoImage) -> tuple[int, ...]:
    """Colour table (0xAARRGGBB) that ``image.pixels`` index into."""
    if _is_dynamic(image.profile):
        return pal.GLOBAL512
    return _FIXED_COLORS[image.profile]


def render_png(image: McoImage) -> bytes:
    """Render to an RGBA PNG at native size; transparentColor pixels get alpha 0."""
    colors = rgba_palette_for(image)
    last = len(colors) - 1
    raw = bytearray()
    w = image.width
    for y in range(image.height):
        raw.append(0)  # filter: none
        for px in image.pixels[y * w : (y + 1) * w]:
            argb = colors[min(max(px, 0), last)]
            alpha = (
                0
                if image.transparent_color is not None and px == image.transparent_color
                else (argb >> 24) & 0xFF
            )
            raw += bytes(((argb >> 16) & 0xFF, (argb >> 8) & 0xFF, argb & 0xFF, alpha))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", image.width, image.height, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


@dataclass(frozen=True)
class RenderedImage:
    width: int
    height: int
    profile: str
    algorithm: str
    container: str
    byte_length: int
    image_id: str
    png_base64: str


_BASE91_CLASS = re.escape(_BASE91_ALPHABET)
# Whole message body is one im3: token, optionally after a "Name: " prefix of up
# to 64 characters. "look im3:..." mid-sentence, or trailing words, stay text.
_IM3_TEXT_RE = re.compile(r"^(?:[^\n]{0,64}?: )?(im3:[" + _BASE91_CLASS + r"]+)\s*$")


def im3_token(text: str | None) -> str | None:
    """The ``im3:...`` token when the message body is exactly one, else None."""
    if not text or "im3:" not in text:
        return None
    match = _IM3_TEXT_RE.match(text)
    return match.group(1) if match else None


def describe_for_message(text: str | None, app_payload: bytes | None) -> dict | None:
    """Picture info for a chat row: from the stored datagram payload, else im3: text.

    Returns None when the row is not an MCOimg v3 picture. Never raises: a
    payload that does not decode gives ``{"ok": False, ...}`` so the chat can
    show "image (could not decode)" instead of breaking.
    """
    source = "datagram"
    payload = app_payload
    try:
        if payload is None:
            token = im3_token(text)
            if token is None:
                return None
            source = "text"
            payload = app_payload_from_text(token)
        rendered = render_app_payload(bytes(payload))
    except Exception:  # noqa: BLE001 - any decoder fault must stay a placeholder
        return {
            "format": "mcoimg_v3",
            "source": source,
            "ok": False,
            "byte_length": max(len(payload) - 1, 0) if payload else 0,
        }
    return {
        "format": "mcoimg_v3",
        "source": source,
        "ok": True,
        "width": rendered.width,
        "height": rendered.height,
        "profile": rendered.profile,
        "algorithm": rendered.algorithm,
        "container": rendered.container,
        "byte_length": rendered.byte_length,
        "image_id": rendered.image_id,
        "png_base64": rendered.png_base64,
    }


@lru_cache(maxsize=512)
def render_app_payload(app_payload: bytes) -> RenderedImage:
    """Decode ``0x13 | body`` and render it. Raises McoImgError on a bad payload."""
    image = decode_app_payload(app_payload)
    return RenderedImage(
        width=image.width,
        height=image.height,
        profile=image.profile_name,
        algorithm=image.algorithm_name,
        container=image.container_name,
        byte_length=len(app_payload) - 1,
        image_id=image_identity(app_payload),
        png_base64=base64.b64encode(render_png(image)).decode("ascii"),
    )
