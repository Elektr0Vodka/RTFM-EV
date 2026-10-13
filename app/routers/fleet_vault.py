"""Fleet key vault: encrypted private keys and passwords of fleet assets.

Off unless the server runs with ``MESHCORE_FLEET_VAULT_ENABLED=true``. Every
route except the status one answers 403 without it.

A secret's value leaves the server in exactly two ways: ``reveal`` (one value,
written to the audit log) and ``export`` (all values, encrypted under a
passphrase given for that export). Listings carry kind, label and dates only.
Values, passphrases and tokens are never logged.

Nothing here talks to the radio. Crypto and unlock sessions live in
``app.services.fleet_vault``.
"""

import asyncio
import base64
import binascii
import logging
import time
from typing import Any, Literal

from fastapi import APIRouter, Header, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from app.config import settings
from app.decoder import derive_public_key
from app.repository.fleet import FleetAssetRepository
from app.repository.fleet_vault import FleetVaultRepository
from app.routers.fleet import FleetAsset, _asset_or_404
from app.services import fleet_vault

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/fleet", tags=["fleet vault"])

FleetSecretKind = Literal["private_key", "admin_password", "guest_password", "wifi", "other"]

_PASSPHRASE_MIN = 12
_PASSPHRASE_MAX = 1024
_VALUE_MAX = 4096
_EXPORT_FORMAT = "rtfm-ev-fleet-vault"
_EXPORT_MAX_ENTRIES = 5000
# An import file names its own key derivation cost; refuse one that would
# take this host down.
_IMPORT_MAX_MEMLIMIT = 1024 * 1024 * 1024
_IMPORT_MAX_OPSLIMIT = 10
_KEYGEN_MAX_ATTEMPTS = 3_000_000
_NO_STORE = {"Cache-Control": "no-store"}


class VaultStatus(BaseModel):
    enabled: bool = Field(description="MESHCORE_FLEET_VAULT_ENABLED is set")
    initialised: bool = Field(description="A passphrase was set")
    unlocked: bool = Field(description="The token sent with this request is a live session")
    idle_seconds: int = Field(description="A session ends after this long without use")


class PassphraseRequest(BaseModel):
    passphrase: str = Field(min_length=_PASSPHRASE_MIN, max_length=_PASSPHRASE_MAX)


class UnlockRequest(BaseModel):
    passphrase: str = Field(min_length=1, max_length=_PASSPHRASE_MAX)


class ChangePassphraseRequest(BaseModel):
    current: str = Field(min_length=1, max_length=_PASSPHRASE_MAX)
    new: str = Field(min_length=_PASSPHRASE_MIN, max_length=_PASSPHRASE_MAX)


class VaultSession(BaseModel):
    token: str = Field(description="Send as X-Fleet-Vault-Token; keep it in memory only")
    idle_seconds: int


class FleetSecret(BaseModel):
    """A stored secret without its value."""

    id: int
    asset_id: int
    kind: FleetSecretKind
    label: str | None = None
    created_at: int
    updated_at: int


class FleetSecretCreate(BaseModel):
    kind: FleetSecretKind
    label: str | None = Field(default=None, max_length=200)
    value: str = Field(max_length=_VALUE_MAX)


class FleetSecretValue(BaseModel):
    value: str


class FleetAuditEntry(BaseModel):
    id: int
    ts: int
    action: str
    asset_id: int | None = None
    secret_id: int | None = None
    detail: str | None = None
    remote_addr: str | None = None
    auth_user: str | None = None


class ExportEntry(BaseModel):
    public_key: str | None = None
    org_serial: str | None = None
    asset_label: str | None = None
    kind: FleetSecretKind
    label: str | None = None
    nonce: str
    ciphertext: str


class ExportKdf(BaseModel):
    opslimit: int = Field(ge=1, le=_IMPORT_MAX_OPSLIMIT)
    memlimit: int = Field(ge=8192, le=_IMPORT_MAX_MEMLIMIT)
    salt: str


class ExportDocument(BaseModel):
    format: str
    version: int
    created_at: int
    kdf: ExportKdf
    entries: list[ExportEntry] = Field(max_length=_EXPORT_MAX_ENTRIES)


class ImportRequest(BaseModel):
    passphrase: str = Field(min_length=1, max_length=_PASSPHRASE_MAX)
    document: ExportDocument


class ImportResult(BaseModel):
    imported: int
    skipped: int = Field(description="Already stored, or no asset with that key or serial")


