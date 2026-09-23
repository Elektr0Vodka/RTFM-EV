"""Tests for app/communities.py (meshcore-open community key derivation + QR JSON).

Expected values are computed independently here with hmac/hashlib, and pinned as
hex literals (cross-checked with Node's crypto module when written). meshcore-open
ships no community test vectors (checked its test/ tree on 2026-09-23).
"""

import base64
import hashlib
import hmac
import json

import pytest

from app.communities import (
    CommunityError,
    community_id,
    derive_hashtag_channel_key,
    derive_public_channel_key,
    format_qr_payload,
    hashtag_channel_name,
    hashtag_display,
    normalize_hashtag,
    parse_qr_payload,
    public_channel_name,
    short_community_id,
)

K = bytes(range(32))
K_B64URL = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="


def _hmac16(secret: bytes, label: str) -> bytes:
    return hmac.new(secret, f"channel:v1:{label}".encode(), hashlib.sha256).digest()[:16]


class TestDerivation:
    def test_public_channel_key(self):
        key = derive_public_channel_key(K)
        assert key == _hmac16(K, "__public__")
        assert key.hex() == "cd18a636c186d37d2cb79dd7b4697727"

    def test_hashtag_channel_key(self):
        key = derive_hashtag_channel_key(K, "ops")
        assert key == _hmac16(K, "ops")
        assert key.hex() == "152999787891e7ab30c7b6eeb7909b40"

    @pytest.mark.parametrize("variant", ["ops", "#ops", "OPS", "#Ops", "  ops  ", "#ops "])
    def test_hashtag_variants_share_a_key(self, variant):
        assert derive_hashtag_channel_key(K, variant) == _hmac16(K, "ops")

    def test_normalize_strips_one_hash_then_lowercases_then_trims(self):
        # Order matters: '#' is only stripped when it is the very first char.
        assert normalize_hashtag("#Ops") == "ops"
        assert normalize_hashtag("##ops") == "#ops"
        assert normalize_hashtag(" #ops") == "#ops"

    def test_hashtag_key_differs_from_plain_hashtag_channel(self):
        plain = hashlib.sha256(b"#ops").digest()[:16]
        assert derive_hashtag_channel_key(K, "ops") != plain

    def test_empty_hashtag_rejected(self):
        with pytest.raises(CommunityError):
            derive_hashtag_channel_key(K, "#  ")

    def test_community_id(self):
        expected = hashlib.sha256(b"community:v1" + K).hexdigest()
        assert community_id(K) == expected
        assert expected == "b235068a6a0ae3ffd136c230dd1e5a35b2af297d3209acead29d1d2938864f13"
        assert short_community_id(K) == "b235068a"

    def test_secret_must_be_32_bytes(self):
        with pytest.raises(CommunityError):
            derive_public_channel_key(b"\x00" * 16)


class TestNames:
    def test_public_name(self):
        assert public_channel_name("Acme") == "Acme Public"

    def test_public_name_truncated_to_32_bytes(self):
        name = public_channel_name("A" * 40)
        assert len(name.encode()) <= 32
        assert name == "A" * 32

    def test_public_name_truncation_keeps_utf8_valid(self):
        name = public_channel_name("é" * 20)
        assert len(name.encode()) <= 32
        name.encode("utf-8")  # no dangling partial char

    def test_hashtag_name_keeps_case(self):
        assert hashtag_channel_name("Acme", "#Ops") == "Acme #Ops"
        assert hashtag_display("  #Ops ") == "Ops"

    def test_hashtag_name_too_long_rejected(self):
        with pytest.raises(CommunityError):
            hashtag_channel_name("Acme", "x" * 30)


class TestQrPayload:
    def test_parse_valid(self):
        payload = parse_qr_payload(
            json.dumps({"v": 1, "type": "meshcore_community", "name": "Acme", "k": K_B64URL})
        )
        assert payload.name == "Acme"
        assert payload.secret == K

    def test_parse_accepts_unpadded_base64url(self):
        payload = parse_qr_payload(
            json.dumps(
                {"v": 1, "type": "meshcore_community", "name": "Acme", "k": K_B64URL.rstrip("=")}
            )
        )
        assert payload.secret == K

    def test_parse_strips_leading_hash_from_name(self):
        payload = parse_qr_payload(
            json.dumps({"v": 1, "type": "meshcore_community", "name": " #Acme", "k": K_B64URL})
        )
        assert payload.name == "Acme"

    @pytest.mark.parametrize(
        "data",
        [
            "not json",
            "[]",
            json.dumps({"v": 1, "type": "other", "name": "A", "k": K_B64URL}),
            json.dumps({"v": 2, "type": "meshcore_community", "name": "A", "k": K_B64URL}),
            json.dumps({"v": True, "type": "meshcore_community", "name": "A", "k": K_B64URL}),
            json.dumps({"v": 1, "type": "meshcore_community", "name": "", "k": K_B64URL}),
            json.dumps({"v": 1, "type": "meshcore_community", "name": "A"}),
            json.dumps({"v": 1, "type": "meshcore_community", "name": "A", "k": "!!!"}),
            json.dumps(
                {
                    "v": 1,
                    "type": "meshcore_community",
                    "name": "A",
                    "k": base64.urlsafe_b64encode(b"x" * 16).decode(),
                }
            ),
        ],
    )
    def test_parse_rejects_invalid(self, data):
        with pytest.raises(CommunityError):
            parse_qr_payload(data)

    def test_format_matches_meshcore_open_shape(self):
        text = format_qr_payload("Acme", K)
        # Dart jsonEncode: insertion order, no spaces, padded base64url.
        assert text == '{"v":1,"type":"meshcore_community","name":"Acme","k":"' + K_B64URL + '"}'

    def test_round_trip(self):
        payload = parse_qr_payload(format_qr_payload("Mesh Zuid", K))
        assert payload.name == "Mesh Zuid"
        assert payload.secret == K
