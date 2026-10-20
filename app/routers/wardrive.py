"""Wardrive driver API (``MESHCORE_WARDRIVE``).

Reached without the main Basic login: wardrive accounts have their own
sessions, and nothing here touches the home radio. Registered only when the
module is active.
"""

import asyncio
import time
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field

from app.repository.wardrive import (
    DriveOfAnotherRadio,
    RadioTaken,
    UsernameTaken,
    WardriveDataRepository,
    WardriveDriveRepository,
    WardriveRadioRepository,
    WardriveUserRepository,
)
from app.wardrive import drives, sessions
from app.wardrive import nodes as wardrive_nodes
from app.wardrive.brokers import served_brokers
from app.wardrive.config import resolved_hashtag_channels, rssi_calibration
from app.wardrive.crypto import (
    challenge_message,
    challenges,
    hash_password,
    normalize_key,
    verify_password,
)
from app.wardrive.models import MAX_TS, UploadBody, UploadResult
from app.wardrive.visibility import visible_user_ids

router = APIRouter(prefix="/wardrive", tags=["wardrive"])

CurrentUser = Annotated[dict[str, Any], Depends(sessions.current_user)]

MIN_PASSWORD_LENGTH = 10


class ChallengeRequest(BaseModel):
    public_key: str


class ChallengeResponse(BaseModel):
    nonce: str
    message_hex: str = Field(description="The exact bytes the radio signs, as hex")


class SignedRadio(BaseModel):
    public_key: str
    nonce: str
    signature: str = Field(description="Ed25519 signature over message_hex, as hex")


class RegisterRequest(SignedRadio):
    username: str = Field(max_length=64)
    password: str
    radio_name: str | None = Field(default=None, max_length=64)


class LoginRequest(BaseModel):
    username: str
    password: str


class AddRadioRequest(SignedRadio):
    name: str | None = Field(default=None, max_length=64)


class RadioOut(BaseModel):
    public_key: str
    name: str | None = None


class MeResponse(BaseModel):
    user_id: int
    username: str
    visibility: str
    radios: list[RadioOut]


def _key_or_400(public_key: str) -> str:
    try:
        return normalize_key(public_key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None


def _check_signed(body: SignedRadio, request: Request) -> str:
    key = _key_or_400(body.public_key)
    if not challenges.consume(body.nonce, key, body.signature, owner=sessions.requester(request)):
        raise HTTPException(status_code=401, detail="The radio signature did not verify")
    return key


async def _me(user: dict[str, Any]) -> MeResponse:
    radios = await WardriveRadioRepository.list_for_user(user["id"])
    return MeResponse(
        user_id=user["id"],
        username=user["username"],
        visibility=user["visibility"],
        radios=[RadioOut(public_key=r["public_key"], name=r["name"]) for r in radios],
    )


@router.post("/challenge", response_model=ChallengeResponse)
async def wardrive_challenge(
    body: ChallengeRequest, request: Request, response: Response
) -> ChallengeResponse:
    """A one-time nonce for the radio to sign, proving it holds the key. It
    can only be spent by the browser that asked for it (device cookie)."""
    key = _key_or_400(body.public_key)
    nonce = challenges.issue(key, owner=sessions.challenge_owner(request, response))
    return ChallengeResponse(nonce=nonce, message_hex=challenge_message(nonce, key).hex())


@router.post("/register", response_model=MeResponse)
async def wardrive_register(
    body: RegisterRequest, request: Request, response: Response
) -> MeResponse:
    """Create an account that starts with the signed radio, and log in."""
    username = body.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="Choose a username")
    if len(body.password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"The password needs at least {MIN_PASSWORD_LENGTH} characters",
        )
    key = _check_signed(body, request)
    if await WardriveRadioRepository.owner_of(key) is not None:
        raise HTTPException(status_code=409, detail="This radio is already on an account")
    now = int(time.time())
    try:
        # scrypt is slow on purpose; keep it off the event loop.
        password_hash = await asyncio.to_thread(hash_password, body.password)
        user_id = await WardriveUserRepository.create(username, password_hash, now)
    except UsernameTaken:
        raise HTTPException(status_code=409, detail="This username is taken") from None
    try:
        await WardriveRadioRepository.add(key, user_id, body.radio_name, now)
    except RadioTaken:
        await WardriveUserRepository.delete(user_id)
        raise HTTPException(status_code=409, detail="This radio is already on an account") from None
    await sessions.start_session(
        response, user_id, sessions.request_is_https(request), sessions.cookie_path(request)
    )
    user = await WardriveUserRepository.get(user_id)
    assert user is not None
    return await _me(user)


