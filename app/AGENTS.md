# Backend AGENTS.md

This document is the backend working guide for agents and developers.
Keep it aligned with `app/` source files and router behavior.

## Stack

- FastAPI
- aiosqlite
- Pydantic
- MeshCore Python library (`meshcore` from PyPI)
- PyCryptodome

## Code Ethos

- Prefer strong domain modules over layers of pass-through helpers.
- Split code when the new module owns real policy, not just a nicer name.
- Avoid wrapper services around globals unless they materially improve testability or reduce coupling.
- Keep workflows locally understandable; do not scatter one reasoning unit across several files without a clear contract.
- Typed write/read contracts are preferred over loose dict-shaped repository inputs.

## Backend Map

```text
app/
├── main.py              # App startup/lifespan, router registration, static frontend mounting
├── api_docs.py          # OpenAPI description/tag metadata and docs route registration
├── asgi.py              # Entry point: single-radio app, or the gateway when MESHCORE_MULTI_RADIO=true
├── gateway/             # Multi-radio mode (plan 30): registry.py (radios.json), keys.py (URL keys), supervisor.py (one worker process per radio), proxy.py (HTTP + WS pass-through), app.py (/gateway/api, /r/<key>/)
├── config.py            # Env-driven runtime settings
├── channel_constants.py # Public/default channel constants shared across sync/send logic
├── database.py          # SQLite writer connection (tx(), locked) + reader pool (readonly(), WAL, query_only) + base schema + migration runner
├── migrations/          # Schema migrations (SQLite user_version, per-version modules)
├── perf/                # Performance page self-monitoring: metrics.py (histograms), recorders.py (hot-path recorders), loopwatch.py (lag + stall watchdog), process.py (/proc stats), sampler.py (10 s ring, perf_samples), health.py, snapshot.py, middleware.py
├── snmp/                # Small SNMPv2c implementation for observer firmware nodes: ber.py (BER codec), message.py (framing), mib.py (the MeshCore OID table, single source for keys/units), client.py (async UDP GET), agent.py (read-only GET/GETNEXT/GETBULK responder, pure `handle_request` + UDP protocol), address.py (host validation, wifi.status parsing). Read-only, no dependency. LAN only, never the radio.
├── models.py            # Pydantic request/response models and typed write contracts (for example ContactUpsert)
├── version_info.py      # Unified version/build metadata resolution for debug + startup surfaces
├── repository/          # Data access layer (contacts incl. name/location history, channels, communities, messages, raw_packets, packet_receptions, relay_history, settings, fanout, push_subscriptions, repeater_telemetry, contact_telemetry, device_config_history, analyzer_names, radio_identities)
├── services/            # Shared orchestration/domain services
│   ├── messages.py              # Shared message creation, dedup, ACK application
│   ├── message_send.py          # Direct send, channel send, resend workflows
│   ├── dm_ingest.py             # Shared direct-message ingest / dedup seam for packet + fallback paths
│   ├── dm_ack_apply.py          # Shared DM ACK application over pending/buffered ACK state
│   ├── dm_path_outcomes.py      # Which route each DM attempt used + ACK/failed outcomes (plan 28 1.15)
│   ├── path_scoring.py          # meshcore-open path score port (display only, pure)
│   ├── route_suggestions.py     # DM route suggestions from heard paths, reversed + ranked (suggest only, pure)
│   ├── analyzer_path_check.py   # On-request analyzer check of suggested routes (reach + paths/inspect)
│   ├── analyzer_packet_lookup.py # On-request "who heard this": the analyzer's observers of one packet hash
│   ├── clock_drift.py           # Node clocks from advert timestamps: offset reading, mesh check of the host clock, clock-sync decision (pure)
│   ├── dm_ack_tracker.py        # Pending DM ACK state
│   ├── contact_reconciliation.py # Prefix-claim, sender-key backfill, name-history wiring
│   ├── flood_scope.py           # Firmware-version-aware flood-scope set/clear command seam
│   ├── radio_lifecycle.py       # Post-connect setup and reconnect/setup helpers
│   ├── radio_commands.py        # Radio config/private-key command workflows
│   ├── radio_stats.py           # In-memory local radio stats sampling and noise-floor history
│   ├── radio_identity.py        # Which radio feeds this install: connect registration, per-sample attribution, chart scope (plan 18)
│   ├── radio_runtime.py         # Router/dependency seam over the global RadioManager
│   ├── new_node_notify.py       # New-node WS notification batching/warm-up (plan 28 item 1.5)
│   ├── relay_reception.py       # Per-copy flood reception capture + packets x relays aggregation (plan 21 S1)
│   └── analyzer_resolution.py   # Name for an unnamed full-key contact: directory, cache, opted-in analyzers (plan 16 a)
├── radio.py             # RadioManager transport/session state + lock management
├── radio_sync.py        # Polling, sync, periodic advertisement loop
├── decoder.py           # Packet parsing/decryption
├── contact_uri.py       # meshcore:// contact links: parse/validate (ADVERT + signature), format
├── smaz.py              # SMAZ "s:<base64>" message-body decode (port of meshcore-open smaz.dart)
├── communities.py       # meshcore-open communities: HMAC-SHA256 channel keys from a 32-byte secret, QR JSON parse/format
├── packet_processor.py  # Raw packet pipeline, dedup, path handling
├── event_handlers.py    # MeshCore event subscriptions and ACK tracking
├── events.py            # Typed WS event payload serialization
├── websocket.py         # WS manager + broadcast helpers
├── security.py          # Optional app-wide HTTP Basic auth middleware for HTTP + WS
├── push/                # Web Push notification subsystem
│   ├── vapid.py                 # VAPID key generation, storage, caching
│   ├── send.py                  # pywebpush wrapper (async via thread executor)
│   └── manager.py               # Push dispatch: filter, build payload, concurrent send
├── fanout/              # Fanout bus: MQTT, webhooks, Apprise, SQS (see fanout/AGENTS_fanout.md)
├── telemetry_interval.py # Shared telemetry interval math for tracked-repeater scheduler
├── path_utils.py        # Path hex rendering and hop-width helpers
├── malformed.py         # Malformed channel message detection (gibberish text, firmware-default sender clock)
├── spam/                # Spam Guard detector (pure, no I/O, no radio): text.py, settings.py, detector.py, rules.py
├── region_scope.py      # Normalize/validate regional flood-scope values
├── region_resolver.py   # Recompute transport codes per known region to name a packet's region
├── keystore.py          # Ephemeral private/public key storage for DM decryption
├── frontend_static.py   # Mount/serve built frontend (production); applies brand_name to index.html title + site.webmanifest
├── web_manifest.py      # The PWA manifest body + request base URL (proxy headers); no database imports, the gateway uses it too
└── routers/
    ├── health.py
    ├── debug.py
    ├── radio.py
    ├── contacts.py
    ├── channels.py
    ├── messages.py
    ├── packets.py
    ├── read_state.py
    ├── rooms.py
    ├── server_control.py   # Shared helpers for repeater/room CLI flows (not an APIRouter)
    ├── settings.py
    ├── fanout.py
    ├── repeaters.py
    ├── statistics.py
    ├── unfurl.py           # GET /api/unfurl: SSRF-guarded link-preview fetch for chat
    ├── tiles.py            # /api/tiles: allow-listed map tile caching proxy + settings
    ├── push.py
    └── ws.py
```

### Chat link previews (`/api/unfurl`)

`GET /api/unfurl?url=<encoded>` fetches a URL server-side and returns OpenGraph
metadata (`{url, title, description, image, site_name}`) for the chat link-preview
card. It is gated by the `chat_url_previews` app setting (off by default) and only
called lazily when a preview card mounts. `services/url_safety.py` requires an
http(s) scheme and rejects any host resolving to an address that is not on the public internet: private, loopback, link-local, reserved, benchmarking and documentation ranges, shared address space (`100.64.0.0/10`) and site-local IPv6 (`fec0::/10`), also when written as an IPv4-mapped IPv6 address
(re-checked on each redirect). A name without an address raises `UnresolvedHostError`, a subclass of `UnsafeUrlError`. `services/unfurl.py` asks for the page uncompressed and gives no preview for a compressed answer, stops reading at 256 KiB, bounds the whole fetch with `_FETCH_DEADLINE` (12 s; the 6 s timeout is per network operation), resolves the name off the event loop, decodes with the page's charset only when it is a plain one (`_CHARSETS`, else UTF-8: some codecs take seconds on a hostile body and the decode runs on the event loop),
sends no cookies, parses metadata with the stdlib
`html.parser`, and caches results in-process. Never fetch untrusted chat URLs
without going through `assert_public_http_url`.

### Map tile cache (`/api/tiles`)

`services/tile_cache.py` holds the source allow-list (`SOURCES`). Each source has
a fixed `upstream_base`, the client URL prefixes the browser rewrites, regex
`path_patterns`, and `proxy` / `predownload` flags with the policy URL that
justifies them. `GET /api/tiles/proxy/{source}/{path}` only serves a path that
fully matches one of that source's patterns, rebuilds the upstream URL
server-side (the client never picks the host), and fetches it pinned to an IP
checked by `url_safety.resolve_public_ip`. With the cache disabled it answers
307 to the upstream. Tiles are stored under `<data dir>/tile_cache/tiles/` with
their freshness metadata; settings are `<data dir>/tile_cache/config.json` (no
DB table). `GET/PATCH /api/tiles/config`, `GET /api/tiles/stats`,
`DELETE /api/tiles/cache`, and `/api/tiles/download[/estimate]` for area
pre-download, which `check_predownload` refuses unless the source has
`predownload=True` (none does today). Adding a source: record its tile-usage
policy verdict in the comment above `SOURCES` first; never set `predownload`
for a source whose terms forbid bulk downloading.

### Antenna register (`/api/antenna-register`)

