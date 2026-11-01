"""The server's sender rules agree with the wardrive page's decoder.

Vectors come from running the page's ``decodeReception`` (frontend
``src/test/wardrive/senderVectors.test.ts``), so a change on either side
fails one of the two suites."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.channel_constants import PUBLIC_CHANNEL_KEY
from app.wardrive.config import hashtag_key
from app.wardrive.senders import decode_sender, id_class

VECTORS = json.loads(
    (Path(__file__).parent / "fixtures" / "wardrive_sender_vectors.json").read_text("utf-8")
)


def keys_for(channels: list[str]) -> list[tuple[str, bytes]]:
    return [("Public", bytes.fromhex(PUBLIC_CHANNEL_KEY))] + [
        (name, bytes.fromhex(hashtag_key(name))) for name in channels
    ]


@pytest.mark.parametrize("vector", VECTORS, ids=[v["name"] for v in VECTORS])
def test_sender_matches_the_page_vectors(vector):
    assert decode_sender(vector["raw"], keys_for(vector["channels"])) == vector["expect"]


def test_id_class_follows_the_page():
    def sender(kind, ident):
        return {"kind": kind, "id": ident, "label": None, "role": None}

    assert id_class(sender("channel_name", "alice")) == "channel"
    assert id_class(sender("path_hash", "ab")) == "1b"
    assert id_class(sender("relay", "abcd")) == "2b"
    assert id_class(sender("relay", "abcdef")) == "3b"
    assert id_class(sender("discover_pubkey", "ab" * 8)) == "pubkey"
    assert id_class(sender(None, None)) == "unnamed"


@pytest.mark.parametrize("raw", ["zz", "", "0"])
def test_undecodable_frames_have_no_sender(raw):
    out = decode_sender(raw, keys_for([]))
    assert out["packet_type_name"] == "Unknown"
    assert out["sender"]["kind"] is None
