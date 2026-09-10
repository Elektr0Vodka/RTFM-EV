# 06 - CAD toggle for DMs

Date: 2026-09-10
Status: draft, local planning only. No commits, no PRs, no issues from this plan.

## 1. Summary

CAD (Channel Activity Detection, LoRa hardware listen-before-transmit) is **already
fully implemented end to end in RTFM-EV** as a global, device-wide radio setting:
backend read/write, REST endpoints, a shared frontend hook, a Settings panel
control, and a ChatHeader toggle. The only thing not built is that the ChatHeader
toggle is currently restricted to channel conversations
(`frontend/src/components/ChatHeader.tsx:478`) and does not render for DM (contact)
conversations.

Firmware research changes the framing of the "toggle to dm's" request. CAD is a
single boolean the mesh library consults before every transmit
(`getCADEnabled()` in the companion firmware) - it is not, and cannot currently be,
scoped to a destination, a conversation, or a single send on either firmware branch
inspected. So there is no such thing as "CAD only for this DM" at the protocol
level today. The only faithful interpretation of the request that current firmware
supports is: **surface the existing global CAD control in the DM header too**,
so a user viewing a DM can see/flip the same radio-wide CAD state they can already
see/flip from a channel header or from Settings.

A second, separate finding: the companion-radio firmware that ships as `main` in
`Elektr0Vodka/meshcomod` does **not** implement the host-settable CAD byte that
RTFM-EV's backend writes/reads. That capability exists only on the unmerged
`Feat/companion-cad-toggle` branch (15 commits ahead of `main`, pushed to `origin`,
not merged). RTFM-EV's existing `cad_supported` runtime probe already handles this
gracefully (hides the control when unsupported), so no code correctness bug follows
from this, but it is a material fact for anyone testing or shipping this feature:
**CAD will show as unsupported on a radio running stock `main` firmware.**

## Decision (2026-09-10, user)

Resolution for the room-server open question in section 6: **include them.**
The CAD toggle is also exposed for room-server contacts
(`Conversation.type` `'contact'`/room), gated the same way as any other
contact/channel conversation - only shown when the runtime `cad_supported`
probe is `true`. No separate carve-out for room-server contacts is needed
since the existing condition in section 4.1 already gates on `cadSupported`
for every conversation type.

## 2. Current state (cited)

### 2.1 Backend - global, radio-wide CAD read/write (already shipped)

- `app/services/meshcomod.py:1-6` - module docstring: "Meshcomod DMC / DMC-EV
  companion settings: CAD tuning byte and GPS custom vars... The meshcore library
  cannot read or write the CAD byte: `set_tuning()` hardcodes it to 0 and the
  reader parses only the first 9 bytes of the 0x17 response. So CAD is written
  with a raw 0x15 frame and read by briefly hooking the reader's `handle_rx`."
  (This claim about the `meshcore` PyPI library's `set_tuning()`/reader behavior is
  taken from the code comment; the library source itself was not independently
  inspected in this pass - UNVERIFIED against the library, but it is why RTFM-EV's
  implementation bypasses the library.)
- `app/services/meshcomod.py:16-32` - `SET_TUNING_OPCODE = 0x15`;
  `build_set_tuning_frame(rx_delay, airtime_factor, cad_enabled)` appends a 10th
  byte (`1` or `0`) after the 4-byte `rx_delay` and 4-byte `airtime_factor` fields.
- `app/services/meshcomod.py:35-40` - `parse_tuning_response(frame)` reads
  `frame[9]` as `cad_enabled`, `None` if the frame is shorter than 10 bytes.
- `app/services/meshcomod.py:59-108` - `capture_tuning_frame()` /
  `read_meshcomod_settings()`: hooks the reader's `handle_rx` once, issues
  `get_tuning()`, captures the raw `0x17` response, and derives
  `cad_supported = cad_enabled is not None`. This is a runtime capability probe,
  not a firmware-version check.
- `app/services/meshcomod.py:111-129` - `apply_meshcomod_update()` sends the raw
  10-byte `0x15` frame via `mc.commands.send(...)`, preserving the current
  `rx_delay`/`airtime_factor` and only flipping the CAD byte.
