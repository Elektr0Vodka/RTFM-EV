"""Wardrive account crypto: passwords, radio keys and signed challenges.

A radio joins an account only by signing a one-time challenge with its own
Ed25519 key, the same way it signs a DutchMeshCore collector token, so nobody
can claim someone else's radio by typing its public key.
"""

import hashlib
import hmac
import secrets
import time
from collections import OrderedDict

from nacl.exceptions import BadSignatureError
from nacl.signing import VerifyKey

_SCRYPT_N = 16384
_SCRYPT_R = 8
_SCRYPT_P = 1
_SCRYPT_DKLEN = 32


def _scrypt(password: str, salt: bytes, n: int, r: int, p: int) -> bytes:
    return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p, dklen=_SCRYPT_DKLEN)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = _scrypt(password, salt, _SCRYPT_N, _SCRYPT_R, _SCRYPT_P)
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt_hex, digest_hex = stored.split("$")
        if scheme != "scrypt":
            return False
        digest = _scrypt(password, bytes.fromhex(salt_hex), int(n), int(r), int(p))
        return hmac.compare_digest(digest, bytes.fromhex(digest_hex))
    except (ValueError, TypeError):
        return False


def normalize_key(public_key: str) -> str:
    """A radio public key as stored: 64 hex characters, upper case."""
    key = str(public_key).strip().upper()
    if len(key) != 64:
        raise ValueError("A radio public key is 64 hex characters")
    try:
        bytes.fromhex(key)
    except ValueError:
        raise ValueError("A radio public key is 64 hex characters") from None
    return key


def challenge_message(nonce: str, public_key: str) -> bytes:
    """The exact bytes the radio signs to prove it holds ``public_key``."""
    return f"rtfm-ev-wardrive:{nonce}:{normalize_key(public_key)}".encode()


def verify_signature(public_key: str, message: bytes, signature_hex: str) -> bool:
    try:
        VerifyKey(bytes.fromhex(normalize_key(public_key))).verify(
            message, bytes.fromhex(signature_hex)
        )
        return True
    except (BadSignatureError, ValueError, TypeError):
        return False


class ChallengeStore:
    """One-time nonces for proving radio ownership, kept in memory.

    A challenge belongs to the radio key and to the requester that asked for
    it (``owner``, a per-browser cookie set by ``/challenge``): another device
    can neither replace it nor spend it. A requester has one pending challenge
    per radio (a new one replaces it). When the store is full, expired
    challenges go first, then the oldest."""

    MAX_PENDING = 1000

    def __init__(self, ttl_s: int = 300) -> None:
        self.ttl_s = ttl_s
        # nonce -> (radio key, issued at, owner)
        self._pending: OrderedDict[str, tuple[str, float, str]] = OrderedDict()
        self._by_owner_key: dict[tuple[str, str], str] = {}

    def _drop(self, nonce: str) -> tuple[str, float, str] | None:
        entry = self._pending.pop(nonce, None)
        if entry is not None:
            slot = (entry[2], entry[0])
            if self._by_owner_key.get(slot) == nonce:
                del self._by_owner_key[slot]
        return entry

    def issue(self, public_key: str, now: float | None = None, owner: str = "") -> str:
        key = normalize_key(public_key)
        current = time.time() if now is None else now
        previous = self._by_owner_key.get((owner, key))
        if previous is not None:
            self._drop(previous)
        if len(self._pending) >= self.MAX_PENDING:
            expired = [n for n, (_, at, _o) in self._pending.items() if current - at > self.ttl_s]
            for n in expired:
                self._drop(n)
        while len(self._pending) >= self.MAX_PENDING:
            self._drop(next(iter(self._pending)))
        nonce = secrets.token_hex(16)
        self._pending[nonce] = (key, current, owner)
        self._by_owner_key[(owner, key)] = nonce
        return nonce

    def consume(
        self,
        nonce: str,
        public_key: str,
        signature_hex: str,
        now: float | None = None,
        owner: str = "",
    ) -> bool:
        """True when the nonce was issued to this owner for this key, is fresh,
        and the signature verifies. The owner's attempt spends the nonce; a
        different owner's attempt is refused and leaves it."""
        pending = self._pending.get(nonce)
        if pending is None or not hmac.compare_digest(pending[2], owner):
            return False
        entry = self._drop(nonce)
        if entry is None:
            return False
        issued_key, issued_at, _owner = entry
        current = time.time() if now is None else now
        try:
            key = normalize_key(public_key)
        except ValueError:
            return False
        if key != issued_key or current - issued_at > self.ttl_s:
            return False
        return verify_signature(key, challenge_message(nonce, key), signature_hex)


challenges = ChallengeStore()
