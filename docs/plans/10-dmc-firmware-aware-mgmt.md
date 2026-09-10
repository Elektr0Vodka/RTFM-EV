# [10] DMC firmware-aware repeater/observer management

Date: 2026-09-10
Category: F (DMC firmware-aware node management)
Model: Opus
State: Absent (new capability; extends existing repeater dashboard)
Status: local planning only. No PRs, no issues, no commits from this plan.

Primary references (code is truth; verified 2026-09-10):

- DMC firmware `Dutch-MeshCore/MeshCore`, branches `dmc-dev` (DMC Repeater) and
  `dmc-observer-dev-1171-regiongating` (DMC-MQTT / Observer). Local checkout
  `G:\Github\repositories\Dutch-MeshCore\MeshCore` (currently on the observer branch).
- Stock MeshCore `meshcore-dev/MeshCore`, local `G:\Github\repositories\Meshcore\MeshCore-dev`.
- OTA service `Dutch-MeshCore/DutchMeshCore-OTA`, local `G:\Github\repositories\Dutch-MeshCore\DutchMeshCore-OTA`.
- Flasher web tool https://flasher.dutchmeshcore.nl (local `G:\Github\repositories\Elektr0Vodka\flasher.dutchmeshcore.nl`).
- RTFM-EV: `app/routers/repeaters.py`, `app/routers/server_control.py`,
  `frontend/src/components/RepeaterDashboard.tsx`, `frontend/src/hooks/useRepeaterDashboard.ts`.

This plan is the concrete form of a Dutch contributor's suggestion. Design to this,
verbatim:

> "op basis van de reported firmware de beschikbare opties aanpast, zodat MQTT en
> non-MQTT DMC repeaters/observers hun eigen config en filtermanagement-UI krijgen
> ... zonder rf te belasten met nutteloze commands die met '??' als reply komen."

---

## 1. Summary

Managed nodes (repeaters / room servers) run one of three firmware classes:

1. **stock** MeshCore (`meshcore-dev/MeshCore`) - base CLI only.
2. **DMC Repeater** (`dmc-dev`) - stock plus the DMC **packet filter** CLI, over
   Serial / RF CLI. No on-device MQTT, no webconfig, no OTA-over-network.
3. **DMC-MQTT / Observer** (`dmc-observer-dev-1171-regiongating`) - everything in
   DMC Repeater plus on-device **MQTT** (`mqtt.*`), **wifi** (`wifi.*`), **webconfig**
   HTTP server, **SNMP**, `discover.scopes`, and network **OTA** (`ota check` /
   `ota update`).

The feature: detect the firmware class + version at login (primarily by parsing the
existing `ver` reply), then gate the repeater dashboard so only supported config /
filter options render, so RTFM-EV does not fire CLI verbs a node cannot answer (they
come back as `??`). Because an RF reply can time out or a dev build can omit branding,
the user can override device type / firmware class manually. For observer nodes on the
same wifi, detect the webconfig HTTP server and offer an OTA check/update path.

The four capabilities phase as: **detection + gating** first (self-contained, RF-only),
then **manual override** (small schema + UI), then **webconfig detection** (LAN HTTP),
then **OTA** (highest risk, remote-flash safety).

---

## 2. Current state (RTFM-EV repeater management today)

Cited from source on this branch.

**Command transport.** All CLI to a repeater/room contact goes through one seam:
`mc.commands.send_cmd(contact.public_key, cmd)` then a buffered CLI-response read.
- `send_contact_cli_command(...)` (`app/routers/server_control.py:552-600`) backs
  `POST /api/contacts/{public_key}/command` (`app/routers/contacts.py`; surfaced in
  `frontend/src/api.ts:199` as `sendRepeaterCommand`).
- `batch_cli_fetch(contact, op, [(cmd, field), ...])`
  (`app/routers/server_control.py:406-450`) backs the granular panes; each command
  takes the radio lock independently, re-ensures the contact is loaded, flushes stale
  buffered replies, sends, and reads one response.
- `extract_response_text(event)` (`app/routers/server_control.py:92-97`) strips the
  firmware `> ` prefix and returns the reply verbatim.

