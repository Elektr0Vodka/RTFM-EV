"""Wardrive sessions: a cookie scoped to /api/wardrive/, separate from the
main Basic login, plus a small in-memory login throttle."""

import hashlib
import re
import secrets
import time
from typing import Any

from fastapi import HTTPException, Request, Response

from app.repository.wardrive import WardriveSessionRepository, WardriveUserRepository
from app.wardrive.module import API_PREFIX

COOKIE_NAME = "rtfm_wardrive"
SESSION_TTL_S = 30 * 86400
# Names the browser that asked for a radio challenge, so only it can use it.
DEVICE_COOKIE = "rtfm_wardrive_device"
DEVICE_TTL_S = 365 * 86400


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def request_is_https(request: Request) -> bool:
    """TLS usually ends in front of the app (tailscale serve, a reverse proxy)."""
    forwarded = request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower()
    return request.url.scheme == "https" or forwarded == "https"


# A proxy prefix as it may appear in a cookie Path: plain path characters
# only, so a header cannot add cookie attributes.
_SAFE_PREFIX = re.compile(r"^/[A-Za-z0-9._~/-]*$")


def cookie_path(request: Request) -> str:
    """The API path as the browser sees it: behind a sub-path reverse proxy
    (X-Forwarded-Prefix, as the web manifest reads it) the cookie must carry
    that prefix or the browser never sends it back."""
    prefix = (
        (request.headers.get("x-forwarded-prefix") or request.headers.get("x-forwarded-path") or "")
        .strip()
        .rstrip("/")
    )
    if prefix and not _SAFE_PREFIX.match(prefix):
        prefix = ""
    return f"{prefix}{API_PREFIX}"


def challenge_owner(request: Request, response: Response) -> str:
    """Who a challenge belongs to: this browser's device cookie (set here when
    missing), stored only as its hash. Another device asking for a challenge
    for the same radio then cannot replace or spend this one."""
    token = request.cookies.get(DEVICE_COOKIE)
    if not token or len(token) > 128:
        token = secrets.token_urlsafe(32)
        response.set_cookie(
            DEVICE_COOKIE,
            token,
            max_age=DEVICE_TTL_S,
            path=cookie_path(request),
            httponly=True,
            samesite="strict",
            secure=request_is_https(request),
        )
    return _token_hash(token)


def requester(request: Request) -> str:
    """The device cookie's hash on a request that spends a challenge."""
    token = request.cookies.get(DEVICE_COOKIE)
    return _token_hash(token) if token and len(token) <= 128 else ""


async def start_session(
    response: Response, user_id: int, secure: bool, path: str = API_PREFIX
) -> None:
    token = secrets.token_urlsafe(32)
    await WardriveSessionRepository.create(
        _token_hash(token), user_id, now=int(time.time()), ttl_s=SESSION_TTL_S
    )
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=SESSION_TTL_S,
        path=path,
        httponly=True,
        samesite="strict",
        secure=secure,
    )


async def current_user(request: Request) -> dict[str, Any]:
    """FastAPI dependency: the logged-in wardrive user, read fresh every call."""
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not logged in")
    user_id = await WardriveSessionRepository.get_user_id(_token_hash(token), int(time.time()))
    user = await WardriveUserRepository.get(user_id) if user_id is not None else None
    if user is None:
        raise HTTPException(status_code=401, detail="Not logged in")
    if user["disabled"]:
        raise HTTPException(status_code=403, detail="Account disabled")
    return user


async def end_session(request: Request, response: Response) -> None:
    token = request.cookies.get(COOKIE_NAME)
    if token:
        await WardriveSessionRepository.delete(_token_hash(token))
    response.delete_cookie(COOKIE_NAME, path=cookie_path(request))


class LoginThrottle:
    """Refuse logins for a username after too many failures in a window.

    It counts per username: behind tailscale serve or a reverse proxy every
    request comes from the same address, so an address says nothing. At most
    ``MAX_TRACKED`` usernames are kept; expired ones go first, then the one
    with the fewest failures, so made-up usernames cannot grow it without
    end nor push out a name that is close to a lockout."""

    MAX_TRACKED = 10000

    def __init__(self, max_failures: int = 5, window_s: int = 900) -> None:
        self.max_failures = max_failures
        self.window_s = window_s
        self._failures: dict[str, list[float]] = {}

    def _recent(self, username: str, now: float) -> list[float]:
        key = username.strip().lower()
        recent = [t for t in self._failures.get(key, []) if now - t < self.window_s]
        if recent:
            self._failures[key] = recent
        else:
            self._failures.pop(key, None)
        return recent

    def blocked(self, username: str, now: float | None = None) -> bool:
        current = time.time() if now is None else now
        return len(self._recent(username, current)) >= self.max_failures

    def record_failure(self, username: str, now: float | None = None) -> None:
        current = time.time() if now is None else now
        key = username.strip().lower()
        recent = self._recent(username, current)
        self._failures.pop(key, None)
        # Ordered by the latest failure: expired names sit at the front.
        while self._failures:
            oldest = next(iter(self._failures))
            if current - self._failures[oldest][-1] < self.window_s:
                break
            del self._failures[oldest]
        if len(self._failures) >= self.MAX_TRACKED:
            # All still live: forget the name with the fewest failures, so
            # made-up names cannot push out one that is close to a lockout.
            del self._failures[min(self._failures, key=lambda n: len(self._failures[n]))]
        self._failures[key] = [*recent, current]

    def reset(self, username: str) -> None:
        self._failures.pop(username.strip().lower(), None)


login_throttle = LoginThrottle()
