"""Fleet key vault: the crypto and the unlock sessions.

Layout (all libsodium through PyNaCl):

- A random 32-byte data key encrypts every secret (XChaCha20-Poly1305). The
  asset id and the secret kind are bound in as associated data, so a ciphertext
  copied to another row does not open.
- The data key is stored wrapped under a key derived from the vault passphrase
  with Argon2id. The passphrase and the derived key are never stored. A
  forgotten passphrase cannot be recovered.
- Unlocking yields a random token. The data key lives in this process's memory
  under that token until it has been idle for ``IDLE_SECONDS`` or the process
  restarts. Nothing here is written to disk.

The key derivation is slow and memory-hard on purpose; callers run it in a
thread (``asyncio.to_thread``) and one at a time.
"""

import asyncio
import hashlib
import os
import secrets
import time

import nacl.bindings
import nacl.exceptions
import nacl.pwhash
import nacl.secret

KEY_BYTES = nacl.secret.Aead.KEY_SIZE
NONCE_BYTES = nacl.secret.Aead.NONCE_SIZE
SALT_BYTES = nacl.pwhash.argon2id.SALTBYTES

# libsodium's "moderate" preset: 3 passes over 256 MiB. Stored with each vault
# and each export, so raising it later does not lock anyone out.
KDF_OPSLIMIT = nacl.pwhash.argon2id.OPSLIMIT_MODERATE
KDF_MEMLIMIT = nacl.pwhash.argon2id.MEMLIMIT_MODERATE

IDLE_SECONDS = 15 * 60
MAX_SESSIONS = 16

_WRAP_AAD = b"rtfm-ev fleet vault key v1"
# One derivation at a time: each takes KDF_MEMLIMIT of memory.
kdf_lock = asyncio.Lock()


class VaultError(Exception):
    """A ciphertext did not open: wrong key, wrong row, or changed bytes."""


def new_salt() -> bytes:
    return os.urandom(SALT_BYTES)


def new_data_key() -> bytes:
    return os.urandom(KEY_BYTES)


def derive_key(passphrase: str, salt: bytes, opslimit: int, memlimit: int) -> bytes:
    """Argon2id. Blocking and memory-hard: call it through ``derive_key_async``."""
    return nacl.pwhash.argon2id.kdf(
        KEY_BYTES, passphrase.encode("utf-8"), salt, opslimit=opslimit, memlimit=memlimit
    )


async def derive_key_async(passphrase: str, salt: bytes, opslimit: int, memlimit: int) -> bytes:
    async with kdf_lock:
        return await asyncio.to_thread(derive_key, passphrase, salt, opslimit, memlimit)


def seal(key: bytes, plaintext: bytes, aad: bytes) -> tuple[bytes, bytes]:
    """Encrypt under ``key``. Returns ``(nonce, ciphertext)``."""
    nonce = os.urandom(NONCE_BYTES)
    sealed = nacl.secret.Aead(key).encrypt(plaintext, aad, nonce)
    return nonce, sealed.ciphertext


def open_sealed(key: bytes, nonce: bytes, ciphertext: bytes, aad: bytes) -> bytes:
    try:
        return nacl.secret.Aead(key).decrypt(ciphertext, aad, nonce)
    except (nacl.exceptions.CryptoError, ValueError, TypeError) as exc:
        raise VaultError("could not be decrypted") from exc


def wrap_data_key(data_key: bytes, wrapping_key: bytes) -> tuple[bytes, bytes]:
    return seal(wrapping_key, data_key, _WRAP_AAD)


def unwrap_data_key(wrapping_key: bytes, nonce: bytes, wrapped: bytes) -> bytes:
    return open_sealed(wrapping_key, nonce, wrapped, _WRAP_AAD)


def secret_aad(asset_id: int, kind: str) -> bytes:
    return f"rtfm-ev fleet secret v1|{asset_id}|{kind}".encode()


def export_aad(kind: str) -> bytes:
    return f"rtfm-ev fleet export v1|{kind}".encode()


class VaultSessions:
    """Unlocked data keys by token, in memory only."""

    def __init__(self) -> None:
        self._sessions: dict[str, tuple[bytes, float]] = {}

    def _drop_expired(self) -> None:
        now = time.monotonic()
        for token in [t for t, (_key, used) in self._sessions.items() if now - used > IDLE_SECONDS]:
            del self._sessions[token]

    def open(self, data_key: bytes) -> str:
        self._drop_expired()
        while len(self._sessions) >= MAX_SESSIONS:
            oldest = min(self._sessions, key=lambda token: self._sessions[token][1])
            del self._sessions[oldest]
        token = secrets.token_urlsafe(32)
        self._sessions[token] = (data_key, time.monotonic())
        return token

    def key_for(self, token: str | None) -> bytes | None:
        """The data key of a live session; using it counts as activity."""
        self._drop_expired()
        if not token or token not in self._sessions:
            return None
        data_key, _used = self._sessions[token]
        self._sessions[token] = (data_key, time.monotonic())
        return data_key

    def close(self, token: str | None) -> None:
        if token:
            self._sessions.pop(token, None)

    def close_all(self) -> None:
        self._sessions.clear()


sessions = VaultSessions()


def generate_keypair(
    prefix: str, taken: set[str], free_bytes: int, max_attempts: int
) -> tuple[bytes, bytes, int] | None:
    """Search for a MeshCore keypair. Blocking: run it in a thread.

    The public key must start with ``prefix`` (lower-case hex, may be empty),
    its first ``free_bytes`` bytes (as hex) must not be in ``taken``, and its
    first byte must not be 00 or FF (the old fork's keygen treated those as
    reserved; not checked against firmware).

    Returns ``(private_key, public_key, attempts)`` or None when
    ``max_attempts`` is used up. The private key is in MeshCore's format: the
    clamped scalar followed by the signing prefix, both from SHA-512 of a
    random seed (see ``app.decoder.derive_public_key``).
    """
    width = free_bytes * 2
    for attempt in range(1, max_attempts + 1):
        digest = bytearray(hashlib.sha512(os.urandom(32)).digest())
        digest[0] &= 248
        digest[31] &= 127
        digest[31] |= 64
        public_key = nacl.bindings.crypto_scalarmult_ed25519_base_noclamp(bytes(digest[:32]))
        if public_key[0] in (0x00, 0xFF):
            continue
        public_hex = public_key.hex()
        if not public_hex.startswith(prefix) or public_hex[:width] in taken:
            continue
        return bytes(digest), public_key, attempt
    return None
