# [21] Signal-Tester Mirror: Per-Relay Reception Comparison + Signal-QoL Imports

Date: 2026-09-12
Status: PLANNING (greenfield analysis). Verified against firmware + code + lib on
2026-09-12; nothing built.
Category: H (Persistence) + G (Map) + telemetry parity (L2). See `docs/plans/README.md`.
Model: Opus (flagship S1 has protocol/firmware feasibility risk); S3/S4/S5/S6 are Sonnet.

Scope: local planning only. No code changes, no migrations, no commits, no PRs
from this document.

Product framing: RTFM-EV is a **MeshCore** server + browser terminal driving a
companion radio (BLE / serial / TCP). The primary reference is
`kybl/meshcore-signal-tester`, a **client-side** browser/Android RF signal-quality
analyzer that connects a radio directly (Web Bluetooth / Web Serial / WiFi-TCP) and
stores captures in IndexedDB. Its transport/persistence half is category-mismatched
with RTFM-EV (server owns one companion, persists to SQLite); its analytics half
maps directly. This plan mirrors only the analytics.

Two in-house sibling repos already implement parts of this and are first-class
sources for the port (not just the external tool): **EU-Meshcore-Analyzer**
(`Elektr0Vodka/EU-Meshcore-Analyzer`, its own signal-tester + Geiger/sonar audio, and
the UX reference for [13]) and **DutchMeshCore-Observers**
(`Dutch-MeshCore/DutchMeshCore-Observers`, the map with the **fixed** Geiger click).
See S6 for the audio port and `docs/sources-of-truth.md` for repo pointers.

---

## 1. Summary

RTFM-EV already covers ~70-80% of the signal-tester's analytical surface
(MyNodeView, MeshHealthView, TracePane, raw-feed with signal columns, repeater
neighbour SNR history, active discovery). Verification against firmware, the
`meshcore` lib, and RTFM code isolated exactly **one** genuinely-absent capability
worth porting, plus a small set of quality-of-life additions.

The flagship is a **per-relay same-packet reception comparison**: for one flooded
message, show every relay (last hop) that delivered a copy to our radio and the
SNR/RSSI our radio measured for each copy. This is the signal-tester's signature
"one row per packet, one column-pair per repeater" table. It is **feasible**: the
companion pushes the full raw packet (including the routing path) plus per-copy
SNR/RSSI on **every** physical reception; RTFM currently discards the duplicate
copies at the DB layer. The missing pieces are a per-reception store, a last-hop
extractor, prefix->identity resolution, an aggregation endpoint, and a view.

Everything else the tool does is either already present (document, do not rebuild),
a small QoL add (S3-S6), or category-N/A (client transports, IndexedDB, phone GPS).

---

## 2. What the reference tool does (feature inventory)

From the tool README/UI (secondary source, marked **[web]** where not cross-checked
against firmware):

1. Connect to companion or repeater over Web Bluetooth / Web Serial / WiFi-TCP. **[web]**
2. Auto-detect companion vs repeater (3-phase probe: APP_START, then `ver`). **[web]**
3. Repeater CLI polling modes: stock (neighbour tables, no last-hop) vs
   `MESH_PACKET_LOGGING` (streams raw hex). **[web]**
4. **Packet table grouped by message hash: one row per unique packet, one
   column-pair (SNR/RSSI) per repeater/last-hop.** (Flagship.)
5. Scrolling SNR and RSSI history charts per repeater, with noise-floor shading
   (RSSI-SNR) and the radio's own polled noise floor as a dashed line (~10 s poll). **[web]**
6. 3D signal map: GPS dots, SNR encoded as height, clustering, offline tiles. **[web]**
7. Seen-repeaters stats table (RX count, max/last RSSI, max/last SNR, last-seen), sortable.
8. Connection status box (identity, preset match, battery). **[web]**
9. IndexedDB capture, auto-remove window, display window. **[web]**
10. CSV export/import with repeater name/position metadata, multi-file merge. **[web]**
11. Pause/resume, auto-pause on disconnect, auto-reconnect. **[web]**
12. Per-packet audio, pitch scales with SNR. Also independently built in-house:
    EU-Meshcore-Analyzer (sonar/geiger themes, SNR + payload-type shaping, Tx chirp)
    and DutchMeshCore-Observers (the fixed Transient Geiger click). See S6.
