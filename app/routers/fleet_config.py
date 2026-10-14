"""Fleet config library: stored config files of fleet assets, and templates.

A config is the device's own file: the one the Dutch MeshCore toolbox's USB
config page writes for a repeater or room server, or the version 1 file
Settings > Radio writes for a companion. What this app adds (kind, profile,
role, firmware version, label) is stored beside the document, never in it, so
an exported file is again a file those tools read.

A stored document never holds a secret value. On import each secret goes to
the fleet vault and the document keeps its vault id; with the vault off or
locked the document keeps an empty placeholder and the answer says how many
secrets were left out. An export puts secrets back only when asked, with the
vault unlocked, and that is written to the vault's audit log.

Nothing here talks to a device: no serial port, no LAN call, no radio.
The document rules live in ``app.services.fleet_config``.
"""

import logging
from typing import Any, Literal

from fastapi import APIRouter, Header, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.config import settings
from app.decoder import derive_public_key
from app.repository.contact_snmp import SnmpHistoryRepository
from app.repository.device_config_history import DeviceConfigHistoryRepository
from app.repository.fleet import FleetAssetRepository
from app.repository.fleet_config import (
    CONFIG_EDITABLE,
    TEMPLATE_FIELDS,
    FleetConfigRepository,
    FleetConfigTemplateRepository,
)
from app.repository.fleet_vault import FleetVaultRepository
from app.routers.fleet import _asset_or_404, _clean_text
from app.routers.fleet_vault import _NO_STORE, _audit, _require_key, _secret_detail
from app.services import fleet_config, fleet_config_reported, fleet_vault

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/fleet", tags=["fleet configs"])

FleetConfigKind = Literal["snapshot", "desired"]
# ``file`` and ``template`` are written today; the others are for the phases
# that read a device.
FleetConfigSource = Literal["file", "template", "usb_browser", "usb_server", "webconfig", "manual"]
FleetConfigProfile = Literal["stock", "dmc_repeater", "dmc_observer", "companion_v1"]

_TEXT_MAX = 200
_NOTES_MAX = 4000
_SECRET_LABEL_PREFIX = "config "


class FleetConfigSummary(BaseModel):
    """A stored config without its document."""

    id: int
    asset_id: int
    kind: FleetConfigKind
    source: FleetConfigSource
    profile: FleetConfigProfile
    role: str | None = None
    firmware_version: str | None = None
    label: str | None = None
    created_at: int
    secrets_stored: int = Field(description="Secrets of this document that are in the vault")
    secrets_missing: int = Field(description="Secrets of this document with no stored value")


class FleetConfig(FleetConfigSummary):
    document: dict[str, Any] = Field(
        description='The device\'s own file; each secret is {"$secret": vault id or null}'
    )


class FleetConfigImport(BaseModel):
    document: dict[str, Any]
    kind: FleetConfigKind = "snapshot"
    profile: FleetConfigProfile | None = Field(
        default=None, description="Absent: taken from the sections the file has"
    )
    role: str | None = Field(default=None, max_length=_TEXT_MAX)
    firmware_version: str | None = Field(default=None, max_length=_TEXT_MAX)
    label: str | None = Field(default=None, max_length=_TEXT_MAX)


class FleetConfigImportResult(BaseModel):
    config: FleetConfig
    secrets_stored: int = Field(description="Secrets moved to the vault")
    secrets_left_out: int = Field(description="Secrets not kept: the vault is off or locked")


class FleetConfigUpdate(BaseModel):
    """Only fields present in the body change. The document cannot be changed."""

    profile: FleetConfigProfile | None = None
    role: str | None = Field(default=None, max_length=_TEXT_MAX)
    firmware_version: str | None = Field(default=None, max_length=_TEXT_MAX)
    label: str | None = Field(default=None, max_length=_TEXT_MAX)


class FleetConfigExportRequest(BaseModel):
    include_secrets: bool = False


class FleetConfigExport(BaseModel):
    document: dict[str, Any]
    secrets_included: int
    secrets_left_out: int = Field(description="Their keys are not in the document")


