# Meshcomod (DMC-EV) radio settings block: CAD toggle and GPS settings

- Date: 2026-09-09
- Status: approved design, pre-implementation
- Repo: RTFM-EV (RemoteTerm for MeshCore, fork)

## Summary

Add a firmware-gated settings block to RTFM's radio settings that is visible only
when the connected companion runs the meshcomod DMC / DMC-EV firmware. The block
exposes three controls:

1. CAD (Channel Activity Detection) on/off toggle.
2. GPS enable on/off toggle.
3. GPS interval (seconds), shown only when GPS is enabled.

CAD is a DMC-EV firmware feature delivered over the companion tuning-params
opcodes. GPS is delivered over the standard custom-vars opcodes that the fork
persists. The block is hidden entirely on stock MeshCore firmware.

## Context and constraints (verified)

- RTFM talks to the radio through the Python `meshcore==2.3.7` library over
  serial / TCP / BLE. It does not use raw BLE.
- Local radio self-settings pattern: router endpoint -> Pydantic model ->
  `radio_manager.radio_operation()` context (yields the raw `mc` object under the
  radio lock) -> service function -> `mc.commands.<method>()`. Existing example:
  `PATCH /api/radio/config` -> `apply_radio_config_update(mc, update)` in
  `app/services/radio_commands.py`.
- Firmware identity is captured on `RadioManager`: `firmware_ver_code`,
  `firmware_version`, `device_model`, `firmware_build`
  (`app/radio.py:171-176`, populated in `app/services/radio_lifecycle.py:110-142`).
  The fork sets `FIRMWARE_VER_CODE = 27` (stock is 13); it is byte 1 of the
  device-info frame. There is no literal `DMC`/`DMC-EV` string in firmware source,
  but the connected device empirically reports
  `version=v1.17.0.4-DMC-EV-1e` in its version string.
- `GET /api/health` already exposes `radio_device_info`
  (`model`, `firmware_build`, `firmware_version`, `max_contacts`, `max_channels`)
  to the frontend (`app/routers/health.py:138-149`), broadcast over the WS health
  event too. It does NOT currently expose `firmware_ver_code` or any meshcomod flag.
- CAD companion-toggle lives only on the meshcomod `Feat/companion-cad-toggle`
  branch, not `main`. SET is `CMD_SET_TUNING_PARAMS` 0x15 with an optional 10th
  byte `cad_enabled`; GET is `CMD_GET_TUNING_PARAMS` 0x2B returning a 10-byte
  `RESP_CODE_TUNING_PARAMS` 0x17 with `cad_enabled` appended. Applied live and
  persisted firmware-side; default on.
- The `meshcore` library cannot do CAD via its typed API, in BOTH 2.3.7 and the
  latest 2.3.9.1: `set_tuning(rx_dly, af)` hardcodes the CAD byte to 0, and the
  reader parses only the first 9 bytes of the 0x17 frame and discards any appended
  byte (reader.py TUNING_PARAMS branch). The library's single raw-frame entry
  point is `MessageReader.handle_rx(data)`, and the low-level raw send is
  `mc.commands.send(data: bytes, [EventType...])`.
- GPS uses the standard custom-vars mechanism (`CMD_GET_CUSTOM_VARS` 40,
  `CMD_SET_CUSTOM_VAR` 41). The fork special-cases keys `gps` (0/1) and
  `gps_interval` (seconds, clamped 0-86400) and persists them. Custom vars read
  back cleanly through the library (reader dispatches a CUSTOM_VARS event); no
  raw-frame hack is needed for GPS.

## Detection: when the block appears

Add `is_meshcomod` (bool) to the `radio_device_info` payload in
`app/routers/health.py`, computed on the backend from
`radio_manager.firmware_ver_code == 27`, with `firmware_version` containing `DMC`
as a secondary signal. Note (verified): the version string's trailing suffix is
not stable across connections (observed `v1.17.0.4-DMC-EV-1e` then
`v1.17.0.4-DMC-EV-d5` on the same device), so match the `DMC` substring, never the
exact suffix; `ver_code == 27` is the primary, stable signal. The frontend renders the block only when
`health.radio_device_info?.is_meshcomod` is true, mirroring the existing
capability-gated precedent `config.path_hash_mode_supported && (...)` at
`frontend/src/components/settings/SettingsRadioSection.tsx:936`.

Per-control capability is separate from block visibility:

- `cad_supported`: true once a 10-byte 0x17 tuning frame has been observed.
- `gps_supported`: true when the custom-vars read returns the `gps` key (the fork
  only exposes it when built with GPS).

When the block is shown but a control is unsupported, that control renders
disabled with a short explanatory note.

## New endpoints

Isolate the firmware-specific and live-radio-I/O logic from the fast
`GET /radio/config` (which only reads cached `self_info`). Add a dedicated pair in
`app/routers/radio.py`, with logic in `app/services/radio_commands.py`:

- `GET /radio/meshcomod` returns
  `{ cad_supported, cad_enabled, gps_supported, gps_enabled, gps_interval }`.