13. Per-hop SNR on Trace packets (patched decoder).
14. "Discover nodes" (active): nearby nodes reply with uplink SNR (README also
    claims name + GPS - **corrected below**).
15. Repeater ID resolution: promote 1-3 byte prefixes to full IDs, split collisions
    (`1234/1289`). **[web]**
16. Theme/text-size/dot-size/prefix-filter display options; keep-screen-on. **[web]**

---

## 3. Verification results (firmware + lib + code, cited)

All firmware citations are `G:\Github\repositories\Dutch-MeshCore\MeshCore`
(companion string `v1.17.1`, `examples/companion_radio/MyMesh.h:15`). Lib is
`meshcore==2.3.9.1` (`fdlamotte/meshcore_py`). RTFM paths are repo-root-relative.

### 3.1 The radio delivers path + per-copy signal on every reception (FACT)

- Firmware pushes `PUSH_CODE_LOG_RX_DATA = 0x88` from `MyMesh::logRxRaw`
  (`examples/companion_radio/MyMesh.cpp:289-300`). Frame is
  `[0x88][snr*4 (int8)][rssi (int8)][full raw packet bytes]`.
- It is called **unconditionally** on every received frame, *before* parsing, with
  the untouched over-the-air buffer: `src/Dispatcher.cpp:243`
  `logRxRaw(_radio->getLastSNR(), _radio->getLastRSSI(), raw, len);`. Not gated by
  any setting. The raw buffer includes header + (transport codes) + path_len + path
  + payload, i.e. **the path is not stripped**.
- The sibling `PUSH_CODE_RAW_DATA = 0x84` (`MyMesh.cpp:815-833`) *does* strip the
  path (payload only, byte 3 = `0xFF` reserved). This is a different frame.
- The `meshcore` lib maps `LOG_DATA = 0x88` -> `rx_log_data`, and decodes
  `snr` (signed/4.0), `rssi`, `payload` (raw hex, incl path), plus parsed
  `route_type`/`payload_type`/`path_len`/`path`. (0x84 `RAW_DATA` is a separate
  enum value.) So RTFM's `RX_LOG_DATA` subscription is the 0x88 frame **with** path.

Conclusion: every relayed copy of a flood reaches RTFM with (a) our-radio SNR, (b)
our-radio RSSI, (c) the full path whose last entry identifies the last hop. The
data needed for the flagship already arrives.

### 3.2 RTFM discards duplicate copies and keeps no last-hop (FACT)

- `app/event_handlers.py:135-155` `on_rx_log_data` reads only `payload["snr"]`,
  `payload["rssi"]`, `payload["payload"]` and calls `process_raw_packet`. It ignores
  the lib-provided `path`/`path_len` (RTFM re-parses instead).
- `app/repository/raw_packets.py:45-65` `create()` does
  `INSERT OR IGNORE INTO raw_packets ... payload_hash ...` where `payload_hash =
  sha256(extract_payload(data))` **excludes routing/path** (`app/decoder.py:117-133`).
  So all relayed copies of one payload collapse to one row, and only the
  first-seen copy's `data`/`snr`/`rssi` is kept. There is **no relay/last-hop column**.

### 3.3 Path format and last-hop (FACT)

- Path length byte packs `[hash_size-1 : 2][hop_count : 6]`; hash width is **1, 2,
  or 3 bytes** (width 4 reserved/rejected). Firmware `src/Packet.h:79-81`,
  `src/Packet.cpp:13-30`; RTFM mirror `app/path_utils.py:42-56`.
- A forwarding node appends its own hash to the **end** of the path
  (`src/Mesh.cpp:344-357`), so for **flood** packets `path[0]` is the relay nearest
  the source and the **last entry is the node that transmitted to us (last hop)**.
  Direct-routed packets consume from index 0 instead (`removeSelfFromPath`,
  `src/Mesh.cpp:334-342`) - see open question Q3.