class GenerateKeyRequest(BaseModel):
    prefix: str = Field(default="", max_length=4, description="Wanted start of the public key")
    free_bytes: Literal[0, 1, 2] = Field(
        default=2,
        description="The first N bytes must not match any known contact or asset (0 = any)",
    )


class GenerateKeyResult(BaseModel):
    asset: FleetAsset
    attempts: int


def _require_enabled() -> None:
    if not settings.fleet_vault_enabled:
        raise HTTPException(
            status_code=403,
            detail="The fleet vault is switched off (set MESHCORE_FLEET_VAULT_ENABLED=true)",
        )


def _require_key(token: str | None) -> bytes:
    """The data key of the caller's session, or 401."""
    _require_enabled()
    data_key = fleet_vault.sessions.key_for(token)
    if data_key is None:
        raise HTTPException(status_code=401, detail="The vault is locked")
    return data_key


async def _audit(request: Request, action: str, **fields: Any) -> None:
    await FleetVaultRepository.audit(
        action,
        remote_addr=request.client.host if request.client else None,
        auth_user=settings.basic_auth_username if settings.basic_auth_enabled else None,
        **fields,
    )


def _secret_detail(kind: str, label: str | None) -> str:
    return f"{kind}: {label}" if label else kind


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _unb64(text: str) -> bytes:
    try:
        return base64.b64decode(text, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=422, detail="The file is not a vault export") from None


def _clean_value(kind: str, value: str, asset_public_key: str | None) -> str:
    """Validate a secret value. A private key must be MeshCore's 64 bytes and fit the asset."""
    if kind != "private_key":
        if not value.strip():
            raise HTTPException(status_code=422, detail="value cannot be empty")
        return value
    key_hex = value.strip().lower()
    try:
        key = bytes.fromhex(key_hex)
    except ValueError:
        key = b""
    if len(key) != 64:
        raise HTTPException(status_code=422, detail="a private key is 128 hex characters")
    if asset_public_key and derive_public_key(key).hex() != asset_public_key:
        raise HTTPException(
            status_code=422, detail="this private key does not belong to the asset's public key"
        )
    return key_hex


async def _unwrap(passphrase: str, vault: dict[str, Any]) -> bytes | None:
    """The data key when the passphrase is right, else None."""
    wrapping_key = await fleet_vault.derive_key_async(
        passphrase, vault["salt"], vault["kdf_opslimit"], vault["kdf_memlimit"]
    )
    try:
        return fleet_vault.unwrap_data_key(wrapping_key, vault["key_nonce"], vault["wrapped_key"])
    except fleet_vault.VaultError:
        return None


@router.get("/vault", response_model=VaultStatus)
async def vault_status(
    x_fleet_vault_token: str | None = Header(default=None),
) -> dict[str, Any]:
    """Whether the vault is switched on, set up, and unlocked for this caller."""
    enabled = settings.fleet_vault_enabled
    return {
        "enabled": enabled,
        "initialised": enabled and await FleetVaultRepository.get_vault() is not None,
        "unlocked": enabled and fleet_vault.sessions.key_for(x_fleet_vault_token) is not None,
        "idle_seconds": fleet_vault.IDLE_SECONDS,
    }


@router.post("/vault/init", response_model=VaultSession)
async def init_vault(body: PassphraseRequest, request: Request) -> dict[str, Any]:
    """Set the vault passphrase for the first time. It cannot be recovered later."""
    _require_enabled()
    if await FleetVaultRepository.get_vault() is not None:
        raise HTTPException(status_code=409, detail="The vault already has a passphrase")
    salt = fleet_vault.new_salt()
    data_key = fleet_vault.new_data_key()
    opslimit, memlimit = fleet_vault.KDF_OPSLIMIT, fleet_vault.KDF_MEMLIMIT
    wrapping_key = await fleet_vault.derive_key_async(body.passphrase, salt, opslimit, memlimit)
    key_nonce, wrapped = fleet_vault.wrap_data_key(data_key, wrapping_key)
    if not await FleetVaultRepository.create_vault(opslimit, memlimit, salt, key_nonce, wrapped):
        raise HTTPException(status_code=409, detail="The vault already has a passphrase")
    await _audit(request, "vault_created")
    return {"token": fleet_vault.sessions.open(data_key), "idle_seconds": fleet_vault.IDLE_SECONDS}


