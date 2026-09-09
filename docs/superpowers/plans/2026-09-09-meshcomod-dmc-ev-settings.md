# Meshcomod (DMC-EV) settings: CAD toggle and GPS settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a firmware-gated "Meshcomod (DMC-EV)" settings block to RTFM's radio settings with a CAD on/off toggle, a GPS enable toggle, and a GPS interval, visible only when the connected companion runs meshcomod DMC/DMC-EV firmware.

**Architecture:** New backend service module `app/services/meshcomod.py` holds pure frame build/parse and detection helpers plus async read/apply functions that use the `meshcore` library. CAD is read via a temporary hook on `mc._reader.handle_rx` (the library discards the appended CAD byte) and written via a raw `0x15` frame; GPS uses the standard custom-vars commands. A new `GET`/`PATCH /radio/meshcomod` endpoint pair exposes them, `is_meshcomod` is added to the health payload for gating, and a dedicated frontend component renders the block.

**Tech Stack:** Python 3.14, FastAPI, Pydantic, `meshcore==2.3.7`, pytest (asyncio_mode=auto); React + TypeScript, Vitest + Testing Library.

**House rules (CLAUDE.md) that bind execution:** no em dashes in code/comments/messages; no AI co-author or attribution lines; verify before claiming; make the smallest change necessary. IMPORTANT: never create commits or push unless the user has explicitly authorized it. The `git commit` steps below are checkpoints; only run them once the user says commits are OK, otherwise stop at green tests and report.

**Coordination:** A parallel agent is bumping `meshcore` 2.3.7 -> 2.3.9.1 and auditing it. All library API used here (`get_tuning`, raw `send`, `get_custom_vars`, `set_custom_var`, `mc._reader.handle_rx`) is identical in both versions, so this plan is version-agnostic. Do not edit `pyproject.toml` or `uv.lock` in this plan.

---

## File Structure

- Create `app/services/meshcomod.py`: pure helpers (`build_set_tuning_frame`, `parse_tuning_response`, `is_meshcomod`, `clamp_gps_interval`) and async workflows (`capture_tuning_frame`, `read_meshcomod_settings`, `apply_meshcomod_update`). Reuses `RadioCommandRejectedError` from `app/services/radio_commands.py`.
- Modify `app/routers/radio.py`: add `MeshcomodConfigResponse` / `MeshcomodConfigUpdate` models and `GET`/`PATCH /radio/meshcomod`.
- Modify `app/routers/health.py`: add `is_meshcomod` to `RadioDeviceInfoResponse` and the health dict.
- Create `tests/test_meshcomod_service.py` and `tests/test_meshcomod_router.py`.
- Modify `frontend/src/types.ts`: add `is_meshcomod` to `radio_device_info`; add `MeshcomodConfig` and `MeshcomodConfigUpdate`.
- Modify `frontend/src/api.ts`: add `getMeshcomodConfig` / `updateMeshcomodConfig`.
- Create `frontend/src/components/settings/MeshcomodSettings.tsx`: the self-contained gated block.
- Modify `frontend/src/components/settings/SettingsRadioSection.tsx`: render `<MeshcomodSettings health={health} />`.
- Create `frontend/src/test/meshcomodSettings.test.tsx`.

---

## Task 1: Backend pure helpers (frame build/parse, detection, clamp)

**Files:**
- Create: `app/services/meshcomod.py`
- Test: `tests/test_meshcomod_service.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_meshcomod_service.py
from app.services.meshcomod import (
    build_set_tuning_frame,
    parse_tuning_response,
    is_meshcomod,
    clamp_gps_interval,
)


class TestTuningFrame:
    def test_build_set_tuning_frame_layout(self):
        # rx_delay raw 0, airtime raw 1000 (0x3E8), cad on
        frame = build_set_tuning_frame(0, 1000, 1)
        assert frame == bytes.fromhex("1500000000e803000001")

    def test_build_set_tuning_frame_cad_off(self):
        frame = build_set_tuning_frame(0, 1000, 0)
        assert frame[0] == 0x15
        assert frame[9] == 0

    def test_parse_tuning_response_with_cad(self):
        res = parse_tuning_response(bytes.fromhex("1700000000e803000001"))
        assert res == {"rx_delay": 0, "airtime_factor": 1000, "cad_enabled": 1}

    def test_parse_tuning_response_without_cad(self):
        res = parse_tuning_response(bytes.fromhex("1700000000e8030000"))
        assert res == {"rx_delay": 0, "airtime_factor": 1000, "cad_enabled": None}


class TestDetection:
    def test_is_meshcomod_by_ver_code(self):
        assert is_meshcomod(27, "v1.17.0.4") is True

    def test_is_meshcomod_by_version_substring(self):
        assert is_meshcomod(13, "v1.17.0.4-DMC-EV-d5") is True

    def test_not_meshcomod(self):
        assert is_meshcomod(13, "v1.17.0") is False

    def test_is_meshcomod_handles_none(self):
        assert is_meshcomod(None, None) is False


class TestClamp:
    def test_clamp_gps_interval_bounds(self):
        assert clamp_gps_interval(-5) == 0
        assert clamp_gps_interval(999999) == 86400
        assert clamp_gps_interval(600) == 600
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_meshcomod_service.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.meshcomod'`.