- `app/services/meshcomod.py:43-52` - `is_meshcomod(ver_code, version)`: detects
  the meshcomod fork generically (firmware `ver_code == 27`, or `"DMC"` in the
  version string). This only detects "this is a meshcomod build," not whether that
  build includes the CAD-byte protocol extension - that is why `cad_supported` is
  determined separately at runtime (see above), not from `is_meshcomod()`.
- `app/routers/radio.py:162-173` - `MeshcomodConfigResponse`
  (`cad_supported`, `cad_enabled`, `gps_*`) and `MeshcomodConfigUpdate`
  (`cad_enabled`, `gps_enabled`, `gps_interval`) Pydantic models.
- `app/routers/radio.py:488-520` - `GET /api/radio/meshcomod` and
  `PATCH /api/radio/meshcomod`. `_require_meshcomod()` (488-491) 404s when the
  connected radio isn't detected as meshcomod. Neither endpoint takes a contact,
  channel, or conversation identifier - the setting is global to the radio
  connection, matching the underlying hardware semantics (see 3.3).
- No DM-specific or per-send CAD code exists anywhere in `app/` (confirmed via
  `git grep -in cad -- app tests`); all backend CAD code is the global
  `/api/radio/meshcomod` surface above.

### 2.2 Frontend - already-shipped global toggle, gated to channels only

- `frontend/src/types.ts:55-67` - `MeshcomodConfig` /
  `MeshcomodConfigUpdate` TS types mirror the backend models exactly.
- `frontend/src/types.ts:385-393` - `ConversationType` includes both `'contact'`
  (DMs) and `'channel'`.
- `frontend/src/hooks/useMeshcomodConfig.ts:1-81` - module-level shared cache
  (`cache`, `inflight`) plus a `MESHCOMOD_CONFIG_CHANGE_EVENT` window event so every
  consumer (Settings panel, ChatHeader) reads/writes the same single state. Fetch
  is keyed only on `isMeshcomod` (a boolean), not on the active conversation.
- `frontend/src/App.tsx:157-167` - `isMeshcomod` is derived from
  `health?.radio_device_info?.is_meshcomod` (connection-wide health state, not
  conversation-scoped). `useMeshcomodConfig(isMeshcomod)` and `handleToggleCad`
  are defined once at the App level.
- `frontend/src/App.tsx:603-606` - `cadCapable: isMeshcomod`, `cadSupported`,
  `cadEnabled`, `onToggleCad: handleToggleCad` are passed down as generic props,
  not scoped by conversation.
- `frontend/src/components/ConversationPane.tsx:71-74,155-158,326-329` - these
  four props are forwarded to `ChatHeader` unconditionally, regardless of
  `conversation.type`. **The type gate lives entirely inside `ChatHeader`, not in
  how props are threaded.**
- `frontend/src/components/ChatHeader.tsx:478-502` - the actual toggle button:
  ```
  {conversation.type === 'channel' && cadCapable && cadSupported && onToggleCad && (
    <button ... aria-label="Toggle channel activity detection" ...>CAD</button>
  )}
  ```
  This is the only place that excludes DMs. Everything upstream of it
  (`App.tsx`, `ConversationPane.tsx`, the hook, the backend) is already
  conversation-agnostic.
- `frontend/src/components/settings/MeshcomodSettings.tsx:1-82` - a second,
  independent surface for the same global toggle (Settings > Meshcomod section),
  using the same `useMeshcomodConfig` hook. Confirms the setting is understood
  elsewhere in the app as global, not per-conversation.
- `frontend/src/components/MessageInput.tsx:39-47` - the composer has no
  CAD-related prop or affordance today (`onSend`, `disabled`, `placeholder`,
  `conversationType`, `senderName` only). The task's "composer" framing has no
  existing hook to extend; the header is the only place this control exists today.
- `frontend/src/test/chatHeaderCadToggle.test.tsx:1-62` - four tests, all built on
  `makeChannelChatHeaderProps` (`frontend/src/test/helpers/chatHeaderProps.ts:18`
  hardcodes `conversation.type = 'channel'`). No test exercises a contact/DM
  conversation with CAD props; no `makeContactChatHeaderProps` helper exists yet.
