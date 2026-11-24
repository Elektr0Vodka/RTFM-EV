"""MCOimg v3 decoder: upstream cross-runtime fixtures plus robustness checks.

``tests/fixtures/mcoimg_v3_decoder_fixtures.json`` is
``docs/mcoimg-js/tests/v3-js-decoder-fixtures.json`` from HDDen/meshcore-open
at b04a027397aba45823e8e21725c419a905280f11 (MIT), unchanged.
"""

import base64
import json
import random
import struct
import zlib
from pathlib import Path

import pytest

from app import mcoimg_palettes as pal
from app import mcoimg_v3 as m

FIXTURES = json.loads(
    (Path(__file__).parent / "fixtures" / "mcoimg_v3_decoder_fixtures.json").read_text(
        encoding="utf-8"
    )
)["fixtures"]


def test_fixture_set_covers_all_algorithms_and_containers():
    assert len(FIXTURES) == 39
    assert {f["algorithm"] for f in FIXTURES} >= set(m.ALGORITHM_NAMES)
    assert {f["container"] for f in FIXTURES} == set(m.CONTAINER_NAMES)


@pytest.mark.parametrize("fx", FIXTURES, ids=[f["name"] for f in FIXTURES])
def test_decoder_fixture(fx):
    body = base64.b64decode(fx["bodyBase64"])
    app_payload = base64.b64decode(fx["appPayloadBase64"])
    assert app_payload == bytes([0x13]) + body

    for image in (
        m.decode_body(body),
        m.decode_app_payload(app_payload),
        m.decode_app_payload(m.app_payload_from_text(fx["text"])),
    ):
        assert image.width == fx["width"]
        assert image.height == fx["height"]
        assert image.profile_name == fx["paletteProfile"]
        assert list(image.pixels) == fx["pixels"]
        assert image.transparent_color == fx["transparentColor"]
        assert image.container_name == fx["container"]
        # Region and solid containers report rawGlobal as their top-level algorithm.
        if fx["container"] in ("block", "compactBlock", "boundsBlock", "compactBoundsBlock"):
            assert image.algorithm_name == fx["algorithm"]

    assert m.text_from_app_payload(app_payload) == fx["text"]


@pytest.mark.parametrize("fx", FIXTURES, ids=[f["name"] for f in FIXTURES])
def test_fixture_renders_png(fx):
    rendered = m.render_app_payload(base64.b64decode(fx["appPayloadBase64"]))
    png = base64.b64decode(rendered.png_base64)
    assert png.startswith(b"\x89PNG\r\n\x1a\n")
    width, height = struct.unpack(">II", png[16:24])
    assert (width, height) == (fx["width"], fx["height"])
    assert rendered.byte_length == len(base64.b64decode(fx["bodyBase64"]))


def _png_rgba(png: bytes) -> bytes:
    idat = b""
    pos = 8
    while pos < len(png):
        (length,) = struct.unpack(">I", png[pos : pos + 4])
        kind = png[pos + 4 : pos + 8]
        if kind == b"IDAT":
            idat += png[pos + 8 : pos + 8 + length]
        pos += 12 + length
    raw = zlib.decompress(idat)
    width, _ = struct.unpack(">II", png[16:24])
    stride = width * 4 + 1
    return b"".join(raw[i + 1 : i + stride] for i in range(0, len(raw), stride))


def test_transparent_colour_renders_alpha_zero():
    # The transparentSolid fixture fills with colour 2 and marks 3 transparent,
    # so build an image where some pixels do equal the transparent colour.
    image = m.McoImage(
        width=2,
        height=1,
        profile=m.MASTER4,
        pixels=(3, 2),
        transparent_color=3,
        container=m.C_COMPACT_BLOCK,
        algorithm=m.A_RAW_GLOBAL,
    )
    rgba = _png_rgba(m.render_png(image))
    assert rgba[3] == 0
    assert rgba[7] == 0xFF

    fx = next(f for f in FIXTURES if f["name"] == "transparentSolid")
    decoded = m.decode_app_payload(base64.b64decode(fx["appPayloadBase64"]))
    assert decoded.transparent_color == 3
    assert all(a == 0xFF for a in _png_rgba(m.render_png(decoded))[3::4])