- [ ] **Step 3: Write minimal implementation**

```python
# app/services/meshcomod.py
"""Meshcomod DMC / DMC-EV companion settings: CAD tuning byte and GPS custom vars.

The meshcore library cannot read or write the CAD byte: set_tuning() hardcodes it
to 0 and the reader parses only the first 9 bytes of the 0x17 response. So CAD is
written with a raw 0x15 frame and read by briefly hooking the reader's handle_rx.
GPS uses the standard custom-vars commands, which round-trip cleanly.
"""
import logging

from meshcore import EventType

from app.services.radio_commands import RadioCommandRejectedError

logger = logging.getLogger(__name__)

SET_TUNING_OPCODE = 0x15
TUNING_RESP_OPCODE = 0x17
GPS_INTERVAL_MAX = 86400


def build_set_tuning_frame(rx_delay: int, airtime_factor: int, cad_enabled: int) -> bytes:
    """Build a CMD_SET_TUNING_PARAMS (0x15) frame including the CAD byte.

    rx_delay and airtime_factor are the raw already-scaled uint32 values as
    returned by the library get_tuning() (i.e. base * 1000).
    """
    return (
        bytes([SET_TUNING_OPCODE])
        + int(rx_delay).to_bytes(4, "little")
        + int(airtime_factor).to_bytes(4, "little")
        + bytes([1 if cad_enabled else 0])
    )


def parse_tuning_response(frame: bytes) -> dict:
    """Parse a RESP_CODE_TUNING_PARAMS (0x17) frame; cad_enabled is None if absent."""
    rx_delay = int.from_bytes(frame[1:5], "little")
    airtime_factor = int.from_bytes(frame[5:9], "little")
    cad_enabled = frame[9] if len(frame) >= 10 else None
    return {"rx_delay": rx_delay, "airtime_factor": airtime_factor, "cad_enabled": cad_enabled}


def is_meshcomod(ver_code: int | None, version: str | None) -> bool:
    """Detect the meshcomod DMC/DMC-EV fork. Primary signal is FIRMWARE_VER_CODE 27.

    Secondary signal is a 'DMC' substring in the version string. The version
    string's trailing suffix is not stable across connections, so never match the
    exact suffix.
    """
    if ver_code == 27:
        return True
    if version and "DMC" in version.upper():
        return True
    return False


def clamp_gps_interval(value: int) -> int:
    return max(0, min(GPS_INTERVAL_MAX, int(value)))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_meshcomod_service.py -v`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit (only if commits authorized)**

```bash
git add app/services/meshcomod.py tests/test_meshcomod_service.py
git commit -m "feat(meshcomod): add pure tuning-frame and detection helpers"
```

---

## Task 2: Backend async read/apply workflows

**Files:**
- Modify: `app/services/meshcomod.py`
- Test: `tests/test_meshcomod_service.py`

- [ ] **Step 1: Write the failing test**