class FleetConfigReportedRow(BaseModel):
    """One setting the config holds and the node reported."""

    path: str = Field(description="Where it sits in the config, e.g. vars/tx")
    configured: str
    reported: str = Field(description="The stored reply, as text")
    reported_at: int = Field(
        description="When that report was stored; a pane read again with the same values keeps it"
    )
    source: Literal[
        "node_info", "radio_settings", "advert_intervals", "owner_info", "regions", "snmp"
    ]
    same: bool


class FleetConfigReported(BaseModel):
    """A stored config against the newest stored reports of its node."""

    status: Literal["ok", "no_public_key", "not_a_device_file", "nothing_stored"]
    rows: list[FleetConfigReportedRow]
    not_reported: list[str] = Field(
        description="Settings of the config that could be compared but have no stored report"
    )


class FleetConfigVariable(BaseModel):
    name: str = Field(max_length=64)
    description: str = Field(default="", max_length=_TEXT_MAX)
    default: str = Field(default="", max_length=_TEXT_MAX)
    type: Literal["text", "number", "boolean"] = "text"


class FleetConfigTemplate(BaseModel):
    id: int
    name: str
    description: str | None = None
    profile: FleetConfigProfile
    role: str | None = None
    document: dict[str, Any]
    variables: list[FleetConfigVariable]
    created_at: int
    updated_at: int


class FleetConfigTemplateCreate(BaseModel):
    name: str = Field(max_length=_TEXT_MAX)
    description: str | None = Field(default=None, max_length=_NOTES_MAX)
    profile: FleetConfigProfile
    role: str | None = Field(default=None, max_length=_TEXT_MAX)
    document: dict[str, Any]
    variables: list[FleetConfigVariable] = Field(default_factory=list)


class FleetConfigTemplateUpdate(BaseModel):
    """Only fields present in the body change."""

    name: str | None = Field(default=None, max_length=_TEXT_MAX)
    description: str | None = Field(default=None, max_length=_NOTES_MAX)
    profile: FleetConfigProfile | None = None
    role: str | None = Field(default=None, max_length=_TEXT_MAX)
    document: dict[str, Any] | None = None
    variables: list[FleetConfigVariable] | None = None


class FleetConfigTemplateFromConfig(BaseModel):
    name: str = Field(max_length=_TEXT_MAX)
    description: str | None = Field(default=None, max_length=_NOTES_MAX)


class FleetConfigFromTemplate(BaseModel):
    template_id: int | None = Field(
        default=None, description="Absent: a config with only the asset's private key"
    )
    values: dict[str, str | int | float | bool] = Field(default_factory=dict)
    label: str | None = Field(default=None, max_length=_TEXT_MAX)
    include_private_key: bool = Field(
        default=False,
        description="Put the asset's own private key from the vault in it (vault id only)",
    )


def _unprocessable(detail: str) -> HTTPException:
    return HTTPException(status_code=422, detail=detail)


def _summary(config: dict[str, Any]) -> dict[str, Any]:
    stored, missing = fleet_config.count_placeholders(config["document"])
    return {**config, "secrets_stored": stored, "secrets_missing": missing}


async def _config_or_404(config_id: int) -> dict[str, Any]:
    config = await FleetConfigRepository.get(config_id)
    if config is None:
        raise HTTPException(status_code=404, detail="Config not found")
    return config