@router.post("/login", response_model=MeResponse)
async def wardrive_login(body: LoginRequest, request: Request, response: Response) -> MeResponse:
    throttle = sessions.login_throttle
    if throttle.blocked(body.username):
        raise HTTPException(status_code=429, detail="Too many failed logins, try again later")
    user = await WardriveUserRepository.get_by_username(body.username.strip())
    matches = user is not None and await asyncio.to_thread(
        verify_password, body.password, user["password_hash"]
    )
    if user is None or not matches:
        throttle.record_failure(body.username)
        raise HTTPException(status_code=401, detail="Wrong username or password")
    if user["disabled"]:
        raise HTTPException(status_code=403, detail="Account disabled")
    throttle.reset(body.username)
    await sessions.start_session(
        response, user["id"], sessions.request_is_https(request), sessions.cookie_path(request)
    )
    return await _me(user)


@router.post("/logout", status_code=204)
async def wardrive_logout(request: Request, response: Response) -> None:
    await sessions.end_session(request, response)


@router.get("/me", response_model=MeResponse)
async def wardrive_me(user: CurrentUser) -> MeResponse:
    return await _me(user)


@router.post("/radios", response_model=MeResponse)
async def wardrive_add_radio(
    body: AddRadioRequest, request: Request, user: CurrentUser
) -> MeResponse:
    """Add the signed radio to the logged-in account."""
    key = _check_signed(body, request)
    try:
        await WardriveRadioRepository.add(key, user["id"], body.name, int(time.time()))
    except RadioTaken:
        raise HTTPException(status_code=409, detail="This radio is already on an account") from None
    return await _me(user)


@router.post("/upload", response_model=UploadResult)
async def wardrive_upload(body: UploadBody, user: CurrentUser) -> UploadResult:
    """Store a batch of the page's receptions and listening intervals.

    Re-sending a batch is safe: rows already stored count as duplicates. Every
    row's ``origin_id`` must be the radio the batch is for, as the
    DutchMeshCore collectors require; one that is not rejects the batch.
    """
    key = _key_or_400(body.radio_key)
    if await WardriveRadioRepository.owner_of(key) != user["id"]:
        raise HTTPException(status_code=403, detail="This radio is not on your account")
    for row in [*body.obs, *body.tracks]:
        try:
            origin = normalize_key(row.origin_id)
        except ValueError:
            origin = None
        if origin != key:
            raise HTTPException(
                status_code=422, detail="Every origin_id must be the radio of the batch"
            )
    try:
        counts = await WardriveDriveRepository.store_upload(
            user["id"], key, body.drive_uid, list(body.obs), list(body.tracks), int(time.time())
        )
    except DriveOfAnotherRadio:
        raise HTTPException(status_code=422, detail="This drive belongs to another radio") from None
    return UploadResult(**counts)


DEFAULT_WINDOW_S = 86400


@router.get("/data")
async def wardrive_data(
    user: CurrentUser,
    since: int | None = Query(
        default=None, ge=0, le=MAX_TS, description="Unix seconds, default 24 h ago"
    ),
    until: int | None = Query(
        default=None, ge=0, le=MAX_TS, description="Unix seconds, default now"
    ),
    radio_key: str | None = None,
) -> dict[str, Any]:
    """Stored receptions and tracks this user may see under their visibility."""
    end = until if until is not None else int(time.time())
    start = since if since is not None else end - DEFAULT_WINDOW_S
    key = _key_or_400(radio_key) if radio_key else None
    return await WardriveDataRepository.query(await visible_user_ids(user), start, end, key)