```python
# append to tests/test_meshcomod_service.py
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.meshcomod import (
    capture_tuning_frame,
    read_meshcomod_settings,
    apply_meshcomod_update,
)
from app.services.radio_commands import RadioCommandRejectedError
from meshcore import EventType


def _event(type_=EventType.OK, payload=None):
    ev = MagicMock()
    ev.type = type_
    ev.payload = payload if payload is not None else {}
    return ev


def _mock_mc(tuning_frame_hex="1700000000e803000001", custom_vars=None):
    mc = MagicMock()
    reader = MagicMock()
    reader.handle_rx = AsyncMock()
    mc._reader = reader

    async def _get_tuning():
        # Simulate the radio pushing the 0x17 frame through the reader.
        await mc._reader.handle_rx(bytes.fromhex(tuning_frame_hex))
        return _event(EventType.TUNING_PARAMS, {"rx_delay": 0, "airtime_factor": 1000})

    mc.commands = MagicMock()
    mc.commands.get_tuning = AsyncMock(side_effect=_get_tuning)
    mc.commands.send = AsyncMock(return_value=_event(EventType.OK))
    mc.commands.get_custom_vars = AsyncMock(
        return_value=_event(EventType.CUSTOM_VARS, custom_vars if custom_vars is not None else {})
    )
    mc.commands.set_custom_var = AsyncMock(return_value=_event(EventType.OK))
    return mc


class TestReadMeshcomod:
    @pytest.mark.asyncio
    async def test_capture_tuning_frame_restores_reader(self):
        mc = _mock_mc()
        original = mc._reader.handle_rx
        frame = await capture_tuning_frame(mc)
        assert frame == bytes.fromhex("1700000000e803000001")
        assert mc._reader.handle_rx is original  # restored

    @pytest.mark.asyncio
    async def test_read_settings_cad_and_gps(self):
        mc = _mock_mc(custom_vars={"gps": "1", "gps_interval": "600"})
        data = await read_meshcomod_settings(mc)
        assert data == {
            "cad_supported": True,
            "cad_enabled": True,
            "gps_supported": True,
            "gps_enabled": True,
            "gps_interval": 600,
        }

    @pytest.mark.asyncio
    async def test_read_settings_no_cad_no_gps(self):
        mc = _mock_mc(tuning_frame_hex="1700000000e8030000", custom_vars={})
        data = await read_meshcomod_settings(mc)
        assert data["cad_supported"] is False
        assert data["cad_enabled"] is None
        assert data["gps_supported"] is False


class TestApplyMeshcomod:
    @pytest.mark.asyncio
    async def test_apply_cad_sends_raw_frame_preserving_tuning(self):
        mc = _mock_mc()
        await apply_meshcomod_update(mc, cad_enabled=False)
        sent = mc.commands.send.await_args.args[0]
        assert sent == bytes.fromhex("1500000000e803000000")  # cad byte 0

    @pytest.mark.asyncio
    async def test_apply_cad_raises_on_error(self):
        mc = _mock_mc()
        mc.commands.send = AsyncMock(return_value=_event(EventType.ERROR, {"reason": "x"}))
        with pytest.raises(RadioCommandRejectedError):
            await apply_meshcomod_update(mc, cad_enabled=True)

    @pytest.mark.asyncio
    async def test_apply_gps_sets_vars_and_clamps(self):
        mc = _mock_mc()
        await apply_meshcomod_update(mc, gps_enabled=True, gps_interval=999999)
        mc.commands.set_custom_var.assert_any_await("gps", "1")
        mc.commands.set_custom_var.assert_any_await("gps_interval", "86400")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_meshcomod_service.py -k "Read or Apply" -v`
Expected: FAIL with `ImportError` for `capture_tuning_frame` / `read_meshcomod_settings` / `apply_meshcomod_update`.

- [ ] **Step 3: Write minimal implementation**