async def _template_or_404(template_id: int) -> dict[str, Any]:
    template = await FleetConfigTemplateRepository.get(template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    return template


def _vault_kind(secret: fleet_config.FoundSecret, asset_public_key: str | None) -> str:
    """The vault kind of a secret from a file.

    A private key is only filed as one when it is MeshCore's 64 bytes; any
    other form is kept as ``other`` so nothing is lost. One that belongs to a
    different public key than the asset's means the file is another device's.
    """
    if secret.kind != "private_key":
        return secret.kind
    try:
        key = bytes.fromhex(secret.text.strip())
        public_key = derive_public_key(key).hex() if len(key) == 64 else None
    except Exception:
        public_key = None
    if secret.encoded or public_key is None:
        return "other"
    if asset_public_key and public_key != asset_public_key:
        raise _unprocessable(
            "The private key in this file does not belong to this asset's public key. "
            "Is it the file of another device?"
        )
    return "private_key"


async def _store_secrets(
    data_key: bytes,
    asset_id: int,
    document: dict[str, Any],
    secrets: list[tuple[fleet_config.FoundSecret, str]],
    added: list[dict[str, Any]],
) -> None:
    """Put each secret in the vault and its id in the document.

    A secret the asset already holds under the same kind and label with the
    same value is used again, so importing a file twice stores it once.
    Every row that is added is appended to ``added`` as it is written.
    """
    existing = await FleetVaultRepository.all_sealed(asset_id)
    for secret, kind in secrets:
        label = (_SECRET_LABEL_PREFIX + fleet_config.path_label(secret.path))[:_TEXT_MAX]
        aad = fleet_vault.secret_aad(asset_id, kind)
        value = secret.text.encode("utf-8")
        secret_id: int | None = None
        for row in existing:
            if row["kind"] != kind or row["label"] != label:
                continue
            try:
                current = fleet_vault.open_sealed(data_key, row["nonce"], row["ciphertext"], aad)
            except fleet_vault.VaultError:
                continue
            if current == value:
                secret_id = row["id"]
                break
        if secret_id is None:
            nonce, ciphertext = fleet_vault.seal(data_key, value, aad)
            row = await FleetVaultRepository.add_secret(asset_id, kind, label, nonce, ciphertext)
            added.append(row)
            secret_id = int(row["id"])
        fleet_config.set_placeholder(document, secret.path, secret_id, encoded=secret.encoded)


@router.get("/assets/{asset_id}/configs", response_model=list[FleetConfigSummary])
async def list_configs(asset_id: int) -> list[dict[str, Any]]:
    """The asset's stored configs, newest first, without the documents."""
    await _asset_or_404(asset_id, health=False)
    return [_summary(config) for config in await FleetConfigRepository.get_for_asset(asset_id)]


@router.post(
    "/assets/{asset_id}/configs/import",
    response_model=FleetConfigImportResult,
    status_code=status.HTTP_201_CREATED,
)
async def import_config(
    asset_id: int,
    body: FleetConfigImport,
    request: Request,
    x_fleet_vault_token: str | None = Header(default=None),
) -> dict[str, Any]:
    """Store a toolbox config file or a companion version 1 file with an asset.

    The secrets in it go to the vault when it is unlocked for this caller.
    Otherwise they are not kept at all and ``secrets_left_out`` says how many.
    """
    asset = await _asset_or_404(asset_id, health=False)
    return await store_config(
        asset,
        body.document,
        {
            "kind": body.kind,
            "source": "file",
            "profile": body.profile,
            "role": body.role,
            "firmware_version": body.firmware_version,
            "label": body.label,
        },
        request,
        x_fleet_vault_token,
    )


async def store_config(
    asset: dict[str, Any],
    file: dict[str, Any],
    details: dict[str, Any],
    request: Request,
    vault_token: str | None,
) -> dict[str, Any]:
    """Store a device's file with an asset by the library's rules; the import answer.

    ``details`` holds ``kind``, ``source``, ``profile`` (None: taken from the
    file), ``role``, ``firmware_version`` and ``label``. A file read from a
    device over a cable is stored through here too, so it follows the same
    rules for secrets as an imported file.
    """
    asset_id = int(asset["id"])
    try:
        fleet_config.check_size(file)
        detected = fleet_config.detect_profile(file)
        document, found = fleet_config.split_secrets(file)
    except fleet_config.ConfigError as exc:
        raise _unprocessable(str(exc)) from None
    profile = details.get("profile") or detected
    if not fleet_config.profile_fits(profile, file):
        raise _unprocessable("This profile is for the other file format")
    secrets = [(secret, _vault_kind(secret, asset["public_key"])) for secret in found]

    fields = {
        "kind": details["kind"],
        "source": details["source"],
        "profile": profile,
        "role": _clean_text(details.get("role")),
        "firmware_version": _clean_text(details.get("firmware_version")),
        "label": _clean_text(details.get("label")),
    }
    data_key = fleet_vault.sessions.key_for(vault_token) if settings.fleet_vault_enabled else None
    added: list[dict[str, Any]] = []
    try:
        if data_key is not None:
            await _store_secrets(data_key, asset_id, document, secrets, added)
        config_id = await FleetConfigRepository.create(asset_id, fields, document)
    except Exception:
        # Without the document nothing points at these: do not keep them.
        for row in added:
            await FleetVaultRepository.delete_secret(row["id"])
        raise
    for row in added:
        await _audit(
            request,
            "secret_added",
            asset_id=asset_id,
            secret_id=row["id"],
            detail=_secret_detail(row["kind"], row["label"]),
        )
    stored = len(secrets) if data_key is not None else 0
    logger.info(
        "Stored a %s config for fleet asset %d (%d secrets to the vault, %d left out)",
        profile,
        asset_id,
        stored,
        len(secrets) - stored,
    )
    return {
        "config": _summary(await _config_or_404(config_id)),
        "secrets_stored": stored,
        "secrets_left_out": len(secrets) - stored,
    }


@router.post(
    "/assets/{asset_id}/configs/from-template",
    response_model=FleetConfig,
    status_code=status.HTTP_201_CREATED,
)
async def create_config_from_template(
    asset_id: int,
    body: FleetConfigFromTemplate,
    x_fleet_vault_token: str | None = Header(default=None),
) -> dict[str, Any]:
    """Fill a template's variables for this asset and store the result as ``desired``.

    With ``include_private_key`` the config also holds the asset's own private
    key, as its vault id: applying it gives a device the asset's identity
    (onboarding with a key made in the vault). That needs the vault unlocked
    and a private key in it that belongs to the asset's public key. Without a
    template the config holds that key only.
    """
    asset = await _asset_or_404(asset_id, health=False)
    if body.template_id is None and not body.include_private_key:
        raise _unprocessable("Choose a template, the asset's private key, or both")
    template = await _template_or_404(body.template_id) if body.template_id is not None else None
    if template is not None and body.include_private_key and template["profile"] == "companion_v1":
        raise _unprocessable("A companion's file does not take a private key from here")
    try:
        if template is not None:
            rendered = fleet_config.render_template(
                template["document"], template["variables"], body.values, asset
            )
        else:
            rendered = {"vars": {}}
        fleet_config.check_size(rendered)
        # A template holds no secret; this keeps that true for what is stored.
        document, _found = fleet_config.split_secrets(rendered, allow_placeholders=True)
    except fleet_config.ConfigError as exc:
        raise _unprocessable(str(exc)) from None
    if body.include_private_key:
        secret_id = await _asset_private_key_id(asset, x_fleet_vault_token)
        document.setdefault("vars", {})["prv.key"] = {fleet_config.SECRET: secret_id}
    config_id = await FleetConfigRepository.create(
        asset_id,
        {
            "kind": "desired",
            "source": "template" if template is not None else "manual",
            "profile": template["profile"] if template is not None else "stock",
            "role": template["role"] if template is not None else _clean_text(asset["role"]),
            "label": _clean_text(body.label)
            or (template["name"] if template is not None else "Asset key"),
        },
        document,
    )
    return _summary(await _config_or_404(config_id))


async def _asset_private_key_id(asset: dict[str, Any], vault_token: str | None) -> int:
    """The vault id of the asset's private key that belongs to its public key.

    The newest such key wins. The value is opened only to check whose key it
    is; it does not leave this function.
    """
    data_key = _require_key(vault_token)
    if not asset["public_key"]:
        raise HTTPException(status_code=409, detail="This asset has no public key")
    for row in reversed(await FleetVaultRepository.all_sealed(int(asset["id"]))):
        if row["kind"] != "private_key":
            continue
        try:
            value = fleet_vault.open_sealed(
                data_key,
                row["nonce"],
                row["ciphertext"],
                fleet_vault.secret_aad(row["asset_id"], row["kind"]),
            )
            key = bytes.fromhex(value.decode("ascii").strip())
        except (fleet_vault.VaultError, ValueError, UnicodeDecodeError):
            continue
        if len(key) == 64 and derive_public_key(key).hex() == asset["public_key"]:
            return int(row["id"])
    raise HTTPException(
        status_code=409,
        detail="The vault holds no private key of this asset's public key",
    )


@router.get("/configs/{config_id}", response_model=FleetConfig)
async def get_config(config_id: int) -> dict[str, Any]:
    return _summary(await _config_or_404(config_id))


@router.patch("/configs/{config_id}", response_model=FleetConfig)
async def update_config(config_id: int, body: FleetConfigUpdate) -> dict[str, Any]:
    """Correct what is stored beside the document: profile, role, firmware version, label."""
    config = await _config_or_404(config_id)
    changes = body.model_dump(include=body.model_fields_set)
    for field in CONFIG_EDITABLE:
        if field in changes and field != "profile":
            changes[field] = _clean_text(changes[field])
    if "profile" in changes:
        if changes["profile"] is None:
            raise _unprocessable("profile cannot be empty")
        if not fleet_config.profile_fits(changes["profile"], config["document"]):
            raise _unprocessable("This profile is for the other file format")
    await FleetConfigRepository.update_details(config_id, changes)
    return _summary(await _config_or_404(config_id))


@router.delete("/configs/{config_id}")
async def delete_config(config_id: int) -> dict[str, str]:
    """Remove one stored config. Its secrets stay in the vault."""
    if not await FleetConfigRepository.delete(config_id):
        raise HTTPException(status_code=404, detail="Config not found")
    return {"status": "ok"}


@router.post("/configs/{config_id}/export", response_model=FleetConfigExport)
async def export_config(
    config_id: int,
    body: FleetConfigExportRequest,
    request: Request,
    x_fleet_vault_token: str | None = Header(default=None),
) -> Any:
    """The config as a file again, with nothing of this app in it.

    Without ``include_secrets`` every secret's key is left out. With it, the
    vault must be unlocked, the secrets of this asset are put back and the
    export is written to the audit log. A secret that is not in the vault (any
    more) is left out and counted.
    """
    config = await _config_or_404(config_id)
    if not body.include_secrets:
        document, included, left_out = fleet_config.export_document(config["document"], None)
        return {"document": document, "secrets_included": included, "secrets_left_out": left_out}

    data_key = _require_key(x_fleet_vault_token)
    values: dict[int, str] = {}
    for secret_id in fleet_config.secret_ids(config["document"]):
        sealed = await FleetVaultRepository.get_sealed(secret_id)
        # Only this asset's own secrets: an id in a document is not a permission.
        if sealed is None or sealed["asset_id"] != config["asset_id"]:
            continue
        try:
            value = fleet_vault.open_sealed(
                data_key,
                sealed["nonce"],
                sealed["ciphertext"],
                fleet_vault.secret_aad(sealed["asset_id"], sealed["kind"]),
            )
        except fleet_vault.VaultError:
            continue
        values[secret_id] = value.decode("utf-8")
    document, included, left_out = fleet_config.export_document(config["document"], values)
    await _audit(
        request,
        "config_exported",
        asset_id=config["asset_id"],
        detail=f"config {config_id}: {included} secrets",
    )
    return JSONResponse(
        {"document": document, "secrets_included": included, "secrets_left_out": left_out},
        headers=_NO_STORE,
    )


@router.get("/configs/{config_id}/reported", response_model=FleetConfigReported)
async def config_reported(config_id: int) -> dict[str, Any]:
    """Where a stored config differs from what its node last reported.

    Stored data only: the newest snapshot of each repeater or room pane and the
    newest SNMP poll of the asset's public key. No node is asked anything, so
    a setting whose pane was never opened is listed under ``not_reported``.
    """
    config = await _config_or_404(config_id)
    nothing: dict[str, Any] = {"rows": [], "not_reported": []}
    if not isinstance(config["document"].get("vars"), dict):
        # A companion has no panes: there is nothing its file can be held against.
        return {"status": "not_a_device_file", **nothing}
    asset = await FleetAssetRepository.get(config["asset_id"])
    public_key = asset["public_key"] if asset else None
    if not public_key:
        return {"status": "no_public_key", **nothing}
    snapshots = await DeviceConfigHistoryRepository.get_latest_by_kind(public_key)
    poll = await SnmpHistoryRepository.get_latest(public_key)
    if poll is not None:
        snapshots["snmp"] = {"timestamp": poll["timestamp"], "data": poll["values"]}
    rows, not_reported = fleet_config_reported.compare(config["document"], snapshots)
    return {
        "status": "ok" if rows else "nothing_stored",
        "rows": rows,
        "not_reported": not_reported,
    }


def _checked_template(template: dict[str, Any]) -> dict[str, Any]:
    """The template with trimmed text, or 422 when it breaks a rule."""
    cleaned = dict(template)
    cleaned["name"] = _clean_text(template.get("name"))
    cleaned["description"] = _clean_text(template.get("description"))
    cleaned["role"] = _clean_text(template.get("role"))
    if cleaned["name"] is None:
        raise _unprocessable("name cannot be empty")
    if cleaned.get("profile") is None or cleaned.get("document") is None:
        raise _unprocessable("a template needs a profile and a document")
    try:
        fleet_config.validate_template(
            cleaned["profile"], cleaned["document"], cleaned["variables"]
        )
    except fleet_config.ConfigError as exc:
        raise _unprocessable(str(exc)) from None
    return cleaned


async def _create_template(template: dict[str, Any]) -> dict[str, Any]:
    cleaned = _checked_template(template)
    template_id = await FleetConfigTemplateRepository.create(
        {field: cleaned[field] for field in TEMPLATE_FIELDS},
        cleaned["document"],
        cleaned["variables"],
    )
    return await _template_or_404(template_id)


@router.get("/config-templates", response_model=list[FleetConfigTemplate])
async def list_templates() -> list[dict[str, Any]]:
    return await FleetConfigTemplateRepository.get_all()


@router.post(
    "/config-templates", response_model=FleetConfigTemplate, status_code=status.HTTP_201_CREATED
)
async def create_template(body: FleetConfigTemplateCreate) -> dict[str, Any]:
    """Add a template. It may hold ``{{name}}`` variables and no secret value."""
    return await _create_template(body.model_dump())


@router.post(
    "/configs/{config_id}/template",
    response_model=FleetConfigTemplate,
    status_code=status.HTTP_201_CREATED,
)
async def create_template_from_config(
    config_id: int, body: FleetConfigTemplateFromConfig
) -> dict[str, Any]:
    """Save a stored config as a template: its identity and its secrets are left out."""
    config = await _config_or_404(config_id)
    return await _create_template(
        {
            "name": body.name,
            "description": body.description,
            "profile": config["profile"],
            "role": config["role"],
            "document": fleet_config.template_document(config["document"]),
            "variables": [],
        }
    )


@router.get("/config-templates/{template_id}", response_model=FleetConfigTemplate)
async def get_template(template_id: int) -> dict[str, Any]:
    return await _template_or_404(template_id)


@router.patch("/config-templates/{template_id}", response_model=FleetConfigTemplate)
async def update_template(template_id: int, body: FleetConfigTemplateUpdate) -> dict[str, Any]:
    """Change the fields present in the body. The result is checked as a whole."""
    current = await _template_or_404(template_id)
    changes = body.model_dump(include=body.model_fields_set)
    if "variables" in changes and changes["variables"] is None:
        changes["variables"] = []
    await FleetConfigTemplateRepository.save(template_id, _checked_template({**current, **changes}))
    return await _template_or_404(template_id)


@router.delete("/config-templates/{template_id}")
async def delete_template(template_id: int) -> dict[str, str]:
    """Remove a template. Configs made from it stay."""
    if not await FleetConfigTemplateRepository.delete(template_id):
        raise HTTPException(status_code=404, detail="Template not found")
    return {"status": "ok"}