Map layer of Dutch mobile-network masts that transmit next to the 868 MHz mesh
band. Source: the public WFS behind antenneregister.nl
(`https://antenneregister.nl/mapserver/wfs/`, Antennebureau / RDI; capabilities
say `Fees: none`, `AccessConstraints: none`). `services/antenna_register.py`
pages two feature types, 2000 per page (the server cap), sorted by `ID`:
`Antennes_Groepen` (one row per antenna: `AI_ID`, `SAT_CODE`, `FREQUENTIE` as a
string such as `"816 MHz"` or `"925-934.8 MHz"`, height, bearing, power in dBW;
its geometry is a placeholder) with a loose server-side `FREQUENTIE` filter
(`4##*MHz` / `7##*MHz` / `8##*MHz` / `9##*MHz`), then `Antennes` (one row per
site: RD New `X`/`Y` and `ANT_IDS`, the `AI_ID`s on it). Only antennas
overlapping `BANDS` are kept (450: 400-470 MHz PAMR / base stations, next to
433 MHz; 700: 758-788, 800: 791-821, 900: 925-960 MHz downlinks, next to 868
MHz). Licensed amateur sites (`ZENDAMATEURS`) have no `Antennes_Groepen` rows
at all, so they are kept as sites with band `AMATEUR` and no transmitters. The register
lists some site IDs more than once (same position, one feature per antenna
group), so features are merged on ID (`collect_site_feature`) before
`build_site`. Sectors of one system + frequency are folded into one
`AntennaRegisterTransmitter` (sector count, bearings, highest mount, strongest
power). The service only serves EPSG:28992; `app/rd_new.py` converts to WGS84
(published polynomial, ~0.3 m off PDOK's own pairs). Cache table
`antenna_register_sites` (migration `_154`, transmitters as JSON;
`max_height_m`, the site's highest antenna above ground level, from `_156`
with a backfill from that JSON), replaced in full by
`AntennaRegisterRepository.replace_all_rows`; an empty result raises and keeps
the old cache. No periodic sync: `POST /sync` (202) starts a background task (a
few minutes, ~100 pages) and is a no-op while one runs; `GET /status`
(`count`, `last_synced_at`, `running`, `phase`, `fetched`, `error`);
`GET /sites/all` (what the map loads: every site as compact rows
`[id, lat, lon, bands, max_power_dbw, max_height_m]` plus `synced_at`, built
from plain tuples and kept encoded in memory until count or last sync changes,
because pydantic models for ~26k sites took 0.5-1.2 s); `GET /sites?west&south&
east&north&limit` (summaries, strongest first, `truncated`, limit up to 50000);
`GET /sites/full?west&south&east&north&limit` (full sites with transmitters,
limit up to 5000, for the zoomed-in radiation patterns); `GET /sites/{id}`
(full site, 404 when unknown).

## Core Runtime Flows

### Incoming data

1. Radio emits events.
2. `on_rx_log_data` stores raw packet and tries decrypt/pipeline handling.
3. Shared message-domain services create/update `messages` and shape WS payloads.
4. Direct-message storage is centralized in `services/dm_ingest.py`; packet-processor DMs and `CONTACT_MSG_RECV` fallback events both route through that seam.
5. `PayloadType.GROUP_DATA` (0x06, firmware `GRP_DATA`) packets are decrypted with the channel key next to `GROUP_TEXT` (`decoder.try_decrypt_group_data_with_channel_key`, plaintext `data_type(u16 LE) | data_len(u8) | blob`, mirroring `BaseChatMesh::onGroupDataRecv`) and stored by `services/messages.create_group_data_message` as a placeholder `CHAN` row with `txt_type = TXT_TYPE_GROUP_DATA` (0x40; firmware text types are 0..3). Only chunk metadata is stored: for meshcore-open image chunks (`data_type 0xAE1C`, header `sender_prefix(2) | img_id | idx<<4|total`) the text is `<Sender>: [image] id=<hex> chunks=<total>` (sender = unique contact match on the 2-byte prefix, else the prefix in upper hex); anything else is `[data] type=0x<type> len=<n> sha=<8 hex>`. The text omits the chunk index and `sender_timestamp` is NULL, so every chunk and repeat of one image reconciles onto one row via the messages dedup index, each arrival becoming a path. The blob is never persisted or decoded (the neural image codec is out of scope). Limitation: a sender that reuses an image id on the same channel merges into the old row. Before the placeholder path, `_process_group_data` hands every decrypted datagram to `services/trackers.handle_tracker_datagram`: data type `0xFF01` (TAK-MESHCORE `UVAX1|` envelope, reassembled in `services/atak_reassembly.py`, AX.25 frames to `OPENRL` decoded by `app/atak_payloads.py`), `0xFF02` (plugin control bytes, counted), `0xFFFF` 16-byte MeshCore SAR fast-GPS blobs and `0x0200` MeshCoreNG `MCL1` tracker reports (`app/meshcoreng.decode_mcl1`, source `meshcoreng`, identity = 4-byte node id hex, display name = report name, else the contact name on that prefix, else the node id) are handled there and get no placeholder row; anything else falls through. Plaintext MeshCoreNG Location packets (0x0D, same `MCL1` body) are stored the same way from `process_raw_packet` via `trackers.handle_meshcoreng_location` with `channel_key` NULL; repeats share the raw packet id, so `has_position_for_packet` keeps one fix. Positions and ATAK map objects go to `tracker_positions` / `tracker_objects` (migration `_157`, `repository/trackers.py`) and out as a WS-only `tracker` event plus `tak_stream.publish_tracker`; ATAK chat becomes a normal channel message via `create_message_from_decrypted` (or `create_fallback_channel_message` when there is no raw packet). Channel text that starts with `UVAX1|`, or carries it right after a sender name of up to 32 characters the decoder did not split off (`atak_payloads.envelope_body`; older plugin builds; a longer lead-in that only quotes one stays chat), is routed the same way from both message-creation functions and never stored as text. Repeats are dropped by a 120 s frame-hash cache, and a raw packet adds at most one position (`has_position_for_packet`); encrypted frames, pings and acks are only counted (`trackers.tracker_counters`, debug-logged, totals per kind in `GET /trackers` `counts`). A frame whose processing raises is forgotten again (`forget_frame`) so a repeat can be stored. `tracker_positions.cot_uid` holds the uid ATAK knows the user by: `ANDROID-<FULL CALLSIGN>` (the plugin's own synthetic uid) when the GPS tail carried the full callsign, the CoT uid for CoT PLI, else NULL; the TAK Stream then uses `RTFM-EV-ATAK-<identity>` (MeshCoreNG: `RTFM-EV-NG-<node id>`, SAR: `RTFM-EV-SAR-<key prefix>`). One identity heard both by GPS TLV and by CoT PLI can carry two different uids; the stream follows the newest fix, so ATAK may briefly show two markers. Historical channel decryption (`routers/packets.py`) routes GRP_DATA through the same handler with `DatagramContext.realtime=False` (no fanout, push or TAK Stream push); tracker raw packets stay unlinked (`message_id` NULL).
6. Incoming SMAZ bodies (`s:<base64>`, sent compressed by meshcore-open) are decoded before storage by `app/smaz.py`: in `_store_direct_message` for incoming non-CLI DMs and in `create_message_from_decrypted` / `create_fallback_channel_message` for channel text (the part after `Sender: `). Stored text, mentions, reaction hashes and fanout all see the decoded text. A body is only decoded when it is valid base64/base64url, a complete stream, valid UTF-8, byte-identical to what the meshcore-open encoder produces, and shorter than the decoded text (the encoder only compresses when it saves bytes); anything else is stored unchanged. Outgoing echoes are never decoded. The raw-packet decoder (`decoder.py`, packet feed/analyzer views) still shows the `s:` form.

### Outgoing messages

1. Send endpoints in `routers/messages.py` validate requests and delegate to `services/message_send.py`.
2. Service-layer send workflows call MeshCore commands, persist outgoing messages, and wire ACK tracking.
3. Endpoint broadcasts WS `message` event so all live clients update.
4. ACK/repeat updates arrive later as `message_acked` events.
5. DM failed state: `_retry_direct_message_until_acked` retries up to `DM_SEND_MAX_ATTEMPTS` (final attempt flood), then waits one more ACK window. With still no ACK it sets `messages.failed_at` (migration 109, `MessageRepository.mark_failed`, only when `outgoing = 1 AND acked = 0`) and broadcasts `message_failed`. Every ACK code the message was sent with stays matchable for `dm_ack_tracker.FAILED_ACK_GRACE_SECONDS` (30 s): a late ACK in that window goes through `apply_dm_ack_code` as usual, `increment_ack_count` clears `failed_at`, and `message_acked` flips the UI to delivered. A later ACK is buffered like any unmatched ACK and the message stays failed. DMs whose first send returned no `expected_ack` never schedule retries, so they are never marked failed.
6. DM manual retry (`POST /messages/direct/{id}/resend`): only for an outgoing PRIV row with `failed_at` set and `acked = 0` (else 409). Sends the stored text again through `send_direct_message_to_contact` (fresh timestamp, new ACK code, normal background retries), then deletes the failed row and broadcasts `message_deleted`. If the new send fails the failed row stays. No byte-perfect DM resend exists.
7. Channel resend (`POST /messages/channel/{id}/resend`) and the echo watchdog strip the sender prefix with `_channel_message_body`: the stored `sender_name` first (the name the radio had at send time), then the current radio name. A message sent before a rename therefore does not put the old prefix on air as body text. A `new_timestamp=true` resend stores its new row under the current radio name.
8. Unknown send outcome: when the radio gives no response to a send command the packet may or may not be on air, so the row is kept. `messages.send_status` (migration `_134`) is `pending` while a channel row waits for the radio's answer, `confirmed` once accepted, `unknown` when the radio never answered. DM, channel send and `new_timestamp` resend all keep the row as `unknown`, broadcast it, and still raise 422 with `NO_RADIO_RESPONSE_AFTER_SEND_DETAIL` (`_is_unknown_send_outcome` keys on that detail). A radio ERROR result or any other exception still deletes the row. `increment_ack_count` sets `confirmed`, so a heard echo or an ACK settles it.

### Connection lifecycle

- `RadioManager.start_connection_monitor()` checks health every 5s.
- meshcore reconnects a dropped transport by itself within about a second (`auto_reconnect=True`), which the 5s poll usually does not see. `RadioManager.connect()` therefore subscribes to `EventType.CONNECTED` and sets `library_reconnect_pending` on an event with `reconnected: true`; the monitor then re-runs post-connect setup. Setup clears the flag when it starts, so a reconnect during setup triggers one more run. Without this a rebooted radio keeps running on its boot state: the flood-scope override (`CMD_SET_FLOOD_SCOPE`) lives in radio RAM only, so the radio sends with its stored default scope instead of the app's "Flood Scope / Region".
- `RadioManager.post_connect_setup()` delegates to `services/radio_lifecycle.py`.
- Routers, startup/lifespan code, fanout helpers, and `radio_sync.py` should reach radio state through `services/radio_runtime.py`, not by importing `app.radio.radio_manager` directly.
- Shared reconnect/setup helpers in `services/radio_lifecycle.py` are used by startup, the monitor, and manual reconnect/reboot flows before broadcasting healthy state.
- Setup first records the connected radio in `radio_identities` (`services/radio_identity.register_connected_radio`, key from `mc.self_info["public_key"]`; never raises). The stats sampler files each sample under that radio and skips samples from a radio that is not registered yet, so a swapped radio never blends into the previous one's series.
- Setup still includes handler registration, key export, time sync, contact/channel sync, and advertisement tasks. The message-poll task always starts: by default it runs as a low-frequency hourly audit, and `MESHCORE_ENABLE_MESSAGE_POLL_FALLBACK=true` switches it to aggressive 10-second polling. That audit checks both missed-radio-message drift and channel-slot cache drift; cache mismatches are logged, toasted, and the send-slot cache is reset.
- Post-connect setup is timeout-bounded. If initial radio offload/setup hangs too long, the backend logs the failure and broadcasts an `error` toast telling the operator to reboot the radio and restart the server.

## Important Behaviors

### Multibyte routing

- Packet `path_len` values are hop counts, not byte counts.
- Hop width comes from the packet or radio `path_hash_mode`: `0` = 1-byte, `1` = 2-byte, `2` = 3-byte.
- Channel slot count comes from firmware-reported `DEVICE_INFO.max_channels`; do not hardcode `40` when scanning/offloading channel slots.
- Channel sends use a session-local LRU slot cache after startup channel offload clears the radio. Repeated sends to the same channel reuse the loaded slot; new channels fill free slots up to the discovered channel capacity, then evict the least recently used cached channel.
- TCP radios do not reuse cached slot contents. For TCP, channel sends still force `set_channel(...)` before every send because this backend does not have exclusive device access.
- `MESHCORE_FORCE_CHANNEL_SLOT_RECONFIGURE=true` disables slot reuse on all transports and forces the old always-`set_channel(...)` behavior before every channel send.
- Contacts persist canonical direct-route fields (`direct_path`, `direct_path_len`, `direct_path_hash_mode`) so contact sync and outbound DM routing reuse the exact stored hop width instead of inferring from path bytes.
- Direct-route sources are limited to radio contact sync (`out_path`) and PATH/path-discovery updates. This mirrors firmware `onContactPathRecv(...)`, which replaces `ContactInfo.out_path` when a new returned path is heard.
- `route_override_path`, `route_override_len`, and `route_override_hash_mode` take precedence over the learned direct route for radio-bound sends.
- Advertisement paths are stored only in `contact_advert_paths` for analytics/visualization. They are not part of `Contact.to_radio_dict()` or DM route selection.
- `contact_advert_paths` identity is `(public_key, path_hex, path_len)` because the same hex bytes can represent different routes at different hop widths.
- `contact_path_outcomes` (migration `_115`, `ContactPathOutcomeRepository`) is the scored path history (plan 28 item 1.15): one row per `(public_key, path_hex, path_len)` a DM was sent on (`path_len` -1 = flood, 0 = direct neighbour) with attempts, successes, failures, trip times and a meshcore-open route weight. `services/dm_path_outcomes.py` is fed by `message_send` (`record_attempt` after every `send_msg`, route read from the radio's contact record `out_path`/`out_path_len`), by `dm_ack_apply` / the immediate-match branch (`record_ack`: last attempt gets the send-to-ACK trip time) and by `_mark_direct_message_failed` (`record_failed`: one failure per distinct route). `services/path_scoring.py` ranks the rows for `GET /contacts/analytics` (`path_scores`). Display only: nothing reads it for routing. Recording errors are swallowed so a send never fails because of it.
- Route suggestions (`services/route_suggestions.py`, `GET /contacts/{public_key}/route-suggestions`) turn the paths a contact was heard on into candidate DM routes: advert paths (`contact_advert_paths`) plus the paths incoming DMs arrived on (`messages.paths`, 0-hop entries skipped because a direct-routed DM also arrives with an empty path), hop order reversed, merged per `(route, hop count, hop width)` and ranked by freshness, times heard, hop count and `contact_path_outcomes` delivery (weights 0.35 / 0.2 / 0.15 / 0.3), top 5. Suggest only: a route is used only when the user sets it through `routing-override`. Channel messages are not a source (sender matched by name).
- `services/analyzer_path_check.py` checks those suggestions against an analyzer, only when the request passes `validate=true`: `GET {host}/api/nodes/{pubkey}/reach` (contact neighbours with per-direction counts) and `POST {host}/api/paths/inspect` (hop prefixes, at most 8) on the host of `external_map_sync_url`. It sends the contact's public key and the hop prefixes there. The verdict (`confirmed` / `partial` / `unconfirmed` / `not_checked`) never changes the ranking and never adds a route that was not heard locally; an analyzer failure leaves the suggestions intact and sets `validation_error`.
- `contacts.flags` mirrors the radio's `ContactInfo.flags`: bit 0 is the radio favourite bit, bits 1-3 are the firmware `TELEM_PERM_*` bits (base, location, environment) that the companion reads as `flags >> 1` when a telemetry mode is Per-Contact. `ContactUpsert.flags=None` keeps the stored value, so advert/DM upserts never zero it; a radio snapshot writes the radio's value.
- `contacts.telemetry_perms` (migration `_106`, nullable) is the app-set permission value and wins over the radio: `Contact.to_radio_dict()` overlays it on `flags`, and `sync_contacts_from_radio` pushes it with `change_contact_flags` to any radio contact whose bits differ. `NULL` means never set in the app, so the radio's bits are kept.

### Read/unread state

- Server is source of truth (`contacts.last_read_at`, `channels.last_read_at`, each with a `last_read_message_id` cursor, migration `_133`).
- A message is unread when `received_at > last_read_at`, or `received_at = last_read_at AND id > last_read_message_id`. `last_read_at` alone has one-second resolution, so without the cursor a message arriving in the second of the mark never counted as unread. `update_last_read_at(key, timestamp)` and `mark_all_read` set the cursor to the newest message at or before the timestamp; prefix-contact promotion carries it along with `last_read_at`.
- `POST .../mark-read?message_id=<id>` (`update_last_read_at(..., message_id=)`) advances through that exact message only, and only forward (compares `(received_at, id)` tuples). The client uses it for messages arriving in the open conversation, so a delayed request cannot consume newer arrivals or move the cursor back. 400 when the message is not part of that conversation.
- `GET /api/read-state/unreads` returns counts, mention flags, `last_message_times`, `last_read_ats`, and `first_unread_ids`.
- Unread counts, mention flags, `first_unread_ids` and `last_message_times` exclude incoming messages from blocked keys/names and messages hidden by the chat "Hide by hop size" filter (`app_settings.hidden_hop_widths`, migration `_121`; `MessageRepository._build_hidden_hop_width_clause`). A message is hop-hidden when ANY stored path has a per-hop byte width in the list (width derivable only when `path_len` > 0 and the hex is exactly `path_len` hops of 2/4/6 chars, `path_utils.stored_path_hop_width`), the same rule as the frontend's `isMessageHiddenByHopWidth`.
- The same four exclude incoming messages flagged as malformed when the chat "Hide malformed" filter is on (`app_settings.hide_malformed`, `messages.malformed`, migration `_129`; `MessageRepository._build_hidden_malformed_clause`). The flag is set once at ingest by `app/malformed.py` (`is_malformed_channel_message`) in `create_message_from_decrypted` and `create_fallback_channel_message`, on the body after `Sender: ` and after SMAZ decode: no ASCII letter or digit plus an invalid code point, letters from two or more script families, or letters next to box-drawing characters; or a sender timestamp within 30 days of the MeshCore default RTC epoch (1715770351) on a message received more than a week later. Migration `_129` backfills existing incoming channel text. Flagged messages are stored, broadcast and returned by the message APIs with `malformed: true`; nothing is dropped. GRP_DATA placeholders, DMs and outgoing messages are never flagged. A GroupText whose plaintext is not valid UTF-8 is still dropped by `decrypt_group_text` before this point and never becomes a message.
- The same four exclude incoming messages Spam Guard flagged when the chat "Hide spam" filter is on (`app_settings.hide_spam`, `messages.spam`, migration `_137`; `MessageRepository._build_hidden_spam_clause`). Web Push skips them too (`app/push/manager.py`), and so does the Ollama unread summary (`MessageRepository.get_latest_since(hide_spam=...)`). The flag can change after ingest (`MessageRepository.set_spam`, WS `message_spam`).
- Senders on an enabled bot list are hidden the same way while "Hide bots" is on (`app_settings.hide_bots`, migration `_142`). `bot_lists.hidden_senders(settings)` (`services/bot_lists.py`) is the one place that decides it: it returns the user's blocked keys and names plus, with `hide_bots` on, the effective set of the enabled lists. Unread counts (`routers/read_state.py`), Web Push (`push/manager.py`), the Ollama unread summary (`routers/channels.py`), shared locations and team beacons take their `blocked_keys` / `blocked_names` from it. The message list, jump-to-message and search (`routers/messages.py`) still take the user's own block lists only: the chat view filters listed senders in the browser. A hidden name is matched as chat shows it: `MessageRepository._build_blocked_incoming_clause` also matches a channel row stored with `sender_name` NULL (the decoder rejects a name with `[` or `]`) by the `Sender: ` prefix of its text, the rule of `reaction_payloads.channel_sender`, and `push/manager.py` `_is_blocked` does the same. That builder is shared with Blocked contacts.
- `first_unread_ids` maps stateKey -> id of the oldest unread message, so the client can anchor the unread divider (and jump to it) without paging back through history. It is computed with `ROW_NUMBER() OVER (PARTITION BY type, conversation_key ORDER BY received_at, id)` - deliberately not `MIN(received_at)` with a bare id, because sender timestamps are whole seconds and same-second ties are routine, and not `MIN(id)`, because historical decryption inserts old messages with new ids.
- `POST /contacts/{public_key}/mark-unread` and `POST /channels/{key}/mark-unread` (`{message_id}`) mark a conversation unread from a given message onward, by setting `last_read_at = message.received_at - 1`. The message must be an incoming (`outgoing = 0`) message belonging to that conversation (404/400 otherwise). Same server-side, shared-across-browsers model as mark-read.

### DM ingest + ACKs

- `services/dm_ingest.py` is the one place that should decide fallback-context resolution, DM dedup/reconciliation, and packet-linked vs. content-based storage behavior.
- `CONTACT_MSG_RECV` is a fallback path, not a parallel source of truth. If you change DM storage behavior, trace both `event_handlers.py` and `packet_processor.py`.
- DM ACK tracking is an in-memory pending/buffered map in `services/dm_ack_tracker.py`, with periodic expiry from `radio_sync.py`.
- Outgoing DMs send once inline, store/broadcast immediately after the first successful `MSG_SENT`, then may retry up to 2 more times in the background only when the initial `MSG_SENT` result includes an expected ACK code and the message remains unacked.
- DM retry timing follows the firmware-provided `suggested_timeout` from `PACKET_MSG_SENT`; do not replace it with a fixed app timeout unless you intentionally want more aggressive duplicate-prone retries.
- Direct-message send behavior is intended to emulate `meshcore_py.commands.send_msg_with_retry(...)` when the radio provides an expected ACK code: stage the effective contact route on the radio, send, wait for ACK, and on the final retry force flood via `reset_path(...)`.
- Non-final DM attempts use the contact's effective route (`override > direct > flood`). The final retry is intentionally sent as flood even when a routing override exists.
- Outgoing DM sender timestamps are made unique per *text across all recipients* (`allocate_outgoing_sender_timestamp`): the firmware ACK code is sha256(timestamp, attempt, text, sender pubkey) and does not include the recipient, so the same text to two contacts in the same second would otherwise share an ACK code. Channel timestamps stay unique per channel.
- DM ACK state is terminal on first ACK. Retry attempts may register multiple expected ACK codes for the same message, but sibling pending codes are cleared once one ACK wins so a DM should not accrue multiple delivery confirmations from retries.
- ACKs are delivery state, not routing state. Bundled ACKs inside PATH packets still satisfy pending DM sends, but ACK history does not feed contact route learning.
- DM ACKs are matched from two independent radio emissions, so confirmation does not depend on the radio surfacing a host control frame: (1) the `EventType.ACK`/`SEND_CONFIRMED` host frame via `event_handlers.on_ack`, and (2) the raw RF packet itself via `packet_processor.process_raw_packet`. The packet processor extracts ACK codes both from PATH-return packets (flood replies, ACK embedded in `extra`) and from standalone `PayloadType.ACK` packets (direct replies, 4-byte cleartext payload), feeding both into `apply_dm_ack_code`. This matters for companion firmwares (e.g. pyMC over TCP) that do not reliably emit a separate host ACK frame for direct-routed replies.
- FUOTA: payload type 0x0E is not in `PayloadType`, so `parse_packet` returns None. `process_raw_packet` then tries `app/fuota.py:detect_fuota` (meshcore_fuota draft: version 0, DIRECT, 0 hops, payload byte 0 = kind 1-4 with fixed lengths) and stores a match as `payload_type = "FUOTA"` with DIRECT / 0-hop stat fields and no "Failed to parse" warning; nothing else runs on it. `GET /api/packets/fuota-traffic` (`repository/fuota_traffic.py`) re-parses those rows and groups them by campaign for the Mesh Health "Firmware updates" tab. `frontend/src/utils/fuotaPayload.ts` mirrors the detector; keep both in step. Multi-byte fields are read little-endian (assumed: the draft states no byte order).
- MeshCoreNG: after the FUOTA check, `app/meshcoreng.py:meshcoreng_kind` recognises 0x0D Location (`MCL1` magic, version 1, exactly 32 + name bytes) and 0x0C Atlas (DIRECT, 0 hops, subtype 1-4 with exact lengths) and ingest stores them as `MESHCORENG` with route/hop fields from the envelope. `path_utils.bucket_region_scope` skips valid MeshCoreNG packets when it counts the 0x0C-0x0E noise floor. The frontend mirror and the CubeCell / RAW_CUSTOM labels live in `frontend/src/utils/thirdPartyPackets.ts` (labels only; RAW_CUSTOM and CONTROL storage is unchanged).

### Server login route escalation

`prepare_authenticated_contact_connection` (`routers/server_control.py`, shared by repeater and room login) sends one login over the contact's effective route. If that draws **no reply at all**, it calls `reset_path(...)` and retries exactly once as flood.

This is intentionally *more* than the reference implementations do - do not "correct" it back to single-shot:
- Firmware `BaseChatMesh::sendLogin` picks flood only when `out_path_len == OUT_PATH_UNKNOWN` and never retries; `CMD_SEND_LOGIN` calls it once.
- `meshcore_py` has `send_msg_with_retry` (with `flood_after` + `reset_path`) but no login equivalent - `send_login`/`send_login_sync` are single-shot.
- Firmware only clears a stale path when the *host* asks (`CMD_RESET_PATH`); client-side path learning is otherwise passive via `onContactPathRecv`.

Escalating is still correct because the **server** side treats an inbound flood as its cue to relearn the return path (`simple_repeater`/`simple_room_server`: `if (is_flood) client->out_path_len = OUT_PATH_UNKNOWN`). A flood login is therefore what repairs a broken route in both directions, and login gates the whole repeater dashboard.

Escalation is bounded to one extra attempt and only fires when:
- the first attempt **timed out**. `LOGIN_FAILED` means the server heard us and refused, so the route is fine and retrying only hammers it with bad credentials; a send error is a local radio problem a different route will not fix.
- the contact was **not already on flood** (`effective_route_source != "flood"`), since the retry would otherwise be byte-identical.

### Remote CLI reply correlation and redaction

- Every remote CLI command of 2+ characters is sent with a rotating `XX|` tag (two uppercase hex digits). Repeater/room `CommonCLI` (since Feb 2025) and OpenHop strip it and reflect it at the start of the reply. `fetch_contact_cli_response(expected_tag=...)` drops a reply that echoes a *different* tag (a late answer to an earlier command) and keeps waiting; untagged replies are still accepted for firmware without the echo. `extract_response_text` strips the tag before the `> ` prefix.
- CLI commands and replies are logged through `app/log_redaction.py`: `password <pw>`, `set guest.password <pw>`, `set prv.key <hex>` and the companion 1.18 secrets `set pin <n>`, `set wifi.pwd <pw>` (and the reply to `get wifi.pwd`) and meshcomod's `wifi set pwd <pw>` are masked, and the reply to any command that reads or sets one of those secrets is logged as `***` (the firmware echoes the new admin password back). A filter on the `meshcore` logger masks the library's own `send_cmd` and `run_cli_command` debug lines. The API response itself is not redacted.

### Companion command line (MeshCore 1.18)

- `app/services/companion_cli.py`: `firmware_supports_cli(ver_code, version, model)` is true for `FIRMWARE_VER_CODE >= 14` except OpenHop, and except meshcomod (always reports 27) when its version string is below 1.18 (`v1.18.0.1` and later have the command line); health exposes it as `radio_device_info.cli_supported`. `run_local_cli` wraps meshcore `run_cli_command` (`CMD_RUN_CLI_COMMAND` 66, reply `RESP_CODE_CLI_REPLY` 29). It runs on the radio and never transmits.
- meshcomod's own commands are not in that command line (it answers them with "Unknown command"): `handleMeshcomodCommand` only runs them for a DM to the command contact (below). So `POST /radio/cli` checks `routes_to_meshcomod_contact(command, ver_code, version)`: on meshcomod (`is_meshcomod`) a command whose first word is `help`, `status`, `mac`, `ota`, `wifi`, `tcp`, `ble`, `ok` or `cancel` (case-insensitive) is sent with `send_direct_message_to_contact` to the contact (`MESHCOMOD_COMMAND_CONTACT_KEY`; a stand-in `Contact` when it is not in the database yet), so the command and the replies land in the Meshcomod conversation as from the chat. `collect_meshcomod_replies` subscribes to `CONTACT_MSG_RECV` from the prefix (txt_type 0) before the send and only listens: the normal message fetch pulls the replies, the radio lock is held only for the send. It waits up to 15 s for the first reply (`wifi scan`, `ota check` go to the network), stops 1.5 s after the last, never past 20 s, and joins the replies with newlines. `ota update` / `ota url` flash inside the command handler, so the radio may only answer after the flash: those return on the first reply or, without one, with a note. Words the 1.18 command line also has (`ver`, `clock`, `get`, `set`, `reboot`, `advert`, `wifi.apply`, ...) stay on it. A reply that is still due from an earlier console command can be counted for the next one (the replies carry no correlation).
- Commands to another companion go through `POST /contacts/{key}/command` like repeater commands: `_cli_command_destination` passes the contact's type, so meshcore `send_cmd` sends txt_type 3 (`TXT_TYPE_CLI_COMMAND`) to chat contacts. Our radio needs 1.18 for that (409 otherwise). The other companion only answers when it has given us Remote CLI permission; the no-reply text says so (`server_control.no_reply_text`).
- Remote CLI permission is contact flags bit 0x10 (`REMOTE_CLI_FLAG`). `contacts.remote_cli` (migration `_150`, NULL = never set in the app) is overlaid by `Contact.to_radio_dict` and re-applied on a contact sync by `radio_sync._reapply_app_contact_permissions` together with `telemetry_perms`.
- An incoming txt_type 3 DM is a command another companion sent to our radio. It is stored (both the raw-packet path and the `CONTACT_MSG_RECV` fallback) with `messages.cli_permitted` (migration `_150`): 1 when the contact's flags had 0x10 at receive time (the radio ran it), else 0. These rows are excluded from unread counts and last-message times (`MessageRepository._build_cli_command_clause`), Web Push (`push/manager.py`) and fanout (`fanout/manager._scope_matches_message`). Our own CLI commands heard back as outgoing echoes (txt_type 1 or 3) are not stored.

### meshcomod command contact

- meshcomod lists a fake contact "Meshcomod" (key `4d455348434d` + zeros, "MESHCM") after every `GET_CONTACTS`. A `CMD_SEND_TXT_MSG` to that prefix is handled on the radio (wifi, tcp, ble, ota, status, ...), answered with `RESP_CODE_SENT` (not flood, timeout 1 ms) plus an immediate `PUSH_CODE_SEND_CONFIRMED`, and replies arrive as plain `CONTACT_MSG_RECV_V3` from the same prefix. A `CMD_ADD_UPDATE_CONTACT` with that key would store a real copy in the radio's table.
- `app/meshcomod_contact.py` (`is_meshcomod_command_contact`, no imports) is the single check. Uses: `message_send.send_direct_message_to_contact` skips `add_contact`, flood scope and background retries; `fanout/manager._scope_matches_message` and `push/manager.dispatch_message` drop its PRIV rows; `radio_sync` keeps it out of `get_radio_residency`, the background reconcile (never removed), `should_run_full_periodic_sync` capacity counting and `_reapply_app_contact_permissions`; `routers/contacts` (`_reject_meshcomod_command_contact`: trace, path discovery, routing override, telemetry permissions, remote CLI, telemetry) and `routers/repeaters` `/command` answer 409. Unread counts are kept.

### meshcomod Full capture

- Opt-in companion command `0xE0 [flags]` (1 over-long, 2 damaged, 4 drop notices; reply `00 <supported mask>`, stock firmware answers ERR) and split push `0xC0` `[tag][index<<4|count][status][snr_x4][rssi][total_len][chunk]` (Elektr0Vodka/meshcomod only). `app/full_capture.py` is the pure decoder and `Reassembler` (two parts by tag, any order, incomplete frames expire after 2 s).
- `app/services/full_capture.py`: `apply_on_connect` runs in `radio_lifecycle` for every meshcomod radio and always sends the saved flags (`app_settings.full_capture_flags`, migration `_158`; 0 is harmless) because only the reply tells whether the firmware supports it; `radio_manager.full_capture_supported_flags` (0 = unsupported) and `rx_ring_drops` are reset on connect and disconnect. On support it installs a permanent `handle_rx` wrapper (once per reader, `HOOK_ATTR`) that takes every `0xC0` frame away from meshcore_py and routes it in a task: status 0 (over-long, valid) to `process_raw_packet`; status 1-3 to `rx_bad_frames` plus a WS-only `rx_bad_frame` event (never `raw_packets`, fanout or MQTT; kept out of the `chat` WS stream); status 4 adds to `rx_ring_drops`. `rx_bad_frames` is pruned after a fixed 7 days (`retention_pruner.RX_BAD_FRAME_RETENTION_DAYS`).
- `GET/PATCH /api/radio/meshcomod` carry `full_capture_supported`, `full_capture_flags` (0-7) and `rx_ring_drops`; a PATCH saves the flags and sends `0xE0` (422 without support or when the radio refuses).

### meshcomod companion receive filter

- meshcomod's `filter` CLI (source formats in `docs/sources-of-truth.md`) is driven entirely through `run_local_cli`, so nothing transmits. `app/services/companion_filter.py` holds the reply parsers, input validation (patterns: no spaces, 15/23 bytes; path prefixes: 2-8 hex digits, whole bytes) and the radio operations. Replies are capped at 158 bytes: a list ending in `..` is clipped, its last entry is dropped and `truncated` is reported. Patterns can contain commas, so entries are walked from the start (a pattern ends at its first space).
- Detection: `radio_lifecycle` probes `filter` after device info when the CLI is supported and the radio is meshcomod; the result is `radio_manager.companion_filter_supported` (reset on disconnect) and `radio_device_info.companion_filter_supported` in health.
- Router `app/routers/companion_filter.py` (`/api/radio/meshcomod/filter`, 404 without the filter): GET, PATCH settings, POST `paths` / `paths/remove` / `rules/{sender|text}` / `rules/{kind}/remove`, `backup`, `restore`, GET `history`. Each change runs one command, raises 422 on `Failed` or an error reply, then reads the whole filter back (ten commands).
- History: the 60 s radio-stats sampler adds one `filter` call when supported and stores the cumulative counters in `companion_filter_history` (migration `_152`, in `SCOPED_STAT_TABLES`, retention class `companion_filter` on `airtime_retention_days`). `counter_deltas` treats a lower counter as a radio restart and never takes a delta across two radios.
- Backup: `companion_filter_backups` (migration `_152`), one row per radio identity. A plain read only creates the first backup, a change through the API refreshes it (but a clipped read never replaces a complete backup), `POST backup` always saves. `restore` replays `filter reset`, malformed, age, paths, rules, then on/off.

The retry deliberately does not re-run `_ensure_on_radio` - re-adding the contact would restore the route just cleared. `reset_path` clears the route on the radio only; the stored contact route is untouched, so the next `add_contact` re-stages it. That mirrors the DM retry and keeps one bad login from discarding a route that may be fine.

### Echo/repeat dedup

- Channel message uniqueness (`idx_messages_dedup_null_safe`): `(type, conversation_key, text, COALESCE(sender_timestamp, 0))` where `type = 'CHAN'`.
- Incoming PRIV message uniqueness (`idx_messages_incoming_priv_dedup`): `(type, conversation_key, text, COALESCE(sender_timestamp, 0), COALESCE(sender_key, ''))` where `type = 'PRIV' AND outgoing = 0` - `sender_key` was added in migration 056 to distinguish room-server posts from different senders in the same second.
- Duplicate insert is treated as an echo/repeat: the new path (if any) is appended, and the ACK count is incremented only for outgoing channel messages. Incoming direct messages with the same dedup identity also collapse onto one stored row, with later observations merging path data instead of creating a second DM.

### Region scope decoding (transport codes)

- `ROUTE_TYPE_TRANSPORT_FLOOD`/`ROUTE_TYPE_TRANSPORT_DIRECT` packets carry a 4-byte transport-code block; `parse_packet_envelope` exposes it as `transport_codes = (code_1, code_2)` (little-endian uint16s; `code_2` is reserved/0).
- `code_1` is a keyed MAC over the payload, not a stable per-region id: `code = HMAC-SHA256(SHA256("#" + region_name)[:16], payload_type || payload)[:2]` (firmware `TransportKeyStore.cpp`; reserved values `0x0000`/`0xFFFF` are nudged to `0x0001`/`0xFFFE`). There is **no** reverse lookup table - to name a packet's region you recompute the code per candidate region and check for a match (`app/region_resolver.py`).
- Candidate region names come from `app_settings.known_regions` (user-editable, seeded by migration 063 from `flood_scope` + channel `flood_scope_override`).
- MeshCore 1.18 treats a first transport code of 0 as the wildcard region (`RegionMap::findMatch`, #3568). `path_utils.is_scoped(transport_codes)` is the one test for "region-scoped" (codes present and code_1 != 0); use it, not `transport_codes is not None`, wherever a packet is counted or resolved as scoped.
- Channel messages persist `messages.transport_code` (uint16, NULL = unscoped plain flood) and `messages.region` (resolved name, NULL = scoped but no list match) at ingest, so the chat region badge survives raw-packet purge. The packet inspector (`GET /packets/{id}` and the `raw_packet` WS broadcast) resolves region on the fly against the current list since it still holds the raw payload.

### Region-scope adoption stats (`region_scope_24h`)

`GET /statistics` reports regional flood-scope uptake as two views with different denominators that intentionally will not agree:

- **Traffic** (`bucket_region_scope` in `path_utils.py`) counts flood-routed (`route_type` 0/1) GroupText packets across all channels, including undecryptable ones. Zero-hop/direct sends are excluded because firmware reaches them through the non-transport `sendZeroHop`/`sendDirect` overloads and they can never carry transport codes.
- **Senders** (`StatisticsRepository._region_scope_senders_24h`) counts distinct senders with at least one scoped message. Attribution requires decryption, so it only covers channels we hold keys for - narrower, but self-validating (a decrypted packet is provably not a corrupt capture) and immune to one chatty node skewing the result. Identity is `sender_key` falling back to `sender_name`; scoping reads `messages.transport_code`, falling back to the linked raw packet for rows stored before region tagging existed.

`false_positive_floor` exists because corrupt RF captures land in `raw_packets` with effectively random headers and a share of them claim `TRANSPORT_FLOOD`. (0x0E is real traffic too, meshcore_fuota, but always DIRECT without transport codes, so it never enters the floor; see FUOTA below.) That garbage spreads near-uniformly across payload-type buckets, so it is measured directly from payload types the protocol does not define (`0x0C`/`0x0D`/`0x0E`) and averaged per bucket. **A `scoped_messages` count at or below the floor is not evidence of adoption**; surface the two together and never show the percentage alone. Do not "fix" the floor by removing it - without it the metric reads several times higher than reality.

Both traffic buckets come from one 24h raw-packet scan (`_packet_shape_24h`) shared with `path_hash_width_24h`, so adding region stats costs no extra query or parse pass.

### Raw packet dedup policy

- Raw packet storage deduplicates by payload hash (`RawPacketRepository.create`), excluding routing/path bytes.
- Stored packet `id` is therefore a payload identity, not a per-arrival identity.
- Realtime raw-packet WS broadcasts include `observation_id` (unique per RF arrival) in addition to `id`.
- Frontend packet-feed features should key/dedupe by `observation_id`; use `id` only as the storage reference.
- Message-layer repeat handling (`_handle_duplicate_message` + `MessageRepository.add_path`) is separate from raw-packet storage dedup.

### Contact sync throttle

- `sync_recent_contacts_to_radio()` sets `_last_contact_sync = now` before the sync completes.
- This is intentional: if sync fails, the next attempt is still throttled to prevent a retry-storm against a flaky radio. Contacts will resync on the next scheduled cycle or on reconnect.

### Periodic advertisement

- Controlled by `app_settings.advert_interval` (seconds).
- `0` means disabled.
- Last send time tracked in `app_settings.last_advert_time`.

### New-node notifications

`app/services/new_node_notify.py` decides whether and when to broadcast the WS
`new_node` event for a public key never stored in `contacts` before (plan 28
item 1.5). It does not touch contact storage; it is a pure notification-timing
layer called from two independent "this contact is brand new" call sites,
each of which checks `existing is None` against a fresh
`ContactRepository.get_by_key` read immediately before creating the row:

- `packet_processor._process_advertisement` - a genuine RF advert for a key
  never seen before.
- `event_handlers.on_new_contact` (MeshCore `EventType.NEW_CONTACT`) - the
  radio's own auto-add from hearing an advert directly. This is distinct from
  `sync_contacts_from_radio()`'s bulk startup pull, which upserts contacts
  directly and never raises this event, so a fresh install's initial contact
  sync does not trigger notifications on its own.

A contact type with no user-facing notification checkbox (`0`/unknown) never
queues. Notifiable types are `1`/`2`/`3`/`4` (Client/Repeater/Room/Sensor),
matching `discovery_blocked_types`' codes.

Rate limiting:

- **Busy mesh batching.** Each queued node resets a quiet-period timer
  (`BATCH_QUIET_SECONDS`, 3s); the batch flushes that long after the last new
  node, or `BATCH_MAX_WAIT_SECONDS` (15s) after the first one, whichever comes
  first. A batch of exactly one node broadcasts full contact detail
  (`batched: false`, `public_key`/`name`/`type` set); more than one broadcasts
  a count + per-type breakdown only (`batched: true`, those three fields
  null, `types: {"2": 2, "4": 1}` etc.).
- **Startup warm-up.** `arm_startup_warmup()` (called once from `main.py`'s
  lifespan, after the DB connects and before the radio connects) checks
  whether `contacts` was empty; if so, notifications are suppressed for
  `STARTUP_WARMUP_SECONDS` (1 hour - deliberately generous, since existing
  mesh nodes' advert intervals are commonly minutes to hours apart) so the
  initial catch-up burst on a fresh install is silent. `suppress_for(seconds)`
  is exposed for a future bulk-import flow that runs without a process
  restart; no such endpoint exists today.

The frontend applies its own per-browser filter on top of this (master
enable + per-type checkboxes, both local-only/off by default, same model as
the existing per-conversation browser-notification toggle) - the backend
always broadcasts a truthful `new_node` event regardless of any browser's
preference, the same way `message` broadcasts do.

### Fanout bus

- All external integrations (MQTT, webhooks, Apprise, SQS) are managed through the fanout bus (`app/fanout/`).
- Configs stored in `fanout_configs` table, managed via `GET/POST/PATCH/DELETE /api/fanout`.
- `broadcast_event()` in `websocket.py` dispatches to the fanout manager for `message`, `raw_packet`, and `contact` events.
- `on_message` and `on_raw` are scope-gated. `on_contact`, `on_telemetry`, and `on_health` are dispatched to all modules unconditionally (modules filter internally).
- Repeater telemetry broadcasts are emitted after `RepeaterTelemetryRepository.record()` in both `radio_sync.py` (auto-collect) and `routers/repeaters.py` (manual fetch). Contact LPP telemetry is similarly recorded to `ContactTelemetryRepository` and dispatched to fanout.
- The telemetry collection loop in `radio_sync.py` is unified: it iterates over both `tracked_telemetry_repeaters` and `tracked_telemetry_contacts`, dispatching by list, not contact type: repeater-list entries go to `_collect_repeater_telemetry` (status) and contact-list entries to `_collect_contact_telemetry` (LPP). The contact list accepts any contact type, repeaters included, so a repeater can be on both lists and is then polled for status and LPP separately. The daily check ceiling uses the combined count.
- SNMP as a telemetry source (`contact_snmp.use_as_telemetry`, migration `_153`, `app/services/snmp_telemetry.py`): `snmp_poll.poll_contact` hands a marked node's good poll to `record_snmp_telemetry`, which writes a repeater/room row to `repeater_telemetry_history` (RF field names, `data.source = "snmp"`) when that node's newest row is at least an hour old, and broadcasts it like the RF path. `_run_telemetry_cycle` skips a repeater-list entry whose contact is marked and `is_snmp_healthy` (polling on, good poll within `max(600, 3 * interval)` s): no status, neighbour signal, region count or clock sync for it. The LPP contact list is not skipped. The interval clamp still counts every tracked node. `get_latest_telemetry` merges per field (battery, LPP temperature, SNMP chip temperature each from the newest reading that has it). `mqtt_community.on_telemetry` drops `source == "snmp"` rows unless `publish_snmp_telemetry` is on.
- The 60-second radio stats sampling loop in `radio_stats.py` dispatches an enriched health snapshot (radio identity + full stats) to all fanout modules after each sample.
- Community MQTT publishes raw packets only, but its derived `path` field for direct packets is emitted as comma-separated hop identifiers, not flat path bytes.
- See `app/fanout/AGENTS_fanout.md` for full architecture details and event payload shapes.

### Web Push notifications

Web Push is a standalone subsystem in `app/push/`, separate from the fanout module system. It sends browser push notifications for incoming messages even when the tab is closed.

- **Not a fanout module** - Web Push manages per-browser subscriptions (N browsers, each with its own endpoint and delivery state), unlike fanout which is one-config-to-one-destination.
- **VAPID keys**: auto-generated P-256 key pair on first startup, stored in `app_settings.vapid_private_key` / `vapid_public_key`. Cached in-module by `app/push/vapid.py`.
- **VAPID subject**: the JWT `sub` claim comes from `get_vapid_claims()` in `app/push/vapid.py`, configurable via `MESHCORE_VAPID_SUBJECT` (default `mailto:noreply@meshcore.local`). Apple's APNs rejects `.local` subjects with `403 BadJwtToken`, so iOS/Safari deployments must set a real `mailto:`/`https:` contact.
- **Dispatch**: `broadcast_event()` in `websocket.py` fires `push_manager.dispatch_message(data)` alongside fanout for `message` events. The manager checks the global `app_settings.push_conversations` list, skips blocked senders, muted channels, messages hidden by `app_settings.hidden_hop_widths` (`path_utils.message_hidden_by_hop_width`) and, when `app_settings.hide_malformed` is on, messages flagged `malformed`, then sends to all currently registered subscriptions via `pywebpush` (run in a thread executor).
- **Stale cleanup**: HTTP 404/410 from the push service triggers immediate subscription deletion.
- **Subscriptions stored** in `push_subscriptions` table with `UNIQUE(endpoint)` for upsert semantics.
- Requires HTTPS (self-signed OK) and outbound internet to reach browser push services.

### Multi-radio gateway (`app/gateway/`, opt-in)

With `MESHCORE_MULTI_RADIO=true`, `app.asgi:app` serves the gateway instead of the single-radio app. The gateway is the only listener on the public port. It keeps the radio list in `<data dir>/radios.json` and runs the unchanged single-radio app once per radio as a subprocess (`uvicorn app.main:app` on `127.0.0.1:<free port>`), each with its own `MESHCORE_DATABASE_PATH` and transport. Nothing in the core app knows about other radios: isolation is by process and database file.

- **Identity.** Each radio has a numeric `id` (never reused) for storage and a URL key for its workspace: the first 12 hex characters of the public key the worker reports in `/api/health` (`radio_identity.public_key`). Two radios with the same key get `-2`, `-3` in id order. A radio that never connected has no key and no workspace URL. Old keys and longer forms redirect to the current key (`keys.resolve`).
- **Routing.** `/r/<key>/<path>` is forwarded to that radio's worker with `X-Forwarded-Prefix: /r/<key>`, so the worker serves the SPA, manifest and service worker under that sub-path. An outer proxy's own `X-Forwarded-Prefix` is kept in front. Redirects are relative for the same reason.
- **Worker token.** The gateway starts each worker with a random `MESHCORE_WORKER_TOKEN` and adds it to every forwarded request (`x-rtfm-worker-token`). `WorkerTokenMiddleware` in `app/security.py` rejects anything else with 403, so a local process cannot skip the gateway's Basic auth. Basic auth itself is enforced by the gateway only; the credentials are not passed to workers.
- **Supervisor.** `WorkerSupervisor.tick()` runs every 2 s: a worker that exited is `crashed` and restarted after `min(60, 2^restarts)` seconds; a live worker is probed on `/api/health`, which sets `running` and feeds the public key to the registry. Worker output is echoed to the gateway's stdout with a `[radio <id>]` prefix and the last 500 lines are kept for `GET /gateway/api/radios/{id}/log`.
- **Shared channels** (`channel_sync.py`). Key, name and hashtag flag are the same on every radio; everything else about a channel stays per radio. Adds: `ChannelSync.reconcile()` lists `/api/channels` on every running worker and creates what is missing, on worker start (new token in the health callback), after a proxied request that can change channels (`changes_channels`), and every 30 s, which also covers channels a worker creates itself (radio sync, communities). It picks the endpoint that reproduces the channel exactly: `POST /channels` with name and key for a keyed channel, with the name only for a `#name` whose key is the name hash, and `POST /channels/import` for a hashtag channel with a custom key. Deletes cannot be inferred from a missing row, so only the two delete requests spread (`deleted_keys`): they are stored per radio in `radios.json` (`pending_channel_deletes`) until that worker has applied them, and a pending key is neither offered from nor added to that radio meanwhile. A failed add is tried once per worker run. Historical decrypt is not triggered on the other radios. If you add another way to delete channels in the core app, teach `deleted_keys` about it or the next reconcile brings the channel back.
- **Unread totals** (`unreads.py`). `UnreadsHub` keeps one `/api/ws?events=chat` connection per running worker. On an event in `REFRESH_EVENTS` (messages, channel and contact deletes; not adverts or health), on a proxied request that changes read state or settings (`changes_unreads`; marking read raises no worker event), and every 20 s, it asks that worker for `/api/read-state/unreads`, `/api/channels` (muted flags) and `/api/settings` (`mention_sound_enabled`) and publishes `{unread, dms, mentions, sound}` per radio. The counts are the worker's own, so blocked senders and the hide filters are applied once, there. `GET /gateway/api/unreads` returns the snapshot; `/gateway/ws` sends it on connect and on change as `{type: "unreads", radios}`, and `{type: "alert", radio, keys}` when a contact has more unread DMs or a channel gets its first unread mention (the first snapshot of a radio alerts nothing). The client may send `ping`.
- **Page context.** `index.html` loads `./radio-context.js` before the bundle. The build ships a no-op copy; the gateway answers `/r/<key>/radio-context.js` and `/gateway/radio-context.js` itself with `window.__RTFM_GATEWAY__ = {page, base, radio}` (`page` is `workspace` or `radios`, `radio` is `{id, name, urlKey}`), so the frontend knows the radio id synchronously. It is never proxied to a worker.
- **Radios page.** `/gateway/` serves the same frontend build (`frontend/dist`, then `frontend/prebuilt`) straight from disk; the frontend renders only the radios page there. `/` redirects to it while no radio has a workspace. 503 when no build exists. `GET /gateway/site.webmanifest` is the manifest of the radios page (`app/web_manifest.py`): it opens on `gateway/` and its scope is the gateway root, so an app installed from there covers every `/r/<key>/`. A workspace's own manifest comes from its worker and has that radio as scope.
- **Gateway API** (not under `/api`, which belongs to the workers): `GET/POST /gateway/api/radios`, `PATCH/DELETE /gateway/api/radios/{id}` (`delete_data=true` removes only `<data dir>/radios/<id>/`), `POST /gateway/api/radios/{id}/start|stop|restart`, `GET /gateway/api/radios/{id}/log`. The BLE PIN is never returned.
- Do not import `app.main` or `app.database` from `app/gateway/`: the gateway must not open a radio or a database itself. That also rules out `app.frontend_static` (it reads the brand name from the database); the manifest code lives in `app/web_manifest.py` for that reason.

### Performance self-monitoring (`app/perf/`)

The Performance page reads the backend's own state. Everything is in memory and bounded; one row per minute goes to `perf_samples` (migration `_159`, 30 days, pruned by the sampler).

- **Recorders** (`recorders.py`, one module-level instance each): `loops`, `pipeline`, `db_calls`, `radio_ops`, `outputs`, `routes`, `log_tail`. Every `record` is wrapped in `metrics.safe` and must never raise into the code it measures. Per-key tables are capped at 300 keys.
- **Hooks:** `process_raw_packet` (stage timings parse / store / process / broadcast), `Database.tx()` and `readonly()` (wait and hold time per calling function, found by `caller_name()`, which skips `database.py`, `contextlib` and `app/perf/` frames), `RadioManager.radio_operation()` (lock wait and hold per operation name) and `reconnect()`, `FanoutManager._run_handler()` (per module: ok / timeout / error), `PerfRouteMiddleware` (`/api` HTTP requests by `scope["route"].path`; `/api/ws` and static files skipped), and `PerfLogHandler` on the root logger (last 200 WARNING+ records).
- **Background loops:** wrap one iteration (not the sleep) in `with perf_loops.tick("<name>", every_s):` (`from app.perf.recorders import loops as perf_loops`). `every_s=None` for an on-demand loop. Overdue = not running and `now - last_start > max(2 * every, every + 60)`. A new long-running loop should get a tick, or it is invisible on the page.
- **Event loop:** `loopwatch.LoopWatch` beats every 100 ms; a daemon thread checks every 50 ms and, when the beat is more than 180 ms late, reads `sys._current_frames()` for the loop thread plus `asyncio.current_task(loop)`. Each lag of 100 ms or more is a stall with that stack; 1 s or more is also logged.
- **Process:** `process.process_stats()` uses `time.process_time()` for CPU (share of one core) and `/proc/self/status`, `/proc/self/fd`, `/proc/meminfo`, cgroup `memory.max` for the rest; `None` off Linux. No psutil.
- **Health** (`health.evaluate`): `ok` / `degraded` / `critical` with stable reason keys (`loop_overdue`, `loop_failing`, `stall` (>= 500 ms in 5 min), `lag_high` (p95 >= 100 ms), `output_error`, `radio_disconnected`, `memory_high` (>= 90% of the limit, critical)). The frontend words them as `perf_reason_<key>`.
- The sampler, the watchdog and the log handler start in the lifespan before the database opens (watchdog, log handler) or right after it (sampler) and stop at shutdown.

## API Surface (all under `/api`)

### Health
- `GET /health`
  - `radio_identity`: the active (most recently connected) radio `{id, public_key, name, status, pending_reason, owned_keys}` or null. `status: "pending"` drives the connect-time prompt; `owned_keys` (the radio plus predecessors linked with `carry_owned`) drive the sidebar Owned section.

### Performance
- `GET /perf/snapshot`: `{generated_at, health, process, latest, loop, tasks, asyncio_tasks, pipeline, database, radio, outputs, routes, logs}`.
- `GET /perf/history?range=live|15m|1h|6h|24h|7d|30d`: `{range, step_s, points}`. Up to `1h` from the 10 s ring; longer ranges from `perf_samples`, bucketed to at most 720 points (`avg` for cpu / lag p50 / pkts, `max` for the p95s, rss and tasks, `sum` for stalls and warnings). Unknown range: 422.

### Radio identities (plan 18)
- `GET /radio-identities` - `{radios, has_unassigned_history}`, newest connect first
- `POST /radio-identities/{id}/confirm-new` - answer "new radio" for a pending `new_key` radio
- `POST /radio-identities/{id}/replace` - `{old_id, carry_stats, carry_owned, carry_note}`: this radio replaces `old_id`; confirms it
- `POST /radio-identities/{id}/legacy-history` - `{adopt}`: whether samples recorded before radio tracking belong to this radio
- `PATCH /radio-identities/{old_id}/link` - change the carry-over flags; `DELETE /radio-identities/{old_id}/link` - undo a replacement
- `PATCH /radio-identities/{id}` - `{notes}`
- `DELETE /radio-identities/{id}?delete_stats=false` - remove a radio that is not the current one (409 for the active radio). `delete_stats=true` deletes its `battery_history` / `noise_floor_samples` / `airtime_history` rows; the default keeps them with `radio_identity_id` NULL (unassigned). A replacement link that pointed at the removed radio is cleared. Contacts, messages and packets are not touched. Returns `{"status": "ok"}`
- 404 unknown id, 409 wrong state (already answered, self link, radio already replaced, second predecessor, loop, removing the current radio). Every change broadcasts `health`. Nothing here touches the radio.

### Debug
- `GET /debug` - support snapshot with recent logs, live radio probe, slot/contact audits, and version/git info

### Radio
- `GET /radio/config` - includes `path_hash_mode`, `path_hash_mode_supported`, advert-location on/off, `multi_acks_enabled`, and read-only `client_repeat_enabled` (`null` if firmware doesn't report it, fw ver < 9) / `client_repeat_allowed_freqs` (kHz ranges from `get_allowed_repeat_freq`, cached per connect; `null` if not queried)
- `PATCH /radio/config` - may update `path_hash_mode` (`0..2`) when firmware supports it, and `multi_acks_enabled`. A `radio` block update (fw ver >= 9) always re-sends the device's current client-repeat state to `set_radio` explicitly (firmware treats a missing repeat byte as 0 and persists that - see `app/services/radio_commands.py`), then re-queries device info; returns `409` if repeat is currently on and the new frequency isn't in the cached allowed-repeat-frequency list. RTFM-EV never sends `repeat=1` itself; there is no UI to enable it yet
- `GET /radio/private-key` - export in-memory private key as hex (requires `MESHCORE_ENABLE_LOCAL_PRIVATE_KEY_EXPORT=true`)
- `PUT /radio/private-key`
- `GET /radio/contact-uri` - this node's `meshcore://` contact link (`{uri, public_key}`) via `export_contact()` with no key (CMD_EXPORT_CONTACT). Local radio command, nothing transmitted; 502 if the radio returns no valid signed advert
- `GET /radio/default-flood-scope` - the radio's own configured default region (companion `CMD_GET_DEFAULT_FLOOD_SCOPE` 64: `{supported, scope_name, scope_key}`; `supported=false` when the firmware answers ERROR, `scope_name=null` when no default is set). This is the firmware setting, not the per-send override RTFM-EV applies via `services/flood_scope.py` (`CMD_SET_FLOOD_SCOPE`); Settings > Radio shows it read-only under "Flood Scope / Region" with a hint when the two differ. Local command, nothing transmitted
- `GET /radio/gps`, `PATCH /radio/gps` - GPS on/off + report interval via the generic custom-vars commands (`app/services/meshcomod.py` `read_gps_settings`/`apply_gps_update`). Not meshcomod-gated: the `gps` custom var is part of the stock MeshCore companion firmware too (`ENV_INCLUDE_GPS` build flag + runtime GPS detection), so this works for any radio that reports it. `GET/PATCH /radio/meshcomod` reuse the same helpers for its combined CAD+GPS response
- `POST /radio/advertise` - manual advert send; request body may set `mode` to `flood` or `zero_hop` (defaults to `flood`)
- `POST /radio/discover` - short mesh discovery sweep for nearby repeaters/sensors
- `POST /radio/discover-regions` - sweep nearby repeaters via the guest anon regions request; aggregates flood-allowed region names into a deduped union for merging into `known_regions` (direct-routed, so only in-range repeaters answer; optional `public_keys`, else recent repeaters)
- `GET /regions/sync` - server-side fetch of the configured `region_sync_url` (an analyzer regions endpoint returning a bare `{code, name}` array); maps each entry to `name || code`, dedupes, drops the `*` wildcard, and returns `{regions: [...]}` for additive merge into `known_regions` (mirrors `GET /registry/sync`; 400 if unset, 502 on unreachable/non-array)
- `POST /contacts/{key}/resolve-name?force=` / `POST /contacts/resolve-names?limit=` - plan 16 case (a) analyzer name resolution for contacts with a full public key but no name (`app/services/analyzer_resolution.py`): the synced analyzer directory (`external_map_nodes`) first, then the `analyzer_resolved_names` cache (migration `_117`; positive 7 d / negative 1 d TTL), then one GET per `AnalyzerSite` with `resolution_enabled` and a `node_api_url_template` (`{pubkey}` substituted; the name is read from `name` or `stat.name` / `node.name` / `data.name` ...). A found name is applied with `ContactRepository.set_name_if_empty` (a real advert's name is never overwritten), recorded in name history and broadcast as a contact update. Statuses: `resolved`, `already_named`, `not_found`, `no_sources`. Case (b) (hop-hash probing) is not built.
- `GET /registry/wordlist-sync`: server-side fetch of the configured `wordlist_sync_url` (a JSON array of candidate channel-name strings); filters to strings, caps at 100k entries, and returns `{words: [...]}` for the browser channel finder to merge into its bundled wordlist (mirrors `GET /registry/sync`; 400 if unset, 502 on unreachable/non-array/oversized)
- `POST /radio/trace` - send a multi-hop trace loop through known repeaters and back to the local radio
- `POST /radio/cli` - body `{command}` (2 to 160 chars): run a command on the radio's own command line (companion firmware 1.18+), returns `{command, reply}`. 409 when the firmware has no command line, 502 on an error frame. Local, nothing transmitted. On meshcomod its own commands (`ota`, `wifi`, `tcp`, `ble`, `help`, `status`, `mac`, `ok`, `cancel`) go to the Meshcomod command contact as a DM and the reply is the DMs it answers with (see Companion command line)
- `POST /radio/disconnect`
- `POST /radio/reboot`
- `POST /radio/reconnect`

### Host repeater (plan 29, shadow and armed mode)
RTFM-EV judges received frames as a repeater would; shadow mode never transmits, armed mode forwards through `services/host_repeater_tx.py` (the only host repeater module that may import the radio; the engine and runtime keep their no-radio boundary, test-enforced). Arming needs env switch + admin switch + capability checks + `confirm`; it always starts disarmed and auto-disarms on disconnect, firmware repeat on, identity/modulation change, send errors, measured duty over the sub-band limit, or a stuck queue. Pure engine `services/host_repeater_engine.py` (MeshCore `Mesh.cpp` rules, repeater gates, DMC filter, OpenHop policy via `services/host_repeater_policy.py`; must not import the radio, radio commands or meshcore, `tests/test_host_repeater_api.py` enforces it). Settings model `services/host_repeater_settings.py` (strict, `extra=forbid`), stored as one versioned JSON row in `host_repeater_config` (migration `_112`, `repository/host_repeater.py`). Runtime `services/host_repeater.py`: `pre_observe` + `observe` are called from `event_handlers.on_rx_log_data` around `process_raw_packet` (pending ACK codes are read before the processor consumes them); `on_stats_sample` from the radio stats loop. Radio facts come in as a `RadioSnapshot` from `services/host_repeater_link.py`, the only module that reads the radio manager (cached state only). Session stats are in memory; lifetime totals (`LifetimeStats`) persist in `host_repeater_stats` (migration `_114`, `HostRepeaterStatsRepository`), flushed from the RX path at most once a minute, at shutdown (`host_repeater.stop()` in `main.py`) and on reset. Score-based delays (Phase 4): `observe()` asks the engine for `rx_delay_ms(raw, snr)` (repeater `rxdelay`: `packet_score` = firmware `packetScoreInt`, `rx_delay_ms` = `MyMesh::calcRxDelay`, floods only, 0 = off) and holds the frame in an asyncio task before judging it (the firmware's delayed inbound queue: a neighbour's relay judged meanwhile makes the held copy a duplicate, counted as `rx_delay.yielded`); `use_score_for_tx` scales the retransmit delay inside the engine. `AdvertLimiter` (OpenHop token bucket per advert public key, no penalty box / adaptive tiers) runs last for flood adverts (`advert_rate`). OpenHop radios are skipped. Region map: `settings.regions` (name without `#`, parent, `deny_flood`) + `home_region`; the engine matches transport codes against this list itself (`region_resolver.compute_transport_code`), not against `known_regions`. A transport code of 0 counts as unscoped (`path_utils.is_scoped`): it obeys `unscoped_flood_allow`, the wildcard gate and `flood_max_unscoped` like a plain flood (Dutch-MeshCore/MeshCore#22). DMC region gating: `AirtimeBudget` (dmc-dev budget bucket) fed by would-forward airtime and `add_own_tx` (radio `tx_air_secs` deltas); pending 10 s gate checks are replayed on each engine call. The legacy `region_rules` field is converted in a `mode="before"` validator, because `load()` falls back to defaults on a validation error. Policy rule extensions (jhuebert/MeshCore repeater filter parity, `FILTER.md`): fields `channel_name` (from the decrypt result, via `RxFacts.channel_name`), `region` (`unscoped` for plain floods and transport code 0, the resolved name for scoped ones, `None` for direct), `path_first` / `path_last` / `path_string`; operator `matches` (Python `re.search`, pattern validated and capped at `MAX_REGEX_LENGTH` 128 at save time, compiled through a bounded cache); `then.prob` (deterministic roll from sha256(rule id, packet hash)) and `then.throttle_seconds` + `then.throttle_key` (`PolicyState` owned by the engine, one free pass per window, reset with `reset_state()`). A rule that steps aside (failed roll or within its throttle budget) is skipped and reported in `PolicyDecision.passes` / `Decision.policy_passes`. Drops for `SAVED_AIRTIME_REASONS` (policy and DMC filter drops, `advert_rate`) carry `Decision.saved_airtime_ms` (airtime of the frame we would have re-sent); the runtime sums it per reason and per rule (`saved_airtime_*`, `policy_passes`, in session and lifetime stats). DMC filter sync with `dmc-observer-dev` (`Filter.cpp`, `AdvertLimiter.h`, `PathBlock.h`, `SenderRules.h`, `MessageAge.h`): order hash size, path prefixes (`filter_paths`, whole-entry match), hops, per-origin advert window (`AdvertOriginWindow`, 256-entry ring on the first 4 key bytes, `filter_advert_hours`), GRP_TXT checks (channel block, malformed scan on Public, age limit `filter_age_minutes`, sender / text rules `filter_sender_rules` / `filter_text_rules` read on Public plus `filter_watch` hashtag channels, decrypted once), rate limiter last (our deliberate deviation: content drops never eat the GRP_TXT rate budget). The age limit and the malformed +-1 week check are inactive below `DMC_CLOCK_SET_AFTER` (1 Jan 2026). `filter_dryrun`: a filter hit is counted (`FilterCounters.dryrun_hits`, "would have saved" airtime) and the flood carries on with `Decision.filter_dryrun`; the runtime counts it as `by_reason["dryrun:<reason>"]`. `FilterCounters` (in memory, cleared by `reset_stats()`) and `engine.filter_snapshot()` feed `stats.filter` and the MQTT `filter` topic. Neighbours table (`services/host_repeater_neighbors.py`, no radio, boundary-tested): signed zero-hop repeater adverts observed by the runtime and discover replies, max 50, least recently heard replaced. The neighbour poll (`services/host_repeater_neighbor_poll.py`, TRANSMITS, the second module besides `host_repeater_tx` allowed near the radio) runs every `neighbor_poll_interval_hours` when `neighbor_poll_enabled` and the host repeater is shadow or armed on a connected non-OpenHop radio (first poll 120 s after it becomes eligible): one zero-hop repeater discover (60 s listen, lock released while listening), then per neighbour an anon regions request sent zero-hop (the contact is pushed with an empty direct path, then its stored route is restored or it is removed again). Started / stopped in `main.py` (`neighbor_poller`); `stats.neighbors` reports table and poll state.
- Policy field `channel_sender` is the sender as chat shows it (`host_repeater.policy_channel_sender`; the own-origin check for GRP_TXT uses the same name): the decoder's sender, or, for a name the decoder rejects (`[` or `]`, such as `[NU]`), the `Sender: ` prefix of the text. `channel_message_body` is the decoder's text either way, so for such a name it still starts with that prefix; Spam Guard builds its text and duplicate rules from the same text. Side effects for such names: a rule with `throttle_key: sender` now keeps one budget per bracketed name (before, they shared the empty one), and a known-people allow rule can match a bracketed name the user put in `allow_senders`, while the detector is still fed the decoder's empty sender.
- `GET /radio/host-repeater` - settings, `version`, `state` (`off`/`shadow`/`armed`), `armed_since`, `disarm_reason`, `rearm_pending`, `env_enabled` (`MESHCORE_HOST_REPEATER_ENABLED`), capabilities (raw send ver code >= 13, firmware repeat byte, OpenHop, EU sub-band limit, `arm_blockers`)
- `PUT /radio/host-repeater/settings` - `{version, settings}`; 409 when `version` is stale, 409 when enabling shadow on OpenHop; broadcasts WS `host_repeater`
- `POST /radio/host-repeater/validate` - `{valid, errors[{loc, msg}]}` without saving
- `POST /radio/host-repeater/mode` - `{mode: off|shadow|armed, confirm}`; `armed` needs `confirm: true` (400 otherwise) and answers 409 `{message, blockers}` when a precondition fails; `off`/`shadow` disarm without touching the saved settings
- `POST /radio/host-repeater/disarm` - kill switch (also cancels a pending re-arm)
- `GET /radio/host-repeater/stats` (includes `region_gate`: level, max level, budget use, closed regions; `tx`: sent, airtime, errors, table full, queued, in flight, drops by cause; `rx_delay`: held / yielded / pending + percentiles; `advert_limiter`: allowed / dropped / tracked; `lifetime`: totals since first run with `runs` and `persisted`), `POST /radio/host-repeater/stats/reset` (`?lifetime=true` also restarts the persisted totals)

### Spam Guard (channel spam detection, off by default)
Behaviour modelled on flackrat/openhop-spamguard v5.11.3, code written from scratch (no source copied). Layers:
- `app/spam/` is pure and must not import the radio, radio commands or `meshcore` (test-enforced). `text.py`: comparison form of a message (case, look-alikes, leetspeak, invisible characters, emoji, `@[name]` mentions), 4-character shingle similarity, name score 0-6, disguise check, shared text / shared words of a set of copies. `settings.py`: `SpamTunables` (bounded, defaults = `balanced` preset), `PRESETS`, `SpamConfig` (mode, paused, sensitivity, `overrides`, protected `channels`, `allow_hops` / `allow_senders` / `allow_texts`), `effective()` = defaults < preset < overrides. `detector.py`: `SpamDetector` with an injected clock. `ingest()` builds an `Event`; `decide()` creates, renews and expires `Block`s (kinds `text`, `words`, `hop`, `suffix`, `links`, `lockdown`; sources `manual`, `hop`, `campaign`, `dedupe`, `repeat`, `rotation`, `links`, `lockdown`) and returns `DecideResult(changed, important, flag)`; `action(op, **body)` runs user actions (there is deliberately none that blocks a sender by name; `block_hop` takes an optional `channel` that scopes a repeater block to one protected channel, `unblock` and `clear_auto` hold the removed keys off in `suppressed`, except for a `dedupe` block: there the copies it was made from are marked `Event.released` (`_release`) so they start no new block and the next copy counts as a first copy, `clear_held` / `clear_messages` / `forget_source` empty the held list, hide the recent messages (`visible_events()`, the events stay as evidence) and take one hop out of the hourly source counters, `reset_learned` forgets all learnt state); a message already stopped by an enforced non-dedupe block gets no duplicate-suppression block (`_stopped`); `dump()` / `load()` round-trip the state as JSON. Reasons and activity entries are codes plus numbers, worded by the frontend. Events are judged for learning (known people, routes, hourly history) once they are 120 s old. `rules.py`: `render(detector, dialect, preview=False, channels=None)` turns blocks into OpenHop-format rules in two lists, `before` (manual, repeater, campaign, duplicate) and `after` (known-people allow per channel, the gated blocks, then rotation allow + block rules), for dialect `host` (1 byte channel hash, inline known-names list, `path_first` for `starts_at`) or `openhop` (channel secret, `@rtfmspam.known_senders`, integer ids). A rule name ends in the origin of its block, ` (yours)` / ` (duplicate)` / ` (repeat)` / ` (auto)`; the rule id is made from the name without that ending. A repeater block with a `channel` only renders for that channel, and the known-people rule is only rendered for the channels a gated block applies to. Monitor, Pause and a block set to observe render nothing: both engines stop at the first matching rule, so even a `log_only` rule ahead of the user's rules would change forwarding. `_block_matches` in the detector mirrors the rendered rules; `tests/test_spam_rules.py` proves the two agree.
- Spam Guard catch-up with openhop-spamguard v5.37, slice 1 (design `docs/superpowers/specs/2026-10-16-spam-guard-v537-design.md`, gitignored):
  - `known_min_msgs` defaults to 3. `dump()` writes `version` (`STATE_VERSION` 2); `load()` of older state raises every `known` count to at least 3 once, so people already known stay known.
  - Repeat guard (`repeat_guard`, `repeat_max`, `repeat_window_seconds`, `repeat_block_seconds`): `SpamDetector._block_repeats()` makes a `text` block with `sender_only`, source `repeat`, key `repeat:<digest(sender|piece)>`, for one name sending the same normalised message (8+ characters after mentions) more than `repeat_max` times in the window. Caught copies get `duplicate`, not `spam`; `unblock` releases its copies like a `dedupe` block (`_REPEAT_SOURCES`).
  - Newer floods: `text.tagged_name_score()` (first name + random tag, call-sign-shaped tags excluded) raises the name score of a name that is not trusted, known or established; `text.is_unreadable()` (the chat's `is_gibberish_text` plus short mixed bodies of 3 to 8 characters) sets `Event.unreadable` and makes the event random when `detect_unreadable` is on and the name is not familiar. Evidence records carry `unreadable`.
  - Regulars: `homes` (name -> first hop -> uncaught settled messages, at most 4 hops, persisted), `established(name)` (known, or 5+ messages first heard an hour ago), `Event.forgivable` (caught by a campaign, rotation, lockdown or gated repeater block). `_learn_sender` still counts such a message when the name is established, normal-looking and heard from home (`_still_a_regular`). `_suspect` is false for established names, so regulars' shared greetings make no campaign. Established senders are not rotation candidates. Routes regulars use are NOT spared from rotation blocks (measured: our suffix blocks are gated, so sparing protected no one and let floods through).
  - Fresh start: `SpamGuardRuntime.load()` without stored state, and `action('reset_learned')`, call `SpamDetector.seed_known()` with `MessageRepository.channel_sender_counts(channel keys, now - SEED_KNOWN_SECONDS)` (incoming, not spam, last 24 h); made-up, tagged, disguised, `?` and `Unknown` names are left out. Activity `known_seeded`.
  - `tests/spam_redteam.py` + `tests/test_spam_redteam.py`: a deterministic attack simulation judged by both engines (OpenHop before ingest via `NodePolicy`, host after `decide(rematch)` via `evaluate_layers`); the gate asks 90% of attack messages stopped and at most 3% of regulars held on both, for seed 7.
- Spam Guard catch-up, slices 2 to 4:
  - Spam, not opinions: `gated()` is also true for `text` / `words` blocks with reason `manual` or `marked_spam` (rendered after the known-people rule by `_Renderer.gated`). `MANUAL_TEXT_MIN_CHARS` 12 for `block_text` and the `mark_spam` piece; `mark_spam` with a known or trusted `sender` raises (the runtime fills `sender` from the stored message). `week_at_most(block)` (every text/words block, and a hop block that is not gated) caps `expires` at now + `MAX_PEOPLE_BLOCK_SECONDS` (7 days) in `_add_block`, `_do_extend` (permanent refused), `_do_hop_mode`, `configure` and `load`. `spam_text_days` le 7; `clamp_overrides` also lowers it. The block payload carries `week_at_most`.
  - Automatic lockdown (`auto_lockdown`, default on): `_auto_lockdown()` starts `LOCKDOWN_KEY` with source `auto_lockdown` for 15 min when 12 made-up, unfamiliar names arrive through 6 first hops (not DIRECT) within 120 s. Ending it by hand (`lockdown` minutes 0 or `unblock`) suppresses the key 24 h; ending a user lockdown does not; `clear_auto` keeps a user lockdown.
  - `_correct_campaigns()`: a campaign text/words block that caught `CAMPAIGN_REGULARS` (3) known names each heard from home is dropped, suppressed 24 h, Activity `campaign_corrected`. Brand-new names (`hop_new`) leave out familiar names.
  - Known people list: `known_list(q, limit, offset)`, action `forget_known` (known, homes, trust), `GET /spam-guard/known`.
  - Graphs per channel: hourly counters carry `channels` (per channel key), `channels_since` in the state; `metrics(channel)` filters the graphs only; `GET /spam-guard/metrics?channel=`.
  - auto-Protect (`auto_protect`, default off, a profile `LOCAL_KEY`): detector `watch_since` (set when it is turned on or the mode changes to monitor; action `watch_again`), `genuine_marks` (`not_spam` with a `matched` block), `auto_protect_status()`; `SpamGuardRuntime.tick()` switches to protect through `_maybe_auto_protect()` unless `refusal()` objects; `save_config` from protect to monitor and the `stay_in_monitor` action set `auto_protect` false. The snapshot carries `auto_protect`.
- `services/spam_guard.py` (`SpamGuardRuntime`, singleton `spam_guard`) owns the detector. `on_channel_message()` is called from `create_message_from_decrypted` in `services/messages.py` for a newly stored message (`realtime` only, protected channels only), before the message is broadcast, so a message caught by an existing block reaches chat, unread counts and Web Push already flagged. `create_fallback_channel_message` (CHANNEL_MSG_RECV, no raw packet) feeds it too, with `raw_frame=False`: the host engine never judged that message, so a block it confirms does not count it as caught, and without hop hashes it counts as heard directly. It is fed the text as sent (before SMAZ decoding), which is what the engines match on, and the packet length (`packet_len`, passed by `packet_processor`). It never raises. Earlier copies of a campaign are flagged after the fact (`MessageRepository.set_spam`, WS `message_spam`). The host engine judges a frame after message ingest, so a block confirmed by a message also catches that message there (`decide(rematch=event)`). A 30 s tick expires blocks and settles events. State is written at once for important changes and otherwise at most every 300 s, and at shutdown (`stop()` in `main.py`). Loaded in the lifespan; the master switch `app_settings.spam_guard_enabled` reaches it through `routers/settings.py` (`set_enabled`).
- `on_channel_message()` returns a `MessageVerdict(spam, duplicate)` for the arriving message's chat row and takes `malformed` (the chat filter's verdict, `app/malformed.py`). `duplicate` is set when duplicate suppression caught the message (`Event.duplicate`, `DecideResult.duplicate`, `MessageRepository.set_duplicate`, `messages.duplicate`, migration `_140`); it is a marker only and never hides a message. 'Not spam' clears it and sends `message_spam` with `duplicate: false`.
- Duplicate suppression lengths: `dedupe_min_chars` (shortest message looked at) and `text_rule_chars` (length of the piece a rule matches) go down to `MIN_DUPLICATE_CHARS` (5). `min_rule_chars` does not apply to a duplicate rule, only to campaign text rules. `SpamDetector._rule_piece()` takes whole words from the middle and falls back to the characters as they come (`middle_piece(..., whole_words=False)`) when whole words leave fewer than 5.
- Duplicate suppression scope (`SpamTunables.dedupe_scope`): `others` (default; `Block.sender` may re-send, rule `channel_sender not_equals`), `same` (`Block.sender_only`, rule `equals`, block key includes the sender), `everyone` (no sender). `configure()` drops the dedupe blocks when the scope changes. With `same` / `everyone` a block is not started by a single copy that is the message being judged (`decide(rematch=event)` on the host), or the first copy would be stopped by its own rule.
- `SpamTunables.malformed_signal` (default off): a malformed message counts as a made-up sender (`Event.random`) and is flagged as spam, unless the name is trusted or the text is allowed.
- `services/policy_verdict.py` (`NodePolicy`, singleton `policy_verdicts`): what an OpenHop node's policy does with a received packet, evaluated here for the packet feed. `NodePolicy` is a port of openhop_repeater `repeater/policy_engine.py` (first enabled matching rule decides, no type coercion, channel sender / text only with a secret the document holds, a bare all-digit `channel_hash` is decimal). `mode` and `rx_radio_id` are only known to the node: no verdict from a rule that needs them. The cached document comes from `OpenHopBackend.on_policy` (every sync), `GET /openhop/policy`, and its own read at most every `REFRESH_SECONDS` (60) while packets arrive; policy changes through `routers/openhop.py` (`_policy_change`) invalidate it. A failed read drops the copy. `packet_processor` calls `verdict_for()` for every packet; it never raises and returns None unless the radio is an OpenHop node. Not for the host repeater.
- `services/spam_backend_host.py` (`HostBackend`) hands the rule set to `ForwardingEngine.set_managed_rules(before, after)`. `host_repeater_policy.evaluate_layers(before, policy, after, fields, ...)` evaluates managed rules around the user's rules: first match across the three lists decides, the user's rules and `default_action` only count while `policy.enabled`, managed rules always. `evaluate_policy` delegates to it. A managed drop reports `policy_drop` with rule id `spam:<block key>`; lifetime per-rule counters bucket those ids per kind (`_lifetime_rule_key` in `services/host_repeater.py`). On an OpenHop radio the host rules are cleared.
- `services/spam_backend_openhop.py` (`OpenHopBackend`) keeps the rule set in an OpenHop node's policy through `OpenHopClient`. `want(rules)` / `release()` only record what should be there; a worker task (`start()`, `stop(remove=True)`) does `sync_once()`: `GET /api/policy`, keep every rule whose name does not start with `rtfm-spam:`, write `before + theirs + after` plus `objects.rtfmspam.known_senders` and `objects.rtfmspam.bot_senders` (each only while a rule refers to it) when that differs from the node. Everything else (other objects, groups, `default_action`) is passed through; `enabled` is switched on when there are rules to write and never off. At most one sync per 2 s, a re-read every 60 s that restores missing or altered rules (`repairs`), a retry every 30 s after a failure. A node with `spamguard:` rules is refused: nothing is written and what we wrote is taken out. Because OpenHop rules never expire by themselves, ours are removed on Monitor / Pause (empty rule set), on switching the feature off, when another radio connects and at shutdown. `client_from_settings` is fail-closed like `routers/openhop.py` (url + token, radio is OpenHop), except that a node known to hold our rules may still be asked to give them up. The API facts it relies on (untyped rule ids, `POST /api/policy` semantics for `objects` and groups, errors as HTTP 200 with `success: false`, `/api/policy_validate` checks nothing about a rule) were read from openhop_repeater `main`, not observed on a node. `SpamGuardRuntime.backend_name()` only changes while a radio is connected and has reported its model, so a dropped link to the node does not look like a switch to the host repeater. `ProtectedChannel.share_key` is the user's agreement that a private channel's key may be copied to the node; `SpamConfig.shareable_channels()` (Public, hashtag-derived, or agreed) is passed to `render(..., channels=...)` so no other channel appears in an OpenHop rule.
- OpenHop drop rules carry a last condition `local_transmission not_equals true` (`_NOT_OWN_SEND` in `app/spam/rules.py`, added in `_Renderer.rule()` for the `openhop` dialect and action `drop` only). OpenHop evaluates the policy for what its companions send too (`packet_router` injects with `local_transmission=True`; the policy context has the field in tags 1.1.2 and 1.1.4) and does not send a packet a rule drops, so without it our rules could stop the user's own messages. A node without the field resolves it to None, so the condition holds and the rule works as before. The host dialect has no such field (`host_repeater_settings`). `policy_verdict` always judges with `local_transmission: False`, so packet feed verdicts are unchanged. Read from openhop_repeater `dev` 85fc14a6, not observed on a node.
- `SpamTunables.max_total_rules` is capped at `MAX_RULES` (500; it was 2000): more can overload an OpenHop node. `clamp_overrides()` brings an older stored value down to the cap where settings are read: `SpamGuardRuntime.load()` (otherwise the whole stored document would fail validation and fall back to defaults) and `SpamGuardProfiles._parse()` (saved or imported profiles).
- Storage (migration `_137`, `repository/spam.py`): `spam_guard_config` (one versioned JSON row), `spam_guard_state` (one JSON row), `spam_evidence` (one row per evidence record, `SpamEvidenceRepository`: `add`, `iter_since` in pages, `list_since` with a limit, `prune_older_than`, `count`), `messages.spam`, `app_settings.spam_guard_enabled`, `app_settings.hide_spam`.
- `GET /spam-guard` - everything the page shows (`SpamGuardRuntime.snapshot()`): summary, `settings`, `tunables`, `defaults`, `presets`, `health`, `metrics`, `block_list`, `held`, `messages`, `campaigns`, `activity`, `known_names`, `suppressed`, `private_channels`, `bot_forward` (what the bot lists' Block forwards is doing, see "Bot lists")
- `PUT /spam-guard/settings` - `{version, settings}`; 409 when `version` is stale, 409 for `hop_match_mode: starts_at` on an OpenHop radio
- `POST /spam-guard/action` - `{op, args, message_id}`; 400 for bad input or an unknown `op`. With `message_id`, `mark_spam` / `not_spam` also set or clear that message's chat flag. `reset_settings` is handled by the runtime, not the detector: it saves `default_config()` as a new settings version
- `GET /spam-guard/rules?preview=` - the rule set for the active backend (on OpenHop exactly what is synced, so without private channels not agreed to); `preview` renders what Protect would apply whatever the mode; `bot_senders` are the names the bot list rules drop
- `app/spam/evidence.py` (pure): record shapes for the evidence log. `message_record(event, known, channel_name)` is what the detector was given plus what it made of it; `label_record(...)` is a This is spam / Not spam answer (`spam` / `genuine`). A record never holds a channel key: `channel_id(key)` is a 12 character one-way id. `Scrambler` replaces sender names and `@[name]` mentions by codes that are stable within one export and drops `channel_name`; `export_lines` / `export_line` / `meta_record` write JSON Lines with a `meta` first line; `parse_lines(text, limit)` reads it back, counting unusable lines; `retention_days(stored_settings)`. The runtime writes a `msg` row per analysed message and a `label` row per verdict with a `message_id`, only while the `evidence_log` tunable is on (`_keep_evidence`, `_keep_label`); `retention_pruner.prune_once` deletes rows older than `evidence_days` (result key `spam_evidence`).
- `app/spam/replay.py` (pure): `replay(records, config, scrambled=False)` feeds the `msg` records in time order to a fresh detector on a clock driven by their timestamps (a `decide()` first when 30 s have passed, then `decide(rematch=event)`, host timing) and scores against the last label per `message_id`: `caught`, `flagged_later`, `missed`, `passed`, `wrongly_held`, with capped samples, plus `stopped`, `flagged`, `recorded_stopped`, `blocks` by kind. For a scrambled log it passes the recorded `name_score` / `name_disguised` to `SpamDetector.ingest`, because a code says nothing about the name it replaced. Cost is several ms per message (`_shared` results are cached per set of copies, `SHARED_CACHE_SIZE`).
- `GET /spam-guard/evidence?days=&scramble=` - the log as a JSON Lines download (streamed)
- `POST /spam-guard/replay` - `{days | evidence, settings}`; runs in a thread, stores nothing; 400 past `MAX_REPLAY_MESSAGES` (20000) records
- `GET /spam-guard/airtime?start_ts&end_ts` - airtime saved in the hours that start inside the window (all channels: airtime is not kept per channel), with `from_ts` and `partial` when the window reaches past the 8 kept days; read-only, for the filter share card
- `GET /spam-guard/health` - `state` `off` / `ok` / `warn` / `bad` with `problems` (`not_running`, `rules_failed`, `rules_missing`, `openhop_sync_failed`) and `warnings` (`settings_invalid`, `host_not_armed`, `openhop_spamguard_present`, `openhop_not_configured`, `openhop_key_not_shared`, `no_channels`); on OpenHop also `sync_state` (`idle` / `pending` / `synced` / `unconfigured` / `refused` / `failed`), `repairs` and `last_sync_at`; 503 when `bad`. It carries codes only: exception text (which can quote stored values or the node URL) is logged, never returned

### Bot lists
- Lists of known bots (exact sender name, optional public key and note). An enabled list marks its senders in chat; `app_settings.hide_bots` hides them; a list's `block_forward` asks Spam Guard to keep them off the air. Nothing here transmits, and forwarding is only ever reached through Spam Guard.
- Forward blocking: `BotListService.refresh()` computes the forward names (entries with `forward_reviewed = 1` of lists that are `enabled` and `block_forward`, minus the exceptions) and hands them to `SpamGuardRuntime.set_bot_senders`; that is the only path to the forwarding backends. `app/spam/rules.py` `render(bot_senders=...)` puts one `bots:<channel key> (bot list)` drop rule per protected channel first in `before` (ahead of the user's rules and the known-people allow rules; the rule cap cuts detector blocks before a bot rule; `max_total_rules` covers `before` and `after` together: `_fit_gated` keeps the newest gated blocks whose rules, one per channel and marker plus each newly needed known-people rule, still fit, and leaves the rest out whole with `truncated` set): an inline name list for the host engine, `@rtfmspam.bot_senders` on OpenHop, where `spam_backend_openhop` writes that object while a rule refers to it. For OpenHop the renderer leaves out names the node would read differently than chat (`_same_sender_on_openhop`): `Unknown` (what the node calls the sender of text without a prefix), a name with a colon, a name of 50 characters or more. Nothing is rendered in Monitor, while paused, with Spam Guard off, or for a private channel not shared with the node. `SpamGuardRuntime.bot_forward()` is the status both UIs show: `{state, channels, names}` with `state` one of `active`, `off`, `monitor`, `paused`, `no_names` (a list blocks forwards but no name of it is confirmed), `rules_failed` (`apply_rules` failed and cleared the managed rules), `key_not_shared` (OpenHop: protected channels exist but none may be named there), `no_channels`, `not_armed` (host repeater not armed), `not_synced` (rules not on the OpenHop node). `refresh()` runs one at a time (`_refresh_lock`), so an older refresh cannot overwrite what a newer one handed over. A name a URL refresh adds has `forward_reviewed = 0`, is marked in chat at once and is left out of the forward names until `POST /bot-lists/{id}/review` names it; local, imported and shipped entries are always reviewed. The bot lists are loaded before Spam Guard at startup (`main.py`). Not verified on a real host repeater on air or a real OpenHop node.
- Storage (migration `_142`, `repository/bot_lists.py`): `bot_lists` (`source` is `local`, `url` or `shipped`; `enabled`; `block_forward`), `bot_list_entries.forward_reviewed`, `bot_list_entries` (one name per list), `bot_exceptions` (names never treated as a bot), `app_settings.hide_bots`.
- File format (`app/bot_lists/format.py`, pure): `rtfm-ev-bot-list` version 1, at most 256 KiB and 1000 entries; a document that fails any check is refused whole (`BotListFormatError`). A name must not be blank or padded; matching is exact and case-sensitive.
- `services/bot_lists.py` (`bot_lists`): caches the effective set (entries of enabled lists minus exceptions, at most 5000 names), broadcasts WS `bot_lists` after every change, and loads `app/data/bot_list.json` into the one read-only `shipped` list at startup (entries replaced, the user's switch kept; a missing or invalid file keeps the stored entries and sets `last_error`).
- `GET /bot-lists` - lists with entry counts, `exceptions`, `effective` (`names`, `keys`), `limits` and `forward` (`SpamGuardRuntime.bot_forward()`); a list row also has `review_count` (names a refresh added that are not confirmed and not an exception). Every changing route below answers with the same body
- `POST /bot-lists` - `{name, description}`; a new local list, switched off. The answer also carries `created_id` (lists are sorted by name, so the new one is not otherwise identifiable); the WS event does not
- `PATCH /bot-lists/{id}` - `{name, description, enabled, block_forward}`; name and description only for a local list (409 otherwise); 400 when enabling would pass the effective cap
- `DELETE /bot-lists/{id}` - 409 for the shipped list
- `GET /bot-lists/{id}/entries` (each entry also has `forward_reviewed`; the export file does not carry it), `PUT /bot-lists/{id}/entries` (`{entries}`), `POST /bot-lists/{id}/entries` (one entry) - writes only on a local list (409 otherwise)
- `POST /bot-lists/import` - the body is the file itself; stored as a new local list, switched off; 400 with the format message
- `GET /bot-lists/{id}/export` - the list in the file format, as a download
- `PUT /bot-lists/exceptions` - `{names}`; 400 `over_limit` when taking an exception away would put the effective set past its cap (a change that does not make the set larger is always let through)
- Refusals the UI words itself are answered as a code in `detail` (`BotListError.code`): `over_limit`, `too_many_entries`, `already_subscribed`, `too_many_subscriptions`. Other refusals keep their sentence. `subscribe` checks, fetches, then checks again and stores under `_subscribe_lock` (the fetch is outside the lock), so two requests for one address make one list. Where a list's names are replaced (`replace_entries`, `_refresh_row`, `load_shipped`) the cap is judged on the result by `_check_replacement` (other enabled lists plus the new names, minus exceptions); enabling a list and adding one entry use `_check_cap`. `BotListRepository.apply_refresh` does nothing for a list deleted while its file was fetched. A shipped list that would take an enabled set past the cap keeps its stored entries and gets `last_error` `over_limit`; it is only tried again at the next start.
- Subscriptions (`source` `url`): `services/bot_list_fetch.py` does the fetch. `check_subscription_url` accepts `https` only, no user name or password, at most 2048 characters, drops the fragment and drops a written port 443 (one address, one spelling). `fetch_bot_list` sends each request to the address `url_safety.resolve_public_ip` validated (original host as `Host` header and SNI, like `services/unfurl.py`), follows at most 3 redirects by hand with the same checks per hop, sends `Accept-Encoding: identity` and refuses an answer with any other `Content-Encoding` (decompression would defeat the cap), stops reading at `MAX_FILE_BYTES`, bounds the whole fetch (name lookup, every hop, the body) with `FETCH_DEADLINE` (20 s; `FETCH_TIMEOUT` 10 s is per network operation), and returns a validated `BotListFile`. While it runs, a filter on the `httpx` logger drops the request line, which would carry the pinned address and the query. The other end is untrusted: `_refresh_row` records `fetch_failed` for any unexpected exception so one list cannot stop the pass. It raises `BotListFetchError` with a `code` (`not_https`, `bad_url`, `unsafe_url`, `host_not_found` for a name without an address, `fetch_failed`, `http_error`, `too_large`, `too_many_redirects`, `invalid_file`); `public_text()` is the code, or `invalid_file: <format message>`. `detail` (resolved addresses, exception text) is logged, never returned or stored.
- `POST /bot-lists/preview-url` - `{url}`; fetches and validates, stores nothing; answers `{url, name, description, updated, entries}`; 400 with `detail` = `public_text()`
- `POST /bot-lists/subscribe` - `{url}`; stores a read-only list, switched off, with `created_id`; 400 for a fetch error, an address already subscribed, or more than `MAX_SUBSCRIPTIONS` (20)
- `POST /bot-lists/{id}/refresh` - refresh now; always the state when the list is a subscription (a failed fetch shows as that list's `last_error`, which holds a code, `invalid_file: <message>` or `over_limit`); 409 for another kind of list
- `POST /bot-lists/{id}/review` - `{names}`; confirms names a refresh added, so Block forwards covers them too. The UI sends only names it showed; switching Block forwards on for a subscription is this call followed by the PATCH
- A refresh is `BotListRepository.apply_refresh`, a diff by name: names gone from the file are deleted, names that stay keep `forward_reviewed` and take key and note from the file, new names get `forward_reviewed = 0` (left out of forward blocking until reviewed, see above). Name, description and `file_updated` follow the file.
- `services/bot_list_refresh.py`: a loop started and stopped in `main.py` next to the backup schedule. First check 120 s after start, then hourly; `bot_lists.refresh_due()` refreshes every subscription whose last good fetch (`fetched_at`) is 24 hours old or older, so a failing one is tried again each hour. With no subscription nothing is contacted.

**Filter library (profiles).** Named sets of filter settings that the user applies by hand and shares as files. One mechanism for every kind; Spam Guard (`spam_guard`) is the only kind so far.

- Storage (migration `_147`, `repository/filter_profiles.py`): `filter_profiles` (`kind`, `name`, `description`, `source` = `local`, `payload` JSON, `created_at`, `updated_at`) and `filter_profile_in_use` (one row per kind). `in_use()` only answers a profile that still exists and is of that kind; `delete()` removes the in-use row with the profile.
- `app/filter_profiles/kinds.py` (pure): `ProfileError(code, message, status)`, whose `detail` (`code` or `code: message`) is what the API answers, and the `ProfileKind` interface every kind implements: `validate(payload)` (raises `ValueError`), `capture()`, `apply(payload, confirmed=)`, `matches(payload)`, `changes(payload)`. A new kind is one class registered in `services/filter_profiles.py`; the service knows nothing about the feature, the kind knows nothing about storage or files.
- `app/filter_profiles/format.py` (pure): the file is `rtfm-ev-filter-profile` version 1, one profile per file, at most 256 KiB, unknown keys refused. `parse_profile` raises `ProfileError` `too_large`, `not_json`, `not_a_profile`, `unsupported_version` or `invalid_file: <field>: <message>`. `version: true` is refused (`type() is int`). `export_filename` is plain ASCII because it travels in a header.
- `services/filter_profiles.py` (`filter_profiles`): `snapshot(kind)` answers `{kind, profiles, in_use: {profile_id, modified} | null, limits}`. `modified` is computed on read (`not kind.matches(payload)`, and true when the stored payload no longer validates). At most 100 profiles per kind (`too_many_profiles`). `create` captures the live values and marks the profile in use; `import_file` stores and never applies; `update(capture=True)` is "Save to profile". A `ValueError` from the kind becomes `invalid_file` (400) on import and `invalid_profile` (422) on apply and changes; a `ProfileError` from the kind passes through.
- `services/filter_profile_spam.py` (`SpamGuardProfiles`): the payload is `{mode, sensitivity, overrides}`. Never in it: `paused`, `channels`, the three allow lists, and the tunables in `LOCAL_KEYS` (`evidence_log`, `evidence_days`); a payload carrying any of them is refused. Validation builds `SpamTunables` and a `SpamConfig`, so the bounds in `app/spam/settings.py` apply unchanged, and the override values are stored as those models read them (a hand-edited `1` for a switch is stored as `true`). `apply` keeps the live `LOCAL_KEYS` overrides and everything else of the live document, and saves through `SpamGuardRuntime.save_config`. It raises `needs_confirm` (409) for Monitor to Protect without `confirmed`, the code from `SpamGuardRuntime.refusal` (`openhop_starts_at`, 409) and `conflict` (409) when the save lost the version race. `matches` compares the mode and the tunables in force (`effective()`), so an override equal to its preset value is no change.
- `SpamGuardRuntime.refusal(config)` (`services/spam_guard.py`) answers a key of `REFUSALS` when the connected radio cannot run the settings. `PUT /spam-guard/settings` answers the sentence, the filter library the code.
- `GET /filter-profiles?kind=` - the snapshot; 400 `unknown_kind`
- `POST /filter-profiles` - `{kind, name, description}`; saves the live values, answers the snapshot with `created_id`
- `POST /filter-profiles/import` - the body is the file itself; stored as an own copy, not applied; 400 with the format code
- `PATCH /filter-profiles/{id}` - `{name, description, capture}`
- `DELETE /filter-profiles/{id}`
- `GET /filter-profiles/{id}/export` - the file, as a download
- `GET /filter-profiles/{id}/changes` - `{profile_id, changes: [{key, from, to}]}`: what applying would change
- `POST /filter-profiles/{id}/apply` - `{confirm_protect}`; 409 `needs_confirm`, `conflict` or `openhop_starts_at`, 422 `invalid_profile: ...`
- No WebSocket event of its own: applying a profile saves Spam Guard settings, which broadcasts `spam_guard` with the new `version`.

### Contacts
- `GET /contacts`
- `GET /contacts/analytics` - unified keyed-or-name analytics payload (keyed lookups include `path_scores`, the scored DM route history)
- `GET /contacts/repeaters/advert-paths` - recent advert paths for all contacts
- `POST /contacts`
- `POST /contacts/bulk-delete` - keys are lowercased and de-duplicated; returns `{deleted, radio_deleted, radio_failed, radio_failures: [{public_key, error}]}`. The database rows are always removed; a radio that refuses or does not answer a removal is reported per contact, and one failure does not skip the rest
- `POST /contacts/bulk-contact-uris` - body `{public_keys}`: `meshcore://` links for several contacts at once (`{links: {public_key: uri}}`), built from the most recently retained advert transmission per key (`AdvertEventRepository.latest_raw_adverts`, `advert_events` joined to `raw_packets`) and validated the same way an imported link is (hex, ADVERT packet, Ed25519 signature). Unlike `GET /{public_key}/contact-uri` this never talks to the radio; a key with no stored advert (never heard, or pruned by retention) is left out of the response rather than erroring. Used by the map's GPX export
- `POST /contacts/import-uri` - body `{uri}`: import a `meshcore://` contact link (`app/contact_uri.py`). The link is validated first (scheme, hex, <= 255 bytes, ADVERT packet, Ed25519 signature; 400 otherwise), then sent with `import_contact` (CMD_IMPORT_CONTACT; 422 if the radio rejects it). The firmware loops the advert back as if heard and ignores the forwarding decision, so nothing is transmitted. A new contact is stored with the advert's name, type and location but no `last_advert`/`last_seen` (not heard on RF); an existing contact is left unchanged. Broadcasts `contact`. `share_contact` (CMD 0x10, transmits) is deliberately not used anywhere
- `DELETE /contacts/{public_key}` - returns `{status: "ok"|"partial", database_deleted, radio_deleted, radio_error}`; `partial` when the radio refused or did not answer the removal (the row is deleted either way)
- `POST /contacts/{public_key}/mark-read`
- `POST /contacts/{public_key}/mark-unread` - `{message_id}`, marks unread from that message onward
- `POST /contacts/{public_key}/command` - CLI command to a repeater, room server, sensor or (our radio 1.18+) chat contact; see Companion command line above
- `POST /contacts/{public_key}/remote-cli` - body `{enabled}`: store the Remote CLI permission and push flags bit 0x10 when the contact is on the radio; returns `applied_to_radio`; broadcasts `contact`
- `POST /contacts/{public_key}/annotations` - set user annotations (`notes`, `owner_info`, `owner_key`, `manual_lat`, `manual_lon`, `battery_chemistry`, `power_source`); partial update, explicit `null` clears a field (for `battery_chemistry`, reverting to the global default), `owner_key` must reference an existing contact (422 otherwise), `battery_chemistry` must be one of `lipo`/`lifepo4`/`lipo_hv`/`nmc` (422 otherwise), `power_source` must be one of `mains`/`battery`/`solar`/`solar_battery`/`unknown` (422 otherwise; `null` reverts to auto-detection from the name); broadcasts `contact`
- `POST /contacts/{public_key}/routing-override`
- `POST /contacts/{public_key}/flood-scope-override` - per-contact region for direct messages, the same tri-state as channels (`contacts.flood_scope_override`, migration `_135`): blank clears it (inherit the global scope), `*` forces unscoped, a region name scopes. `send_direct_message_to_contact` and the background DM retry wrap `send_msg` in `services/flood_scope.temporary_flood_scope`, which applies an explicit override (always, the radio's live scope cannot be read back) and restores the saved global scope afterwards, also on failure, with three attempts. Only a flood-routed DM carries the region
- `GET /contacts/{public_key}/contact-uri` - the contact's `meshcore://` link via `export_contact(key)`: the radio returns the last raw advert it stored for that contact (404 when it has none, 502 if it returns another node's or an invalid advert). Nothing transmitted
- `POST /contacts/{public_key}/telemetry-permissions` - body `{base, location, environment}` (all required); stores `telemetry_perms`, pushes the flag bits to the radio when the contact is loaded there (never adds it just for this), returns `applied_to_radio`; broadcasts `contact`
- `POST /contacts/{public_key}/trace`
- `POST /contacts/{public_key}/path-discovery` - discover forward/return paths, persist the learned direct route, and sync it back to the radio best-effort
- `GET /contacts/{public_key}/route-suggestions?validate=` - ranked DM route suggestions from heard paths (`ContactRouteSuggestions`); `validate=true` also asks the analyzer and fills each suggestion's `validation`. Read-only, changes no route
- `POST /contacts/{public_key}/repeater/login` - one attempt on the effective route, then one flood retry on timeout. Response waits for a contact on a known route scale with the hop count (`services/route_timeout.py`: the fixed wait plus 5 s per radio hop, capped at 30 s; a flood keeps the fixed wait). This covers the login's first attempt and the status, telemetry, neighbour, ACL, region, owner-info, CLI and path-discovery waits of repeaters, rooms and the telemetry collector. A console line that is empty or starts with a space (a `region load` line, which the firmware does not answer) keeps the fixed 20 s
- `POST /contacts/{public_key}/repeater/status`
- Sensor nodes (type 4) may use `repeater/login`, `repeater/lpp-telemetry`, `repeater/acl` and `command` (`_require_repeater_or_sensor`); `simple_sensor` answers no status, neighbour, region or config request
- `POST /contacts/{public_key}/sensor/mma?hours=24` - min/max/average per channel (`req_mma_sync`), 504 without a reply
- `GET /contacts/{public_key}/sensor-push`, `PUT` (thresholds), `POST .../sensor-push/subscribe`, `POST .../sensor-push/unsubscribe` - MeshCore 1.18 sensor telemetry push (`app/services/sensor_push.py`, table `sensor_push_subscriptions`, migration `_151`). Subscribe is binary request 0x08 built by hand (meshcore `BinaryReqType` stops at 0x06): random 4-byte push tag, timeout 65535 s, thresholds LPP-encoded with the firmware's `LPPData::getDataSize`/`getMultiplier` (humidity is 2 bytes x10 there, not the LPP spec's 1 byte x2), at most 14 bytes. The reply grants an expiry (0 = refused) and names the scope. Pushes arrive as unsolicited `BINARY_RESPONSE` events whose tag is our push tag (`event_handlers.on_binary_response`) and go to `contact_telemetry_history` and fanout like an on-demand telemetry read. A loop renews 10 minutes before expiry and retries every 15 minutes after a failure. Subscribe, renew and unsubscribe transmit. A sensor only pushes when it has a scope region
- `POST /contacts/{public_key}/repeater/lpp-telemetry`
- `POST /contacts/{public_key}/repeater/neighbors`
- `POST /contacts/{public_key}/repeater/acl`
- `POST /contacts/{public_key}/repeater/node-info`
- `POST /contacts/{public_key}/repeater/radio-settings`
- `POST /contacts/{public_key}/repeater/regions` - CLI region hierarchy, falling back to the guest anon flood-allowed names (`source`: `cli` or `anon`)
- `POST /contacts/{public_key}/repeater/advert-intervals`
- `POST /contacts/{public_key}/repeater/settings/read` - `get` of allow-listed editor settings (`{settings?: [...]}`; omit for every non-observer key, see `repeater_settings.default_read_keys()`); observer-only keys (`SettingSpec.observer`, currently `snmp`) are read only when named; error sentinels come back as null
- `POST /contacts/{public_key}/repeater/settings/set` - ONE allow-listed `set <verb> <value>` over RF then `get <verb>` read-back; returns `status` `ok`/`mismatch`/`rejected`/`unverified` + `reboot_required`. Allow-list + value ranges live in `app/services/repeater_settings.py` (from the stock `CommonCLI.cpp`, plus the observer firmware's `CommonCLI_Observer.cpp` for `snmp`); anything off-list or out of range is a 400 before the radio is touched. `prv.key`, the admin `password` and `snmp.community` are deliberately not on the list.
- `POST /contacts/{public_key}/repeater/owner-info` - also auto-fills the contact's stored `owner_info` when empty (never overwrites) and returns `stored_owner_info` + `owner_info_updated`
- `GET /contacts/{public_key}/repeater/telemetry-history` - stored telemetry history for a repeater (read-only, no radio access)
- `POST /contacts/{public_key}/telemetry` - on-demand CayenneLPP telemetry from any contact (persists in `contact_telemetry_history`)
- `GET /contacts/{public_key}/telemetry-history` - stored LPP telemetry history for a contact (read-only)
- `GET /contacts/{public_key}/location-history` - positions the contact has advertised, newest first (plan 14, `contact_location_history`, migration `_119`): append-on-change like name history, rounded to 4 decimals (`round_location`, (0,0)/missing ignored), captured from advert ingest and contact-card import (`record_contact_location` in `contact_reconciliation.py`); unbounded like name history
- `GET /contacts/{public_key}/repeater/config-history?kind=` - stored repeater pane snapshots (`device_config_history`, kinds `node_info` / `radio_settings` / `advert_intervals` / `owner_info` / `regions`), newest first. Written by `_record_config_snapshot` at the end of each pane handler, append-on-change (volatile fields excluded: `clock_utc`, owner-info bookkeeping, the regions `raw` dump; a response with every stored field null, i.e. an unanswered fetch, is skipped; a single null field, i.e. one command that got no answer, keeps the latest snapshot's value), capped at 200 rows per contact and kind by the repository, age-limited by `device_history_retention_days`. Room servers store only the `acl` kind (see `room/acl`); their status and LPP panes already land in telemetry history
- `POST /contacts/{public_key}/room/login` - one attempt on the effective route, then one flood retry on timeout. Body `{password, resync_history?}` (`RoomLoginRequest`). `resync_history=true` removes the room from the radio first, so the login's own add is a fresh one. Why that works (checked against meshcore-dev/MeshCore): the companion keeps a per-room `sync_since` and sends it in every room login (`BaseChatMesh::sendLogin`); the room server pushes only posts newer than it, out of a ring of 32 (`MAX_UNSYNCED_POSTS`), never to their author; the companion advances `sync_since` when a post arrives over RF, before the app reads it, and its offline queue (16 frames by default) drops a new DM/room frame when full of non-channel frames; `CMD_ADD_UPDATE_CONTACT` keeps the cursor of a contact the radio has and sets it to 0 for one it does not have. So a post lost between radio and app is never sent again by a normal login, and remove plus re-add is the only way to reset the cursor. The replay costs the airtime of up to 32 posts; ingest dedup drops the ones already stored. Manual only, nothing does this on its own
- `POST /contacts/{public_key}/room/status` - room firmware's 52-byte status ends with `n_posted`/`n_post_push` (uint16 each) where repeaters have RX airtime; these map to `room_posted`/`room_post_pushes` and `rx_airtime_seconds` is null (`services/room_status.py`). A 56-byte frame (e.g. OpenHop) keeps the repeater layout
- `POST /contacts/{public_key}/room/lpp-telemetry`
- `POST /contacts/{public_key}/room/acl` - also stores an `acl` snapshot in `device_config_history` (plan 14): `{pubkey_prefix, permission}` pairs sorted by prefix, resolved names left out; an empty list (timeout) is not stored
- `GET /contacts/{public_key}/room/config-history?kind=` - stored room pane snapshots (today only `acl`), newest first; same shape as the repeater endpoint, 400 for a non-room contact

### SNMP polling (observer firmware, LAN)

Router `routers/snmp.py` (`router` under `/contacts`, `nodes_router` under `/snmp`), service `services/snmp_poll.py` (poll, schedule loop), repository `repository/contact_snmp.py`, tables `contact_snmp` (migration `_130`) and `snmp_history` (migration `_131`). Polls the SNMP agent of the DMC / agessaman observer firmware (SNMPv2c, read-only, scalar OIDs under the temporary enterprise number 99999, see `app/snmp/mib.py`). Repeaters and room servers (observer firmware) and companions (meshcomod's agent, same OID tree; `SNMP_CONTACT_TYPES` in `routers/snmp.py`); sensors and unknown types get a 400. `discover-address` stays repeater/room only: a companion has no remote admin login, so its address is typed in. `mib.FIRST_RELEASE_ENTRIES` are the 22 OIDs every firmware node serves; `mib.ADDED_ENTRIES` (31, Dutch-MeshCore/MeshCore PR #16: battery, MCU temperature, reset reason, TX queue, duplicates, RX air time, duty cycle, error flags, NTP, lowest free heap, duty gate `.6`, packet filter `.7`, neighbours `.8`; plus meshcomod's companion `.9` and receive filter `.10`, Elektr0Vodka/meshcomod `docs/companion_snmp.md`) may each be missing: older firmware has none, room servers have no `.6` / `.7`. A missing OID comes back as noSuchObject, decodes to `None` and means "not supported" (no error, the poll still counts as good). Counter32 entries (`kind="counter"`) restart at 0 after a reboot or `clear stats`; `sentinel` marks the "cannot measure" value (battery 0 mV, MCU -127 C), stored as sent.

- `GET /contacts/{public_key}/snmp/config` - stored settings or null. Returns `community_is_default`, never the community, plus `use_as_telemetry`, `ntp_synced` (newest stored poll, null when not served) and `clock_sync_listed` (key on `clock_sync_repeaters`).
- `PUT /contacts/{public_key}/snmp/config` - `{host, port, community?, poll_enabled, poll_interval_minutes, use_as_telemetry}` (interval 1-1440, default 5; `use_as_telemetry` default false); a null or empty community keeps the stored one (`public` for a new row). Host must be an IP address or hostname (`app/snmp/address.normalize_host`).
- `DELETE /contacts/{public_key}/snmp/config`
- `POST /contacts/{public_key}/snmp/poll` - reads the whole table over UDP in GETs of at most `MAX_OIDS_PER_GET` (22) OIDs, first-release table first, no radio access. The firmware's agent (0neblock/SNMP_Agent) builds replies in a 1400-byte buffer and sends nothing (not tooBig) when one does not fit, so the table is not asked for in one GET. A failed poll is a normal 200 with `ok: false` and `error`; the outcome is written to `last_ok_at` / `last_error` / `last_error_at`. An agent that answers but serves none of the MeshCore OIDs counts as a failure.
- `GET /contacts/{public_key}/snmp/history?hours=` or `?start=&end=` - stored polls (`snmp_history`, one JSON row per good poll, same shape as the poll `values`), oldest first; more than `HISTORY_MAX_POINTS` (1500) rows are thinned by stride with the newest row kept. Without `start` it is the last `hours` (1 to 8760, default 24). With `start` (Unix seconds) it is the period up to `end` (inclusive, now when omitted) and `hours` is ignored; `end` without `start` or `end <= start` is a 400. The new parameters are `Annotated[..., Query()] = None`, so calling the function directly (as the tests do) gets real `None` defaults.
- `POST /contacts/{public_key}/snmp/discover-address` - the only SNMP endpoint that transmits: ONE `get wifi.status` over RF, parsed for the IP. Saves nothing. Status `ok` / `no_address` / `unsupported` / `no_reply`.
- `GET /snmp/nodes` - overview for the Tools > SNMP page: one `SnmpNodeOverview` per `contact_snmp` row, ordered by contact name, with `name` / `type` from `contacts`, the settings and outcome fields of the config endpoint, and `latest` (`SnmpHistoryRepository.get_latest`, the newest stored poll, null when none). Database only: it polls nothing and never touches the radio. `ContactSnmpRepository.list_overview()` does not select the community, only whether it is the default (`community_is_default`).

Schedule: `start_snmp_poll_schedule()` (lifespan) runs `run_scheduled_polls_once()` every `SCHEDULE_TICK_SECONDS` (30). A contact with `poll_enabled` is due when `poll_interval_minutes` has passed since its last attempt, good or failed (`is_due`), so a dead node is not polled every tick. At most `MAX_CONCURRENT_POLLS` (4) run at once; one failing contact never stops the others. Every good poll (scheduled or "Poll now") writes a `snmp_history` row and is handed to the fanout bus (`fanout_manager.broadcast_snmp`, hook `on_snmp`, payload `{public_key, timestamp, values}`); a failed poll does neither. The HA MQTT module turns it into SNMP sensors for tracked repeaters. Retention: key `snmp` in `repository/retention.py`, pruned by `telemetry_retention_days`; the per-node row cap (`TELEMETRY_TABLES`) does not include it.

The community is a credential: it lives only in `contact_snmp`, never on the contact row, and must not be put in a response, a WebSocket event, a fanout payload or a log line. `last_snr` is served by the firmware as dB x 4 and returned by the API in dB.

### SNMP agent (this host, off by default)

Router `routers/snmp_agent.py`, service `services/snmp_agent.py`, repository `repository/snmp_agent.py`, table `snmp_agent` (migration `_132`, one row), protocol `app/snmp/agent.py`.

- `GET /snmp-agent` - `{settings: {enabled, port, community}, running, error, requests, bad_community}`
- `PUT /snmp-agent` - save the settings and apply them right away; a bind failure is returned in `error`, not raised

The agent serves the first-release part of the firmware's OID table (`mib.FIRST_RELEASE_ENTRIES`, 22 OIDs) for this host; the OIDs added later answer noSuchObject: `host_values()` reads the latest radio stats sample, the radio name and firmware version, the count of connected MQTT fanout modules and `/proc/meminfo`; `build_table()` turns that into INTEGER / OCTET STRING varbinds sorted by OID (unknown numbers 0, unknown names empty, values clamped to int32, `last_snr` back to dB x 4). `_safe_table()` serves zeros when a source fails, so a request is never dropped for that. `apply_snmp_agent_settings()` closes the old listener and yields to the loop before binding again, with one retry on `EADDRINUSE`, because `transport.close()` only schedules the close. Wrong community, SNMPv1/v3 and malformed datagrams get no reply; SET gets `notWritable`. Lifespan: `start_snmp_agent()` / `stop_snmp_agent()`. It never uses the radio.

### LAN discovery (Tools > Network scan)

Router `routers/lan_discovery.py` (under `/lan-discovery`), service `services/lan_discovery.py` (targets, SNMP probe, the scan job), protocol `services/companion_probe.py`, HTTP check `services/webconfig_probe.py`. No table, no migration, no WebSocket event, never the radio. One scan at a time, held in memory (`current_job()`) until the next scan or a restart.

- `GET /lan-discovery/suggestions` - the /24 networks of the TCP radio address (`settings.tcp_host`, resolved) and of every `contact_snmp` host that is a private IPv4 literal. Database only, sends nothing.
- `POST /lan-discovery/scan` - `{targets, snmp=true, snmp_port=161, community?, companion=false, companion_port=5000, webconfig=false, webconfig_port=80}`; 400 for bad targets or no check, 409 while a scan runs. `parse_targets` takes IPv4 addresses and networks only, private / loopback / link-local only, at most `MAX_SCAN_HOSTS` (1024). Runs `MAX_CONCURRENT_PROBES` (64) addresses at once.
- `GET /lan-discovery/scan` - progress and the addresses that answered (null before the first scan). Contact matching is done at read time: by the companion's public key, else by the web config `node_id` (`get_by_key_prefix`, unique only), else by a name exactly one contact has, with that contact's SNMP address if set.
- `POST /lan-discovery/scan/cancel` - stops the scan, keeps what it found.

SNMP probe: one GET of `node_name`, `firmware_version`, `uptime_secs` plus `sysName` / `sysDescr` (`SNMP_PROBE_OIDS`, timeout 1 s, one retry). Any MeshCore value = `kind: meshcore`, else `other`. A wrong community gets no reply at all from the firmware agent, so it reads as "nothing there". The community lives only in the scan task: never stored, returned or logged. Setting SNMP up on a found contact is the existing `PUT /contacts/{key}/snmp/config` (the page sends the typed community).

Companion probe (opt-in): TCP connect, `APP_START` (`01 03` + 6 spaces + name), wait for `SELF_INFO` (code 5: advert type, public key, position, name at byte 58), then `DEVICE_QUERY` (`16 03`) for `DEVICE_INFO` (code 13: model, version, build date; the BLE PIN at bytes 4-8 is skipped and never leaves the parser). Push frames in between are skipped. Frames are `<` + uint16 LE length out and `>` + length in (MeshCore `src/helpers/wifi/SerialWifiInterface.cpp`). Why opt-in: that stock interface stops the connected client as soon as a new TCP client arrives, so a probe disconnects whatever app is using a WiFi companion. `own_radio_addresses()` (this instance's `tcp_host`) is always left out of the companion check (`skipped` in the status). In multi-radio mode only the worker's own radio is known; other workspaces' radios are not skipped.

Web config check (opt-in): one `GET /api/status` (httpx, connect 1 s, read 2 s, no redirects, `trust_env=False`, body capped at 8 KiB). The DMC observer firmware (`dmc-observer-dev`, `src/helpers/esp32/WebConfigServer.cpp`) serves it without a login while `start webconfig` runs and answers 503 when stopped. `parse_status` keeps a reply only when `node_id` is 16 hex, `role` is `repeater` / `room_server` (mapped to advert type 2 / 3), `mode` is `setup` / `lan` and `fw` is a string; every other web server answers None and is not listed.

### Fleet asset register (plan 31, Phases 1 to 3a)

Router `routers/fleet.py`, repository `repository/fleet.py`, table `fleet_assets` (migration `_143`). No service, no background task, no WebSocket event, no radio access. Secrets live in the separate vault below, never in these tables or responses.

- `GET /fleet/assets` - every asset; `?public_key=` narrows to the asset of one node (64 hex, any case)
- `POST /fleet/assets` - `{public_key?, label?, org_serial?, hw_serial?, model?, role?, wifi_mac?, ble_mac?, assigned_to?, site_name?, status?, notes?}`; 201 with the asset. 422 when none of `public_key`, `label`, `org_serial` is set; 409 when another asset has the public key
- `POST /fleet/assets/from-contacts` - `{public_keys}`; one `deployed` asset per key that is a known contact and has no asset yet. Answers `{created, skipped}`; a malformed key is 422 and creates nothing
- `GET /fleet/assets/{id}`, `PATCH /fleet/assets/{id}` (only fields present in the body change, null clears; `status` cannot be null), `DELETE /fleet/assets/{id}` (`{status: "ok"}`)

An asset holds what only the operator knows. Its `contact` (`{name, type, last_seen, lat, lon}`, position manual-first) is a LEFT JOIN on `contacts.public_key` at request time and is never stored, so it is null for an asset without a key and for a key that was never heard. `fleet_assets.public_key` is unique when set and has NO foreign key on purpose: an asset may exist before its node is heard and it outlives a deleted contact. `status` is `in_stock` (default), `deployed`, `maintenance`, `lost`, `stolen` or `retired`. Text is trimmed and blank becomes NULL; a MAC is accepted with `:`, `-`, `.` or no separator and stored as `AA:BB:CC:DD:EE:FF`. Text fields are capped at 200 characters, notes at 4000. With multi-radio on, the table lives in each radio's own database like `contacts`.

#### Log (Phase 2)

Table `fleet_asset_events` (migration `_144`, rows go with their asset), `FleetEventRepository`.

- `GET /fleet/assets/{id}/events` - newest first
- `POST /fleet/assets/{id}/events` - `{kind, occurred_at?, summary, detail?, actor?}`; `kind` is `placement`, `maintenance`, `failure`, `custody`, `firmware` or `note`; `occurred_at` defaults to now; 201
- `DELETE /fleet/assets/{id}/events/{event_id}` - 404 unless the entry belongs to that asset

`status` rows cannot be posted: `update_asset` writes one when the status changes and a `custody` row when `assigned_to` changes (`_change_events`), with the old and new value in `from_value` / `to_value` and no summary, in the SAME transaction as the change (`FleetAssetRepository.update(..., events)`). `create_asset` writes a first `custody` row when a holder is given. Every asset response carries `last_maintenance` and `last_failure` (newest entry of that kind, subqueries in `_SELECT`). `actor` is free text because the app has no user accounts.

#### Health and attention settings (Phase 3a)

Migration `_145`: `fleet_assets.target_firmware` and the one-row table `fleet_settings` (`silent_hours` 48, `low_battery_volts` 3.5).

- `GET /fleet/settings`, `PUT /fleet/settings` - `{silent_hours (1-8760), low_battery_volts (0-100)}`

Every asset with a public key carries `health` (`_with_health`): `battery_volts`, `temperature`, `telemetry_at` from the same merged latest-telemetry read as `GET /contacts/telemetry/latest`, and `firmware_version`, `firmware_at`, `firmware_source`. Firmware is the newer of the newest `owner_info` snapshot in `device_config_history` and the newest SNMP poll (`FleetAssetRepository.reported_firmware`); for the connected radio's own key it is `radio_manager.firmware_version` with source `radio`. All of it is stored data: no node is polled and nothing transmits. The "needs attention" rules themselves live in the frontend (`fleetAttention`); the server only stores the two thresholds.

### Fleet key vault (plan 31, Phases 4 and 5)

Router `routers/fleet_vault.py` (under `/fleet`), crypto and sessions `services/fleet_vault.py`, repository `repository/fleet_vault.py`, tables `fleet_vault`, `fleet_secrets`, `fleet_audit` (migration `_146`). OFF unless `MESHCORE_FLEET_VAULT_ENABLED=true` (`settings.fleet_vault_enabled`): every route but the status one answers 403. The tables exist on every install.

- `GET /fleet/vault` - `{enabled, initialised, unlocked, idle_seconds}`; works when switched off
- `POST /fleet/vault/init` - `{passphrase}` (12+ characters), first use only (409 afterwards); answers `{token, idle_seconds}`
- `POST /fleet/vault/unlock` - `{passphrase}`; 401 and an `unlock_failed` audit row on a wrong one
- `POST /fleet/vault/lock`, `POST /fleet/vault/passphrase` (`{current, new}`; re-wraps the data key, ends every session)
- `GET /fleet/vault/audit?limit=` - newest first
- `GET /fleet/assets/{id}/secrets` - kind, label, dates. Never a value
- `POST /fleet/assets/{id}/secrets` - `{kind, label?, value}`; `kind` is `private_key`, `admin_password`, `guest_password`, `wifi` or `other`. A `private_key` must be 128 hex and, when the asset has a public key, derive to it (`decoder.derive_public_key`)
- `POST /fleet/secrets/{id}/reveal` - the one route that returns a value (`Cache-Control: no-store`); always audited
- `DELETE /fleet/secrets/{id}`
- `POST /fleet/vault/export` - `{passphrase}`: every secret re-encrypted under that passphrase, with the asset's public key, organisation serial and label to match on
- `POST /fleet/vault/import` - `{passphrase, document}`: an entry goes to the asset with its public key, else to the single asset with its organisation serial; unmatched and already-stored entries are skipped; a wrong passphrase stores nothing (422)
- `POST /fleet/assets/{id}/generate-key` - `{prefix (0-4 hex), free_bytes (0, 1 or 2)}`; 409 when the asset already has a public key or a known node uses the wanted prefix

Session routes take the token in `X-Fleet-Vault-Token`; without a live session they answer 401.

Crypto (all PyNaCl, no new dependency): a random 32-byte data key encrypts each secret with XChaCha20-Poly1305 (`nacl.secret.Aead`), with `asset id | kind` as associated data, so a ciphertext moved to another row does not open (409 on reveal). The data key is stored wrapped under an Argon2id key from the passphrase (`KDF_OPSLIMIT` / `KDF_MEMLIMIT` = libsodium "moderate", 3 passes over 256 MiB; the parameters are stored per vault and per export file). The passphrase and the derived key are never stored; a forgotten passphrase cannot be recovered. `derive_key_async` runs the derivation in a thread, one at a time (`kdf_lock`), because each run takes that much memory. An import file names its own cost, capped at 1 GiB and 10 passes.

Sessions (`VaultSessions`): unlocked data keys by random token, in this process's memory only, dropped after `IDLE_SECONDS` (900) without use and on restart, at most `MAX_SESSIONS` (16). The token is the only credential on these routes, since the app has no user accounts: anyone holding it can read secrets until it expires.

Rules that must hold:

- A value, a passphrase or a token never goes into a log line, an audit row, a WebSocket event or an asset response. `fleet_audit.detail` holds kind and label only.
- `fleet_secrets.asset_id` has NO cascade and `delete_asset` answers 409 while an asset has secrets, so a private key is never lost by deleting an asset.
- Nothing in the vault talks to the radio. `generate-key` stores the private key in the vault, sets the asset's public key and returns the asset only; putting the key on a device is done by hand (reveal it, then the existing `PUT /radio/private-key` or the device's own console).

Key generation (`generate_keypair`, run with `asyncio.to_thread`): SHA-512 of a random seed, clamped, is the MeshCore private key (scalar + signing prefix, the format `derive_public_key` expects); a candidate is kept when its public key starts with the prefix, its first `free_bytes` bytes are used by no contact and no fleet asset (`known_key_prefixes`), and its first byte is not 00 or FF (taken over from the old fork's generator, not checked against firmware). It gives up after 3,000,000 attempts.

Tests: `tests/test_fleet_vault.py` patches `settings.fleet_vault_enabled` on and the Argon2 cost down to the minimum; a test that touches the vault needs both.

### Fleet config library (plan 32, Phase 1)

Router `routers/fleet_config.py` (under `/fleet`), document rules `services/fleet_config.py` (pure functions: no database, no vault, no device), repository `repository/fleet_config.py`, tables `fleet_configs` and `fleet_config_templates` (migration `_149`). No background task, no WebSocket event. Nothing here opens a serial port, calls a device on the LAN or uses the radio. Reading a device and applying a config over a USB cable is done by the browser (Phase 3, below); over the LAN and from the server are later phases of plan 32.

- `GET /fleet/assets/{id}/configs` - newest first, without the documents; each row has `secrets_stored` and `secrets_missing`
- `POST /fleet/assets/{id}/configs/import` - `{document, kind? (snapshot|desired), profile?, role?, firmware_version?, label?}`; 201 with `{config, secrets_stored, secrets_left_out}`. Takes the vault token in `X-Fleet-Vault-Token` but does not need it
- `POST /fleet/assets/{id}/configs/from-template` - `{template_id?, values, label?, include_private_key?}`; stores a `desired` config with source `template`. 422 names a variable without a value. `include_private_key` (plan 32 Phase 6, onboarding with a new key) puts `{"$secret": id}` of the asset's own private key at `vars/prv.key`: it needs a vault session (403 off, 401 locked) and a `private_key` secret of this asset that derives to its public key (409 otherwise; `_asset_private_key_id`, newest wins, the value never leaves the function). Without `template_id` the config is `{"vars": {"prv.key": ...}}`, source `manual`, profile `stock`, label `Asset key`; with neither, 422. A companion template cannot take the key (422)
- `GET /fleet/configs/{id}`, `PATCH /fleet/configs/{id}` (`profile`, `role`, `firmware_version`, `label` only; the document cannot be changed), `DELETE /fleet/configs/{id}`
- `POST /fleet/configs/{id}/export` - `{include_secrets}`; answers `{document, secrets_included, secrets_left_out}`. With `include_secrets` it needs a vault session (403 switched off, 401 locked), is `Cache-Control: no-store` and writes a `config_exported` audit row
- `POST /fleet/configs/{id}/template` - `{name, description?}`; a template from a stored config
- `GET/POST /fleet/config-templates`, `GET/PATCH/DELETE /fleet/config-templates/{id}`

The formats. A stored document is the device's own file with nothing added, so an export is again a file the other tool reads:

- **Toolbox file** (repeater, room server): what the Dutch MeshCore toolbox's USB config page writes, `{vars, filter?, region?, hardware?, mqtt?}`. `vars` holds the CLI variables by their CLI names (`guest.password`, `prv.key`, `radio` as `{freq, bw, sf, cr}`). The other sections exist only on firmware that has them and use the toolbox's own field names, not CLI names (`mqtt.wifiPassword`, not `wifi.pwd`; `mqtt.slots[n].token`). The format was read from the toolbox source (`src/hooks/useSerialDevice.ts` `exportConfig`, `src/lib/config/*.ts`) at commit `b36c356`; that repo has no licence file, so no code is taken from it.
- **Companion file**: the version 1 object Settings > Radio exports (`frontend/src/components/settings/SettingsRadioSection.tsx`, `buildConfigProfile`).

Profiles (`stock`, `dmc_repeater`, `dmc_observer`, `companion_v1`) are a label picked by `detect_profile` from the sections present (`mqtt` = observer, `filter` = DMC repeater, else stock; a `region` section alone is stock, the region tree is in stock firmware). They are built in and not editable. A file in neither format is refused; there is no "opaque" profile, because nothing could say where its secrets are.

Rules that must hold:

- **A stored document never holds a secret value.** Every write path goes through `split_secrets`, which replaces each secret with `{"$secret": null}`. The router then stores the value in the vault (`fleet_secrets`, label `config <path>`, e.g. `config vars/prv.key`) and writes the id into the placeholder, or leaves it null when the vault is off or locked and reports the count. A value that was not text gets `"$json": true` on its placeholder and is stored as JSON, so a numeric password comes back as a number.
- **Secrets are found by the file, not by the profile** (`_SECRET_PATHS`: `vars/prv.key`, `vars/guest.password`, `mqtt/wifiPassword`, `mqtt/alertPsk`, `mqtt/snmpCommunity`, `mqtt/slots/*/password`, `mqtt/slots/*/token`, `hardware/bridgeSecret`, companion `private_key`). On top of that a text value under an unknown key whose name matches `_SECRET_NAME` (password, token, psk, secret, ...) is treated as one. `mqtt.owner` is NOT a secret: the firmware stores it as `mqtt_owner_public_key`. An empty value is left as it is.
- **Unknown keys are kept** where they are, in the order they came in, and written back unchanged. Nothing validates the values of a document.
- **An import must not carry `$secret`** (422), and an export only opens secrets whose `asset_id` is the config's asset: an id in a document is not a permission.
- **A private key that belongs to another public key than the asset's is refused** (422, nothing stored). One that is not 128 hex is kept as kind `other`.
- **The same secret is stored once**: same asset, kind, label and value reuses the row. Deleting a config never deletes a secret. `fleet_configs` rows go with their asset (ON DELETE CASCADE); they hold no secret.
- **Export without secrets leaves those keys out** of the file (a placeholder never leaves the app).
- **A template holds no secret at all**: `validate_template` refuses a value or a `{{variable}}` at a secret key and any placeholder other than `{"$secret": null}`. Every `{{name}}` in the document must be a declared variable or one of `asset.label`, `asset.org_serial`, `asset.site_name`. `render_template` gives a text value that is one variable and nothing else the variable's type (`"{{power}}"` becomes the number 20).
- No secret value, and no document, goes into a log line or an audit row.

Tests: `tests/test_fleet_config_service.py` (rules, no database), `tests/test_fleet_config_router.py`, `tests/fleet_config_samples.py` (a hand-built toolbox file and companion file; no value comes from a real device).

#### Compare with what the node reported (plan 32, Phase 2)

- `GET /fleet/configs/{id}/reported` - `{status, rows, not_reported}`. `status` is `ok`, `nothing_stored` (the node has no stored value for any compared key), `no_public_key` (the asset cannot be matched to a node) or `not_a_device_file` (a companion file: a companion has no panes). A row is `{path, configured, reported, reported_at, source, same}`; `source` is a `device_config_history` kind or `snmp`.

Read-only, and it must stay that way: the route reads `DeviceConfigHistoryRepository.get_latest_by_kind` (newest snapshot per pane kind) and `SnmpHistoryRepository.get_latest` for the asset's public key and hands them to `services/fleet_config_reported.py` (`compare`, pure). It never calls the radio and never fetches a pane; `tests/test_fleet_config_reported.py::test_it_only_reads` fails if the route touches the radio runtime. `reported_at` is when the snapshot was stored: `device_config_history` is append-on-change, so a pane read again with the same values keeps the older time.

The compared keys and their rules are the `_RULES` table: `vars/name` (newest of `node_info.name`, `owner_info.name`, SNMP `node_name`), `vars/lat`, `vars/lon`, the four parts of `vars/radio` (from the one `radio_settings.radio` reply), `vars/tx`, `vars/af`, `vars/repeat`, `vars/flood.max`, both advert intervals, `vars/owner.info`, `region/home`. Three sides write one setting three ways, which is what a rule handles: the panes store the CLI reply as text, the toolbox file holds parsed values (numbers, booleans, the radio as an object) and rounds the position to 5 decimals and the frequency to 3. Position and frequency are therefore the same within half of that step. Where `repeater_settings` already has a read-back rule that also fits the file's value (`tx`, `repeat`, `flood.max`, the advert intervals) that rule is reused through `get_spec(...).matches`; it does not fit `lat`/`lon` (the editor expects 6 decimals). A stored `None` or an error reply (`??: ...`) is "not reported", not a difference. The home region is read only from a `cli` dump, and from a truncated one only when it shows a home mark. `guest.password` is never compared: the owner-info snapshot does not store it.

`store_config` in `routers/fleet_config.py` is the one store path: the file import calls it with source `file`, a device read (below) with `usb_browser`. Every rule above holds for both.

#### Over a USB cable in the browser (plan 32, Phase 3)

Router `routers/fleet_device.py` (under `/fleet`), rules `services/fleet_device_cli.py` (pure: no database, no vault, no port). The browser opens the port (Web Serial, `frontend/src/utils/serialCli.ts`) and sends the commands; the server never opens a serial port and never uses the radio (`tests/test_fleet_device_router.py::test_nothing_here_touches_the_radio`). A transport hands over the replies as `{command: reply | null}`, where a reply is what follows `  -> ` on the line up to its `\r\n` (`examples/simple_repeater/main.cpp`), and null means no answer in time.

- `POST /fleet/device/read-step` - `{replies}`; `{done, commands, read}`. Start with `{}` and send `commands` until `done`. `read` is `{identity {public_key, role, firmware_version, board, name}, profile, document, secrets, warnings}`; its document has every secret as `{"$secret": null}` (a preview). 422 when the device does not answer `ver`
- `POST /fleet/assets/{id}/configs/read` - `{replies, label?, set_public_key?}`; 201, the import answer plus `identity`, `public_key_set`, `warnings`. Stored as `snapshot`, source `usb_browser`, role and firmware version from the device. 409 when the device's public key is not the asset's, and for an asset without one unless `set_public_key` (then the asset takes it, 409 when another asset holds it)
- `POST /fleet/configs/{id}/apply-plan` - `{replies, allow_private_key, allow_radio}`; `{identity, steps, rows, reboot, rekey, vault}`, `Cache-Control: no-store` (a step's `command` holds its secret value). 422 for a companion file; 409 when the asset has no public key or the device is another one. Secrets of this asset are opened only with a vault session; that is audited as `config_apply_planned` (count only)
- `POST /fleet/device/check` - `{step, reply, readback}`; `{ok, reason, reply}`. `reply` is empty for a secret step. 422 when the step's command is not allowed
- `POST /fleet/configs/{id}/apply-log` - `{transport: usb_browser, total, results [{display, ok, reply}], stopped_reason?, reboot_needed}`; writes a `config_applied` event (app-written, like `status`)

Reading (`read_commands`, `read_device`) works in three rounds: identity (`ver`, `board`, `get role`, `get public.key`); every `VAR_KEYS` variable the firmware version has (`VAR_MIN_VERSION`), `get prv.key` and the probes (`filter`, `get mqtt.config.valid`, the hardware `get`s, `region`); then the settings of what answered. `read_device` builds the toolbox file with the toolbox reader's types (on/off as booleans, numbers as numbers, `radio` as `{freq "869.618", bw, sf, cr}` text, `owner.info` with newlines, `lat`/`lon` to 5 decimals, `multi.acks` as text) and leaves out a key the device did not answer, so a stored snapshot is the file the toolbox would have saved. Deviations, on purpose: the packet filter's `filter rate` lines with a third number (the soft limit, this firmware) are read (the toolbox's reader misses them and writes defaults); an observer value shown as `******** (serial only)` is stored empty with warning `hidden:<key>`; a region dump of 150 characters or more gives warning `region_cut_off` (the firmware's reply is 160 bytes).

Applying (`plan_apply`, `check_step`):

- **What may be sent** is `command_allowed`, checked when a step is made, again by `/device/check`, and a third time in the browser: `ver`, `board`, `get <key>`, `set <key>` (not `set freq`), `filter` with `hops|rate|channel list/add/remove|hash|malformed|on|off`, `region` with nothing, `home`, `default` or `save`. No `\r`/`\n`, at most 159 characters (the firmware's line buffer). So never `erase`, `reboot`, `advert`, `password`, `region put/remove/load/def`.
- **The device must be the asset**: its public key is the asset's (`rekey` false), or the document's private key derives to the asset's public key and `allow_private_key` is on (`rekey` true). Otherwise `DeviceMismatchError` (409).
- **One step per setting that differs**, only for settings the device has (`not_on_device` otherwise), each with the commands that read it back and the value they must show. `prv.key` needs `allow_private_key` and is the last step; its check is the reply's `New pubkey` (a `get prv.key` shows the old key until a restart). `radio` needs `allow_radio`. A value with a line break, a radio outside the firmware's limits or a wrong type is `bad_value`. A key the table does not know is `unknown_key` (kept in the file, never sent).
- **Sections** follow the toolbox's own write order: filter (hash, malformed, hops, rates keeping the device's soft limit, channels, on/off last), region (home and default only when that region is in the device's tree, `region save` after a home change; the tree itself is `region_tree`, never rewritten), hardware (only what the build supports), mqtt (globals, Wi-Fi and time, slots with the preset first, alerts with the switch last, SNMP). `mqtt.status` cannot be read back: its check is the reply only.
- **Secrets**: `resolve_secrets` fills each placeholder from the vault values the router opened; one without a value is `secret_unavailable`. A secret step's `display` ends in `********`, `reply_shown` gives nothing for it, and check reasons are codes (`no_reply`, `unexpected_reply`, `no_readback`, `readback_differs`, `other_public_key`), never values.
- **Reply checks**: `set` answers start with `OK`; `filter` answers are `> Filter: OK|on|off|channel X added|removed|malformed scan on|off`; `region home|default X` answers `home is now` / `default scope is now`. A read-back is compared in the file's own form (`same_var`: position within 0.000005, frequency within 0.0005, on/off as booleans).
- Nothing restarts the device: `reboot` on a step only tells the user.

Tests: `tests/test_fleet_device_cli.py` (rules, no database), `tests/test_fleet_device_router.py`, `tests/fleet_device_cli_samples.py` (replies hand-built from the firmware source's formats, no real device).

### Channels
- `GET /channels`
- `GET /channels/{key}/detail`
- `POST /channels`
- `POST /channels/bulk-hashtag`
- `DELETE /channels/{key}`
- `POST /channels/{key}/flood-scope-override`
- `POST /channels/{key}/summarize-unread?after=<last_read_at>` - Ollama catch-up summary (`services/ollama_summary.py`). Returns `{summary, message_count, reason}`. Does nothing, and sends nothing anywhere, unless `app_settings.ollama_enabled` is set and `ollama_model` is non-empty (migration `_136`; `ollama_base_url` is validated on write in `routers/settings.py`). Sends up to 100 channel messages received at or after `after` (the client passes the read boundary it captured before marking the channel read); with more than 100, the newest (`MessageRepository.get_latest_since`). Only what the chat shows: no blocked senders, no incoming messages hidden by `hidden_hop_widths`, no malformed-flagged ones when `hide_malformed` is on, and no spam-flagged ones when `hide_spam` is on. `summary_cache` keeps the last finished summary per channel in memory and returns it while server URL, model, channel name and message ids are the same; callers for one channel wait for each other, so two at once share one request; failures are not kept. Stored channel text already starts with `Sender: `, so `format_messages_for_prompt` strips that prefix before attributing the line. Upstream errors are logged, never returned
- `POST /channels/{key}/path-hash-mode-override`
- `POST /channels/{key}/mark-read`
- `POST /channels/{key}/mark-unread` - `{message_id}`, marks unread from that message onward

### Communities
meshcore-open communities (`app/communities.py`, port of `lib/models/community.dart`; router `app/routers/communities.py`; table `communities` from migration `_110`). A community is a 32-byte secret `K` plus a name. Keys: public channel `HMAC-SHA256(K, "channel:v1:__public__")[:16]`, hashtag channel `HMAC-SHA256(K, "channel:v1:" + normalized)[:16]` (strip one leading `#`, lowercase, trim), community ID `SHA256("community:v1" || K)` hex. Channel names `"<name> Public"` (cut to 32 UTF-8 bytes) and `"<name> #<tag>"` (400 when over 32 bytes). Channels are DB-only (`is_hashtag=false`, `on_radio=false`) like `POST /channels`; an existing key is left untouched. Nothing transmits. `K` is stored in `communities.secret` so hashtags can be added later; it is never logged and only `GET /communities/{id}/export` returns it (`Cache-Control: no-store`). It is also in DB backups.
- `GET /communities` - joined communities with their derived channels (matched by key; hashtag channels by `"<name> #<tag>"` name plus key check). No secret
- `POST /communities/join` - body `{payload, add_public_channel=true, try_historical=false}`; `payload` is the QR JSON `{"v":1,"type":"meshcore_community","name":...,"k":<base64url, 32 bytes>}` (padded or unpadded; a leading `#` in the name is dropped because meshcore_py re-derives the key of a channel whose name starts with `#`). Re-joining the same secret keeps the stored row (`already_joined`). 202 when a historical decrypt sweep starts
- `POST /communities/{id}/hashtags` - body `{hashtag, try_historical=false}`: create `"<name> #<tag>"` with the community-derived key
- `GET /communities/{id}/export` - `{id, name, payload}`: QR JSON including the secret (padded base64url, like meshcore-open)
- `DELETE /communities/{id}` - forget the community and its secret; its channels stay

### Channel sets (UI: "Loadouts")
Named groups of channels and contacts loaded onto the radio in one action (plan 08; router `app/routers/channel_sets.py`, apply logic `app/services/channel_set_apply.py`). The UI calls them loadouts; code, API paths and the column keep the `channel_set` name. Stored as a JSON array in the internal-only `app_settings.channel_sets` column (migration `_122`), not part of `AppSettings`. Each entry keeps the channel key or full contact key plus the name it had when saved; sets saved before contacts existed read back with `contacts: []`. Local radio commands only; nothing transmits.
- `GET /channel-sets` - saved sets, oldest first
- `POST /channel-sets` - body `{name, channel_keys=[], contact_keys=[]}`: channel keys upper-cased, contact keys lower-cased, duplicates dropped, order kept; every channel key must be a stored channel and every contact key a stored contact with a full 64-char key (400 names the unknown ones); blank name, or no channels and no contacts, is 422
- `PATCH /channel-sets/{id}` - rename and/or replace `channel_keys` / `contact_keys`; 400 when the result would hold neither
- `DELETE /channel-sets/{id}` - delete the set; its channels and contacts stay
- `POST /channel-sets/{id}/apply` - under the radio operation lock. Channels: reads every slot with `get_channel`, then writes each set channel that is not already on the radio into the first empty slot with `set_channel`. Additive: never evicts another channel (`no_free_slot` when full), keeps going after a failed write (`radio_error`), uses the channel's current DB name (the saved name when the channel was deleted), and records written/found slots in the send-slot cache (`note_channel_slot_loaded`). When slots are not reused (TCP, `MESHCORE_FORCE_CHANNEL_SLOT_RECONFIGURE`) slot 0 is skipped because every channel send writes there first. Contacts: reads the radio's contact list once (`get_contacts`; falls back to the library cache when that fails), then `add_contact` for each set contact not already there, using the stored contact record. Never removes a contact; `table_full` (firmware error 3) fails that contact and every later one without sending; `unknown_contact` when the contact is no longer in the DB; `excluded` when its `radio_policy` is `excluded`; `radio_error` otherwise. Returns `{set_id, items: [{key, name, status, slot, error}], contact_items: [{public_key, name, status, error}], loaded, already_loaded, failed}` (counts cover channels and contacts). Channels are point-in-time: the next reconnect or full periodic sync offloads the slots again (`sync_and_offload_channels`). Contacts that end up on the radio (loaded or already there) are protected until the next connect: `radio_sync.protect_loadout_contacts` keeps them in memory and `get_radio_residency` puts them in the first tier after pinned contacts (reason `loadout`), so the reconcile loop does not remove them; `run_post_connect_setup` clears the list. Protection adds up over several applies and is not persisted

### Messages
- `GET /messages` - list with filters; supports `q` (full-text search with the operators `user:`, `channel:` and `region:`; `region:` takes a region name without case or leading `#`, `none` for no transport code, `unknown` for a code that matched no known region), `after`/`after_id` (forward cursor)
- `GET /messages/around/{message_id}` - context messages around a target (for jump-to-message navigation)
- `GET /messages/locations` - location shares in DM + channel messages received in `(since, until]`, newest first; `latest_per_sender` (default true) keeps one per sender (self / DM partner / channel sender key, else name). Parsing in `app/location_payloads.py` (MeshCore SAR `S:` marker, meshcore-open `m:` marker, upper-case MGRS via `app/mgrs.py`, `lat, lon` with 4+ decimals); service `app/services/shared_locations.py` scans at most 20,000 newest rows (`truncated`). Local map only, never fanned out
- `GET /messages/beacons` - MeshCore TEAM position beacons (`#TEL:`, `#T:`, also sent by signalk-meshcore) and waypoints (`#WAY:` + `#WRC:` route parts) in channel messages received in `(since, until]`, newest first; `latest_per_sender` (default true) keeps one beacon per sender; `sender_key` narrows to one contact (by key, or by contact name for rows stored without a key). Parsing in `app/team_payloads.py` (mirrored in `frontend/src/utils/teamPayloads.ts`); service `app/services/team_beacons.py` pre-filters rows on the prefixes in SQL, scans at most 20,000 (`truncated`), reassembles multi-part routes per sender + channel + mesh id and drops beacons without a fix. Receive only; local map and contact history only, never fanned out. Sending: `app/services/team_beacon_sender.py` runs a task (started with the other periodic tasks after radio connect) that sends `encode_telemetry()` output on the channel in `app_settings.team_beacon` when its master toggle is on; it refuses the Public channel and hashtag channels and needs a connected radio and a set `adv_lat`/`adv_lon`. Migration `_128` adds `app_settings.team_beacon` (JSON) and `contacts.vessel_type` (annotation, hand-set, picks the beacon icon)
- `GET /trackers` - ATAK users (TAK-MESHCORE), MeshCore SAR fast-GPS and MeshCoreNG tracker fixes received in `(since, until]`, newest first, plus ATAK map objects that are not stale; `latest_per_identity` (default true, per `source` + identity), `source` (`atak` / `sar_fast_gps` / `meshcoreng`), `identity` (case-insensitive; the contact pane asks for a SAR contact's key prefix), at most 5,000 positions (`truncated`), plus `counts` of unreadable frames. Router `app/routers/trackers.py`, rows written by `app/services/trackers.py`. Local map only, never fanned out
- `GET /tak-stream/status` - `{enabled, host, port, clients}` of the TAK Stream (`app/tak_stream/`), a plaintext CoT TCP server started in the lifespan only when `MESHCORE_TAK_STREAM_ENABLED` is true (`MESHCORE_TAK_STREAM_HOST` / `_PORT`, default `0.0.0.0:8088`). Snapshot on connect and every 30 s (`ContactRepository.get_positioned`, trackers, objects, TEAM beacons; blocked contacts left out), live tracker pushes, max 16 clients, a client whose 256-event queue fills or whose write stalls 5 s is dropped, inbound bytes discarded, mesh-supplied strings stripped of XML-1.0-illegal characters. Multi-radio: `MESHCORE_TAK_STREAM_*` is in `gateway/supervisor.NOT_INHERITED_ENV` (not passed from the gateway to workers, but a radio may set it in its own `env`). Never transmits on RF
- `POST /messages/direct` - 422 before anything reaches the radio when the text is over 160 UTF-8 bytes (`RADIO_MAX_TEXT_BYTES` in `services/message_send.py`, the firmware's `MAX_TEXT_LEN`; the radio refuses such a DM)
- `POST /messages/channel` - same 422 when `"<radio name>: "` plus the text is over 160 bytes; the radio would cut it short without saying so. The composer blocks earlier, at 156
- `POST /messages/direct/{message_id}/resend` - retry a failed DM as a new message and remove the failed row (see Outgoing messages)
- `POST /messages/channel/{message_id}/resend`
- `GET /messages/{message_id}/reaction-target` - resolve an emoji reaction to the message it reacts to: same conversation, up to 7 days before (`app/reaction_payloads.py`). Dialects:
  - `@[Name]emoji\nhash` / `emoji\nhash`: SHA-256 of the target's body (without `Sender: `) + its sender timestamp (LE uint32), first 5 bytes as Crockford Base32. Checked against real traffic and a known-answer vector.
  - meshcore-open `r:<hash>:<index>`: Dart `String.hashCode & 0xFFFF` of `<ts><sender name><first 5 UTF-16 units of body>` (sender name left out for 1:1 DMs). Only 16 bits, so the newest match wins. The Dart hash is ported from the Dart SDK source; there is no real-traffic vector yet.
  - meshcore-open v1 `r:<millis>_<nameHash>_<textHash>:<emoji>` (clients before 2026-01-29): full Dart hashes of the sender name and body.
  - A target with a leading `@[Name] ` reply prefix is also tried with it stripped (meshcore-open hashes replies that way). `target` is null when it was never received; 400 for non-reactions
- `POST /messages/{message_id}/react` - body `{emoji}`; sends a reaction in that same wire format through the normal channel/DM send path (so it is stored, echo-tracked and shown like any sent message). 400 for non-emoji, a reaction target, or a channel row without a sender
- `DELETE /messages/{message_id}` - hard-deletes the message row, its linked raw packet, and any stored reaction that resolves to it (`_find_reactions_targeting`, the inverse of the reaction-target search window), all in one transaction (`MessageRepository.delete_with_raw_packets`, mirroring the retention pruner's message prune). Local only, nothing sent over RF. If the message is an outgoing DM with a background retry still in flight (`services/message_send.py`), the retry is stopped via `services/dm_ack_tracker.mark_message_deleted`. Broadcasts one `message_deleted` WS event per deleted row. 404 if the message does not exist

### Packets
- `GET /packets/undecrypted/count`
- `POST /packets/region-backfill` - re-resolve region scope for stored channel messages that still have a retained raw packet (region is otherwise only tagged at ingest); returns `{scanned, scoped, named}`
- `GET /packets/recent?limit&after_ts&before_ts` - recent raw packets, oldest-first, in the `raw_packet` broadcast shape (raw-feed DB history), with `malformed` from the linked message and the stored `policy` verdict
- `GET /packets/history?limit&after_ts&before_ts&before_id&payload_types&hop_widths&hex&search&policy_only` - Packet History browser: pages backward (newest-first) through persisted `raw_packets` with a `before_id` cursor; `search` matches decrypted message text / sender / channel name and the stored policy rule name; `policy_only` keeps packets with a stored OpenHop policy verdict (partial index `idx_raw_packets_policy`). Each packet carries `policy` (`{action, rule}` or null). Returns `{packets, next_cursor}`. Reach is bounded by `app_settings.raw_packet_retention_days` (`0` = keep forever)
- `GET /packets/timeseries?start_ts&end_ts&bin_count` - time-binned packet counts, byte totals, signal averages, and type breakdowns for historical chart ranges
- `GET /packets/historical-stats?start_ts&end_ts` - DB-computed aggregate stats for a window (My Node history)
- `GET /packets/mesh-health?start_ts&end_ts` - per-contact advert frequency (direct/flood) for Mesh Health; HIGH/MEDIUM alerts are evaluated on the flood count only
- `GET /packets/mesh-health/heard-bins?start_ts&end_ts&bin_count` - which contacts were heard (by advert, `advert_events`) in each of `bin_count` (1-200) equal bins; read-only, for the mesh summary share card
- `GET /packets/prefix-collisions` - public-key prefix collisions among full-key local contacts at 1/2/3-byte widths (Mesh Health "Prefix Collisions" tab). Point-in-time over contacts, not window-scoped. See `app/services/prefix_collisions.py`
- `GET /packets/snr-rssi-scatter`, `GET /packets/hourly-heatmap`, `GET /packets/reachability-rings` - windowed signal scatter, 7x24 UTC packet heatmap, and unique contacts by minimum hop distance
- `GET /packets/relay-pairs?limit` - most frequent consecutive node pairs across advert paths
- `GET /packets/traffic-links?since&until&heard_only&max_km` - map links from the per-packet edge log (`link_edge_events`), aggregated per `(a, b, hop_width)` over the window: `count` (distinct packets), `first_seen`, `last_seen`, `ambiguous` (every sample in the window was a distance-based `nearest` resolution). Endpoints without a current location are dropped; `heard_only`/`max_km` as for advert-links
- `GET /links/{a}/{b}/summary|timeseries|packets` (`app/routers/links.py`) - per-link history for the link detail page. Keys in either order (normalised to sorted lowercase). `summary?since&until`: endpoint names/kinds/coords, distance, `involves_self`, totals and breakdowns by hop width, confidence and payload type. `timeseries?since&until&bucket=hour|day`: distinct packets per UTC bucket and payload type, plus SNR/RSSI avg/min/max per bucket (only the edge into our node carries signal). `packets?limit&before`: newest-first edge rows with a `ts` cursor
- `GET /packets/advert-links?limit&heard_only&max_km&since&until` - resolved advert-path edges for the map link layer (`since`/`until` filter `advert_events.first_seen`). `heard_only=true` resolves hops only against contacts with `last_seen` set (no never-heard contacts, no analyzer-only `external_map_nodes`); `max_km` (> 0) drops candidates farther than that from the previous hop (breaking the chain) and any longer direct/tail edge. The map's link layer uses both; the wrong-location filter fetches without them
- `GET /packets/{packet_id}` - fetch one stored raw packet by row ID for on-demand inspection
- `POST /packets/who-heard` - body `{data: <hex>, lookup: bool}`. Always returns the firmware packet hash (`calculate_packet_hash`, lower case), the analyzer host (`analyzer_base_url(external_map_sync_url)`) and a packet link per `analyzer_sites` entry with a `packet_url_template`; nothing leaves the server for that. With `lookup` true it also sends the hash to `GET {host}/api/packets/{hash}` and returns the observers (`services/analyzer_packet_lookup.py`, capped at 500, oldest first). 400 for data that is not a packet, 502 when the analyzer cannot be asked. Takes raw hex rather than a row id so a pasted packet works too
- `GET /packets/request-traffic` - single-node REQUEST/RESPONSE traffic in a window: totals (requests, anon, responses, flood/direct split), a time-bucketed series, and top src→dest 1-byte-hash pairs (Mesh Health "Requests" panel). Parses `raw_packets` filtered by `payload_type IN (REQUEST, ANON_REQUEST, RESPONSE)`; makes no answered/unanswered judgment (a single node cannot hear responses routed around it)
- `GET /filter-stats?start_ts&end_ts&channel&buckets&limit` - spam, malformed, duplicate and bot statistics over incoming channel text messages in the window (Mesh Health "Spam & bots" tab). `routers/filter_stats.py` reads rows through `repository/filter_stats.py` and hands them to the pure aggregator `services/filter_stats.py::aggregate_filter_stats` (run in a thread, as is the building of the rows in the repository: measured at over a second per 100,000 messages). Returns `totals`, a bucketed `series` (`buckets` 1-200, default 48; a window longer than `MAX_WINDOW_DAYS` = 92 answers 400, since every row of the window is read into memory), `senders` and `sources` (cut to `limit` 1-500, default 200, with `*_truncated`), `channels` (with `public`: the Public channel or a #name whose key derives from it), `filters` (Spam Guard outcome split, enforced vs not, per block source, user labels, `flagged_later`, `not_recorded`), `policy_rules` (OpenHop verdicts from `raw_packets.policy_action` / `policy_rule`, passed through `clean_policy_rules`: Spam Guard names its rules after the channel key, so a 32 hex key in a rule name is replaced by the channel name when the channel is public and by a short one-way id otherwise, and rows that become equal are added up), plus `spam_guard_enabled`, `bot_lists_enabled` and `app_version`. Bots are counted two ways: `bot_now` matches `sender_name` / `sender_key` against the enabled lists minus exceptions at query time, `bot_flagged` is the stored `messages.bot`. The first relay of a message comes from the first entry of `messages.paths` (`first_hop`, via `path_utils.split_path_hex`). Per-message columns (migration `_148`): `bot` and `malformed_reason` are written at ingest in both channel paths of `services/messages.py` (`_is_listed_bot`, `malformed.malformed_reason`); `spam_outcome` / `spam_block` / `spam_enforced` are written by `SpamGuardRuntime._after_decide` from `DecideResult.settled`, which the detector fills in `_settle` using `_outcome`, the same rule its hourly counters use (`_count`); `spam_label` is written by `set_message_spam` (a failed write is logged; the chat flag still follows the answer). `Event.enforced` is set at arrival by `SpamGuardRuntime._enforcing`, which airtime counting shares. A failed outcome write is logged and changes nothing else. No text of a message is returned
- `GET /packets/relay-reception?start_ts&end_ts&limit&offset` - per-relay reception of the same flooded packet (Mesh Health "Relay reception" tab, plan 21 S1): groups `packet_receptions` (migration `_118`, one row per received copy of a flood/transport-flood packet, written by `app/services/relay_reception.py::record_packet_reception` right after `raw_packets` dedup; direct routes are skipped because their path is popped, plan 21 Q3) by payload hash into packets x relays (`last_hop_hex` = last path chunk via `path_utils.last_hop_hex`, null = heard from the origin) with best/last SNR and RSSI per cell, plus a per-relay summary. Relay hashes resolve to a contact only on a unique full-key prefix match (`candidates` > 1 = collision); the per-relay summary merges hashes of different path widths that resolve to the same contact (`relay_identity`, labelled with the longest hash). Pruned by `packet_reception_retention_days` (default 2). No row cap: the per-relay summary and the totals (`receptions`, `total_packets` = sum of first arrivals, `multi_relay_packets`) are SQL aggregates (`repository/packet_receptions.py::relay_stats_sql`), and each summary row adds `first_arrivals` (packets whose first copy, lowest id, came via this relay), `unique_packets` (heard only via this relay), `avg_rssi`/`last_rssi` and `relay_hexes` (the merged hashes). The per-packet pivot pages stored copies with `limit` (1-200) and `offset` (`packet_total`, `packet_offset`). Long-term history: before each retention prune, `services/retention_pruner.py::prune_once` calls `relay_reception.rollup_relay_history`, which folds every complete hour into `relay_reception_hourly` (migration `_124`, one row per hour x relay hash, `''` = origin; sums/counts so rows merge; a packet's first arrival and uniqueness are credited to its first copy's hour, judged over a 10-minute padded context), resuming after the newest rolled-up hour; if the rollup fails the raw prune is skipped that run. Pruned by `relay_history_retention_days` (default 365, `repository/relay_history.py`). `relay_reception.split_window` answers a window from stored copies where they exist and from the hourly history for older hours (`raw_since`, `history_from` in the response). `GET /packets/relay-reception/relay?start_ts&end_ts&relay=<hash>` (repeatable, `''` = origin): one relay's totals and a bucketed series (about 60 buckets, 1 h minimum when the hourly history is used) over the whole window, plus payload-type / hop-count breakdowns and the 25 newest copies (with `first` and relay count) from stored copies only (expanded summary row in the tab). `record_packet_reception` returns a `RelayCapture` (or None) that `process_raw_packet` copies into the `raw_packet` broadcast (`relay_reception`, `last_hop_hex`)
- `POST /packets/decrypt/historical`
- `POST /packets/maintenance`

### Partial-node resolution
Resolves partial nodes (prefix-only placeholder contacts and 1/2/3-byte hop hashes
seen in paths but never heard via a full advert) against the external-map cache.
A soft link (prefix -> full pubkey) is stored in `partial_node_resolutions` (keyed
by `prefix_hex`) for provenance and advert-links map disambiguation. Scoring is
pure (`app/services/partial_resolution.py`): a unique candidate is high-confidence;
ambiguous candidates rank by prefix width, candidate count, and distance from the
prefix's located path-neighbours.
- `GET /partial-resolutions/preview` - scan + propose matches (read-only; returns a
  `reason` when the external-map cache is empty)
- `POST /partial-resolutions/apply` - for each selection: record the soft link,
  then **promote** the node to a full contact so its info applies live. It creates
  the full contact from the external-map node (name/location go in the *advertised*
  fields, so a later RF advert overwrites the guess; an already-existing contact is
  left untouched), runs `promote_prefix_contacts_for_contact` to merge the
  placeholder in, and broadcasts `contact` / `contact_resolved` WS events. Returns
  `{applied, promoted}`.
- `GET /partial-resolutions` - list current soft links
- `DELETE /partial-resolutions/{prefix_hex}` - clear one soft link (does not
  un-promote a contact already created)
Read-time enrichment also consumes the soft links: `ContactInfoBody` display +
analyzer button for still-unpromoted prefix-only contacts, the advert-links
resolver (`resolve_advert_edges`'s `confirmed` arg disambiguates a hop to the
chosen node), and a Prefix Collisions tab badge. The frontend also reads
`GET /partial-resolutions` to name linked hop prefixes in the packet visualizer
and the path modal (`hooks/useSoftResolutions.ts`).

### Read state
- `GET /read-state/unreads` - counts, mention flags, `last_message_times`, `last_read_ats`, and `first_unread_ids`
- `POST /read-state/mark-all-read`

### Settings
- `GET /settings`
- `PATCH /settings`
- `POST /settings/favorites/toggle`
- `POST /settings/blocked-keys/toggle`
- `POST /settings/blocked-names/toggle`
- `POST /settings/tracked-telemetry/toggle` - turning tracking off also drops the repeater from `clock_sync_repeaters`; the response carries that list
- `POST /settings/clock-sync-repeaters/toggle` - opt a tracked repeater in or out of clock sync (`app_settings.clock_sync_repeaters`, migration `_139`; 400 for a repeater that is not tracked). Node clocks are read passively from adverts: `advert_events.sender_timestamp` (migration `_139`) next to `first_seen` gives `offset = sender_timestamp - first_seen`, shown as `clock` in `GET /contacts/analytics`. In a telemetry cycle, after the status request of an opted-in repeater succeeds, `radio_sync._maybe_sync_repeater_clock` asks `services/clock_drift.plan_clock_sync` and sends one CLI `time <now>` only when the repeater's newest advert reads more than 120 s behind, that advert is newer than the last attempt, and the median offset of at least 5 other nodes heard in the last 24 h is within 300 s (the host clock agrees with the mesh). The firmware never moves a clock back, so an "ahead" repeater is only logged
- `GET /settings/tracked-telemetry/schedule` - current telemetry scheduling derivation, interval options, and next-run-at timestamp
- `POST /settings/tracked-telemetry-contacts/toggle` - toggle tracked LPP telemetry for any contact, repeaters included (max 8)
- `GET /settings/tracked-telemetry-contacts/schedule` - contact telemetry scheduling (shared ceiling with repeaters)
- `POST /settings/muted-channels/toggle`

### Backup and restore
- `GET /backup/download` - stream a `VACUUM INTO` snapshot of the database
- `POST /backup/save` - write a snapshot (`meshcore-backup-<stamp>.db`) to `backup_destination_path` (requires `backup_to_path_enabled`)
- `GET /backup/files` - list `*.db` files in the backup directory, newest first, each tagged `auto` / `manual` / `pre-restore` / `other`
- `GET /backup/restore` - `{pending, last_result}`: a staged restore and the outcome of the last applied one
- `POST /backup/restore/upload` (multipart `file`) and `POST /backup/restore/server` (`{filename}`, bare name inside the backup directory) - validate a backup (SQLite header, `quick_check`, RemoteTerm tables, schema not newer than this build) and stage it as `<db>.restore-pending`
- `DELETE /backup/restore` - cancel the staged restore; `DELETE /backup/restore/result` - forget the last outcome
- A staged restore is applied by `app/services/db_restore.py:apply_pending_restore` at the top of `lifespan`, before `db.connect()`: it snapshots the current DB to `meshcore-pre-restore-<stamp>.db` next to it, removes the old `-wal`/`-shm`, swaps the file in, and the normal migrations then upgrade it. Scheduled snapshots (`meshcore-auto-<stamp>.db`, keep-N rotation of those files only) run from `app/services/backup_scheduler.py`

### Retention
- `GET /retention/stats?messages_days` - per-class row count + oldest timestamp (`app/repository/retention.py`), prune-service interval / last run / next run / last result; `messages_days` adds `messages_would_delete` (preview for the UI confirm)
- `POST /retention/prune` - run `retention_pruner.prune_once()` now; returns rows deleted per class

### Fanout
- `GET /fanout` - list all fanout configs
- `POST /fanout` - create new fanout config
- `PATCH /fanout/{id}` - update fanout config (triggers module reload)
- `DELETE /fanout/{id}` - delete fanout config (stops module)

### Statistics
- `GET /statistics` - aggregated mesh network stats (entity counts, message/packet splits, activity windows, busiest channels, `region_scope_24h` regional adoption)
- `GET /statistics/battery`, `/statistics/battery/range`, `/statistics/noise-floor` and `/statistics/airtime/range` take optional `radio_id` (that radio plus the radios it inherits stats from; 404 when unknown) or `unassigned=true` (samples from before radio tracking). Default: the active radio's lineage, or every sample when no radio was ever registered. The 24 h battery endpoint only merges in-memory samples when the read covers the active radio; the OpenHop airtime branch only serves the default.
- `GET /statistics/airtime/range?start_ts&end_ts&bin_count` - per-bin TX/RX airtime utilization % over a range. Default source: the persisted cumulative airtime counters via adjacent-sample deltas (counter resets / disconnect gaps are dropped, not spiked). On OpenHop nodes with the OpenHop API configured, it instead sources TX/RX from OpenHop's `/api/airtime_chart_data` (real per-packet time-on-air, RX included) because OpenHop's companion `STATS_RADIO` frame hardcodes `rx_air_secs=0`; any failure / missing config / non-OpenHop node falls back to the local computation. Each bin also carries `rx_errors`: on the local path the sum of `recv_errors` counter deltas (None when unknown); on the OpenHop path the radio CRC error counts from OpenHop's `/api/crc_error_history`, bucketed like the airtime buckets (0 for a bucket with no rows, key omitted when that call fails). Feeds the My Node airtime and receive-error charts. See `app/services/airtime_util.py` (`compute_airtime_utilization`, `map_openhop_airtime_buckets`) and `app/services/openhop_api.py::airtime_chart_data` / `crc_error_history`.
- `GET /packets/raw-feed-stats?start_ts&end_ts` - DB-computed Raw Packet Feed breakdowns (payload/route/hop/hop-byte-width/RSSI buckets + counts) for historical windows, from the decoded columns persisted on `raw_packets`, plus `median_rssi`, a ten-bin `timeline` (`start_ts`, `total`, `counts_by_type`), `unique_sources` and the top five `strongest_neighbors` / `most_active_neighbors` / `newest_neighbors` (Mesh Trends windows from 20m up and custom ranges). A packet's sender is worked out in SQL (`_SOURCES_SQL`, grouped per sender) the way `getSourceInfo` in `frontend/src/utils/rawPacketStats.ts` does it live: the stored message's `sender_key` / sender name (channel) or `conversation_key` (direct), else from the bytes at the payload offset the stored `route_type` / `hop_count` / `hop_byte_width` give (advert public key, anon request sender key, `hash1:<source hash>` of an undecrypted direct message, request or response). Rows with `route_type` NULL or `Unknown` give no byte-derived sender. Counts are per stored packet (one row per `payload_hash`), the live windows count every reception. Synthetic timing: 190,000 packets over 30 days in about 2.6 s. See `app/services/raw_feed_stats.py`.

### Push
- `GET /push/vapid-public-key` - VAPID public key for browser `PushManager.subscribe()`
- `POST /push/subscribe` - register/upsert push subscription (keyed by endpoint URL)
- `GET /push/subscriptions` - list all push subscriptions
- `PATCH /push/subscriptions/{id}` - update label or filter preferences
- `DELETE /push/subscriptions/{id}` - delete subscription
- `POST /push/subscriptions/{id}/test` - send test notification
- `GET /push/conversations` - global list of push-enabled conversation state keys
- `POST /push/conversations/toggle` - add or remove a conversation from the global push list

### WebSocket
- `WS /ws`
- `WS /ws?events=chat` - same stream minus the event types in `EVENT_PROFILES["chat"]` (`raw_packet`, `host_repeater`); used by the frontend chat popup. `WebSocketManager` keeps the excluded set per connection and `broadcast()` skips those connections. Unknown profile names mean the full stream.

## WebSocket Events

- `health` - radio connection status (broadcast on change, personal on connect, and after each 60 s stats sample); includes `radio_identity`, so a pending radio question reaches tabs opened later
- `contact` - single contact upsert (from advertisements and radio sync)
- `contact_resolved` - prefix contact reconciled to a full contact row (payload: `{ previous_public_key, contact }`)
- `message` - new message (channel or DM, from packet processor or send endpoints)
- `message_acked` - ACK/echo update for existing message (ack count + paths)
- `message_failed` - outgoing DM ran out of retries without an ACK (payload: `{ message_id, failed_at }`)
- `raw_packet` - every incoming RF packet (for real-time packet feed UI); `relay_reception` is true when the copy was stored in `packet_receptions` (flood-routed) and `last_hop_hex` then names the delivering relay (null = heard from the origin), so the Mesh Health Relay reception tab refreshes on arrival; `malformed` is the chat filter's verdict on a decrypted channel message (also on `GET /packets/recent`, from the linked message); `policy` (`{action, rule}` or null) is the OpenHop policy rule that decides the packet as worked out by `services/policy_verdict.py`, an indication. The verdict of a packet's first reception is stored on its row (`raw_packets.policy_action` / `policy_rule`, migration `_141`, passed to `RawPacketRepository.create`); the broadcast carries the verdict of each reception
- `contact_deleted` - contact removed from database (payload: `{ public_key }`)
- `channel` - single channel upsert/update (payload: full `Channel`)
- `channel_deleted` - channel removed from database (payload: `{ key }`)
- `message_deleted` - message row removed: a local delete (one event per row, so a deleted reaction gets its own event alongside its target) or a failed DM replaced by a manual retry (payload: `{ message_id, type, conversation_key }`)
- `host_repeater` - host repeater settings saved (payload: `{ version, settings, state, env_enabled }`)
- `spam_guard` - Spam Guard changed (payload: the small summary from `SpamGuardRuntime.public_state()`; clients refetch `GET /spam-guard`)
- `message_spam` - the spam flag changed on messages already in chat (payload: `{ message_ids, spam }`); the arriving message carries `spam` in its own `message` event
- `bot_lists` - a bot list, an entry or an exception changed (payload: the full `GET /bot-lists` body, which clients keep as their copy)
- `new_node` - a public key never stored before (first advert ever, or the radio's own NEW_CONTACT auto-add); batched into a summary on a busy mesh. See "New-node notifications" below
- `error` - toast notification (reconnect failure, missing private key, stuck radio startup, etc.)
- `success` - toast notification (historical decrypt complete, etc.)

Backend WS sends go through typed serialization in `events.py`. Initial WS connect sends `health` only. Contacts/channels are loaded by REST.
Client sends `"ping"` text; server replies `{"type":"pong"}`.

## Data Model Notes

Main tables:
- `contacts` (includes `first_seen` for contact age tracking and `direct_path_hash_mode` / `route_override_*` for DM routing; plus user-editable annotations `notes`, `owner_info`, `owner_key`, `manual_lat`, `manual_lon` - preserved through radio-sync upserts via `COALESCE`, never overwritten by adverts. `owner_key` references another contact; `manual_lat`/`manual_lon` are fallback coordinates used when the contact has no valid advertised location - by the frontend map/paths (`getEffectiveLocation`) and by the advert-links layer's `located_nodes()` query, which resolves the same advertised-wins/manual-fallback effective location so a manual-only node is still an edge endpoint. `battery_chemistry`, migration `_108`, nullable, follows the `telemetry_perms` pattern: absent from the upsert's column list entirely, so radio-sync never touches it, only `set_annotations` does. `power_source`, migration `_126`, nullable, same pattern: NULL = auto, the frontend (`frontend/src/utils/powerSource.ts` `resolvePowerSource`) then detects it from the name: "DTIS |" prefix = solar + battery, else the power icons)
- `channels`
  Includes optional `flood_scope_override` for channel-specific regional sends and optional `path_hash_mode_override` for per-channel path hop width.
- `messages` (includes `sender_name`, `sender_key` for per-contact channel message attribution)
- `link_edge_events` (migration `_107`) - per-packet link edge log: one row per resolved undirected node pair (`a_pubkey < b_pubkey`) per stored packet (`raw_packet_id`), with `ts`, `hop_width`, `payload_type`, `route_type`, `confidence` (`unique`/`confirmed`/`nearest`) and `snr`/`rssi` on the final hop into our node only. `UNIQUE(raw_packet_id, a_pubkey, b_pubkey, hop_width)`, so duplicate copies and the backfill are idempotent (first copy's signal wins). Covering index `ix_link_edge_events_group` (migration `_125`) on `(a_pubkey, b_pubkey, hop_width, ts, raw_packet_id, confidence)` keeps the `/packets/traffic-links` window aggregation (`window_edges`) index-only. Written by `services/link_edges.record_packet_edges()` from `process_raw_packet` for every copy; resolution is the pure `services/traffic_links.py` (flood paths only, walked back from self and forward from an advert origin that is a contact; a hop needs a confirmed soft resolution, a unique prefix among the candidates, or a nearest located candidate at least `NEAREST_RATIO` = 2x closer than the next). Candidates come from `LinkEdgesRepository.known_nodes()`: contacts with a full 64-hex key only, located or not. Analyzer-only `external_map_nodes` are never link endpoints (an analyzer node joins once promoted to a contact by an applied partial resolution). `link_edge_backfill_state` (single row `next_id`/`end_id`) drives the one-time `services/link_edge_backfill.py` backfill over pre-`_107` `raw_packets`
- `raw_packets` (includes signal columns `rssi`/`snr`/`payload_type` and decoded-stat columns `route_type`/`hop_count`/`hop_byte_width`/`path_signature`, parsed from the packet header at ingest and backfilled by migration 089; used by `/packets/raw-feed-stats` for historical breakdowns; `policy_action`/`policy_rule`, migration `_141`: the OpenHop policy verdict of the first reception, NULL when no rule decided the packet or the radio was not an OpenHop node)
- `radio_identities` (migration `_123`, plan 18) - one row per radio that has fed this install, keyed by full `public_key` (from `mc.self_info` at connect). `status` pending/confirmed with `pending_reason` `new_key` (unknown radio after an earlier one) or `legacy_history` (first radio, unassigned samples, and the own keys found in outgoing channel messages / `link_signal` traffic rows are missing or not all this radio's; when they all match, the samples are assigned silently). A replacement is stored on the OLD row: `replaced_by` + `carry_stats` / `carry_owned`, applied at read time by walking the chain; no row is re-keyed. `is_active` = most recently connected. Foreign keys are off app-wide, so link integrity is checked in `repository/radio_identities.py`, inside each operation's single `db.tx()`. `battery_history`, `noise_floor_samples` and `airtime_history` carry a nullable `radio_identity_id` (NULL = recorded before radio tracking, or kept from a removed radio); airtime deltas are never taken across two radios
- `airtime_history` (60s samples of the local radio's cumulative `tx_air_secs`/`rx_air_secs` plus, since migration `_116`, the cumulative `recv_errors` counter from `STATS_PACKETS` (firmware v1.12+, NULL on the legacy frame, and NULL on OpenHop nodes, whose companion puts its repeater dropped-packet count in that slot); utilization % and per-bin RX error counts are derived at query time. Sibling of the in-memory `noise_floor_samples`/`battery_history` pattern in `app/services/radio_stats.py`)
- `contact_advert_paths` (recent unique advertisement paths per contact, keyed by contact + path bytes + hop count; count per contact is `advert_paths_per_contact`)
- `contact_path_outcomes` (routes our DMs used per contact with outcomes and trip times, newest 100 per contact, migration `_115`; not covered by the retention pruner)
- `contact_name_history` (tracks name changes over time)
- `repeater_telemetry_history` (time-series telemetry snapshots for tracked repeaters)
- `contact_telemetry_history` (time-series LPP telemetry snapshots for tracked contacts; same schema as repeater table)
- `fanout_configs` (MQTT, webhook, Apprise, SQS integration configs)
- `push_subscriptions` (Web Push browser subscriptions with delivery metadata; UNIQUE on endpoint)
- `app_settings` (includes `vapid_private_key` and `vapid_public_key` for Web Push VAPID signing)

Retention: every history table above is pruned only by `app/services/retention_pruner.py` (one loop, ticks every 60 s, runs when `retention_prune_interval_hours` has elapsed), using the per-class settings listed under Settings. Repositories do not prune on insert, except the `contact_advert_paths` trim in `record_observation`. SQL lives in `app/repository/retention.py`. After a run that deleted rows it calls `PRAGMA incremental_vacuum` (the DB uses `auto_vacuum=INCREMENTAL`). The manual `POST /packets/maintenance` cleanup is separate and unchanged.

Contact route state is canonicalized on the backend:
- stored route inputs: `direct_path`, `direct_path_len`, `direct_path_hash_mode`, `direct_path_updated_at`, plus optional `route_override_*`
- computed route surface: `effective_route`, `effective_route_source`, `direct_route`, `route_override`
- removed legacy names: `last_path`, `last_path_len`, `out_path_hash_mode`

Frontend and send paths should consume the canonical route surface rather than reconstructing precedence from raw fields.

Repository writes should prefer typed models such as `ContactUpsert` over ad hoc dict payloads when adding or updating schema-coupled data.

`max_radio_contacts` is the configured radio contact capacity baseline. Favorites reload first, the app refills non-favorite working-set contacts to about 80% of that capacity, and periodic offload triggers once occupancy reaches about 95%.

`app_settings` fields in active model:
- `max_radio_contacts`
- `auto_decrypt_dm_on_advert`
- `last_message_times`
- `advert_interval`
- `last_advert_time`
- `flood_scope`
- `known_regions`
- `region_sync_url` (URL of an analyzer regions endpoint whose `{code, name}` array `GET /regions/sync` normalises into region names for merging into `known_regions`)
- `wordlist_sync_url` (URL of a JSON string-array of candidate channel names that `GET /registry/wordlist-sync` proxies for the browser channel finder's wordlist)
- `blocked_keys`, `blocked_names`, `discovery_blocked_types`
- `hide_bots` (hide senders on an enabled bot list; see "Bot lists")
- `tracked_telemetry_repeaters`, `tracked_telemetry_contacts`
- `auto_resend_channel`
- `auto_add_mentioned_channels` (when enabled, #hashtag channels referenced in chat are auto-recorded in the browser Channel Registry; registry-only, no followed channel is created)
- `telemetry_interval_hours`, `telemetry_routed_hourly` (poll tracked nodes with a direct/routed path hourly instead of on the normal interval); `telemetry_schedule_minute` (migration `_138`): minute of the UTC hour the scheduler wakes at, `-1` = automatic (`telemetry_interval.telemetry_schedule_minute`, first two bytes of the connected radio's public key modulo 60; 0 while no radio is connected), `0`-`59` = chosen by the operator. `radio_sync.current_telemetry_schedule_minute(setting)` resolves it; the loop reads the setting on every wake and evaluates the hour gate at most once per UTC hour
- Retention (all `0` = keep forever / no cap; enforced by `services/retention_pruner.py` every `retention_prune_interval_hours`, default 24): `raw_packet_retention_days` (default 0; bounds Packet History), `advert_retention_days` (30), `telemetry_retention_days` (30) + `telemetry_max_rows_per_node` (1000) for both telemetry tables, `link_signal_retention_days` (30), `noise_floor_retention_days` / `battery_retention_days` / `airtime_retention_days` (0), `message_retention_days` (0; deletes the message's linked `raw_packets` first), `link_edge_retention_days` (365; `link_edge_events`, migration `_107`), `device_history_retention_days` (0; one age limit for `device_config_history` by snapshot time and `contact_location_history` by `last_seen`, migration `_120`), `packet_reception_retention_days` (2; per-copy `packet_receptions`, migration `_118`), `relay_history_retention_days` (365; hourly `relay_reception_hourly`, migration `_124`; the pruner rolls complete hours up before pruning `packet_receptions` and skips that prune if the rollup fails), `advert_paths_per_contact` (10; trimmed on insert and by the pruner, also the contact-analytics read limit). The newer fields are migration `_105`; `RETENTION_DEFAULTS` in `models.py` holds their defaults
- `registry_sync_url` (remote `{name: key}` channel list synced into the registry), `analyzer_sites` (external analyzer link targets, incl. per-site `channel_url_template`), `handy_info` (user overlay for the Handy Info section; a link's `kb` flag lists it in Tools > Knowledge base)
- `external_map_enabled`, `external_map_sync_url`, `external_map_sync_interval_hours`, `external_map_source` (external node-directory overlay on the map, "Analyzer nodes"; also the candidate source for partial-node resolution). `external_map_source` (migration `_155`) is `meshcore_map` (default: `https://map.meshcore.io/api/v1/nodes`, sent with the shared `RTFM-EV/<version>` User-Agent; `type` 1-4 mapped to the analyzer role strings, `updated_date` as last seen since the node-clock `last_advert` can be years off) or `analyzer` (syncs `external_map_sync_url`, httpx default User-Agent). `external_map_sync_url` keeps naming the analyzer host for route checks and who-heard lookups whichever source is picked. Outgoing requests that set a User-Agent all use `version_info.user_agent()` = `RTFM-EV/<version>` (map.meshcore.io sync, bot lists, link previews, antenna register); the tile cache appends ` (+https://github.com/Elektr0Vodka/RTFM-EV)` for the OSM tile policy. Everything else sends the httpx default
- `sidebar_hidden`, `sidebar_section_order`, `sidebar_tool_order`, `sidebar_favorites_order`, `sidebar_favorite_sort_orders` (sidebar customisation, persisted server-side)
- `contact_groups` (user-defined contact/channel groups, each `{id, name, contact_keys, channel_keys}`; full-list replace via `PATCH /settings`, same convention as the other sidebar arrays above; migration `_111`. Each group is its own sidebar section - its key is `sidebar_section_order`'s `group:<id>` entries, tolerated by that field's "unknown keys are dropped/appended" reconciliation without a schema change. Local only, never sent over RF)
- `packet_feed_sort`, `packet_history_sort` (`oldest`/`newest`), `packet_group_by_content` (shared "Group repeats by content" toggle for Raw Packet Feed + Packet History)
- `mesh_health_page_size` (Mesh Health contacts table rows per page; `0` = all)
- `date_time_format` (`auto` / `12h_mdy` / `24h_dmy`; migration `_103`)
- `battery_chemistry` (`lipo` default / `lifepo4` / `lipo_hv` / `nmc`; global default for `mvToPercent` in `frontend/src/utils/batteryDisplay.ts`. A contact's own `battery_chemistry` column, migration `_108` and NULL = use this default, overrides it per node; see `ContactRepository._ANNOTATION_COLUMNS`)
- `map_home_mode` (`auto` / `home` / `last`), `map_home_lat`, `map_home_lon`, `map_home_zoom` (map start view; migration `_104`)
- `show_mention_ticker`, `mention_sound_enabled`, `mention_sound_choice`, `mention_sound_volume`, `mention_sound_custom`
- `chat_parse_pubkeys`, `chat_parse_coordinates`, `chat_url_previews`, `chat_linkify_urls` (chat entity parsing)
- `backup_to_path_enabled`, `backup_destination_path` (server-side database backup)
- `backup_schedule_enabled`, `backup_schedule_interval_hours`, `backup_schedule_keep` (automatic snapshots into the backup directory; migration `_113`)
- `brand_name`, `brand_hidden`, `brand_icon` (navbar, browser tab title/favicon, PWA manifest name; default name "RTFM-EV")
- `openhop_api_url`, `openhop_api_token` (OpenHop REST API; the token is write-only and masked on read)

A new `AppSettings` field needs the repository, the router's separate `AppSettingsUpdate` model and its kwargs, a migration, and the inline `AppSettings` test fixtures updated together.

Note: MQTT, community MQTT, and bot configs were migrated to the `fanout_configs` table (migrations 36-38). The bot system was later removed and migration 127 deletes any remaining `type='bot'` rows.

## Security Posture (intentional)

- No per-user authn/authz model; optionally, operators may enable app-wide HTTP Basic auth for both HTTP and WS entrypoints.
- No CORS restriction (`*`).

These are product decisions for trusted-network deployments; do not flag as accidental vulnerabilities.

## Testing

Run backend tests:

```bash
PYTHONPATH=. uv run pytest tests/ -v
```

Test suites:

```text
tests/
├── conftest.py                 # Shared fixtures
├── test_ack_tracking_wiring.py # DM ACK tracking extraction and wiring
├── test_api.py                 # REST endpoint integration tests
├── test_analyzer_resolution.py # Analyzer name resolution: directory, cache TTLs, opted-in sites, endpoints
├── test_route_suggestions.py   # DM route suggestions: path reversal, source merge, score terms, ranking
├── test_analyzer_path_check.py # Analyzer route check: verdict mapping, reach/inspect calls, failures
├── test_packet_who_heard.py    # Who heard this: hash vs a real analyzer packet, answer parsing, HTTP failures, endpoint
├── test_block_lists.py         # Blocked keys/names filtering across list/search surfaces
├── test_bot_list_format.py     # Bot list file format: validation and each refusal
├── test_bot_list_repository.py # Bot list storage
├── test_bot_list_service.py    # Effective set, exceptions, caps, shipped list, import/export
├── test_bot_list_hiding.py     # hide_bots setting and hidden_senders (unread counts, push)
├── test_bot_list_router.py     # Bot list API and its error codes
├── test_bot_list_fetch.py      # Guarded fetch: https only, pinned address, redirect hops, size cap, error codes
├── test_bot_list_subscriptions.py # Preview, subscribe, refresh, the 24 hour rule, failures keep entries
├── test_bot_list_refresh.py    # The hourly refresh loop
├── test_filter_profile_format.py     # Filter profile file format: each refusal, BOM, download name
├── test_filter_profile_repository.py # Filter profile storage and the profile in use
├── test_filter_profile_spam.py       # Spam Guard as a profile kind: capture, apply, Protect gate, matches
├── test_filter_profile_service.py    # Filter library service with a kind made for the test
├── test_filter_profile_router.py     # Filter library API end to end with Spam Guard
├── test_channel_sender_backfill.py # Sender-key backfill uniqueness rules for channel messages
├── test_channels_router.py     # Channels router endpoints
├── test_community_mqtt.py      # Community MQTT publisher (JWT, packet format, hash, broadcast)
├── test_config.py              # Configuration validation
├── test_contact_reconciliation_service.py # Prefix/contact reconciliation service helpers
├── test_contacts_router.py     # Contacts router endpoints
├── test_decoder.py             # Packet parsing/decryption
├── test_device_history.py      # Contact location history + repeater pane snapshots (plan 14)
├── test_echo_dedup.py          # Echo/repeat deduplication (incl. concurrent)
├── test_fanout.py              # Fanout bus CRUD, scope matching, manager dispatch
├── test_fanout_hitlist.py      # Fanout-related hitlist regression tests
├── test_fanout_integration.py  # Fanout integration tests
├── test_event_handlers.py      # ACK tracking, event registration, cleanup
├── test_frontend_static.py     # Frontend static file serving
├── test_health_mqtt_status.py  # Health endpoint MQTT status field
├── test_http_quality.py        # Cache-control / gzip / basic-auth HTTP quality checks
├── test_key_normalization.py   # Public key normalization
├── test_keystore.py            # Ephemeral keystore
├── test_main_startup.py        # App startup and lifespan
├── test_map_upload.py          # Map upload fanout module
├── test_message_pagination.py  # Cursor-based message pagination
├── test_message_prefix_claim.py # Message prefix claim logic
├── test_mqtt.py                # MQTT publisher topic routing and lifecycle
├── test_messages_search.py     # Message search, around, forward pagination
├── test_mqtt_ha.py             # Home Assistant MQTT Discovery fanout module
├── test_packet_pipeline.py     # End-to-end packet processing
├── test_packets_router.py      # Packets router endpoints (decrypt, maintenance)
├── test_path_utils.py          # Path hex rendering helpers
├── test_radio.py               # RadioManager, serial detection
├── test_radio_commands_service.py # Radio config/private-key service workflows
├── test_radio_lifecycle_service.py # Reconnect/setup orchestration helpers
├── test_radio_operation.py     # radio_operation() context manager
├── test_radio_router.py        # Radio router endpoints
├── test_radio_runtime_service.py # radio_runtime seam behavior and helpers
├── test_radio_sync.py          # Polling, sync, advertisement
├── test_real_crypto.py         # Real cryptographic operations
├── test_relay_reception.py     # packet_receptions capture, aggregation, relay-reception endpoint, WS fields
├── test_relay_history.py       # uncapped relay summary, pivot paging, hourly rollup + window split, per-relay detail
├── test_repeater_routes.py     # Repeater command/telemetry/trace + granular pane endpoints
├── test_repository.py          # Data access layer
├── test_room_routes.py         # Room-server login/status/telemetry/ACL endpoints
├── test_rx_log_data.py         # on_rx_log_data event handler integration
├── test_security.py            # Optional Basic Auth middleware / config behavior
├── test_send_messages.py       # Outgoing messages, concurrent sends
├── test_settings_router.py     # Settings endpoints, advert validation
├── test_push_send.py           # Web Push send/dispatch
├── test_radio_stats.py         # Radio stats sampling and noise-floor history
├── test_radio_identities.py    # Radio identity registry: registration, legacy adoption, links, lineage, rollback (plan 18)
├── test_radio_identity_service.py # Connect hook, per-sample attribution, chart scope, health view
├── test_radio_identity_api.py  # /radio-identities endpoints, per-radio statistics filters, health field
├── test_repeater_telemetry.py  # Repeater telemetry history recording
├── test_service_installer.py   # Service installer script behavior
├── test_sqs_fanout.py          # SQS fanout module
├── test_statistics.py          # Statistics aggregation
├── test_telemetry_interval.py  # Telemetry interval scheduling math
├── test_version_info.py        # Version/build metadata resolution
├── test_websocket.py           # WS manager broadcast/cleanup
└── test_websocket_route.py     # WS endpoint lifecycle
```

## Errata & Known Non-Issues

### Sender timestamps are 1-second resolution (protocol constraint)

The MeshCore radio protocol encodes `sender_timestamp` as a 4-byte little-endian integer (Unix seconds). This is a firmware-level wire format - the radio, the Python library (`commands/messaging.py`), and the decoder (`decoder.py`) all read/write exactly 4 bytes. Millisecond Unix timestamps would overflow 4 bytes, so higher resolution is not possible without a firmware change.

**Consequence:** Message dedup still operates at 1-second granularity because the radio protocol only provides second-resolution `sender_timestamp`. Do not attempt to fix this by switching to millisecond timestamps - it will break echo dedup (the echo's 4-byte timestamp won't match the stored value) and overflow `to_bytes(4, "little")`. Incoming DMs now share the same second-resolution content identity tradeoff as channel echoes: same-contact same-text same-second observations collapse onto one stored row.

### Outgoing DM echoes remain undecrypted

When our own outgoing DM is heard back via `RX_LOG_DATA` (self-echo, loopback), `_process_direct_message` passes `our_public_key=None` for the outgoing direction, disabling the outbound hash check in the decoder. The decoder's inbound check (`src_hash == their_first_byte`) fails because the source is us, not the contact - so decryption returns `None`. This is by design: outgoing DMs are stored directly by the send endpoint, so no message is lost.

### Infinite setup retry on connection monitor

When `post_connect_setup()` fails (e.g. `export_and_store_private_key` raises `RuntimeError` because the radio didn't respond), `_setup_complete` is never set to `True`. The connection monitor sees `connected and not setup_complete` and retries every 5 seconds - indefinitely. This is intentional: the radio may be rebooting, waking from sleep, or otherwise temporarily unresponsive. We keep retrying so that setup completes automatically once the radio becomes available, without requiring manual intervention.

### DELETE channel returns 200 for non-existent keys

`DELETE /api/channels/{key}` returns `{"status": "ok"}` even if the key didn't exist. This is intentional - the postcondition is "channel doesn't exist," which is satisfied regardless of whether it existed before. No 404 needed.

### Contact lat/lon 0.0 vs NULL

MeshCore uses `0.0` as the sentinel for "no GPS coordinates" (see `models.py` `to_radio_dict`). The upsert SQL uses `COALESCE(excluded.lat, contacts.lat)`, which preserves existing values when the new value is `NULL` - but `0.0` is not `NULL`, so it overwrites previously valid coordinates. This is intentional: we always want the most recent location data. If a device stops broadcasting GPS, the old coordinates are presumably stale/wrong, so overwriting with "not available" (`0.0`) is the correct behavior.

## Editing Checklist

When changing backend behavior:
1. Update/add router and repository tests.
2. Confirm WS event contracts when payload shape changes.
3. Run `PYTHONPATH=. uv run pytest tests/ -v`.
4. If API contract changed, update frontend types and AGENTS docs.