```python
# append to app/services/meshcomod.py

async def capture_tuning_frame(mc) -> bytes | None:
    """Trigger a 0x17 response and capture the raw frame via a temporary hook.

    The library drops the appended CAD byte, so hook the reader's single frame
    entry point (handle_rx), request tuning, then restore the original.
    """
    reader = mc._reader
    original = reader.handle_rx
    holder: dict[str, bytes | None] = {"frame": None}

    async def hooked(data):
        try:
            b = bytes(data)
            if b and b[0] == TUNING_RESP_OPCODE:
                holder["frame"] = b
        except Exception:  # noqa: BLE001 - never let sniffing break the pipeline
            logger.debug("tuning sniff failed", exc_info=True)
        return await original(data)

    reader.handle_rx = hooked
    try:
        await mc.commands.get_tuning()
    finally:
        reader.handle_rx = original
    return holder["frame"]


async def read_meshcomod_settings(mc) -> dict:
    """Read CAD (via raw frame capture) and GPS (via custom vars) state."""
    frame = await capture_tuning_frame(mc)
    if frame is not None:
        parsed = parse_tuning_response(frame)
        cad_enabled = parsed["cad_enabled"]
    else:
        cad_enabled = None
    cad_supported = cad_enabled is not None

    vars_event = await mc.commands.get_custom_vars()
    res = vars_event.payload if vars_event is not None else {}
    gps_supported = "gps" in res
    gps_enabled = res.get("gps") == "1" if gps_supported else None
    gps_interval = int(res.get("gps_interval", "0") or 0) if gps_supported else None

    return {
        "cad_supported": cad_supported,
        "cad_enabled": bool(cad_enabled) if cad_supported else None,
        "gps_supported": gps_supported,
        "gps_enabled": gps_enabled,
        "gps_interval": gps_interval,
    }


async def apply_meshcomod_update(
    mc,
    *,
    cad_enabled: bool | None = None,
    gps_enabled: bool | None = None,
    gps_interval: int | None = None,
) -> None:
    """Apply any provided meshcomod settings to the connected radio."""
    if cad_enabled is not None:
        # Preserve current rx_delay / airtime_factor; only flip the CAD byte.
        tuning = await mc.commands.get_tuning()
        payload = tuning.payload if tuning is not None else {}
        rx_delay = int(payload.get("rx_delay", 0))
        airtime_factor = int(payload.get("airtime_factor", 0))
        frame = build_set_tuning_frame(rx_delay, airtime_factor, 1 if cad_enabled else 0)
        logger.info("Setting CAD to %s via raw tuning frame", cad_enabled)
        result = await mc.commands.send(frame, [EventType.OK, EventType.ERROR])
        if result is not None and result.type == EventType.ERROR:
            raise RadioCommandRejectedError(f"Failed to set CAD: {result.payload}")

    if gps_enabled is not None:
        logger.info("Setting GPS enabled to %s", gps_enabled)
        result = await mc.commands.set_custom_var("gps", "1" if gps_enabled else "0")
        if result is not None and result.type == EventType.ERROR:
            raise RadioCommandRejectedError(f"Failed to set GPS enable: {result.payload}")

    if gps_interval is not None:
        clamped = clamp_gps_interval(gps_interval)
        logger.info("Setting GPS interval to %d seconds", clamped)
        result = await mc.commands.set_custom_var("gps_interval", str(clamped))
        if result is not None and result.type == EventType.ERROR:
            raise RadioCommandRejectedError(f"Failed to set GPS interval: {result.payload}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_meshcomod_service.py -v`
Expected: PASS (all tests).

- [ ] **Step 5: Commit (only if commits authorized)**

```bash
git add app/services/meshcomod.py tests/test_meshcomod_service.py
git commit -m "feat(meshcomod): add read/apply workflows for CAD and GPS"
```

---

## Task 3: Health payload exposes is_meshcomod

**Files:**
- Modify: `app/routers/health.py:16-21` (model) and `:141-149` (dict)
- Test: `tests/test_meshcomod_router.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_meshcomod_router.py
from app.routers.health import RadioDeviceInfoResponse


def test_radio_device_info_has_is_meshcomod_default_false():
    info = RadioDeviceInfoResponse()
    assert info.is_meshcomod is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_meshcomod_router.py::test_radio_device_info_has_is_meshcomod_default_false -v`
Expected: FAIL with `AttributeError`/validation error (no `is_meshcomod` field).

- [ ] **Step 3: Write minimal implementation**

In `app/routers/health.py`, add the import near the other service imports:

```python
from app.services.meshcomod import is_meshcomod
```

Add the field to `RadioDeviceInfoResponse` (after `max_channels`):

```python
    is_meshcomod: bool = False
```

Add the key to the `radio_device_info` dict (after the `max_channels` entry):

```python
            "is_meshcomod": is_meshcomod(
                getattr(radio_manager, "firmware_ver_code", None),
                getattr(radio_manager, "firmware_version", None),
            ),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_meshcomod_router.py -v`
Expected: PASS.

- [ ] **Step 5: Commit (only if commits authorized)**

```bash
git add app/routers/health.py tests/test_meshcomod_router.py
git commit -m "feat(meshcomod): expose is_meshcomod on health radio_device_info"
```

---

## Task 4: Router endpoints GET/PATCH /radio/meshcomod

**Files:**
- Modify: `app/routers/radio.py` (models near `:152`; endpoints after `update_radio_config` at `:414`)
- Test: `tests/test_meshcomod_router.py`