- `PATCH /radio/meshcomod` accepts any of
  `{ cad_enabled?, gps_enabled?, gps_interval? }` and applies each present field.

The frontend fetches `GET /radio/meshcomod` only when the block is shown.

## CAD read and write

- Write: read current tuning with the library `get_tuning()` (returns
  `rx_delay` + `airtime_factor`), then send a raw frame
  `mc.commands.send(b"\x15" + rx_delay(4 LE) + airtime(4 LE) + cad(1), [OK, ERROR])`.
  This preserves rx_delay and airtime and flips only CAD. Firmware applies live
  and persists.
- Read (real state): at connect time install a thin interceptor on the reader's
  `handle_rx` that sniffs 0x17 frames; when length >= 10, cache `data[9]` as
  `radio_manager.cad_enabled` and set `cad_supported = True`. `GET /radio/meshcomod`
  issues a `get_tuning()` to trigger a fresh 0x17 then returns the cached byte.
- If no 10-byte 0x17 is ever seen, `cad_supported = False`; the toggle renders
  disabled with a "requires CAD-capable firmware" note.
- Alternative considered and rejected: app-stored desired state (no reader hook,
  simpler) was rejected because real-state read-back was chosen; it can drift if
  another client changes CAD.

### Risk and first implementation step: SPIKE PASSED (verified 2026-09-09)

The reader-hook read path was the only part with real protocol risk. A spike
against the live device confirmed it works: wrapping `mc._reader.handle_rx`
cleanly captures the complete reassembled frame. The device returned a 10-byte
`0x17` frame `1700000000e803000001` (`rx_delay=0`, `airtime_factor=1000`,
`cad_enabled=1`), and the library's `get_tuning()` returned only
`{rx_delay: 0, airtime_factor: 1000}`, dropping byte 9 as expected. The
`tcp_cx.py` connection reassembles a full protocol frame into `self.inframe` and
calls `self.reader.handle_rx(self.inframe)` via attribute lookup at call time, so
an instance-level override on `mc._reader.handle_rx` is seen. No fallback needed.

## GPS read and write

- Read: `get_custom_vars` -> map keys `gps` (bool) and `gps_interval` (int).
- Write: `set_custom_var("gps", "0"/"1")` and `set_custom_var("gps_interval", <sec>)`,
  clamped 0-86400 to match firmware. Interval is shown only when `gps_enabled`.
- Exact library method names for get/set custom vars to be confirmed against the
  installed library during implementation (2.3.7, identical in 2.3.9.1).

## Frontend

- New `<Separator />` + `<h3>Meshcomod (DMC-EV)</h3>` group at the bottom of
  `SettingsRadioSection.tsx`, gated on `is_meshcomod`.
- CAD: shared `Checkbox` (deferred save through the new endpoint via a small
  addition to `frontend/src/hooks/useRadioControl.ts` and `frontend/src/api.ts`).
- GPS: enable `Checkbox` plus a numeric interval input revealed when enabled.
- Disabled controls with explanatory text when the matching `*_supported` is false.
- New types in `frontend/src/types.ts` for the meshcomod config/update and the
  `is_meshcomod` field on `radio_device_info`.

## Data flow

1. Health (REST + WS) carries `is_meshcomod`; frontend decides block visibility.
2. On block mount, frontend GETs `/radio/meshcomod` for current values and
   per-control support.
3. Toggling a control PATCHes `/radio/meshcomod`; backend applies via the service
   layer, then the frontend refetches `/radio/meshcomod` (refetch, not optimistic,
   matching the existing radio-config pattern).

## Testing (TDD)

- Backend unit tests with a faked `mc`:
  - raw 0x15 CAD frame builder byte layout.
  - 0x17 sniff/parse: 9-byte frame (no CAD) vs 10-byte frame (CAD present).
  - `is_meshcomod` and `cad_supported` computation.
  - GPS custom-var read/write mapping and interval clamping.
- Backend endpoint tests for `GET`/`PATCH /radio/meshcomod`.
- Frontend tests: block hidden when not meshcomod; disabled controls when a
  capability is false; correct PATCH bodies on toggle.

## Out of scope

- The meshcomod text-command action interface (TCP/BLE transport toggles, Wi-Fi
  provisioning, OTA, advert, reboot) over the synthetic "Meshcomod" contact. These
  are disruptive actions, not simple settings, and belong in a separate feature.
- Firmware fields present but not companion-settable (`buzzer_quiet`,
  `rx_boosted_gain`).

## Coordination: library bump

A parallel agent is bumping `meshcore` 2.3.7 -> 2.3.9.1 and auditing the new
version for capabilities RTFM could surface. The CAD/GPS implementation is
version-agnostic: the relevant API (`get_tuning`, `set_tuning`, custom vars, raw
`send`) is identical in both versions, and CAD is unsupported in both, so the
raw-frame approach is required regardless. The bump lands separately; reconcile at
merge and fold in any cleaner API the audit surfaces.