@router.post("/vault/unlock", response_model=VaultSession)
async def unlock_vault(body: UnlockRequest, request: Request) -> dict[str, Any]:
    _require_enabled()
    vault = await FleetVaultRepository.get_vault()
    if vault is None:
        raise HTTPException(status_code=409, detail="The vault has no passphrase yet")
    data_key = await _unwrap(body.passphrase, vault)
    if data_key is None:
        await _audit(request, "unlock_failed")
        raise HTTPException(status_code=401, detail="Wrong passphrase")
    return {"token": fleet_vault.sessions.open(data_key), "idle_seconds": fleet_vault.IDLE_SECONDS}


@router.post("/vault/lock")
async def lock_vault(x_fleet_vault_token: str | None = Header(default=None)) -> dict[str, str]:
    _require_enabled()
    fleet_vault.sessions.close(x_fleet_vault_token)
    return {"status": "ok"}


@router.post("/vault/passphrase", response_model=VaultSession)
async def change_passphrase(
    body: ChangePassphraseRequest,
    request: Request,
    x_fleet_vault_token: str | None = Header(default=None),
) -> dict[str, Any]:
    """Change the passphrase. Stored secrets stay as they are; every session ends."""
    _require_key(x_fleet_vault_token)
    vault = await FleetVaultRepository.get_vault()
    data_key = await _unwrap(body.current, vault) if vault else None
    if data_key is None:
        await _audit(request, "unlock_failed", detail="passphrase change")
        raise HTTPException(status_code=401, detail="Wrong passphrase")
    salt = fleet_vault.new_salt()
    opslimit, memlimit = fleet_vault.KDF_OPSLIMIT, fleet_vault.KDF_MEMLIMIT
    wrapping_key = await fleet_vault.derive_key_async(body.new, salt, opslimit, memlimit)
    key_nonce, wrapped = fleet_vault.wrap_data_key(data_key, wrapping_key)
    await FleetVaultRepository.rewrap_vault(opslimit, memlimit, salt, key_nonce, wrapped)
    fleet_vault.sessions.close_all()
    await _audit(request, "passphrase_changed")
    return {"token": fleet_vault.sessions.open(data_key), "idle_seconds": fleet_vault.IDLE_SECONDS}


@router.get("/vault/audit", response_model=list[FleetAuditEntry])
async def vault_audit(
    limit: int = Query(default=200, ge=1, le=1000),
    x_fleet_vault_token: str | None = Header(default=None),
) -> list[dict[str, Any]]:
    """What was done with the vault, newest first."""
    _require_key(x_fleet_vault_token)
    return await FleetVaultRepository.get_audit(limit)


@router.get("/assets/{asset_id}/secrets", response_model=list[FleetSecret])
async def list_secrets(
    asset_id: int, x_fleet_vault_token: str | None = Header(default=None)
) -> list[dict[str, Any]]:
    """Kind, label and dates of an asset's secrets. Never a value."""
    _require_key(x_fleet_vault_token)
    await _asset_or_404(asset_id, health=False)
    return await FleetVaultRepository.list_secrets(asset_id)


@router.post(
    "/assets/{asset_id}/secrets", response_model=FleetSecret, status_code=status.HTTP_201_CREATED
)
async def add_secret(
    asset_id: int,
    body: FleetSecretCreate,
    request: Request,
    x_fleet_vault_token: str | None = Header(default=None),
) -> dict[str, Any]:
    data_key = _require_key(x_fleet_vault_token)
    asset = await _asset_or_404(asset_id, health=False)
    value = _clean_value(body.kind, body.value, asset["public_key"])
    label = (body.label or "").strip() or None
    nonce, ciphertext = fleet_vault.seal(
        data_key, value.encode("utf-8"), fleet_vault.secret_aad(asset_id, body.kind)
    )
    secret = await FleetVaultRepository.add_secret(asset_id, body.kind, label, nonce, ciphertext)
    await _audit(
        request,
        "secret_added",
        asset_id=asset_id,
        secret_id=secret["id"],
        detail=_secret_detail(body.kind, label),
    )
    return secret


