"""Wardrive passwords, radio keys and signed challenges."""

import pytest
from nacl.signing import SigningKey

from app.wardrive.crypto import (
    ChallengeStore,
    challenge_message,
    hash_password,
    normalize_key,
    verify_password,
)


def _radio() -> tuple[SigningKey, str]:
    key = SigningKey.generate()
    return key, key.verify_key.encode().hex().upper()


def _sign(key: SigningKey, nonce: str, public_key: str) -> str:
    return key.sign(challenge_message(nonce, public_key)).signature.hex()


def test_password_roundtrip():
    stored = hash_password("correct horse")
    assert stored.startswith("scrypt$16384$8$1$")
    assert verify_password("correct horse", stored)


def test_password_wrong():
    assert not verify_password("nope nope nope", hash_password("correct horse"))


def test_password_salted():
    assert hash_password("correct horse") != hash_password("correct horse")


def test_password_malformed_stored():
    assert not verify_password("x" * 12, "garbage")
    assert not verify_password("x" * 12, "scrypt$a$b$c$zz$zz")


def test_normalize_key_upper():
    assert normalize_key(" " + "ab" * 32 + " ") == "AB" * 32


def test_normalize_key_rejects_short():
    with pytest.raises(ValueError):
        normalize_key("ab")


def test_normalize_key_rejects_non_hex():
    with pytest.raises(ValueError):
        normalize_key("zz" * 32)


def test_challenge_message_exact():
    assert challenge_message("n1", "ab" * 32) == f"rtfm-ev-wardrive:n1:{'AB' * 32}".encode()


def test_challenge_ok():
    store = ChallengeStore()
    key, pk = _radio()
    nonce = store.issue(pk)
    assert len(nonce) == 32
    assert store.consume(nonce, pk, _sign(key, nonce, pk))


def test_challenge_lowercase_key_ok():
    store = ChallengeStore()
    key, pk = _radio()
    nonce = store.issue(pk.lower())
    assert store.consume(nonce, pk.lower(), _sign(key, nonce, pk))


def test_challenge_reuse_refused():
    store = ChallengeStore()
    key, pk = _radio()
    nonce = store.issue(pk)
    sig = _sign(key, nonce, pk)
    assert store.consume(nonce, pk, sig)
    assert not store.consume(nonce, pk, sig)


def test_challenge_failed_attempt_burns_nonce():
    store = ChallengeStore()
    key, pk = _radio()
    nonce = store.issue(pk)
    assert not store.consume(nonce, pk, "00" * 64)
    assert not store.consume(nonce, pk, _sign(key, nonce, pk))


def test_challenge_expired_refused():
    store = ChallengeStore(ttl_s=300)
    key, pk = _radio()
    nonce = store.issue(pk, now=0)
    assert not store.consume(nonce, pk, _sign(key, nonce, pk), now=301)


def test_challenge_other_key_refused():
    store = ChallengeStore()
    _, pk_a = _radio()
    key_b, pk_b = _radio()
    nonce = store.issue(pk_a)
    assert not store.consume(nonce, pk_b, _sign(key_b, nonce, pk_b))


def test_challenge_bad_signature_refused():
    store = ChallengeStore()
    _, pk = _radio()
    nonce = store.issue(pk)
    assert not store.consume(nonce, pk, "00" * 64)


def test_challenge_garbage_signature_refused():
    store = ChallengeStore()
    _, pk = _radio()
    nonce = store.issue(pk)
    assert not store.consume(nonce, pk, "not hex")


def test_challenge_store_bounded():
    store = ChallengeStore()
    key, pk = _radio()
    first = store.issue(pk, now=0)
    for _ in range(1000):
        store.issue(pk, now=0)
    assert not store.consume(first, pk, _sign(key, first, pk), now=0)


def test_challenge_flood_for_one_radio_keeps_other_radios():
    store = ChallengeStore()
    key, pk = _radio()
    nonce = store.issue(pk, now=0)
    _, other = _radio()
    for _ in range(1000):
        store.issue(other, now=0)
    assert store.consume(nonce, pk, _sign(key, nonce, pk), now=0)


def test_challenge_new_one_replaces_the_pending_one_of_that_radio():
    store = ChallengeStore()
    key, pk = _radio()
    first = store.issue(pk, now=0)
    second = store.issue(pk, now=1)
    assert not store.consume(first, pk, _sign(key, first, pk), now=1)
    assert store.consume(second, pk, _sign(key, second, pk), now=1)


def test_challenge_full_store_drops_expired_ones_first():
    store = ChallengeStore(ttl_s=300)
    for _ in range(ChallengeStore.MAX_PENDING):
        store.issue(_radio()[1], now=0)
    key, pk = _radio()
    nonce = store.issue(pk, now=1000)
    assert len(store._pending) == 1
    assert store.consume(nonce, pk, _sign(key, nonce, pk), now=1000)


def test_challenge_of_another_requester_does_not_replace_mine():
    store = ChallengeStore()
    key, pk = _radio()
    mine = store.issue(pk, now=0, owner="me")
    store.issue(pk, now=0, owner="someone else")
    assert store.consume(mine, pk, _sign(key, mine, pk), now=0, owner="me")


def test_challenge_only_for_the_requester_that_asked():
    store = ChallengeStore()
    key, pk = _radio()
    nonce = store.issue(pk, now=0, owner="me")
    assert not store.consume(nonce, pk, _sign(key, nonce, pk), now=0, owner="someone else")