- [ ] **Step 1: Write the failing test**

```python
# append to tests/test_meshcomod_router.py
from unittest.mock import AsyncMock, MagicMock
from contextlib import asynccontextmanager

import pytest
from fastapi import HTTPException

import app.routers.radio as radio_router
from app.routers.radio import (
    MeshcomodConfigUpdate,
    get_meshcomod_config,
    update_meshcomod_config,
)


@pytest.fixture
def fake_manager(monkeypatch):
    mgr = MagicMock()
    mgr.firmware_ver_code = 27
    mgr.firmware_version = "v1.17.0.4-DMC-EV-d5"
    mgr.require_connected = MagicMock()
    mc = MagicMock()

    @asynccontextmanager
    async def _op(name, **kwargs):
        yield mc

    mgr.radio_operation = _op
    monkeypatch.setattr(radio_router, "radio_manager", mgr)
    return mgr, mc


class TestMeshcomodEndpoints:
    @pytest.mark.asyncio
    async def test_get_rejects_non_meshcomod(self, fake_manager, monkeypatch):
        mgr, _mc = fake_manager
        mgr.firmware_ver_code = 13
        mgr.firmware_version = "v1.17.0"
        with pytest.raises(HTTPException) as exc:
            await get_meshcomod_config()
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_get_returns_settings(self, fake_manager, monkeypatch):
        _mgr, _mc = fake_manager
        monkeypatch.setattr(
            radio_router,
            "read_meshcomod_settings",
            AsyncMock(
                return_value={
                    "cad_supported": True,
                    "cad_enabled": True,
                    "gps_supported": False,
                    "gps_enabled": None,
                    "gps_interval": None,
                }
            ),
        )
        resp = await get_meshcomod_config()
        assert resp.cad_supported is True
        assert resp.cad_enabled is True
        assert resp.gps_supported is False

    @pytest.mark.asyncio
    async def test_patch_applies_then_reads(self, fake_manager, monkeypatch):
        _mgr, _mc = fake_manager
        apply_mock = AsyncMock()
        monkeypatch.setattr(radio_router, "apply_meshcomod_update", apply_mock)
        monkeypatch.setattr(
            radio_router,
            "read_meshcomod_settings",
            AsyncMock(
                return_value={
                    "cad_supported": True,
                    "cad_enabled": False,
                    "gps_supported": True,
                    "gps_enabled": True,
                    "gps_interval": 600,
                }
            ),
        )
        resp = await update_meshcomod_config(MeshcomodConfigUpdate(cad_enabled=False))
        apply_mock.assert_awaited_once()
        assert resp.cad_enabled is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_meshcomod_router.py -k Meshcomod -v`
Expected: FAIL with ImportError for `MeshcomodConfigUpdate` / `get_meshcomod_config` / `update_meshcomod_config`.

- [ ] **Step 3: Write minimal implementation**

In `app/routers/radio.py`, extend the service import block (currently importing from `app.services.radio_commands`) with a meshcomod import:

```python
from app.services.meshcomod import (
    apply_meshcomod_update,
    is_meshcomod,
    read_meshcomod_settings,
)
```

Add models after `RadioConfigUpdate` (around `:152`):

```python
class MeshcomodConfigResponse(BaseModel):
    cad_supported: bool = False
    cad_enabled: bool | None = None
    gps_supported: bool = False
    gps_enabled: bool | None = None
    gps_interval: int | None = None


class MeshcomodConfigUpdate(BaseModel):
    cad_enabled: bool | None = None
    gps_enabled: bool | None = None
    gps_interval: int | None = Field(default=None, ge=0, le=86400)
```

Add endpoints after `update_radio_config` (after `:414`):