- RTFM parses `path`/`path_length`/`path_hash_size` in `app/decoder.py:136-155` and
  `app/path_utils.parse_packet_envelope`. It has `split_path_hex(...)`
  (`path_utils.py:143-155`) and a **first**-hop helper `first_hop_hex`
  (`:158-164`), but **no last-hop helper** (grep: zero `last_hop` symbols in `app/`).
  Last hop = `split_path_hex(path_hex, hop_count)[-1]`.
- The last-hop hash is a 1-3 byte **prefix** of the relay's pubkey, so identity
  needs prefix->contact resolution (the tool's "repeater ID resolution"). RTFM has
  full contact identities server-side, which makes resolution far better than the
  tool's client-side guessing, but collisions are still possible for 1-byte hops.

### 3.4 "Discover nodes" is already present; the README's name/GPS claim is wrong (FACT)

- RTFM `/radio/discover` (`app/routers/radio.py:612-626`) calls
  `send_node_discover_req(target_bits, prefix_only=False, tag=tag)` and collects
  `DISCOVER_RESPONSE` over an 8 s window. It returns `RadioDiscoveryResponse` with
  per node `public_key`, `node_type`, `local_snr`, `local_rssi`, and `remote_snr`
  (= `SNR_in`, the uplink SNR the remote measured for our request). `name` is filled
  from the local contacts DB, not the reply.
- Firmware confirms the reply carries **only** `[type|ADV_TYPE_REPEATER][inbound
  SNR*4][tag(4)][pubkey (32 or 8)]` (`examples/simple_repeater/MyMesh.cpp:964-975`).
  **No name, no GPS.** The tool's README claim of "name and GPS position" in the
  reply is not a firmware capability; those must come from a follow-up advert or a
  local directory. RTFM already does the correct thing.
- Companion drives this over `CMD_SEND_CONTROL_DATA = 55`
  (`examples/companion_radio/MyMesh.cpp:2001-2004`); responses arrive as
  `PUSH_CODE_CONTROL_DATA = 0x8E`. The only RTFM gap is presentation: discovery is a
  one-shot **Settings** button (`SettingsRadioSection.tsx` ~:1639-1787), not a
  persistent/live view.

### 3.5 Per-hop trace SNR is already present (FACT)

- Firmware: each relay appends its measured SNR (`(int8_t)(getSNR()*4)`) into the
  trace path buffer (`src/Mesh.cpp:58-64`); the trace push `PUSH_CODE_TRACE_DATA =
  0x89` carries `path_hashes[]` + `path_snrs[]` + final SNR
  (`examples/companion_radio/MyMesh.cpp:835-863`).
- RTFM already surfaces per-node SNR: `/radio/trace` returns `RadioTraceNode.snr`
  and `TracePane.tsx` renders it. No work needed (the tool's "patched decoder for
  per-hop SNR" is a capability RTFM already has via the lib/firmware).

### 3.6 Existing analytics that partly overlap but do NOT suffice for the flagship (FACT)

- `/packets/relay-pairs` (`app/routers/packets.py:753-788`) counts adjacent hop
  pairs from `contact_advert_paths` weighted by `heard_count`. Topology only; **no
  signal**, and it is advert-derived.
- `contact_advert_paths` (`app/repository/contacts.py:735-888`) keys on
  `(pubkey, path_hex, path_len)` (the **full** route), stores only **best**
  `rssi`/`snr` (MAX), adverts only, pruned to 10 paths/contact. Not per-reception,
  not last-hop keyed.
- `link_signal` (`app/repository/link_signal.py`) is genuine per-sample history
  (`observer_pubkey, subject_pubkey, source, snr, rssi, secs_ago, observed_at`), but
  the `traffic` source is gated to `path_length == 0` (0-hop only,
  `app/packet_processor.py:537-569`) and has **no relay column**; the
  `repeater_query` source is repeater self-reports. Neither pairs *last-hop relay
  identity + per-copy SNR/RSSI*.
- WS `raw_packet` broadcast (`app/packet_processor.py:438-460`) already carries a
  unique `observation_id` per physical reception plus `snr`/`rssi` and raw `data`,
  but omits `path`, last-hop, and payload hash.

Reusable primitives: `calculate_packet_hash` (`path_utils.py:370-394`, the grouping
key), `split_path_hex`, and the `observation_id` counter. Missing: a per-reception
last-hop+signal store, a last-hop helper, and an aggregation surface.

---

## 4. Feature mapping matrix

| # | Signal-tester feature | RTFM-EV status | Action |
|---|---|---|---|
| 4 | Per-relay same-packet comparison | **Absent** | **S1 (flagship)** |
| 5 | SNR/RSSI history + noise-floor shading/dashed line | Present (charts) / Partial (overlay) | **S4** overlay polish |
| 6 | 3D/geographic signal map (SNR over GPS) | Absent | **S2** (fold into [13]) |
| 7 | Seen-repeaters sortable stats | Partial (data in historical-stats/link_signal) | **S3** |
| 10 | CSV export of capture | Absent | **S5** (export only) |
| 12 | Per-packet audio (Geiger, SNR/type shaping) | Absent in RTFM; **exists in EU-Analyzer + DMC-Observers** | **S6** (INCLUDE; port, fixed clicks from DMC) |
| 13 | Per-hop trace SNR | Present (`RadioTraceNode.snr`) | none |
| 14 | Active discovery (uplink SNR) | Present (`/radio/discover`) | optional S7 view |
| 15 | Repeater ID prefix resolution | Better (full contact DB) | part of S1 |
| 5b | Noise-floor viewer | Present (`NoiseFloorLineChart`) | none |
| - | SNR/RSSI scatter, heatmap, reachability | Present (MeshHealthView) | none |
| 1 | In-browser BLE/Serial/WiFi transports | Server-side via lib | N/A |
| 2/3 | Companion/repeater probe, CLI polling modes | Server connects; repeater console differs | N/A |
| 8 | Connection status/preset/battery | Present (`/health`, settings) | none |
| 9 | IndexedDB capture / auto-remove window | SQLite + retention ([19]) | N/A |
| 11 | Pause/resume, auto-reconnect | Backend auto-reconnect; live server | N/A (UI alarm cosmetic) |
| 16 | Phone GPS, keep-screen-on, dot-size | Mobile-only / minor | N/A |

---

## 5. Buildable increments

### S1. Per-relay same-packet reception comparison (FLAGSHIP)

**Goal:** For a flooded packet (grouped by payload hash), show each last-hop relay
that delivered a copy and the SNR/RSSI our radio measured for that copy; resolve
each last-hop hash to a contact where possible.

**Why it is new, not a dupe of link_signal/relay-pairs:** those key on full route
or 0-hop or omit the relay entirely (S3.6). S1 needs `(payload_hash, last_hop_hash,
snr, rssi)` per physical reception.

**Design (phased):**

Phase 1 - capture (backend, the load-bearing change):
- Add a `packet_receptions` table (migration; next free `_076`, re-verify
  `git ls-tree origin/main app/migrations` at build time). Columns (proposed):
  `id, payload_hash BLOB, observed_at INT, snr REAL, rssi INTEGER, route_type INT,
  hop_count INT, hash_size INT, last_hop_hex TEXT, origin_hex TEXT NULL`.
- Populate it in `app/packet_processor.py` on **every** reception, *before/around*
  the dedup in `raw_packets.create()` (which must stay dedup for storage economy).
  The reception row is written per copy even when the raw packet dedups; the
  existing `observation_id` (`packet_processor.py:302`) is the per-copy tag.
- Add `last_hop_hex(path_hex, hop_count)` to `app/path_utils.py` next to
  `first_hop_hex` (`= split_path_hex(...)[-1]`). Guard on route type (Q3).
- Retention: prune by age/count in the existing maintenance path
  (`POST /api/packets/maintenance`); tie into [19] retention policy. This table is
  higher-volume than `raw_packets` (one row per copy), so a tight default window
  (e.g. 24-72 h) is required - decision Q4.

Phase 2 - aggregation endpoint:
- `GET /api/packets/relay-reception` returning, per recent `payload_hash`: the
  message summary (type, decrypted preview if available, first/last seen) and an
  array of `{last_hop_hex, resolved_pubkey?, resolved_name?, snr, rssi, count,
  last_seen}`. Resolve `last_hop_hex` -> contact via the existing prefix lookup
  (`ContactRepository.get_by_key_prefix`), flagging collisions (>1 match) rather
  than guessing, matching the tool's `1234/1289` split behaviour.

Phase 3 - frontend view:
- New conversation type (`types.ts` union `... | 'signal-compare'`) + Sidebar tool
  row + `ConversationPane` dispatch, following the MyNodeView/MeshHealthView
  precedent. Render the pivot table (rows = packets, columns = relays, cells =
  SNR/RSSI), reusing i18n keys (EN/NL/DE per enforced policy) and the existing
  `formatSNR`. Live updates can extend the `raw_packet` WS payload with
  `payload_hash` + `last_hop_hex` (currently omitted, S3.6) or poll the endpoint.

**Effort:** Opus. Backend Phase 1 is the risk (schema + capture placement +
retention volume). Phases 2-3 are standard.

**Open feasibility note:** the comparison is only meaningful when the SAME companion
hears the same flood via multiple relays. That happens for flood traffic in a dense
mesh; it will be sparse in a small mesh. This is an inherent data-availability
limit, not a bug - the view must degrade gracefully (single-relay rows are normal).

### S2. Geographic signal map (SNR over GPS) - fold into [13] Map Overhaul

Each received packet as a map point coloured/elevated by SNR. This is squarely the
[13] engine-migration territory: MapLibre-GL gives fill-extrusion / data-driven
styling cheaply; Leaflet does not. **Do not build standalone** - add it as a layer
in [13] Phase 2 after the MapLibre migration lands. Data source: S1's
`packet_receptions` joined to contact positions, or `contact_advert_paths` best
signal. Medium-high effort, gated on [13].

### S3. Seen-repeaters sortable stats table

RX count, max/last SNR, max/last RSSI, last-seen per relay/neighbour, sortable.
Most data exists (`/packets/historical-stats` "top neighbours", `link_signal`,
and S1's `packet_receptions` once built). Smallest form: a frontend table fed by
an aggregation of `packet_receptions` (or historical-stats) grouped by last-hop.
Best delivered as a panel inside S1's view or MyNodeView. Sonnet, small.

### S4. Noise-floor + RSSI-SNR overlay on the SNR chart

Two chart touches from the tool: (a) plot the radio's polled noise floor as a
dashed line on the SNR chart axes, and (b) shade an estimated noise floor
(`RSSI - SNR`) band. RTFM already samples noise floor every 60 s
(`noise_floor_samples`, `NoiseFloorLineChart`) but shows it as its own chart. This
is a MyNodeView polish. Matches parity **L2**. Sonnet, small. (The tool polls ~10 s;
only raise RTFM's 60 s sample rate if the overlay looks too coarse - decision Q5.)

### S5. CSV export of captured packets

Small addition to the database settings section: export `raw_packets` (or
`packet_receptions`) to CSV. Import is low-value for a live server (skip). Sonnet,
small. Note the tool embeds repeater name/position metadata for round-trip; RTFM's
server-side contact DB makes that unnecessary.

### S6. Per-packet Geiger / signal audio (INCLUDE - port from two existing local repos)

**User-requested inclusion (2026-09-12):** not an optional novelty. Port the audio
that already exists in two sibling repos, using the **fixed clicks** from
DutchMeshCore-Observers rather than the chiptune beep.

**Two existing implementations (verified 2026-09-12):**

- **EU-Meshcore-Analyzer** (`G:\Github\repositories\Elektr0Vodka\EU-Meshcore-Analyzer`)
  is the richer engine, built for its own signal-tester tool:
  - `web/js/lib/signal-audio-core.js` (pure): `snrToPitch` (SNR -20..+10 dB ->
    300..1200 Hz), `snrPitchFactor` (0.85..1.15), per-payload-type `GEIGER_TONES`
    (Advert 880, TextMessage 1200, Ack 1600, Trace 660, ...), `TX_TONES` (distinct
    two-tone up-chirp per Tx kind so your OWN transmission is audibly different from
    an Rx), and a `shouldPlay(now,last,gap)` rate-limit.
  - `web/js/lib/signal-audio.js` (engine): themes `sonar` (sine ping, SNR->pitch,
    350 ms) and `geiger` (square-wave per-type tone, 40 ms), `playChirp` for Tx,
    `onPacket({snrDb,payloadType})` / `onTx({kind})`, `MIN_GAP_MS = 45`, injected
    `makeContext` for tests.
  - **Limitation:** its `geiger` theme is a **pitched square-wave beep** - "reads as
    a chiptune blip, not a counter" (per the DMC design doc below).

- **DutchMeshCore-Observers**
  (`G:\Github\repositories\Dutch-MeshCore\DutchMeshCore-Observers`) is the **fixed
  click** - a real Geiger-Muller tick, deliberately replacing EU's beep. Design doc:
  `docs/superpowers/specs/2026-08-29-geiger-click-map-audio-design.md`.
  - `web/js/lib/clickaudio-core.js` (pure): `jitterParams(random)` ->
    `{pitch 0.94..1.07, level 0.78..1.0}` (organic-train jitter).
  - `web/js/lib/clickaudio.js` (engine): candidate-A **"Transient"** synthesis - a
    50 ms white-noise buffer (built once) through a bandpass (`BP_FREQ 1800` x pitch,
    `BP_Q 1.6`) with an exponential gain envelope (`PEAK 0.9` -> silence by
    `DECAY_S 0.011` = ~11 ms). Scheduled on the **audio clock** (`MIN_SPACING_S 0.02`,
    `MAX_LEAD_S 0.25`) so near-simultaneous ticks stay distinct and an extreme burst
    overlaps into a roar rather than lagging. Injected `makeContext`. It intentionally
    dropped SNR/type shaping for v1 (every packet clicks the same + jitter).

**The port (best of both):** take EU's engine shape (themes, SNR/payload-type
shaping, the Tx up-chirp cue, pure-core + injected-context split) and **replace the
square-wave `playGeiger` with DMC's Transient noise-burst** as the geiger sound, plus
adopt DMC's audio-clock scheduling (`MIN_SPACING`/`MAX_LEAD`) in place of EU's
wall-clock `MIN_GAP_MS` for burst robustness. Carry EU's SNR/type information onto the
Transient click by modulating its bandpass centre by `snrPitchFactor(snr)` and a
per-payload-type base (so a signal *tester* still hears SNR and packet type, which the
map-only DMC version deferred). Keep both themes selectable: `sonar` (EU sine ping)
and `geiger` (DMC Transient click), default geiger.

**RTFM integration (this is a React/TS port, not a vanilla-JS copy):**
- Reimplement as TS modules, e.g. `frontend/src/audio/signalAudioCore.ts` +
  `signalAudioEngine.ts`, with a `useSignalAudio` hook; unit-test the core with Vitest
  (the source repos use `node --test`; both use an injected recording-fake context,
  which ports directly).
- Trigger from the existing live packet stream: the WS `raw_packet` broadcast already
  carries `snr` and `payload_type` and a unique `observation_id` per physical
  reception (`app/packet_processor.py:438-460`). RTFM already dedups multi-observer
  copies upstream, matching DMC's "callers dedupe" contract - so `onPacket` fires once
  per transmission.
- Surface a Sound toggle + volume slider + theme selector on `RawPacketFeedView`
  (and/or the S1 view), persisted in `localStorage`, with the same autoplay-unlock
  discipline both source repos use (context created/resumed only from a user gesture;
  one-time `pointerdown`/`keydown` unlock if restored on).
- The Tx cue (`onTx`) is optional phase 2: RTFM knows its own sends
  (`app/services/message_send.py`, advert/trace) - a distinct chirp when we transmit
  is a nice-to-have, not required for the Rx Geiger.
- i18n keys for the toggle/theme/volume labels in EN/NL/DE (enforced policy). The DMC
  design doc already provides NL/EN/DE strings (`map_sound`, `map_tip_sound`,
  `map_sound_vol`) that can seed them.

**Provenance:** both repos are in-house (Elektr0Vodka / Dutch-MeshCore). Confirm the
license/attribution expectation before copying literal parameter tables; the synthesis
constants and the SNR/tone maps are the reusable substance.

**Effort:** Sonnet. Frontend-only, no backend/migration. The synthesis math is
already written and tested in both repos; the work is the TS port + feed wiring + UI.

### S7. Discovery as a persistent view (OPTIONAL)

`/radio/discover` already produces the data (S3.4). Optionally promote it from the
Settings button to a sidebar view with retained history. Low value; the Settings
button already works. Decision Q6.

---

## 6. Already present - document, do not rebuild

Per-hop trace SNR (S3.5), noise-floor viewer, battery history, SNR-vs-RSSI scatter,
hourly heatmap, reachability rings (MeshHealthView), packet feed with signal columns
(RawPacketFeedView), repeater neighbour SNR history (`NeighborSignalDetailChart` /
`NeighborSnrSparkline`), active discovery with uplink SNR (`/radio/discover`),
connection status / preset / battery (`/health`, SettingsRadioSection), radio preset
config (freq/bw/sf/cr/tx_power).

## 7. N/A (category mismatch - documented, not backlogged)

In-browser BLE/Serial/WiFi transports and companion/repeater 3-phase probe (RTFM
connects server-side via the lib); repeater CLI polling modes (RTFM uses the
companion binary protocol + a different repeater console); IndexedDB capture and
auto-remove window (RTFM uses SQLite + [19] retention); phone GPS location capture,
keep-screen-on, Android background service, disconnect full-screen alarm (mobile/UI
cosmetics; backend auto-reconnect already exists).

## 8. Open questions / decisions needed

- **Q1.** Build S1 as a new dedicated table `packet_receptions`, or extend
  `link_signal` with a `last_hop_hex` column and lift its 0-hop gate? (Recommend a
  new table: `link_signal` semantics are per-neighbour-link, not per-packet-copy.)
- **Q2.** Should S1 capture *all* payload types or floods only? (Direct-routed
  packets do not accumulate a relay path the same way - see Q3.)
- **Q3.** Confirm last-hop semantics for **direct-routed** packets: firmware pops
  index 0 on direct route (`src/Mesh.cpp:334-342`), so `path[-1]` is not the last
  hop for those. S1 should restrict "last hop" to flood/transport-flood routes, or
  handle direct routes separately. Verify against a live capture before shipping.
- **Q4.** `packet_receptions` retention default (volume is one row per copy). Propose
  24-72 h; tie to [19].
- **Q5.** Raise noise-floor sample rate from 60 s for S4 overlay? (Default: no.)
- **Q6.** Promote discovery to a persistent view (S7)? (Default: no, keep Settings.)
- **Q7.** Numbering: this plan is file **21**; file 20 is the already-researched
  `openhop-integration` plan (backlog memory), so 21 is the next free slot. This
  plan is not yet added to the `docs/plans/README.md` index or the delivery table -
  do that on approval.

## 9. Reconciliation with parity-audit and backlog

- **S1** is a new, distinct item (the parity audit's L2 "Direct/Flood packet
  metrics" is aggregate counts, not the per-relay pivot). It consumes the shipped
  **N1** signal-storage foundation and the `observation_id` infrastructure.
- **S2** is explicitly a layer of plan **[13]** Phase 2 (MapLibre), not a new engine.
- **S4** completes part of parity **L2** (noise-floor overlay).
- **S3/S5** lean on shipped analytics + [19] retention.
- Discovery (S3.4) resolves the parity audit's neighbor/discovery line: active
  discovery is present; the "GPS/name in reply" premise was a reference-tool README
  error, corrected here against firmware.

## 10. Recommended build order

1. **S1 Phase 1** (capture + `packet_receptions` + `last_hop_hex`) - the foundation.
2. **S1 Phase 2-3** (endpoint + view) - the flagship deliverable.
3. **S3** seen-repeaters table (rides on S1's data).
4. **S4** noise-floor overlay (independent, small, parity L2).
5. **S5** CSV export (independent, small).
6. **S2** geographic signal map - only after [13] MapLibre migration.
7. **S6** Geiger / signal audio - INCLUDE (user-requested); independent of S1, can
   ship early since the synthesis is already written in EU-Analyzer + DMC-Observers.
8. **S7** discovery-as-view - optional, only on request.