@router.post("/secrets/{secret_id}/reveal", response_model=FleetSecretValue)
async def reveal_secret(
    secret_id: int,
    request: Request,
    x_fleet_vault_token: str | None = Header(default=None),
) -> Any:
    """Return one secret's value. Every call is written to the audit log."""
    from fastapi.responses import JSONResponse

    data_key = _require_key(x_fleet_vault_token)
    sealed = await FleetVaultRepository.get_sealed(secret_id)
    if sealed is None:
        raise HTTPException(status_code=404, detail="Secret not found")
    try:
        value = fleet_vault.open_sealed(
            data_key,
            sealed["nonce"],
            sealed["ciphertext"],
            fleet_vault.secret_aad(sealed["asset_id"], sealed["kind"]),
        )
    except fleet_vault.VaultError:
        await _audit(request, "reveal_failed", asset_id=sealed["asset_id"], secret_id=secret_id)
        raise HTTPException(status_code=409, detail="This secret could not be decrypted") from None
    await _audit(
        request,
        "secret_revealed",
        asset_id=sealed["asset_id"],
        secret_id=secret_id,
        detail=_secret_detail(sealed["kind"], sealed["label"]),
    )
    return JSONResponse({"value": value.decode("utf-8")}, headers=_NO_STORE)


@router.delete("/secrets/{secret_id}")
async def delete_secret(
    secret_id: int,
    request: Request,
    x_fleet_vault_token: str | None = Header(default=None),
) -> dict[str, str]:
    _require_key(x_fleet_vault_token)
    sealed = await FleetVaultRepository.get_sealed(secret_id)
    if sealed is None or not await FleetVaultRepository.delete_secret(secret_id):
        raise HTTPException(status_code=404, detail="Secret not found")
    await _audit(
        request,
        "secret_deleted",
        asset_id=sealed["asset_id"],
        secret_id=secret_id,
        detail=_secret_detail(sealed["kind"], sealed["label"]),
    )
    return {"status": "ok"}


@router.post("/vault/export", response_model=ExportDocument)
async def export_vault(
    body: PassphraseRequest,
    request: Request,
    x_fleet_vault_token: str | None = Header(default=None),
) -> Any:
    """Every secret, encrypted under the passphrase given here (not the vault's own)."""
    from fastapi.responses import JSONResponse

    data_key = _require_key(x_fleet_vault_token)
    salt = fleet_vault.new_salt()
    opslimit, memlimit = fleet_vault.KDF_OPSLIMIT, fleet_vault.KDF_MEMLIMIT
    export_key = await fleet_vault.derive_key_async(body.passphrase, salt, opslimit, memlimit)
    assets = {asset["id"]: asset for asset in await FleetAssetRepository.get_all()}
    entries: list[dict[str, Any]] = []
    for sealed in await FleetVaultRepository.all_sealed():
        asset = assets.get(sealed["asset_id"])
        if asset is None:
            continue
        try:
            value = fleet_vault.open_sealed(
                data_key,
                sealed["nonce"],
                sealed["ciphertext"],
                fleet_vault.secret_aad(sealed["asset_id"], sealed["kind"]),
            )
        except fleet_vault.VaultError:
            continue  # a damaged row is left out rather than failing the whole export
        nonce, ciphertext = fleet_vault.seal(
            export_key, value, fleet_vault.export_aad(sealed["kind"])
        )
        entries.append(
            {
                "public_key": asset["public_key"],
                "org_serial": asset["org_serial"],
                "asset_label": asset["label"],
                "kind": sealed["kind"],
                "label": sealed["label"],
                "nonce": _b64(nonce),
                "ciphertext": _b64(ciphertext),
            }
        )
    await _audit(request, "vault_exported", detail=f"{len(entries)} secrets")
    document = {
        "format": _EXPORT_FORMAT,
        "version": 1,
        "created_at": int(time.time()),
        "kdf": {"opslimit": opslimit, "memlimit": memlimit, "salt": _b64(salt)},
        "entries": entries,
    }
    return JSONResponse(document, headers=_NO_STORE)