```python
def _require_meshcomod() -> None:
    if not is_meshcomod(radio_manager.firmware_ver_code, radio_manager.firmware_version):
        raise HTTPException(
            status_code=404, detail="Connected radio is not meshcomod DMC/DMC-EV firmware"
        )


@router.get("/meshcomod", response_model=MeshcomodConfigResponse)
async def get_meshcomod_config() -> MeshcomodConfigResponse:
    """Read meshcomod-specific settings (CAD, GPS) from the connected radio."""
    radio_manager.require_connected()
    _require_meshcomod()
    async with radio_manager.radio_operation("get_meshcomod_config") as mc:
        data = await read_meshcomod_settings(mc)
    return MeshcomodConfigResponse(**data)


@router.patch("/meshcomod", response_model=MeshcomodConfigResponse)
async def update_meshcomod_config(update: MeshcomodConfigUpdate) -> MeshcomodConfigResponse:
    """Update meshcomod-specific settings. Only provided fields are applied."""
    radio_manager.require_connected()
    _require_meshcomod()
    async with radio_manager.radio_operation("update_meshcomod_config") as mc:
        try:
            await apply_meshcomod_update(
                mc,
                cad_enabled=update.cad_enabled,
                gps_enabled=update.gps_enabled,
                gps_interval=update.gps_interval,
            )
        except RadioCommandRejectedError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    return await get_meshcomod_config()
```

Note: `RadioCommandRejectedError` is already imported in `radio.py` (used by `update_radio_config`). If not, add it to the `app.services.radio_commands` import block.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_meshcomod_router.py -v`
Expected: PASS.

- [ ] **Step 5: Run the full backend suite for regressions**

Run: `uv run pytest -q`
Expected: PASS (no regressions). Report counts.

- [ ] **Step 6: Commit (only if commits authorized)**

```bash
git add app/routers/radio.py tests/test_meshcomod_router.py
git commit -m "feat(meshcomod): add GET/PATCH /radio/meshcomod endpoints"
```

---

## Task 5: Frontend types and api client

**Files:**
- Modify: `frontend/src/types.ts:112-118` (radio_device_info) and after `:37` (new interfaces)
- Modify: `frontend/src/api.ts:97-102` (add methods)
- Test: `frontend/src/test/meshcomodSettings.test.tsx` (added in Task 6 exercises these)

- [ ] **Step 1: Add the `is_meshcomod` field to `radio_device_info` in `types.ts`**

Change the `radio_device_info` object type inside `HealthStatus` (`:112-118`) to include:

```ts
  radio_device_info?: {
    model: string | null;
    firmware_build: string | null;
    firmware_version: string | null;
    max_contacts: number | null;
    max_channels: number | null;
    is_meshcomod: boolean;
  } | null;
```

- [ ] **Step 2: Add the meshcomod config interfaces to `types.ts` (after `RadioConfigUpdate`, `:37`)**

```ts
export interface MeshcomodConfig {
  cad_supported: boolean;
  cad_enabled: boolean | null;
  gps_supported: boolean;
  gps_enabled: boolean | null;
  gps_interval: number | null;
}

export interface MeshcomodConfigUpdate {
  cad_enabled?: boolean;
  gps_enabled?: boolean;
  gps_interval?: number;
}
```

- [ ] **Step 3: Add api methods in `api.ts` (after `updateRadioConfig`, `:102`)**

```ts
  getMeshcomodConfig: () => fetchJson<MeshcomodConfig>('/radio/meshcomod'),
  updateMeshcomodConfig: (update: MeshcomodConfigUpdate) =>
    fetchJson<MeshcomodConfig>('/radio/meshcomod', {
      method: 'PATCH',
      body: JSON.stringify(update),
    }),
```

Add `MeshcomodConfig, MeshcomodConfigUpdate` to the existing type import from `./types` at the top of `api.ts`.

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit (only if commits authorized)**

```bash
git add frontend/src/types.ts frontend/src/api.ts
git commit -m "feat(meshcomod): add frontend types and api client methods"
```

---

## Task 6: Frontend MeshcomodSettings component

**Files:**
- Create: `frontend/src/components/settings/MeshcomodSettings.tsx`
- Test: `frontend/src/test/meshcomodSettings.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/test/meshcomodSettings.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MeshcomodSettings } from '../components/settings/MeshcomodSettings';
import { api } from '../api';
import type { HealthStatus } from '../types';