**`ver` is already fetched.** The radio-settings pane already sends `("ver",
"firmware_version")` as its first batch command
(`app/routers/repeaters.py:343-355`). The reply currently only feeds a display field;
nothing parses it for class/version.

**`??` is already handled in one place.** `repeater_radio_settings` explicitly drops a
`get dutycycle` reply that "startswith('??')" or "error" so an unsupported field reads
as `None` instead of leaking the sentinel (`app/routers/repeaters.py:356-364`). This is
the ad-hoc precursor to the general gating this plan proposes.

**Granular panes.** `POST /api/contacts/{key}/repeater/{status,node-info,neighbors,
acl,radio-settings,regions,advert-intervals,owner-info,lpp-telemetry}` plus the CLI
console via `/command` (`app/routers/repeaters.py:78-410`; API table in `app/AGENTS.md`
"Contacts" and `AGENTS.md` API summary).

**Frontend.** `RepeaterDashboard.tsx` renders a fixed set of panes
(`RepeaterDashboard.tsx:17-27, 333-410`): Telemetry, Node Info, Neighbors, ACL, Radio
Settings, Regions, LPP Telemetry, Owner Info, Actions, Console. State lives in
`useRepeaterDashboard.ts` with a fixed `PaneName` union and per-pane fetch state
(`useRepeaterDashboard.ts:104-165`). No pane is conditional on firmware today.

**Contact model / storage.** The `contacts` base table has no firmware column
(`app/database.py:14-35`): `public_key, name, type, flags, direct_path*,
route_override_*, last_advert, lat, lon, last_seen, on_radio, last_contacted,
first_seen, last_read_at, favorite`. `Contact` / `ContactUpsert` in `app/models.py`
carry route and identity fields only (`app/models.py:24-142`). Contact type constants:
`0 unknown, 1 client, 2 repeater, 3 room, 4 sensor` (`AGENTS.md` "Contact Types").
Migrations are per-version modules; the highest on `origin/main` and this branch is
`_068_add_registry_sync_url.py` (`app/migrations/`), so the **next free migration is
`_069`** (FACT, verified via `git ls-tree -r --name-only origin/main -- app/migrations`).

---

## 3. Reference research (per firmware class)

### 3.1 The `ver` command and its reply

- Handler: `CommonCLI.cpp:1357-1358`

  ```c
  } else if (memcmp(command, "ver", 3) == 0) {
    sprintf(reply, "%s (Build: %s)", _callbacks->getFirmwareVer(), _callbacks->getBuildDate());
  ```

  So the wire reply is `<FIRMWARE_VERSION> (Build: <FIRMWARE_BUILD_DATE>)`. Documented
  in `docs/cli_commands.md:204-206, 578-580` ("Get the Version" / `ver`). FACT.