@router.post("/vault/import", response_model=ImportResult)
async def import_vault(
    body: ImportRequest,
    request: Request,
    x_fleet_vault_token: str | None = Header(default=None),
) -> dict[str, int]:
    """Store the secrets of an export file with the assets they belong to.

    An entry goes to the asset with its public key, else to the one asset with
    its organisation serial. Entries without such an asset, and entries already
    stored there, are skipped. A wrong passphrase stores nothing.
    """
    data_key = _require_key(x_fleet_vault_token)
    document = body.document
    if document.format != _EXPORT_FORMAT or document.version != 1:
        raise HTTPException(status_code=422, detail="The file is not a vault export")
    salt = _unb64(document.kdf.salt)
    if len(salt) != fleet_vault.SALT_BYTES:
        raise HTTPException(status_code=422, detail="The file is not a vault export")
    export_key = await fleet_vault.derive_key_async(
        body.passphrase, salt, document.kdf.opslimit, document.kdf.memlimit
    )

    # Open everything first: a wrong passphrase must not leave half an import behind.
    opened: list[tuple[ExportEntry, bytes]] = []
    for entry in document.entries:
        try:
            value = fleet_vault.open_sealed(
                export_key,
                _unb64(entry.nonce),
                _unb64(entry.ciphertext),
                fleet_vault.export_aad(entry.kind),
            )
        except fleet_vault.VaultError:
            raise HTTPException(
                status_code=422, detail="Wrong passphrase, or the file was changed"
            ) from None
        opened.append((entry, value))

    assets = await FleetAssetRepository.get_all()
    by_key = {asset["public_key"]: asset for asset in assets if asset["public_key"]}
    by_serial: dict[str, list[dict[str, Any]]] = {}
    for asset in assets:
        if asset["org_serial"]:
            by_serial.setdefault(asset["org_serial"], []).append(asset)

    imported = skipped = 0
    for entry, value in opened:
        asset = by_key.get(entry.public_key) if entry.public_key else None
        if asset is None and entry.org_serial and len(by_serial.get(entry.org_serial, [])) == 1:
            asset = by_serial[entry.org_serial][0]
        if asset is None:
            skipped += 1
            continue
        aad = fleet_vault.secret_aad(asset["id"], entry.kind)
        duplicate = False
        for existing in await FleetVaultRepository.all_sealed(asset["id"]):
            if existing["kind"] != entry.kind or existing["label"] != entry.label:
                continue
            try:
                current = fleet_vault.open_sealed(
                    data_key, existing["nonce"], existing["ciphertext"], aad
                )
            except fleet_vault.VaultError:
                continue
            if current == value:
                duplicate = True
                break
        if duplicate:
            skipped += 1
            continue
        nonce, ciphertext = fleet_vault.seal(data_key, value, aad)
        await FleetVaultRepository.add_secret(
            asset["id"], entry.kind, entry.label, nonce, ciphertext
        )
        imported += 1
    await _audit(request, "vault_imported", detail=f"{imported} stored, {skipped} skipped")
    return {"imported": imported, "skipped": skipped}


@router.post("/assets/{asset_id}/generate-key", response_model=GenerateKeyResult)
async def generate_key(
    asset_id: int,
    body: GenerateKeyRequest,
    request: Request,
    x_fleet_vault_token: str | None = Header(default=None),
) -> dict[str, Any]:
    """Make a new keypair for an asset that has no public key yet.

    The private key goes straight into the vault and is not part of the answer;
    the public key is set on the asset. Nothing is sent to any radio: putting
    the key on a device is done by hand.
    """
    data_key = _require_key(x_fleet_vault_token)
    asset = await _asset_or_404(asset_id, health=False)
    if asset["public_key"]:
        raise HTTPException(status_code=409, detail="This asset already has a public key")
    prefix = body.prefix.strip().lower()
    if any(char not in "0123456789abcdef" for char in prefix):
        raise HTTPException(status_code=422, detail="prefix must be hex")

    width = body.free_bytes * 2
    taken = await FleetVaultRepository.known_key_prefixes(width) if width else set()
    if width and len(prefix) >= width and prefix[:width] in taken:
        raise HTTPException(status_code=409, detail="A known node already uses this prefix")

    found = await asyncio.to_thread(
        fleet_vault.generate_keypair, prefix, taken, body.free_bytes, _KEYGEN_MAX_ATTEMPTS
    )
    if found is None:
        raise HTTPException(
            status_code=409, detail="No key found. Try a shorter prefix or fewer free bytes"
        )
    private_key, public_key, attempts = found

    nonce, ciphertext = fleet_vault.seal(
        data_key, private_key.hex().encode("ascii"), fleet_vault.secret_aad(asset_id, "private_key")
    )
    secret = await FleetVaultRepository.add_secret(
        asset_id, "private_key", "generated", nonce, ciphertext
    )
    try:
        await FleetAssetRepository.update(asset_id, {"public_key": public_key.hex()})
    except Exception:
        # The key is useless without its public half on the asset: do not keep it.
        await FleetVaultRepository.delete_secret(secret["id"])
        raise
    await _audit(
        request,
        "key_generated",
        asset_id=asset_id,
        secret_id=secret["id"],
        detail=f"prefix {public_key.hex()[:8]}, {attempts} attempts",
    )
    logger.info("Generated a key for fleet asset %d", asset_id)
    return {"asset": await _asset_or_404(asset_id), "attempts": attempts}