def test_fixed_palette_colours_used_for_pixels():
    fx = next(f for f in FIXTURES if f["name"] == "rawGlobal")  # master4, pixels 0..3
    image = m.decode_app_payload(base64.b64decode(fx["appPayloadBase64"]))
    rgba = _png_rgba(m.render_png(image))
    first = pal.MASTER4[image.pixels[0]]
    assert rgba[:4] == bytes(((first >> 16) & 0xFF, (first >> 8) & 0xFF, first & 0xFF, 0xFF))


JS_ENCODED = json.loads(
    (Path(__file__).parent / "fixtures" / "mcoimg_v3_js_encoded.json").read_text(encoding="utf-8")
)["cases"]


@pytest.mark.parametrize("case", JS_ENCODED, ids=[c["name"] for c in JS_ENCODED])
def test_decodes_pictures_from_the_upstream_js_encoder(case):
    image = m.decode_app_payload(bytes(case["payload"]))
    assert (image.width, image.height) == (case["width"], case["height"])
    assert image.profile == case["profile"]
    assert list(image.pixels) == case["pixels"]
    assert image.transparent_color == case["transparentColor"]
    assert m.app_payload_from_text(case["text"]) == bytes(case["payload"])


def test_palette_tables_sizes_and_dynamic_consistency():
    assert len(pal.GLOBAL512) == 512
    assert list(pal.MASTER8) == [pal.GLOBAL512[i] for i in pal.DYNAMIC_GLOBAL8_INDICES]
    assert list(pal.MASTER64) == [pal.GLOBAL512[i] for i in pal.DYNAMIC_GLOBAL64_INDICES]


def test_image_identity_ignores_nonce():
    payload = base64.b64decode(FIXTURES[0]["appPayloadBase64"])
    resent = bytes([payload[0], (payload[1] + 1) & 0xFF]) + payload[2:]
    assert m.image_identity(payload) == m.image_identity(resent)
    assert len(m.image_identity(payload)) == 32


def test_envelope_parse():
    body = base64.b64decode(FIXTURES[0]["bodyBase64"])
    name = "Zoë".encode()
    blob = bytes([len(name)]) + name + b"\x13" + body
    env = m.parse_app_envelope(blob)
    assert env is not None
    assert env.sender_name == "Zoë"
    assert env.subtype_version == 0x13
    assert env.app_payload == b"\x13" + body
    # Empty name.
    env = m.parse_app_envelope(b"\x00\x13" + body)
    assert env is not None and env.sender_name == ""


@pytest.mark.parametrize(
    "blob",
    [b"", b"\x05ab", b"\x02ab", b"\x80\x80\x80\x80\x80\x01", b"\x02\xff\xfe\x13\x00"],
)
def test_envelope_parse_rejects_malformed(blob):
    assert m.parse_app_envelope(blob) is None


@pytest.mark.parametrize(
    "payload",
    [
        b"",
        b"\x13",
        b"\x14\x00\x00\x00\x00",
        b"\x13\x00\x00",
        b"\x13" + b"\xff" * 40,
        b"\x13\x00\x01\x00\x20\x00\x00",  # trailing / truncated
    ],
)
def test_bad_payload_raises_mcoimg_error(payload):
    with pytest.raises(m.McoImgError):
        m.decode_app_payload(payload)


def test_trailing_byte_and_padding_rejected():
    payload = base64.b64decode(FIXTURES[0]["appPayloadBase64"])
    with pytest.raises(m.McoImgError):
        m.decode_app_payload(payload + b"\x00")


def test_random_bytes_never_raise_anything_but_mcoimg_error():
    rng = random.Random(391)
    bodies = [base64.b64decode(f["appPayloadBase64"]) for f in FIXTURES]
    for _ in range(3000):
        if rng.random() < 0.5:
            data = bytearray(rng.choice(bodies))
            for _ in range(rng.randint(1, 4)):
                data[rng.randrange(len(data))] = rng.randrange(256)
            if rng.random() < 0.3:
                data = data[: rng.randint(0, len(data))]
        else:
            data = bytearray([0x13]) + bytes(rng.randrange(256) for _ in range(rng.randint(0, 165)))
        try:
            m.decode_app_payload(bytes(data))
        except m.McoImgError:
            pass


def test_base91_rejects_bad_character():
    with pytest.raises(m.McoImgError):
        m.app_payload_from_text("im3:abc def")
    with pytest.raises(m.McoImgError):
        m.app_payload_from_text("not im3")