- `getFirmwareVer()` returns the compile-time `FIRMWARE_VERSION` string. It is composed
  in `build.sh` (FACT, `build.sh:169-203`):
  - `FORK_TAG="-dutchmeshcore.nl"` (`build.sh:198`).
  - `VARIANT_TAG` appends `-observer` if the env name contains `observer`, and `-mqtt`
    if it contains `mqtt` (`build.sh:175-181`).
  - `EMBEDDED_VERSION_STRING="${FIRMWARE_VERSION}${BUILD_NUMBER_SUFFIX}${FORK_TAG}${VARIANT_TAG}-${COMMIT_HASH}"`
    (`build.sh:203`).

  Resulting `ver` payloads by class (FACT for release builds produced by `build.sh`):

  | Class | `getFirmwareVer()` shape | Example |
  |---|---|---|
  | stock MeshCore | no `dutchmeshcore.nl` tag | `v1.17.1-<hash>` (upstream form) |
  | DMC Repeater (`dmc-dev`) | `-dutchmeshcore.nl-` and **no** `-observer`/`-mqtt` | `v1.17.1-dutchmeshcore.nl-<hash>` |
  | DMC-MQTT / Observer | `-dutchmeshcore.nl-observer-mqtt-` | `v1.17.1-dutchmeshcore.nl-observer-mqtt-<hash>` |

  Cross-checked against `build.sh:196-197` comments and the OTA note
  `DutchMeshCore-OTA/ota-capable-functions-update.md:33-34` ("The branded string stays
  inside the firmware ... `v1.17.1-dutchmeshcore.nl-observer-mqtt-00cf92ff`").

- **Detection-reliability caveat (FACT).** The `-dutchmeshcore.nl` branding is only
  injected by `build.sh`. A plain `pio run` dev build leaves `OTA_VARIANT` /
  `OTA_MANIFEST_BASE` undefined and the fork tag absent (`build.sh:213-220`). So `ver`
  string parsing reliably classifies **release** builds but can under-report a
  locally-built DMC node as "stock". This is exactly why capability [3] Manual override
  exists.

- **The `??` reply (matches the contributor's quote).** Unknown `get` config replies
  `??: <name>` (`CommonCLI.cpp:1942`, `sprintf(reply, "??: %s", config)`). An
  unsupported feature verb otherwise returns an error string or nothing. RTFM-EV already
  treats `??`/`error` as "unsupported" for one field (`app/routers/repeaters.py:356-364`).

- ASSUMPTION: `getBuildDate()` returns the `FIRMWARE_BUILD_DATE` (`build.sh:137`,
  `date '+%-d %b %Y'`). Not load-bearing for detection; version token is the signal.

### 3.2 Distinct CLI verb families by class

Verified by comparing branches (`git cat-file -e <branch>:<path>`, `git ls-tree`).

**Stock vs DMC (packet filter).** `examples/simple_repeater/Filter.cpp` and `Filter.h`
are **present on `dmc-dev`** and the observer branch, but **absent from stock**
`meshcore-dev/MeshCore` simple_repeater (verified: stock `examples/simple_repeater/`
contains only `MyMesh.*`, `RateLimiter.h`, `UITask.*`, `main.cpp`). So the entire
`filter ...` verb family is a **DMC-only** capability (both flavours):
- `filter`, `filter on/off/reset/help/types`, `filter hops`, `filter rate`,
  `filter hash`, `filter channel {list,add,remove}`, `filter malformed`,
  `filter count`, `filter stats {hops,rate,hash,channel,malformed,top}`
  (`docs/cli_commands.md:214-333`; reference `docs/packet_filter_reference.md`). FACT.

**DMC Repeater vs Observer (MQTT / wifi / webconfig / OTA / SNMP).** These files are
**absent on `dmc-dev`** and present only on the observer branch (verified via
`git cat-file -e dmc-dev:...` -> ABSENT):
- `src/helpers/CommonCLI_Observer.cpp` (the observer-only command handler)
- `src/helpers/esp32/WebConfigServer.cpp` / `.h`
- `src/helpers/bridges/MQTTBridge.cpp`

Observer-only verbs handled in `CommonCLI_Observer.cpp` (FACT, line cites):
- MQTT config: `get/set mqtt.origin` (`:306-316`), `mqtt.iata` (`:316`),
  `mqtt.status/packets/raw/config/tx/rx/interval` (`:341-368`),
  `mqtt.filter.interval` (`:381`), `mqtt.neighbors[.interval]` (`:401-421`),
  `mqtt.ntp[.diag]` (`:424-427`; `docs/cli_commands.md:1458-1482`),
  `mqtt preset/server/port/username/password/token ...` (`:523-629`).
- Wifi: `wifi.ssid` (`:455`), `wifi.pwd` (`:460`), `wifi.powersave` (`:465-475`).
- SNMP: `snmp` / `snmp.community` (`:236-242`). Timezone: `timezone[.offset]`
  (`:504-509`).
- OTA: `ota check` / `ota update` (`:1256-1312`).
- Webconfig: `start webconfig [ap]` / `stop webconfig` (`:1314-1326`).
- `discover.scopes` (MQTT-observer, PSRAM only; `docs/cli_commands.md:132-145`), which
  otherwise replies `Err - neighbors not enabled in this build`.

Shared DMC + stock verbs (not gating signals; render for all classes): `ver`, `board`,
`get/set radio|tx|name|lat|lon|role|repeat|path.hash.mode|advert.interval|...`,
`region ...`, `neighbors`, `advert`, `reboot`, ACL `setperm`/`get acl`
(`docs/cli_commands.md`).

Region gating (`set/get dc.gate*`) is present on the observer branch
(`docs/cli_commands.md:720-785`). OPEN QUESTION: whether `dc.gate` also exists on
`dmc-dev`. It reuses region management, which is upstream; verify with
`git grep dc.gate dmc-dev` before gating that specific control (do not assume observer-only).

### 3.3 Webconfig HTTP server (observer only)

- Bind: `new AsyncWebServer(80)` (`src/helpers/esp32/WebConfigServer.cpp:259`). Port
  **80**, HTTP. FACT.
- Routes (`WebConfigServer.cpp:533-555`), FACT:
  `GET /`, `GET /api/status`, `GET /api/presets`, `POST /api/login`, `POST /api/logout`,
  `GET /api/config`, `GET /api/config/result`, `POST /api/config`, `POST /api/cli`,
  `GET /api/cli/result`, `GET /api/stats`, `GET /api/scan`, `POST /api/reboot`,
  `POST /api/portal/exit`.
- `GET /api/status` is served **without requiring auth** (`handleStatus`,
  `WebConfigServer.cpp:607-639`): it returns `{mode, auth, needs_setup, name, node_id
  (8-byte pubkey prefix hex), fw, build_date, role, board, uptime_s, runtime_slots,
  max_slots, active_slots, max_cmds}`. This is an ideal same-wifi identity + liveness
  probe. FACT.
- **Availability caveat (FACT).** The webconfig server only runs after `start webconfig`
  (`CommonCLI_Observer.cpp:1314`), or when the node raises its setup AP because wifi is
  unconfigured. It is **not** always-on. So a LAN HTTP probe only succeeds when the
  portal has been started (or the node is in setup-AP mode). A node can be a healthy
  MQTT observer with webconfig stopped and answer nothing on port 80.
- OPEN QUESTION: how RTFM-EV learns a node's LAN IP. The RF `ver`/status path never
  reports an IP. Candidates: the MQTT `status`/`config` topics (plan [11] ingestion),
  a `/api/scan` neighbor sweep, or user-entered IP. Mark the IP source UNVERIFIED until
  [11] lands; for phase 3 assume a user-supplied host/IP per contact.

### 3.4 OTA mechanism

**On-device (observer) OTA verbs (FACT, `CommonCLI_Observer.cpp:1256-1312`):**
- `ota check` -> reports the available build, does not flash. Calls
  `_board->otaFromManifest(getFirmwareVer(), dry_run=true, reply)`.
- `ota update` -> dry-run pre-check first; only if an applicable build exists does it
  download and flash, then reboot.
- These are distinct from `start ota` (ElegantOTA web-upload SoftAP page, manual;
  `docs/cli_commands.md:87-91`). `ota check`/`ota update` are **RF/serial CLI verbs**,
  so RTFM-EV can trigger them on an observer node over the existing `/command` endpoint
  without any host-side HTTP.

**Device manifest fetch (FACT, `src/helpers/ESP32Board.cpp:198-260`):**
- The device fetches a slim per-variant manifest at
  `<OTA_MANIFEST_BASE>/<OTA_VARIANT>.json`, forcing plain HTTP when the base is https
  (`ESP32Board.cpp:232-236`). Default base `https://ota.dutchmeshcore.nl/mqtt/v`
  (`build.sh:221`), variant = env name (`build.sh:224-226`, `-DOTA_VARIANT='"$1"'`).
- Manifest JSON shape (FACT, `DutchMeshCore-OTA/README.md:34-35` and
  `test_fixtures/releases.json`):
  ```json
  {"file":"https://ota.dutchmeshcore.nl/mqtt/fw/<tag>/<env>-<version>-<hash>.bin",
   "version":"<version>","hash":"<hash>","partSig":"<type:subtype:offset:size,...>"}
  ```
- Version-compare logic on device (FACT, `ESP32Board.cpp:313-346`): own version = text
  up to first `-`; own hash = text after last `-` (`ota_extractHash`). Compares
  `base + build-number`; if bases differ it is always an update; if build numbers are
  unknown it falls back to 7+ char hash-prefix equality. `partSig` guards against a
  partition-table change that OTA cannot perform (`ESP32Board.cpp:300-311`;
  `README.md:41-46`) - such a build is reported as "[partition change: cable flash]"
  and not flashed.

**Manifest server (DutchMeshCore-OTA, FACT, `README.md`):**
- `poller.py` polls `GET /repos/Dutch-MeshCore/MeshCore/releases` and writes one
  `<env>.json` per observer env; `proxy.py` streams the `.bin` from GitHub Releases
  (ESP32 HTTPUpdate does not follow the GitHub `302`). Served at
  `https://ota.dutchmeshcore.nl/mqtt/v/<env>.json` and over plain HTTP, `max-age=300`.
- Asset naming contract: `<env>-<version>-<hash>.bin`, env must end `_observer_mqtt`
  (`ota-capable-functions-update.md:16-38, 94-128`). Only **published** (non-draft)
  releases are visible (`README.md:78-80`).

**RTFM-EV OTA options (design, §4.5). Two independent paths:**
1. Command-driven (verified building blocks): RTFM-EV sends `ota check` / `ota update`
   over RF to an observer node and relays the reply. No host manifest parsing needed;
   the device does all the work. This is the low-risk path.
2. Host-side check (needs mapping): RTFM-EV fetches
   `https://ota.dutchmeshcore.nl/mqtt/v/<env>.json` itself and compares `version`/`hash`
   to the node's reported `ver` to show "update available" before the user commits.
   **UNVERIFIED / OPEN QUESTION:** how to map a node to its exact `<env>` /
   `OTA_VARIANT` token from RF alone. `board` gives a manufacturer name
   (`CommonCLI.cpp:1359-1360`) and `get role` gives the role, but the env token
   (e.g. `Heltec_v3_repeater_observer_mqtt`) is not directly reported. Until mapped,
   host-side check is best-effort / user-selects-variant.

**flasher.dutchmeshcore.nl:** cable-flash web tool (Web Serial). UNVERIFIED whether it
exposes any machine-readable version/manifest API RTFM-EV could reuse; it is not
host-drivable for a remote node. Treat as a documentation link for the user, not an
integration point, unless later verified.

---

## 4. Design

### 4.1 Firmware classification (backend)

Add a pure classifier `classify_firmware(ver_reply: str) -> FirmwareInfo` (new module,
e.g. `app/services/firmware_detect.py`), host-testable, no radio access.

Typed contract:

```python
FirmwareClass = Literal["stock", "dmc_repeater", "dmc_mqtt_observer", "unknown"]
FirmwareSource = Literal["detected", "manual"]

class FirmwareInfo(BaseModel):
    firmware_class: FirmwareClass
    firmware_version: str | None   # raw ver payload, e.g. "v1.17.1-dutchmeshcore.nl-observer-mqtt-abc (Build: 3 Sep 2026)"
    version_base: str | None       # token up to first '-', e.g. "v1.17.1"
    is_dmc: bool                   # dutchmeshcore.nl present
    has_mqtt: bool                 # observer/mqtt tags present
    source: FirmwareSource
    detected_at: int | None
```

Classification rule (FACT-derived from §3.1):
1. Take the substring before ` (Build:` as the version token.
2. `is_dmc = "dutchmeshcore.nl" in token` (or `-dmc-`; verify exact alt tag if any).
3. `has_mqtt = ("-observer" in token) or ("-mqtt" in token)`.
4. `firmware_class = dmc_mqtt_observer if (is_dmc and has_mqtt) else dmc_repeater if is_dmc else stock`.
5. If the `ver` reply is empty / timed out / `??` / `error` -> `unknown` (do not guess).

Honesty note in the plan output: because dev builds omit branding (§3.1 caveat),
`stock` from detection means "no DMC branding seen", not "provably upstream". The UI
must present detection as a hint, always overridable.

### 4.2 Detection at login (endpoint wiring)

Do not add a new RF round-trip. `ver` is already fetched by radio-settings
(`app/routers/repeaters.py:347`). Two integration choices:

- Preferred: after a successful repeater/room login
  (`prepare_authenticated_contact_connection`, `server_control.py:298`), issue the
  single `ver` command (guest-accessible via the binary owner-info path is name/fw only;
  the CLI `ver` is admin-gated per `server_control.py:456-459` comment, so detection
  quality depends on login level - OPEN QUESTION: confirm whether `ver` returns for a
  guest login or only admin). Persist `FirmwareInfo` on the contact.
- Alternative: classify lazily from the `firmware_version` the radio-settings pane
  already returns and persist it there.

Expose on existing surfaces (no new RF verbs):
- Add `firmware_class`, `firmware_version`, `firmware_source` to the `Contact` payload
  (`GET /api/contacts`, `contact` WS event) so the frontend can gate without a probe.
- Optional read-only `POST /api/contacts/{key}/repeater/firmware` that returns the
  stored `FirmwareInfo` and, if stale and admin-connected, refreshes via one `ver`.

### 4.3 Option gating model (frontend)

Drive the dashboard from `contact.firmware_class`. Define a static capability map
(single source of truth, e.g. `frontend/src/utils/firmwareCapabilities.ts`):

```ts
type Capability =
  | 'baseRepeater'   // ver, radio, name, region, neighbors, acl, reboot, advert  (all classes)
  | 'packetFilter'   // filter*  (dmc_repeater + dmc_mqtt_observer)
  | 'mqttConfig'     // mqtt.*   (dmc_mqtt_observer)
  | 'wifiConfig'     // wifi.*   (dmc_mqtt_observer)
  | 'snmpConfig'     // snmp*    (dmc_mqtt_observer)
  | 'webconfig'      // start/stop webconfig  (dmc_mqtt_observer)
  | 'networkOta';    // ota check/update      (dmc_mqtt_observer)

const CAPS: Record<FirmwareClass, Capability[]> = {
  stock:              ['baseRepeater'],
  dmc_repeater:       ['baseRepeater', 'packetFilter'],
  dmc_mqtt_observer:  ['baseRepeater', 'packetFilter', 'mqttConfig', 'wifiConfig', 'snmpConfig', 'webconfig', 'networkOta'],
  unknown:            ['baseRepeater', 'packetFilter', 'mqttConfig', 'wifiConfig', 'snmpConfig', 'webconfig', 'networkOta'],
};
```

Gating rules:
- `unknown` shows **everything** (fail-open): never hide a control we cannot prove is
  unsupported. Pair with a visible "firmware not detected - set manually" affordance.
- Detected classes show only their capabilities. Panes/tabs guard on
  `caps.includes(...)` in `RepeaterDashboard.tsx` (currently unconditional at
  `RepeaterDashboard.tsx:333-410`) and the console pane annotates which verb families
  are expected to work.
- New panes to add (behind capabilities), each backed by `filter`/`mqtt.*`/`wifi.*`
  batch fetches: a **Packet Filter** management pane and an **MQTT/Wifi config** pane.
  These are the "eigen config en filtermanagement-UI" the contributor asked for.

This directly satisfies the quote: options are adjusted by reported firmware, so MQTT
and non-MQTT DMC repeaters/observers each get their own config and filter-management UI,
without loading RF with useless commands that come back as `??`.

### 4.4 Manual override (storage + UI)

Because RF replies can fail and dev builds omit branding (§3.1), the user must be able
to set the class manually.

- Migration `_069_add_contact_firmware.py` (next free number, FACT) adds to `contacts`:
  `firmware_class TEXT`, `firmware_version TEXT`, `firmware_source TEXT DEFAULT 'detected'`,
  `firmware_detected_at INTEGER`. Follow the additive `ALTER TABLE` pattern of prior
  migrations (`app/migrations/_065`.._068`).
- Extend `Contact` / `ContactUpsert` (`app/models.py:24-142`) and the contacts
  repository writes to carry the new fields.
- New endpoint `POST /api/contacts/{key}/firmware-override` body
  `{firmware_class: FirmwareClass | null}`; null clears the override and reverts to
  detected. Precedence: `firmware_source == 'manual'` wins over detection; a later
  detection never silently overwrites a manual value (mirrors the routing-override
  precedence philosophy in `AGENTS.md` "Route precedence").
- Frontend: a small control in `ContactInfoPane` / dashboard header to pick class,
  reusing the existing override-modal pattern
  (`ContactRoutingOverrideModal.tsx`). Show detected vs manual badge.

### 4.5 Webconfig detection + OTA hook

**Webconfig (phase 3):**
- Per observer contact, optional user-supplied LAN host/IP (IP discovery is an OPEN
  QUESTION until [11] MQTT ingestion, §3.3). Backend probe `GET http://<ip>/api/status`
  (port 80, no auth) -> parse `{fw, build_date, role, board, node_id}`
  (`WebConfigServer.cpp:607-639`). Use `node_id` (8-byte pubkey prefix) to confirm the
  IP maps to this contact before trusting it.
- On success, offer a "Open web config" deep link and use the returned `fw` as a second
  detection source (reconcile with the RF `ver` class; disagreement -> surface both,
  do not silently pick one).
- Safety: the probe is plain HTTP on the trusted LAN, consistent with the app's
  trusted-network posture (`AGENTS.md` "Intentional Security Design Decisions"). Never
  send the admin/webconfig password from RTFM-EV automatically; `/api/status` needs none.

**OTA (phase 4), two sub-paths from §3.4:**
- Path 1 (low risk, RF): `POST /api/contacts/{key}/repeater/ota-check` sends `ota check`
  and relays the device reply (e.g. "update available: v1.17.0 -> v1.17.1 (2 behind)"
  or "up to date" or "[partition change: cable flash]"). `.../ota-update` sends
  `ota update` behind an explicit confirm. Both gated on `networkOta` capability and
  observer-only. The device performs the manifest fetch, partSig guard, flash, reboot.
- Path 2 (host-side pre-check, best-effort): fetch
  `https://ota.dutchmeshcore.nl/mqtt/v/<env>.json` and compare `version`/`hash` to the
  reported `ver` to show availability before committing. Blocked on the env-mapping
  OPEN QUESTION (§3.4); until resolved, either skip or let the user pick the variant.

Typed OTA contract (host side, if Path 2 is built):

```python
class OtaManifest(BaseModel):   # mirrors DutchMeshCore-OTA/<env>.json
    file: str
    version: str
    hash: str
    partSig: str | None = None

class OtaStatus(BaseModel):
    available: bool
    up_to_date: bool
    current: str          # reported ver token
    latest: str | None    # manifest version + hash
    partition_change: bool
    note: str | None
```

---

## 5. Phasing

1. **Detection + gating (RF only, self-contained).** `classify_firmware`, persist on
   contact, add `firmware_class`/`firmware_version` to the contact payload + WS event,
   gate existing panes and add the Packet Filter and MQTT/Wifi config panes. No new RF
   round-trip (reuse the `ver` already fetched). Highest value, lowest risk.
2. **Manual override.** Migration `_069`, model + repo fields, override endpoint, UI
   control + detected/manual badge. Small, unblocks trust in gating for dev builds.
3. **Webconfig detection.** Per-contact host/IP, `GET /api/status` probe, deep link,
   second detection source. Depends on an IP source (user-entered now; MQTT-derived
   after [11]).
4. **OTA.** Path 1 (`ota check`/`ota update` relay) first; Path 2 (host-side manifest
   pre-check) only after the env-mapping question is resolved.

Sequencing matches `docs/plans/README.md:138-152` ("DMC firmware detection [10] ...
gates option visibility in [11] NOC" and "OTA + webconfig sub-phases"). Phase 1-2 are
independent of [11]; phases 3-4 benefit from [11]'s IP/identity plumbing.

---

## 6. Risks and open questions

- **Detection reliability (FACT).** `-dutchmeshcore.nl` branding is injected only by
  `build.sh` (`build.sh:213-220`); dev builds classify as `stock`. Mitigation: fail-open
  for `unknown`, always allow manual override, and treat webconfig `fw` / (later) MQTT
  `config` as corroborating sources.
- **`ver` visibility by login level (OPEN QUESTION).** The CLI `ver` path is described
  as admin-routed (`server_control.py:456-459` comment). Confirm whether a guest login
  gets a usable `ver`; if not, detection quality drops for guest-only nodes and must
  lean on the binary owner-info name/fw (`repeaters.py:388-410`) or webconfig.
- **`dc.gate` branch scope (OPEN QUESTION).** Confirm whether region-gating verbs exist
  on `dmc-dev` or only observer before gating that control (§3.2).
- **Webconfig is not always-on (FACT).** Port-80 probe fails unless `start webconfig`
  was issued or the node is in setup-AP mode (`CommonCLI_Observer.cpp:1314`). Do not
  treat "no HTTP" as "not an observer".
- **LAN IP discovery (OPEN QUESTION).** RF never reports the node IP; needs user input
  or [11] MQTT `status`/`config`. Do not scan the LAN without user intent.
- **OTA env mapping (UNVERIFIED).** Mapping a node to its `<env>`/`OTA_VARIANT` from RF
  alone is not established (§3.4). Host-side pre-check is best-effort until resolved.
- **Remote-OTA safety (FACT + risk).** `ota update` reboots the node; a bad flash on a
  remote repeater is a truck-roll. Guards: require explicit confirm, prefer `ota check`
  first, honor the device's own partSig "[partition change: cable flash]" refusal
  (`ESP32Board.cpp:300-311`), and never auto-update. Only published releases are OTA
  targets (`DutchMeshCore-OTA/README.md:78-80`).
- **flasher.dutchmeshcore.nl (UNVERIFIED).** No confirmed machine API; treat as a user
  link, not an integration, unless verified.

---

## 7. Verification plan

- **Classifier unit tests** (host, no radio): feed representative `ver` payloads for all
  three classes plus dev-build (no brand), empty, and `??`/`error`; assert
  `firmware_class`, `is_dmc`, `has_mqtt`, and `unknown` fallback. This is the core FACT
  under test and needs no hardware.
- **Backend endpoint tests** (extend `tests/test_repeater_routes.py`): mock the CLI seam
  so `ver` returns each branded string; assert the contact payload carries the expected
  class and that override precedence (`manual` > `detected`) holds. Migration `_069`
  covered by `tests/test_repository.py` / a migration test.
- **Frontend gating tests** (extend `frontend/src/test/repeaterDashboard.test.tsx`):
  render with each `firmware_class` and assert only the capability-matched panes mount;
  assert `unknown` shows all panes and the "set manually" affordance.
- **Runtime observation (required by CLAUDE.md; NOT VERIFIED here).** Against a real DMC
  node: confirm gating hides the right panes, that no `??`-provoking command is sent for
  a hidden capability, and (observer) that `GET http://<ip>/api/status` returns the
  documented JSON and that `ota check` relays a real reply. Live UI/behavior must be
  observed, not inferred. Mark NOT VERIFIED until hardware is available.
- Whole-repo gate before finishing code: `./scripts/quality/all_quality.sh`
  (`AGENTS.md` "Important Rules").

---

## 8. Effort

Rough, for scoping only (not a commitment):

- Phase 1 detection + gating: **M**. Classifier + tests are small; the frontend
  capability map and two new config/filter panes are the bulk.
- Phase 2 manual override: **S**. One additive migration, model/repo fields, one
  endpoint, one small UI control.
- Phase 3 webconfig detection: **S-M**, mostly the IP-source question and the probe +
  reconciliation UI.
- Phase 4 OTA: **M-L** and highest risk. Path 1 relay is **S-M**; Path 2 host-side
  pre-check is blocked on env mapping and carries the remote-flash safety surface.

Total is squarely the Opus classification in `docs/plans/README.md:123` due to the
cross-layer protocol/firmware detection and remote-OTA safety, even though each
individual slice is modest.

---

## Reconciliation

- `docs/plans/README.md` entry [10] (`README.md:86-90, 123, 138-152, 166-168`): this
  plan is the concrete form of that entry and the Dutch contributor's suggestion; it
  gates option visibility for [11] NOC and owns the OTA + webconfig sub-phases. No
  duplication of [11]'s inbound MQTT ingestion (this plan uses MQTT only as a possible
  future IP/identity source, deferred to [11]).
- `docs/sources-of-truth.md` (`:22-52`): firmware branch names, the six MQTT topic types,
  and the OTA repo / flasher pointers used here match that file; the two-flavour
  distinction it flags is exactly what this plan gates on.
- `docs/parity-audit.md` (branch `feat/i18n-en-nl-de`): consistent with "Run CLI on node
  = Partial" and the observer firmware as first-class parity target. Firmware-aware
  gating is new relative to the parity audit; it does not overlap N1/N2/X1/X2/L1-L4.