function health(is_meshcomod: boolean): HealthStatus {
  return {
    status: 'ok',
    radio_connected: true,
    radio_initializing: false,
    connection_info: 'TCP',
    radio_device_info: {
      model: 'X', firmware_build: 'b', firmware_version: 'v1.17.0.4-DMC-EV-d5',
      max_contacts: 350, max_channels: 40, is_meshcomod,
    },
    database_size_mb: 1,
  } as HealthStatus;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('MeshcomodSettings', () => {
  it('renders nothing when not meshcomod', () => {
    const { container } = render(<MeshcomodSettings health={health(false)} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows CAD and GPS controls when meshcomod', async () => {
    vi.spyOn(api, 'getMeshcomodConfig').mockResolvedValue({
      cad_supported: true, cad_enabled: true,
      gps_supported: true, gps_enabled: false, gps_interval: 0,
    });
    render(<MeshcomodSettings health={health(true)} />);
    expect(await screen.findByLabelText(/CAD/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/GPS/i)).toBeInTheDocument();
  });

  it('disables CAD when unsupported', async () => {
    vi.spyOn(api, 'getMeshcomodConfig').mockResolvedValue({
      cad_supported: false, cad_enabled: null,
      gps_supported: true, gps_enabled: false, gps_interval: 0,
    });
    render(<MeshcomodSettings health={health(true)} />);
    expect(await screen.findByLabelText(/CAD/i)).toBeDisabled();
  });

  it('submits cad_enabled on toggle', async () => {
    vi.spyOn(api, 'getMeshcomodConfig').mockResolvedValue({
      cad_supported: true, cad_enabled: true,
      gps_supported: true, gps_enabled: false, gps_interval: 0,
    });
    const patch = vi.spyOn(api, 'updateMeshcomodConfig').mockResolvedValue({
      cad_supported: true, cad_enabled: false,
      gps_supported: true, gps_enabled: false, gps_interval: 0,
    });
    render(<MeshcomodSettings health={health(true)} />);
    const cad = await screen.findByLabelText(/CAD/i);
    await userEvent.click(cad);
    await waitFor(() => expect(patch).toHaveBeenCalledWith({ cad_enabled: false }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/test/meshcomodSettings.test.tsx`
Expected: FAIL (module `MeshcomodSettings` not found).

- [ ] **Step 3: Write minimal implementation**

```tsx
// frontend/src/components/settings/MeshcomodSettings.tsx
import { useEffect, useState } from 'react';
import { api } from '../../api';
import type { HealthStatus, MeshcomodConfig } from '../../types';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { Separator } from '../ui/separator';

interface Props {
  health: HealthStatus | null;
}

export function MeshcomodSettings({ health }: Props) {
  const isMeshcomod = health?.radio_device_info?.is_meshcomod ?? false;
  const [cfg, setCfg] = useState<MeshcomodConfig | null>(null);

  useEffect(() => {
    if (!isMeshcomod) return;
    let cancelled = false;
    api
      .getMeshcomodConfig()
      .then((data) => {
        if (!cancelled) setCfg(data);
      })
      .catch((err) => console.error('Failed to load meshcomod config:', err));
    return () => {
      cancelled = true;
    };
  }, [isMeshcomod]);

  if (!isMeshcomod) return null;

  const save = async (update: Parameters<typeof api.updateMeshcomodConfig>[0]) => {
    const next = await api.updateMeshcomodConfig(update);
    setCfg(next);
  };

  return (
    <div className="space-y-4">
      <Separator />
      <h3 className="text-base font-semibold tracking-tight">Meshcomod (DMC-EV)</h3>

      <div className="flex items-start gap-2">
        <Checkbox
          id="meshcomod-cad-enabled"
          className="mt-0.5"
          disabled={!cfg?.cad_supported}
          checked={cfg?.cad_enabled === true}
          onCheckedChange={(checked) => save({ cad_enabled: checked === true })}
        />
        <div>
          <Label htmlFor="meshcomod-cad-enabled">CAD (Channel Activity Detection)</Label>
          <p className="text-xs text-muted-foreground">
            {cfg?.cad_supported
              ? 'Scan for channel activity before each transmit and defer if the channel is busy.'
              : 'Requires CAD-capable meshcomod firmware.'}
          </p>
        </div>
      </div>

      <div className="flex items-start gap-2">
        <Checkbox
          id="meshcomod-gps-enabled"
          className="mt-0.5"
          disabled={!cfg?.gps_supported}
          checked={cfg?.gps_enabled === true}
          onCheckedChange={(checked) => save({ gps_enabled: checked === true })}
        />
        <div className="flex-1">
          <Label htmlFor="meshcomod-gps-enabled">GPS</Label>
          <p className="text-xs text-muted-foreground">
            {cfg?.gps_supported
              ? 'Enable the on-board GPS receiver.'
              : 'This firmware build has no GPS support.'}
          </p>
          {cfg?.gps_supported && cfg?.gps_enabled && (
            <div className="mt-2 flex items-center gap-2">
              <Label htmlFor="meshcomod-gps-interval">Interval (seconds)</Label>
              <input
                id="meshcomod-gps-interval"
                type="number"
                min={0}
                max={86400}
                defaultValue={cfg?.gps_interval ?? 0}
                className="w-24 rounded border px-2 py-1 text-sm"
                onBlur={(e) => save({ gps_interval: Number(e.target.value) })}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

Note: confirm the shared components exist at `../ui/checkbox`, `../ui/label`, `../ui/separator` (they are used throughout `SettingsRadioSection.tsx`). If `Label`/`Separator` live at different paths, match the imports used in `SettingsRadioSection.tsx`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/test/meshcomodSettings.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit (only if commits authorized)**

```bash
git add frontend/src/components/settings/MeshcomodSettings.tsx frontend/src/test/meshcomodSettings.test.tsx
git commit -m "feat(meshcomod): add gated MeshcomodSettings component"
```

---

## Task 7: Wire the block into SettingsRadioSection

**Files:**
- Modify: `frontend/src/components/settings/SettingsRadioSection.tsx` (import near top; render after the Advertising & Discovery group, around `:1328+`)

- [ ] **Step 1: Add the import (with the other component imports at the top of the file)**

```tsx
import { MeshcomodSettings } from './MeshcomodSettings';
```

- [ ] **Step 2: Render the block near the end of the section's JSX**

After the "Advertising & Discovery" group's closing element (the last `<h3>` group, around `:1328` onward), add:

```tsx
      <MeshcomodSettings health={health} />
```

`health` is already a prop of `SettingsRadioSection` (passed from `SettingsModal.tsx`). The component renders nothing when the radio is not meshcomod.

- [ ] **Step 3: Type-check and run the frontend suite**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 4: Commit (only if commits authorized)**

```bash
git add frontend/src/components/settings/SettingsRadioSection.tsx
git commit -m "feat(meshcomod): render meshcomod block in radio settings"
```

---

## Task 8: Rebuild and verify against the live device

**Files:** none (verification only)

- [ ] **Step 1: Rebuild and restart the container**

Run:
```bash
docker compose -f G:/Github/repositories/Elektr0Vodka/RTFM-EV/docker-compose.yml up -d --build
```
Expected: image rebuilds, container `rtfm-ev-remoteterm-1` is Up, logs show `Radio reconnected successfully at TCP: 192.168.1.60:5000`.

- [ ] **Step 2: Verify the endpoint returns real state**

Run:
```bash
curl -s http://localhost:8000/api/radio/meshcomod
```
Expected: JSON with `"cad_supported": true`, `"cad_enabled": true` (device default), and GPS fields reflecting the build. Record the output.

- [ ] **Step 3: Verify a CAD write round-trips**

Run:
```bash
curl -s -X PATCH http://localhost:8000/api/radio/meshcomod -H 'content-type: application/json' -d '{"cad_enabled": false}'
curl -s http://localhost:8000/api/radio/meshcomod
```
Expected: first call returns the config with `cad_enabled: false`; second confirms it persisted. Then set it back to `true`.

- [ ] **Step 4: Verify in the UI**

Open http://localhost:8000, open Settings -> Radio, scroll to the "Meshcomod (DMC-EV)" block. Confirm the CAD toggle reflects state and toggling it updates the radio (watch container logs for the raw-frame send). This is the runtime observation the house rules require before claiming done.

- [ ] **Step 5: Commit any final touch-ups (only if commits authorized)**

---

## Self-Review

- Spec coverage: detection (Task 3), CAD read real-state via reader hook (Task 2, verified by spike), CAD write via raw frame (Task 2), GPS enable + interval via custom vars (Task 2), dedicated endpoints (Task 4), frontend gated block with disabled-when-unsupported controls (Tasks 5-7), testing (all tasks), runtime verification (Task 8). All spec sections map to a task.
- Placeholders: none. Every code step shows complete code; every run step shows the command and expected result.
- Type consistency: `MeshcomodConfig` / `MeshcomodConfigUpdate` names, `is_meshcomod`, `cad_supported`/`cad_enabled`/`gps_supported`/`gps_enabled`/`gps_interval` field names, and the `build_set_tuning_frame` / `parse_tuning_response` / `read_meshcomod_settings` / `apply_meshcomod_update` signatures match across backend, tests, and frontend.