- Backend test coverage: `tests/test_meshcomod_router.py`,
  `tests/test_meshcomod_service.py` (not read line-by-line in this pass; named
  files confirmed present via `git grep`).

### 2.3 Git history correction (the task's premise about the branch is wrong)

The task prompt describes `feat/cad-header-toggle` as "empty branch (no commits)."
That is **not the current repository state**:

- `git rev-list --left-right --count main...feat/cad-header-toggle` → `30  0`
  (30 commits ahead of `main`, 0 behind).
- `git rev-list --left-right --count HEAD...feat/cad-header-toggle` → `25  0`
  (also fully contained in the current branch's ancestry).
- `git log --oneline` on the current branch shows
  `c2d6300 Merge pull request #11 from Elektr0Vodka/feat/cad-header-toggle` and
  `6c3dc5b feat(meshcomod): add CAD toggle to channel header` as ancestors of
  `HEAD`, alongside `b806c5d feat(meshcomod): add DMC-EV CAD toggle and GPS
  settings` (the backend/Settings piece, merged earlier via PR #3).

In short: the CAD-toggle feature work already happened and is already merged into
this branch. There is no empty branch to build on; this plan is scoped to the
one remaining gap (DM header visibility), not a greenfield feature.

## 3. Reference research: meshcomod CAD mechanism and host exposure

Local checkout: `G:\Github\repositories\Elektr0Vodka\meshcomod`
(`origin` = `Elektr0Vodka/meshcomod`, `upstream` = `ALLFATHER-BV/meshcomod`, per
`docs/sources-of-truth.md`).

### 3.1 Stock `main` (commit `1e0def38`): CAD is hardcoded on, not host-settable

- `examples/companion_radio/MyMesh.cpp:1320-1322`:
  ```cpp
  bool MyMesh::getCADEnabled() const {
    return true; // hardware CAD before TX (disabled by default, until configurable)
  }
  ```
  Hardcoded `true`, unconditionally, on the companion-radio firmware class (the
  firmware RTFM-EV actually connects to as its "radio"). The trailing comment is
  stale/misleading relative to the code it describes.
- `examples/companion_radio/MyMesh.cpp` `CMD_SET_TUNING_PARAMS` handler (~line
  3152-3161 in the version examined) reads exactly 8 bytes after the opcode
  (`rx_delay` uint32 + `airtime_factor` uint32) and never inspects a 9th data byte.
  A 10th byte sent by RTFM-EV's `build_set_tuning_frame()` is silently ignored.
- The `CMD_GET_TUNING_PARAMS` / `RESP_CODE_TUNING_PARAMS` handler on `main`
  writes exactly `1 (opcode) + 4 (rx) + 4 (af) = 9` bytes - no CAD byte is
  appended. RTFM-EV's `parse_tuning_response()` sees `len(frame) < 10` and returns
  `cad_enabled = None`, so `cad_supported` correctly evaluates `False` against
  this firmware.
- Contrast: on `main`, the non-companion example firmwares (`simple_repeater`,
  `simple_room_server`, `simple_sensor`) *do* have a real, persisted
  `_prefs.cad_enabled` field (default `0`/off), settable via CLI (`set cad on|off`,
  documented in `docs/cli_commands.md:594-607`, default `off`). See
  `examples/simple_repeater/MyMesh.cpp:900` and `MyMesh.h:153-154`;
  `examples/simple_room_server/MyMesh.cpp:680` and `MyMesh.h:164-165`;
  `examples/simple_sensor/SensorMesh.cpp:327,731`. Only the companion-radio class
  (what RTFM-EV drives) lacked a real toggle on `main`.

### 3.2 `Feat/companion-cad-toggle` (commit `90a70d83`, 15 commits ahead of
`main`, pushed to `origin`, **not merged**): the firmware RTFM-EV's backend
code actually targets

- `examples/companion_radio/MyMesh.cpp` (this branch):
  ```cpp
  bool MyMesh::getCADEnabled() const {
    return _prefs.cad_enabled; // hardware CAD before TX, runtime toggleable
  }
  void MyMesh::setCADEnabled(bool on) {
    _prefs.cad_enabled = on ? 1 : 0;
    _radio->setCADEnabled(_prefs.cad_enabled); // apply live, no reboot needed
    savePrefs();
  }
  ```
- `CMD_SET_TUNING_PARAMS` handler on this branch:
  ```cpp
  } else if (cmd_frame[0] == CMD_SET_TUNING_PARAMS) {
    ...
    _prefs.rx_delay_base = ...; _prefs.airtime_factor = ...;
    if (len >= 10) { // optional trailing byte: hardware CAD on/off (newer apps)
      _prefs.cad_enabled = cmd_frame[i] ? 1 : 0;
      _radio->setCADEnabled(_prefs.cad_enabled);
    }
    savePrefs();
    writeOKFrame();
  }
  ```
- `CMD_GET_TUNING_PARAMS` response on this branch appends
  `out_frame[i++] = _prefs.cad_enabled;` as a 10th byte, with the comment
  "appended trailing byte; older apps ignore it" - i.e. this is deliberately
  designed as a backward-compatible protocol extension.
- This is an **exact match** for the wire format RTFM-EV's
  `app/services/meshcomod.py` (`build_set_tuning_frame`, `parse_tuning_response`)
  already implements. RTFM-EV's backend was clearly written against this firmware
  branch's protocol, not against `main`.
- Branch also adds on-device UI CAD toggle pages across touch/tiny/orig/new UI
  variants (commits `c64f7c3d`, `72c05d11`, `b9215f8b`, `86af5196` - "make hardware
  CAD runtime-toggleable"), i.e. CAD is being made configurable both on-device and
  over the host protocol in this branch, consistently.
- The most recent commit on the branch (`90a70d83`, "merge: fold in main (PR #1
  merge commit) to land remaining CAD work") shows active, current development;
  it has not been fast-forwarded into or merged back to `main` as of this pass.

### 3.3 CAD is architecturally global, not addressable per message or per contact

- `getCADEnabled()` is a single nullary accessor consulted by the mesh/radio layer
  before a transmit; it takes no destination, channel, or message-type argument on
  either firmware branch inspected.
- The send-message command frames (`CMD_SEND_TXT_MSG = 2`,
  `CMD_SEND_CHANNEL_TXT_MSG = 3`, handled from
  `examples/companion_radio/MyMesh.cpp:2645` onward) carry timestamp, attempt,
  recipient/channel identity, and text - no CAD-related field. `git grep` for
  `CMD_SEND` opcodes on `Feat/companion-cad-toggle` shows no per-send CAD bit was
  added alongside the tuning-params CAD byte.
- Conclusion: there is no firmware concept of "CAD for this DM" or "CAD for this
  send" today, on either the shipped or the in-progress branch. The setting is,
  and is designed to be, one radio-wide switch (`_prefs.cad_enabled`), consistent
  with how RTFM-EV's backend/API/UI already model it (see 2.1-2.2).

## 4. Design

Because the host-controllable mechanism is confirmed real (3.2) and the setting is
confirmed global (3.3), the only correctly-scoped change is: **make the existing
global CAD control visible from the DM header, not only the channel header.**
No new backend endpoint, no new hook, no new state model.

### 4.1 Change

`frontend/src/components/ChatHeader.tsx:478` -
change the render condition from:

```tsx
{conversation.type === 'channel' && cadCapable && cadSupported && onToggleCad && (
```

to:

```tsx
{(conversation.type === 'channel' || conversation.type === 'contact') &&
  cadCapable && cadSupported && onToggleCad && (
```

That is the entire functional change required for the DM header to show the CAD
toggle, because:
- `cadCapable`/`cadSupported`/`cadEnabled`/`onToggleCad` are already threaded
  generically through `App.tsx` → `ConversationPane.tsx` → `ChatHeader.tsx`
  regardless of conversation type (2.2).
- The backend endpoint and hook are already conversation-agnostic (2.1, 2.2).
- No repeater-dashboard conflict: repeater contacts (`Contact.type === 2`) never
  render `ChatHeader` at all - `ConversationPane` swaps in `RepeaterDashboard`
  instead (per `frontend/AGENTS.md` "Repeater Dashboard" section), so this change
  cannot surface CAD inside the repeater CLI/telemetry surface.
- Room-server contacts (`Contact.type === 3`) **do** keep the normal `ChatHeader`
  (with `RoomServerPanel` inserted above it per `frontend/AGENTS.md` "Room Server
  Panel"), so this change will also surface CAD in room conversations. This is a
  natural side effect of gating on `Conversation.type` (`'contact'` covers both
  plain contacts and room-server contacts) rather than on the underlying
  `Contact.type` field. **RESOLVED (see Decision note above):** this is the
  desired behavior - room-server contacts keep the toggle, gated on
  `cad_supported` like every other conversation type.

### 4.2 Wording/label consideration

The existing button copy and `aria-label` say "channel activity detection" /
"scans for channel activity before transmit" (`ChatHeader.tsx:483-489`), which is
accurate radio terminology (CAD = Channel Activity Detection, a LoRa modem
feature) and does not reference "channel" in the RTFM-EV app sense (a group
conversation). No copy change is required for correctness, but note this for
whoever reviews the change, since "channel" is overloaded in this app's vocabulary
(radio-protocol "channel activity" vs. app-level "Channel" conversations).

### 4.3 Non-goals (explicitly out of scope, per section 3.3 findings)

- A per-DM or per-send CAD override. Not supported by any inspected firmware
  branch; would require a new firmware protocol field, out of scope for a
  host/frontend-only plan.
- Any new backend work. The existing `/api/radio/meshcomod` surface already
  covers this.
- Composer-level (`MessageInput.tsx`) CAD UI. No existing hook point, and the
  header already carries this exact control pattern for channels; duplicating it
  in the composer would be redundant given the setting is global and already
  visible in the header while composing.

## 5. Phasing

Single small phase (no dependencies on other plans in this backlog):

1. Update `ChatHeader.tsx:478` condition per 4.1.
2. Add a `makeContactChatHeaderProps()` counterpart to
   `frontend/src/test/helpers/chatHeaderProps.ts` (mirroring
   `makeChannelChatHeaderProps`, with `conversation.type = 'contact'`), and extend
   `frontend/src/test/chatHeaderCadToggle.test.tsx` with contact-conversation
   cases (hidden when not capable/supported; visible and toggles when capable).
3. Manually verify against a real device per section 7 (this cannot be fully
   verified by unit tests alone, since `cad_supported` depends on live firmware
   behavior).
4. Room-server contacts are included by decision (see Decision note above); no
   extra `Contact.type` lookup or gate is needed beyond the existing
   `Conversation.type === 'contact'` check plus `cadSupported`.

No phasing beyond this - the change is small and self-contained.

## 6. Risks / open questions

**Feasibility (lead item):** CAD IS host-controllable, but only against
companion-radio firmware built from `Feat/companion-cad-toggle` (or any future
firmware that merges it) - not against the current `main` branch of
`Elektr0Vodka/meshcomod`, which hardcodes CAD on and does not implement the
host-settable byte. RTFM-EV's `cad_supported` runtime probe already degrades
correctly (hides the control) against unsupported firmware, so this is a rollout/
testing caveat, not a code defect. **OPEN QUESTION for the user:** should RTFM-EV
document this firmware dependency anywhere user-facing (e.g. README or the
Settings panel's already-present "Requires CAD-capable meshcomod firmware" text
in `MeshcomodSettings.tsx:44`), given that the required firmware is an unmerged
branch rather than a released version?

**Scope (resolved by evidence, confirming the task's suspicion):** This must
remain a global radio-config flag, not a per-send option - firmware has no
per-destination or per-message CAD concept on either branch (3.3). The
"DM toggle" is therefore "show the existing global control in one more place,"
not a new state model.

**RESOLVED - room-server contacts:** Extending the `ChatHeader` gate to
`conversation.type === 'contact'` also affects room-server conversations
(`Contact.type === 3`), since `Conversation.type` does not distinguish plain
contacts from room-server contacts (both are `'contact'`). **Decision
(2026-09-10, user): include them.** Room-server contacts get the CAD toggle
too, gated on the same `cad_supported` runtime probe as every other
conversation type - no separate `Contact.type` lookup needed.

**Open question - firmware provenance:** `Feat/companion-cad-toggle` is a fork
branch under `Elektr0Vodka/meshcomod`, not `ALLFATHER-BV/meshcomod` (upstream).
Is there an intent to upstream it, or is DMC-EV expected to run a permanently
divergent companion build? This affects how (or whether) RTFM-EV should
communicate the firmware requirement to end users. Not resolvable from this
repo alone - flagging for the user/maintainer.

**Minor:** the `getCADEnabled()` comment on `main`
("disabled by default, until configurable") does not match its own hardcoded
`return true`. Worth a firmware-side comment fix independent of this plan, not
RTFM-EV's to fix (different repo) - not tracked further here.

## 7. Verification plan

Static/unit (already-existing patterns, extend rather than invent):
1. Frontend: `cd frontend && npm run test:run` after the `ChatHeader.tsx` change
   and the new contact-conversation test cases (section 5, step 2) - confirm the
   CAD button renders for a `'contact'` conversation under the same
   capable/supported matrix already tested for `'channel'`
   (`chatHeaderCadToggle.test.tsx`), and confirm no regression in
   `chatHeaderKeyVisibility.test.tsx` or other `ChatHeader` tests.
2. Frontend build: `cd frontend && npm run build` (type-check + bundle).
3. Backend: no backend files change in this plan, but re-run
   `PYTHONPATH=. uv run pytest tests/test_meshcomod_router.py tests/test_meshcomod_service.py -v`
   to confirm no accidental regression from unrelated repo-wide changes picked up
   during the same working session.

Runtime (required - static checks cannot prove the toggle actually affects the
radio; per repo rule, "Runtime behaviour (UI, live data) must be observed, not
reasoned about"):
4. Connect RTFM-EV to a meshcomod-class radio flashed with `main` firmware.
   Expect: CAD control absent from both the channel header (already shipped
   behavior, should be unchanged) and the new DM header, because
   `cad_supported` should resolve `false` (per 3.1). Confirms the runtime probe
   still degrades correctly and this change introduces no new failure mode
   against unsupported firmware.
5. Connect to a radio flashed with `Feat/companion-cad-toggle` firmware (build
   from that branch; not currently available as a prebuilt release per the repo
   listing reviewed). Expect: CAD control appears in both channel and DM headers,
   reads the live `cad_enabled` state, and toggling it in the DM header updates
   the same shared state visible in Settings > Meshcomod and in a channel header
   for the same session (per the shared-cache design in
   `useMeshcomodConfig.ts:9-15`).
6. Confirm toggling from the DM header actually changes on-radio behavior (e.g.
   observe `get cad` via the meshcomod CLI, or observe transmit timing/behavior
   change) - do not rely on the UI state alone as proof the radio behavior
   changed, since the write path is a raw hand-built frame
   (`app/services/meshcomod.py:111-129`) rather than a library call.

Both 4 and 5 are NOT VERIFIED in this planning pass - no live radio was
available/instrumented during research; this plan only established the static
code facts in sections 2-3.

## 8. Effort

Small. The overwhelming majority of the feature (backend, hook, shared cache,
Settings UI, existing channel-header UI, tests-for-channel-case) is already
merged and working. The only change is a single JSX condition in
`ChatHeader.tsx` plus a parallel test-props helper and test cases. Estimated at
a fraction of a normal "Sonnet-sized" plan in this backlog - well under the other
`B` category items ([03], [07]) which involve new backend fields or filtering
logic. No firmware work is in scope for RTFM-EV (firmware lives in a separate
repo, `Elektr0Vodka/meshcomod`, and any decision to merge/build/distribute
`Feat/companion-cad-toggle` is out of this repo's control).