@router.get("/drives")
async def wardrive_drives(
    user: CurrentUser,
    since: int | None = Query(default=None, ge=0, le=MAX_TS),
    until: int | None = Query(default=None, ge=0, le=MAX_TS),
    user_id: int | None = None,
    group_id: int | None = None,
    radio_key: str | None = None,
    limit: int = Query(default=500, ge=1, le=1000),
) -> dict[str, Any]:
    """Drives this user may see (their visibility), newest first."""
    return await drives.list_drives(
        user,
        since=since,
        until=until,
        user_id=user_id,
        group_id=group_id,
        radio_key=radio_key,
        limit=limit,
    )


@router.patch("/drives/{drive_id}")
async def wardrive_update_drive(
    drive_id: int, body: drives.DriveUpdate, user: CurrentUser
) -> dict[str, Any]:
    """Rename a drive or set its notes (own drives only)."""
    return await drives.update_drive(drive_id, body, user)


@router.delete("/drives/{drive_id}")
async def wardrive_delete_drive(drive_id: int, user: CurrentUser) -> dict[str, Any]:
    """Delete an own drive and its stored rows from RTFM-EV (the collectors
    keep what they received)."""
    return await drives.delete_drive(drive_id, user)


@router.post("/drives/merge")
async def wardrive_merge_drives(body: drives.MergeBody, user: CurrentUser) -> dict[str, Any]:
    """Merge own drives of one radio into the earliest."""
    return await drives.merge_drives(body, user)


@router.post("/drives/{drive_id}/split")
async def wardrive_split_drive(
    drive_id: int, body: drives.SplitBody, user: CurrentUser
) -> dict[str, Any]:
    """Split an own drive: rows at or after ``at`` become a new drive."""
    return await drives.split_drive(drive_id, body, user)


ReportQueryParams = Annotated[drives.ReportQuery, Depends(drives.report_query)]


@router.get("/report")
async def wardrive_report(user: CurrentUser, q: ReportQueryParams) -> dict[str, Any]:
    """A report over the picked drives or a window, within this user's visibility."""
    return await drives.make_report(q, user)


@router.get("/export/{kind}")
async def wardrive_export(kind: str, user: CurrentUser, q: ReportQueryParams) -> Response:
    """receptions.csv, cells.csv, drives.geojson or drives.gpx over the same
    scope as /report."""
    return await drives.make_export(kind, q, user)


@router.get("/groups")
async def wardrive_groups(user: CurrentUser) -> dict[str, Any]:
    """The groups this user is a member of (for the report filter)."""
    return await drives.own_groups(user)


@router.get("/config")
async def wardrive_config(user: CurrentUser) -> dict[str, Any]:
    """Owner settings for the page: the hashtag channel names drivers may decode."""
    return {
        "hashtag_channels": await resolved_hashtag_channels(),
        "rssi_calibration_db": await rssi_calibration(),
        "brokers": await served_brokers(),
    }


@router.get("/nodes")
async def wardrive_nodes_in_box(
    user: CurrentUser,
    min_lat: float = Query(ge=-90, le=90),
    max_lat: float = Query(ge=-90, le=90),
    min_lon: float = Query(ge=-180, le=180),
    max_lon: float = Query(ge=-180, le=180),
) -> dict[str, Any]:
    """Names, roles and advertised positions of the nodes RTFM-EV knows: every
    contact with a full key and the imported map nodes inside the box."""
    if min_lat > max_lat or min_lon > max_lon:
        raise HTTPException(status_code=422, detail="The box is upside down")
    if (
        max_lat - min_lat > wardrive_nodes.MAX_SPAN_LAT
        or max_lon - min_lon > wardrive_nodes.MAX_SPAN_LON
    ):
        raise HTTPException(status_code=422, detail="The box is too big")
    return await wardrive_nodes.nodes_in_box(min_lat, max_lat, min_lon, max_lon)
