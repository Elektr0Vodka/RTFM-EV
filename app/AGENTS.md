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
├── config.py            # Env-driven runtime settings
├── channel_constants.py # Public/default channel constants shared across sync/send logic
├── database.py          # SQLite connection + base schema + migration runner
├── migrations/          # Schema migrations (SQLite user_version, per-version modules)
├── models.py            # Pydantic request/response models and typed write contracts (for example ContactUpsert)
├── version_info.py      # Unified version/build metadata resolution for debug + startup surfaces
├── repository/          # Data access layer (contacts incl. name/location history, channels, communities, messages, raw_packets, packet_receptions, settings, fanout, push_subscriptions, repeater_telemetry, contact_telemetry, device_config_history, analyzer_names)
├── services/            # Shared orchestration/domain services
│   ├── messages.py              # Shared message creation, dedup, ACK application
│   ├── message_send.py          # Direct send, channel send, resend workflows
│   ├── dm_ingest.py             # Shared direct-message ingest / dedup seam for packet + fallback paths
│   ├── dm_ack_apply.py          # Shared DM ACK application over pending/buffered ACK state
│   ├── dm_path_outcomes.py      # Which route each DM attempt used + ACK/failed outcomes (plan 28 1.15)
│   ├── path_scoring.py          # meshcore-open path score port (display only, pure)
│   ├── dm_ack_tracker.py        # Pending DM ACK state
│   ├── contact_reconciliation.py # Prefix-claim, sender-key backfill, name-history wiring
│   ├── flood_scope.py           # Firmware-version-aware flood-scope set/clear command seam
│   ├── radio_lifecycle.py       # Post-connect setup and reconnect/setup helpers
│   ├── radio_commands.py        # Radio config/private-key command workflows
│   ├── radio_stats.py           # In-memory local radio stats sampling and noise-floor history
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
├── fanout/              # Fanout bus: MQTT, bots, webhooks, Apprise, SQS (see fanout/AGENTS_fanout.md)
├── telemetry_interval.py # Shared telemetry interval math for tracked-repeater scheduler
├── path_utils.py        # Path hex rendering and hop-width helpers
├── region_scope.py      # Normalize/validate regional flood-scope values
├── region_resolver.py   # Recompute transport codes per known region to name a packet's region
├── keystore.py          # Ephemeral private/public key storage for DM decryption
├── frontend_static.py   # Mount/serve built frontend (production); applies brand_name to index.html title + site.webmanifest
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
http(s) scheme and rejects any host resolving to a private / loopback / link-local
/ reserved address (re-checked on each redirect); `services/unfurl.py` caps the
response size and time, sends no cookies, parses metadata with the stdlib
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

## Core Runtime Flows

### Incoming data

1. Radio emits events.
2. `on_rx_log_data` stores raw packet and tries decrypt/pipeline handling.
3. Shared message-domain services create/update `messages` and shape WS payloads.
4. Direct-message storage is centralized in `services/dm_ingest.py`; packet-processor DMs and `CONTACT_MSG_RECV` fallback events both route through that seam.
5. `PayloadType.GROUP_DATA` (0x06, firmware `GRP_DATA`) packets are decrypted with the channel key next to `GROUP_TEXT` (`decoder.try_decrypt_group_data_with_channel_key`, plaintext `data_type(u16 LE) | data_len(u8) | blob`, mirroring `BaseChatMesh::onGroupDataRecv`) and stored by `services/messages.create_group_data_message` as a placeholder `CHAN` row with `txt_type = TXT_TYPE_GROUP_DATA` (0x40; firmware text types are 0..3). Only chunk metadata is stored: for meshcore-open image chunks (`data_type 0xAE1C`, header `sender_prefix(2) | img_id | idx<<4|total`) the text is `<Sender>: [image] id=<hex> chunks=<total>` (sender = unique contact match on the 2-byte prefix, else the prefix in upper hex); anything else is `[data] type=0x<type> len=<n> sha=<8 hex>`. The text omits the chunk index and `sender_timestamp` is NULL, so every chunk and repeat of one image reconciles onto one row via the messages dedup index, each arrival becoming a path. The blob is never persisted or decoded (the neural image codec is out of scope). Limitation: a sender that reuses an image id on the same channel merges into the old row.
6. Incoming SMAZ bodies (`s:<base64>`, sent compressed by meshcore-open) are decoded before storage by `app/smaz.py`: in `_store_direct_message` for incoming non-CLI DMs and in `create_message_from_decrypted` / `create_fallback_channel_message` for channel text (the part after `Sender: `). Stored text, mentions, reaction hashes and fanout all see the decoded text. A body is only decoded when it is valid base64/base64url, a complete stream, valid UTF-8, byte-identical to what the meshcore-open encoder produces, and shorter than the decoded text (the encoder only compresses when it saves bytes); anything else is stored unchanged. Outgoing echoes are never decoded. The raw-packet decoder (`decoder.py`, packet feed/analyzer views) still shows the `s:` form.

### Outgoing messages

1. Send endpoints in `routers/messages.py` validate requests and delegate to `services/message_send.py`.
2. Service-layer send workflows call MeshCore commands, persist outgoing messages, and wire ACK tracking.
3. Endpoint broadcasts WS `message` event so all live clients update.
4. ACK/repeat updates arrive later as `message_acked` events.
5. DM failed state: `_retry_direct_message_until_acked` retries up to `DM_SEND_MAX_ATTEMPTS` (final attempt flood), then waits one more ACK window. With still no ACK it sets `messages.failed_at` (migration 109, `MessageRepository.mark_failed`, only when `outgoing = 1 AND acked = 0`) and broadcasts `message_failed`. Every ACK code the message was sent with stays matchable for `dm_ack_tracker.FAILED_ACK_GRACE_SECONDS` (30 s): a late ACK in that window goes through `apply_dm_ack_code` as usual, `increment_ack_count` clears `failed_at`, and `message_acked` flips the UI to delivered. A later ACK is buffered like any unmatched ACK and the message stays failed. DMs whose first send returned no `expected_ack` never schedule retries, so they are never marked failed.
6. DM manual retry (`POST /messages/direct/{id}/resend`): only for an outgoing PRIV row with `failed_at` set and `acked = 0` (else 409). Sends the stored text again through `send_direct_message_to_contact` (fresh timestamp, new ACK code, normal background retries), then deletes the failed row and broadcasts `message_deleted`. If the new send fails the failed row stays. No byte-perfect DM resend exists.
7. Channel resend (`POST /messages/channel/{id}/resend`) strips the sender name prefix by exact match against the current radio name. This assumes the radio name hasn't changed between the original send and the resend. Name changes require an explicit radio config update and are rare, but the `new_timestamp=true` resend path has no time window, so a mismatch is possible if the name was changed between the original send and a later resend.

### Connection lifecycle

- `RadioManager.start_connection_monitor()` checks health every 5s.
- `RadioManager.post_connect_setup()` delegates to `services/radio_lifecycle.py`.
- Routers, startup/lifespan code, fanout helpers, and `radio_sync.py` should reach radio state through `services/radio_runtime.py`, not by importing `app.radio.radio_manager` directly.
- Shared reconnect/setup helpers in `services/radio_lifecycle.py` are used by startup, the monitor, and manual reconnect/reboot flows before broadcasting healthy state.
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
- `contacts.flags` mirrors the radio's `ContactInfo.flags`: bit 0 is the radio favourite bit, bits 1-3 are the firmware `TELEM_PERM_*` bits (base, location, environment) that the companion reads as `flags >> 1` when a telemetry mode is Per-Contact. `ContactUpsert.flags=None` keeps the stored value, so advert/DM upserts never zero it; a radio snapshot writes the radio's value.
- `contacts.telemetry_perms` (migration `_106`, nullable) is the app-set permission value and wins over the radio: `Contact.to_radio_dict()` overlays it on `flags`, and `sync_contacts_from_radio` pushes it with `change_contact_flags` to any radio contact whose bits differ. `NULL` means never set in the app, so the radio's bits are kept.

### Read/unread state

- Server is source of truth (`contacts.last_read_at`, `channels.last_read_at`).
- `GET /api/read-state/unreads` returns counts, mention flags, `last_message_times`, `last_read_ats`, and `first_unread_ids`.
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
- CLI commands and replies are logged through `app/log_redaction.py`: `password <pw>`, `set guest.password <pw>` and `set prv.key <hex>` are masked, and the reply to any command that reads or sets one of those secrets is logged as `***` (the firmware echoes the new admin password back). A filter on the `meshcore` logger masks the library's own `send_cmd` debug line. The API response itself is not redacted.

The retry deliberately does not re-run `_ensure_on_radio` - re-adding the contact would restore the route just cleared. `reset_path` clears the route on the radio only; the stored contact route is untouched, so the next `add_contact` re-stages it. That mirrors the DM retry and keeps one bad login from discarding a route that may be fine.

### Echo/repeat dedup

- Channel message uniqueness (`idx_messages_dedup_null_safe`): `(type, conversation_key, text, COALESCE(sender_timestamp, 0))` where `type = 'CHAN'`.
- Incoming PRIV message uniqueness (`idx_messages_incoming_priv_dedup`): `(type, conversation_key, text, COALESCE(sender_timestamp, 0), COALESCE(sender_key, ''))` where `type = 'PRIV' AND outgoing = 0` - `sender_key` was added in migration 056 to distinguish room-server posts from different senders in the same second.
- Duplicate insert is treated as an echo/repeat: the new path (if any) is appended, and the ACK count is incremented only for outgoing channel messages. Incoming direct messages with the same dedup identity also collapse onto one stored row, with later observations merging path data instead of creating a second DM.

### Region scope decoding (transport codes)

- `ROUTE_TYPE_TRANSPORT_FLOOD`/`ROUTE_TYPE_TRANSPORT_DIRECT` packets carry a 4-byte transport-code block; `parse_packet_envelope` exposes it as `transport_codes = (code_1, code_2)` (little-endian uint16s; `code_2` is reserved/0).
- `code_1` is a keyed MAC over the payload, not a stable per-region id: `code = HMAC-SHA256(SHA256("#" + region_name)[:16], payload_type || payload)[:2]` (firmware `TransportKeyStore.cpp`; reserved values `0x0000`/`0xFFFF` are nudged to `0x0001`/`0xFFFE`). There is **no** reverse lookup table - to name a packet's region you recompute the code per candidate region and check for a match (`app/region_resolver.py`).
- Candidate region names come from `app_settings.known_regions` (user-editable, seeded by migration 063 from `flood_scope` + channel `flood_scope_override`).
- Channel messages persist `messages.transport_code` (uint16, NULL = unscoped plain flood) and `messages.region` (resolved name, NULL = scoped but no list match) at ingest, so the chat region badge survives raw-packet purge. The packet inspector (`GET /packets/{id}` and the `raw_packet` WS broadcast) resolves region on the fly against the current list since it still holds the raw payload.

### Region-scope adoption stats (`region_scope_24h`)

`GET /statistics` reports regional flood-scope uptake as two views with different denominators that intentionally will not agree:

- **Traffic** (`bucket_region_scope` in `path_utils.py`) counts flood-routed (`route_type` 0/1) GroupText packets across all channels, including undecryptable ones. Zero-hop/direct sends are excluded because firmware reaches them through the non-transport `sendZeroHop`/`sendDirect` overloads and they can never carry transport codes.
- **Senders** (`StatisticsRepository._region_scope_senders_24h`) counts distinct senders with at least one scoped message. Attribution requires decryption, so it only covers channels we hold keys for - narrower, but self-validating (a decrypted packet is provably not a corrupt capture) and immune to one chatty node skewing the result. Identity is `sender_key` falling back to `sender_name`; scoping reads `messages.transport_code`, falling back to the linked raw packet for rows stored before region tagging existed.

`false_positive_floor` exists because corrupt RF captures land in `raw_packets` with effectively random headers and a share of them claim `TRANSPORT_FLOOD`. That garbage spreads near-uniformly across payload-type buckets, so it is measured directly from payload types the protocol does not define (`0x0C`/`0x0D`/`0x0E`) and averaged per bucket. **A `scoped_messages` count at or below the floor is not evidence of adoption**; surface the two together and never show the percentage alone. Do not "fix" the floor by removing it - without it the metric reads several times higher than reality.

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

- All external integrations (MQTT, bots, webhooks, Apprise, SQS) are managed through the fanout bus (`app/fanout/`).
- Configs stored in `fanout_configs` table, managed via `GET/POST/PATCH/DELETE /api/fanout`.
- `broadcast_event()` in `websocket.py` dispatches to the fanout manager for `message`, `raw_packet`, and `contact` events.
- `on_message` and `on_raw` are scope-gated. `on_contact`, `on_telemetry`, and `on_health` are dispatched to all modules unconditionally (modules filter internally).
- Repeater telemetry broadcasts are emitted after `RepeaterTelemetryRepository.record()` in both `radio_sync.py` (auto-collect) and `routers/repeaters.py` (manual fetch). Contact LPP telemetry is similarly recorded to `ContactTelemetryRepository` and dispatched to fanout.
- The telemetry collection loop in `radio_sync.py` is unified: it iterates over both `tracked_telemetry_repeaters` and `tracked_telemetry_contacts`, dispatching by list, not contact type: repeater-list entries go to `_collect_repeater_telemetry` (status) and contact-list entries to `_collect_contact_telemetry` (LPP). The contact list accepts any contact type, repeaters included, so a repeater can be on both lists and is then polled for status and LPP separately. The daily check ceiling uses the combined count.
- The 60-second radio stats sampling loop in `radio_stats.py` dispatches an enriched health snapshot (radio identity + full stats) to all fanout modules after each sample.
- Community MQTT publishes raw packets only, but its derived `path` field for direct packets is emitted as comma-separated hop identifiers, not flat path bytes.
- See `app/fanout/AGENTS_fanout.md` for full architecture details and event payload shapes.

### Web Push notifications

Web Push is a standalone subsystem in `app/push/`, separate from the fanout module system. It sends browser push notifications for incoming messages even when the tab is closed.

- **Not a fanout module** - Web Push manages per-browser subscriptions (N browsers, each with its own endpoint and delivery state), unlike fanout which is one-config-to-one-destination.
- **VAPID keys**: auto-generated P-256 key pair on first startup, stored in `app_settings.vapid_private_key` / `vapid_public_key`. Cached in-module by `app/push/vapid.py`.
- **VAPID subject**: the JWT `sub` claim comes from `get_vapid_claims()` in `app/push/vapid.py`, configurable via `MESHCORE_VAPID_SUBJECT` (default `mailto:noreply@meshcore.local`). Apple's APNs rejects `.local` subjects with `403 BadJwtToken`, so iOS/Safari deployments must set a real `mailto:`/`https:` contact.
- **Dispatch**: `broadcast_event()` in `websocket.py` fires `push_manager.dispatch_message(data)` alongside fanout for `message` events. The manager checks the global `app_settings.push_conversations` list, then sends to all currently registered subscriptions via `pywebpush` (run in a thread executor).
- **Stale cleanup**: HTTP 404/410 from the push service triggers immediate subscription deletion.
- **Subscriptions stored** in `push_subscriptions` table with `UNIQUE(endpoint)` for upsert semantics.
- Requires HTTPS (self-signed OK) and outbound internet to reach browser push services.

## API Surface (all under `/api`)

### Health
- `GET /health`

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
- `POST /radio/disconnect`
- `POST /radio/reboot`
- `POST /radio/reconnect`

### Host repeater (plan 29, shadow and armed mode)
RTFM-EV judges received frames as a repeater would; shadow mode never transmits, armed mode forwards through `services/host_repeater_tx.py` (the only host repeater module that may import the radio; the engine and runtime keep their no-radio boundary, test-enforced). Arming needs env switch + admin switch + capability checks + `confirm`; it always starts disarmed and auto-disarms on disconnect, firmware repeat on, identity/modulation change, send errors, measured duty over the sub-band limit, or a stuck queue. Pure engine `services/host_repeater_engine.py` (MeshCore `Mesh.cpp` rules, repeater gates, DMC filter, OpenHop policy via `services/host_repeater_policy.py`; must not import the radio, radio commands or meshcore, `tests/test_host_repeater_api.py` enforces it). Settings model `services/host_repeater_settings.py` (strict, `extra=forbid`), stored as one versioned JSON row in `host_repeater_config` (migration `_112`, `repository/host_repeater.py`). Runtime `services/host_repeater.py`: `pre_observe` + `observe` are called from `event_handlers.on_rx_log_data` around `process_raw_packet` (pending ACK codes are read before the processor consumes them); `on_stats_sample` from the radio stats loop. Radio facts come in as a `RadioSnapshot` from `services/host_repeater_link.py`, the only module that reads the radio manager (cached state only). Session stats are in memory; lifetime totals (`LifetimeStats`) persist in `host_repeater_stats` (migration `_114`, `HostRepeaterStatsRepository`), flushed from the RX path at most once a minute, at shutdown (`host_repeater.stop()` in `main.py`) and on reset. Score-based delays (Phase 4): `observe()` asks the engine for `rx_delay_ms(raw, snr)` (repeater `rxdelay`: `packet_score` = firmware `packetScoreInt`, `rx_delay_ms` = `MyMesh::calcRxDelay`, floods only, 0 = off) and holds the frame in an asyncio task before judging it (the firmware's delayed inbound queue: a neighbour's relay judged meanwhile makes the held copy a duplicate, counted as `rx_delay.yielded`); `use_score_for_tx` scales the retransmit delay inside the engine. `AdvertLimiter` (OpenHop token bucket per advert public key, no penalty box / adaptive tiers) runs last for flood adverts (`advert_rate`). OpenHop radios are skipped. Region map: `settings.regions` (name without `#`, parent, `deny_flood`) + `home_region`; the engine matches transport codes against this list itself (`region_resolver.compute_transport_code`), not against `known_regions`. DMC region gating: `AirtimeBudget` (dmc-dev budget bucket) fed by would-forward airtime and `add_own_tx` (radio `tx_air_secs` deltas); pending 10 s gate checks are replayed on each engine call. The legacy `region_rules` field is converted in a `mode="before"` validator, because `load()` falls back to defaults on a validation error. Policy rule extensions (jhuebert/MeshCore repeater filter parity, `FILTER.md`): fields `channel_name` (from the decrypt result, via `RxFacts.channel_name`), `region` (`unscoped` for plain floods, the resolved name for scoped ones, `None` for direct), `path_first` / `path_last` / `path_string`; operator `matches` (Python `re.search`, pattern validated and capped at `MAX_REGEX_LENGTH` 128 at save time, compiled through a bounded cache); `then.prob` (deterministic roll from sha256(rule id, packet hash)) and `then.throttle_seconds` + `then.throttle_key` (`PolicyState` owned by the engine, one free pass per window, reset with `reset_state()`). A rule that steps aside (failed roll or within its throttle budget) is skipped and reported in `PolicyDecision.passes` / `Decision.policy_passes`. Drops for `SAVED_AIRTIME_REASONS` (policy and DMC filter drops, `advert_rate`) carry `Decision.saved_airtime_ms` (airtime of the frame we would have re-sent); the runtime sums it per reason and per rule (`saved_airtime_*`, `policy_passes`, in session and lifetime stats).
- `GET /radio/host-repeater` - settings, `version`, `state` (`off`/`shadow`/`armed`), `armed_since`, `disarm_reason`, `rearm_pending`, `env_enabled` (`MESHCORE_HOST_REPEATER_ENABLED`), capabilities (raw send ver code >= 13, firmware repeat byte, OpenHop, EU sub-band limit, `arm_blockers`)
- `PUT /radio/host-repeater/settings` - `{version, settings}`; 409 when `version` is stale, 409 when enabling shadow on OpenHop; broadcasts WS `host_repeater`
- `POST /radio/host-repeater/validate` - `{valid, errors[{loc, msg}]}` without saving
- `POST /radio/host-repeater/mode` - `{mode: off|shadow|armed, confirm}`; `armed` needs `confirm: true` (400 otherwise) and answers 409 `{message, blockers}` when a precondition fails; `off`/`shadow` disarm without touching the saved settings
- `POST /radio/host-repeater/disarm` - kill switch (also cancels a pending re-arm)
- `GET /radio/host-repeater/stats` (includes `region_gate`: level, max level, budget use, closed regions; `tx`: sent, airtime, errors, table full, queued, in flight, drops by cause; `rx_delay`: held / yielded / pending + percentiles; `advert_limiter`: allowed / dropped / tracked; `lifetime`: totals since first run with `runs` and `persisted`), `POST /radio/host-repeater/stats/reset` (`?lifetime=true` also restarts the persisted totals)

### Contacts
- `GET /contacts`
- `GET /contacts/analytics` - unified keyed-or-name analytics payload (keyed lookups include `path_scores`, the scored DM route history)
- `GET /contacts/repeaters/advert-paths` - recent advert paths for all contacts
- `POST /contacts`
- `POST /contacts/bulk-delete`
- `POST /contacts/bulk-contact-uris` - body `{public_keys}`: `meshcore://` links for several contacts at once (`{links: {public_key: uri}}`), built from the most recently retained advert transmission per key (`AdvertEventRepository.latest_raw_adverts`, `advert_events` joined to `raw_packets`) and validated the same way an imported link is (hex, ADVERT packet, Ed25519 signature). Unlike `GET /{public_key}/contact-uri` this never talks to the radio; a key with no stored advert (never heard, or pruned by retention) is left out of the response rather than erroring. Used by the map's GPX export
- `POST /contacts/import-uri` - body `{uri}`: import a `meshcore://` contact link (`app/contact_uri.py`). The link is validated first (scheme, hex, <= 255 bytes, ADVERT packet, Ed25519 signature; 400 otherwise), then sent with `import_contact` (CMD_IMPORT_CONTACT; 422 if the radio rejects it). The firmware loops the advert back as if heard and ignores the forwarding decision, so nothing is transmitted. A new contact is stored with the advert's name, type and location but no `last_advert`/`last_seen` (not heard on RF); an existing contact is left unchanged. Broadcasts `contact`. `share_contact` (CMD 0x10, transmits) is deliberately not used anywhere
- `DELETE /contacts/{public_key}`
- `POST /contacts/{public_key}/mark-read`
- `POST /contacts/{public_key}/mark-unread` - `{message_id}`, marks unread from that message onward
- `POST /contacts/{public_key}/command`
- `POST /contacts/{public_key}/annotations` - set user annotations (`notes`, `owner_info`, `owner_key`, `manual_lat`, `manual_lon`, `battery_chemistry`); partial update, explicit `null` clears a field (for `battery_chemistry`, reverting to the global default), `owner_key` must reference an existing contact (422 otherwise), `battery_chemistry` must be one of `lipo`/`lifepo4`/`lipo_hv`/`nmc` (422 otherwise); broadcasts `contact`
- `POST /contacts/{public_key}/routing-override`
- `GET /contacts/{public_key}/contact-uri` - the contact's `meshcore://` link via `export_contact(key)`: the radio returns the last raw advert it stored for that contact (404 when it has none, 502 if it returns another node's or an invalid advert). Nothing transmitted
- `POST /contacts/{public_key}/telemetry-permissions` - body `{base, location, environment}` (all required); stores `telemetry_perms`, pushes the flag bits to the radio when the contact is loaded there (never adds it just for this), returns `applied_to_radio`; broadcasts `contact`
- `POST /contacts/{public_key}/trace`
- `POST /contacts/{public_key}/path-discovery` - discover forward/return paths, persist the learned direct route, and sync it back to the radio best-effort
- `POST /contacts/{public_key}/repeater/login` - one attempt on the effective route, then one flood retry on timeout
- `POST /contacts/{public_key}/repeater/status`
- `POST /contacts/{public_key}/repeater/lpp-telemetry`
- `POST /contacts/{public_key}/repeater/neighbors`
- `POST /contacts/{public_key}/repeater/acl`
- `POST /contacts/{public_key}/repeater/node-info`
- `POST /contacts/{public_key}/repeater/radio-settings`
- `POST /contacts/{public_key}/repeater/regions` - CLI region hierarchy, falling back to the guest anon flood-allowed names (`source`: `cli` or `anon`)
- `POST /contacts/{public_key}/repeater/advert-intervals`
- `POST /contacts/{public_key}/repeater/settings/read` - `get` of allow-listed editor settings (`{settings?: [...]}`; omit for all); error sentinels come back as null
- `POST /contacts/{public_key}/repeater/settings/set` - ONE allow-listed `set <verb> <value>` over RF then `get <verb>` read-back; returns `status` `ok`/`mismatch`/`rejected`/`unverified` + `reboot_required`. Allow-list + value ranges live in `app/services/repeater_settings.py` (from the stock `CommonCLI.cpp`); anything off-list or out of range is a 400 before the radio is touched. `prv.key` and the admin `password` are deliberately not on the list.
- `POST /contacts/{public_key}/repeater/owner-info` - also auto-fills the contact's stored `owner_info` when empty (never overwrites) and returns `stored_owner_info` + `owner_info_updated`
- `GET /contacts/{public_key}/repeater/telemetry-history` - stored telemetry history for a repeater (read-only, no radio access)
- `POST /contacts/{public_key}/telemetry` - on-demand CayenneLPP telemetry from any contact (persists in `contact_telemetry_history`)
- `GET /contacts/{public_key}/telemetry-history` - stored LPP telemetry history for a contact (read-only)
- `GET /contacts/{public_key}/location-history` - positions the contact has advertised, newest first (plan 14, `contact_location_history`, migration `_119`): append-on-change like name history, rounded to 4 decimals (`round_location`, (0,0)/missing ignored), captured from advert ingest and contact-card import (`record_contact_location` in `contact_reconciliation.py`); unbounded like name history
- `GET /contacts/{public_key}/repeater/config-history?kind=` - stored repeater pane snapshots (`device_config_history`, kinds `node_info` / `radio_settings` / `advert_intervals` / `owner_info` / `regions`), newest first. Written by `_record_config_snapshot` at the end of each pane handler, append-on-change (volatile fields excluded: `clock_utc`, owner-info bookkeeping, the regions `raw` dump; a response with every stored field null, i.e. an unanswered fetch, is skipped; a single null field, i.e. one command that got no answer, keeps the latest snapshot's value), capped at 200 rows per contact and kind by the repository, age-limited by `device_history_retention_days`. Room servers store only the `acl` kind (see `room/acl`); their status and LPP panes already land in telemetry history
- `POST /contacts/{public_key}/room/login` - one attempt on the effective route, then one flood retry on timeout
- `POST /contacts/{public_key}/room/status` - room firmware's 52-byte status ends with `n_posted`/`n_post_push` (uint16 each) where repeaters have RX airtime; these map to `room_posted`/`room_post_pushes` and `rx_airtime_seconds` is null (`services/room_status.py`). A 56-byte frame (e.g. OpenHop) keeps the repeater layout
- `POST /contacts/{public_key}/room/lpp-telemetry`
- `POST /contacts/{public_key}/room/acl` - also stores an `acl` snapshot in `device_config_history` (plan 14): `{pubkey_prefix, permission}` pairs sorted by prefix, resolved names left out; an empty list (timeout) is not stored
- `GET /contacts/{public_key}/room/config-history?kind=` - stored room pane snapshots (today only `acl`), newest first; same shape as the repeater endpoint, 400 for a non-room contact

### Channels
- `GET /channels`
- `GET /channels/{key}/detail`
- `POST /channels`
- `POST /channels/bulk-hashtag`
- `DELETE /channels/{key}`
- `POST /channels/{key}/flood-scope-override`
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

### Messages
- `GET /messages` - list with filters; supports `q` (full-text search), `after`/`after_id` (forward cursor)
- `GET /messages/around/{message_id}` - context messages around a target (for jump-to-message navigation)
- `GET /messages/locations` - location shares in DM + channel messages received in `(since, until]`, newest first; `latest_per_sender` (default true) keeps one per sender (self / DM partner / channel sender key, else name). Parsing in `app/location_payloads.py` (meshcore-open `m:` marker, upper-case MGRS via `app/mgrs.py`, `lat, lon` with 4+ decimals); service `app/services/shared_locations.py` scans at most 20,000 newest rows (`truncated`). Local map only, never fanned out
- `POST /messages/direct`
- `POST /messages/channel`
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
- `GET /packets/recent?limit&after_ts&before_ts` - recent raw packets, oldest-first, in the `raw_packet` broadcast shape (raw-feed DB history)
- `GET /packets/history?limit&after_ts&before_ts&before_id&payload_types&hop_widths&hex&search` - Packet History browser: pages backward (newest-first) through persisted `raw_packets` with a `before_id` cursor; `search` matches decrypted message text / sender / channel name. Returns `{packets, next_cursor}`. Reach is bounded by `app_settings.raw_packet_retention_days` (`0` = keep forever)
- `GET /packets/timeseries?start_ts&end_ts&bin_count` - time-binned packet counts, byte totals, signal averages, and type breakdowns for historical chart ranges
- `GET /packets/historical-stats?start_ts&end_ts` - DB-computed aggregate stats for a window (My Node history)
- `GET /packets/mesh-health?start_ts&end_ts` - per-contact advert frequency (direct/flood) for Mesh Health; HIGH/MEDIUM alerts are evaluated on the flood count only
- `GET /packets/prefix-collisions` - public-key prefix collisions among full-key local contacts at 1/2/3-byte widths (Mesh Health "Prefix Collisions" tab). Point-in-time over contacts, not window-scoped. See `app/services/prefix_collisions.py`
- `GET /packets/snr-rssi-scatter`, `GET /packets/hourly-heatmap`, `GET /packets/reachability-rings` - windowed signal scatter, 7x24 UTC packet heatmap, and unique contacts by minimum hop distance
- `GET /packets/relay-pairs?limit` - most frequent consecutive node pairs across advert paths
- `GET /packets/traffic-links?since&until&heard_only&max_km` - map links from the per-packet edge log (`link_edge_events`), aggregated per `(a, b, hop_width)` over the window: `count` (distinct packets), `first_seen`, `last_seen`, `ambiguous` (every sample in the window was a distance-based `nearest` resolution). Endpoints without a current location are dropped; `heard_only`/`max_km` as for advert-links
- `GET /links/{a}/{b}/summary|timeseries|packets` (`app/routers/links.py`) - per-link history for the link detail page. Keys in either order (normalised to sorted lowercase). `summary?since&until`: endpoint names/kinds/coords, distance, `involves_self`, totals and breakdowns by hop width, confidence and payload type. `timeseries?since&until&bucket=hour|day`: distinct packets per UTC bucket and payload type, plus SNR/RSSI avg/min/max per bucket (only the edge into our node carries signal). `packets?limit&before`: newest-first edge rows with a `ts` cursor
- `GET /packets/advert-links?limit&heard_only&max_km&since&until` - resolved advert-path edges for the map link layer (`since`/`until` filter `advert_events.first_seen`). `heard_only=true` resolves hops only against contacts with `last_seen` set (no never-heard contacts, no analyzer-only `external_map_nodes`); `max_km` (> 0) drops candidates farther than that from the previous hop (breaking the chain) and any longer direct/tail edge. The map's link layer uses both; the wrong-location filter fetches without them
- `GET /packets/{packet_id}` - fetch one stored raw packet by row ID for on-demand inspection
- `GET /packets/request-traffic` - single-node REQUEST/RESPONSE traffic in a window: totals (requests, anon, responses, flood/direct split), a time-bucketed series, and top src→dest 1-byte-hash pairs (Mesh Health "Requests" panel). Parses `raw_packets` filtered by `payload_type IN (REQUEST, ANON_REQUEST, RESPONSE)`; makes no answered/unanswered judgment (a single node cannot hear responses routed around it)
- `GET /packets/relay-reception?start_ts&end_ts&limit` - per-relay reception of the same flooded packet (Mesh Health "Relay reception" tab, plan 21 S1): groups `packet_receptions` (migration `_118`, one row per received copy of a flood/transport-flood packet, written by `app/services/relay_reception.py::record_packet_reception` right after `raw_packets` dedup; direct routes are skipped because their path is popped, plan 21 Q3) by payload hash into packets x relays (`last_hop_hex` = last path chunk via `path_utils.last_hop_hex`, null = heard from the origin) with best/last SNR and RSSI per cell, plus a per-relay summary. Relay hashes resolve to a contact only on a unique full-key prefix match (`candidates` > 1 = collision); the per-relay summary merges hashes of different path widths that resolve to the same contact (`relay_identity`, labelled with the longest hash). Pruned by `packet_reception_retention_days` (default 2). `record_packet_reception` returns a `RelayCapture` (or None) that `process_raw_packet` copies into the `raw_packet` broadcast (`relay_reception`, `last_hop_hex`)
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
chosen node), and a Prefix Collisions tab badge.

### Read state
- `GET /read-state/unreads` - counts, mention flags, `last_message_times`, `last_read_ats`, and `first_unread_ids`
- `POST /read-state/mark-all-read`

### Settings
- `GET /settings`
- `PATCH /settings`
- `POST /settings/favorites/toggle`
- `POST /settings/blocked-keys/toggle`
- `POST /settings/blocked-names/toggle`
- `POST /settings/tracked-telemetry/toggle`
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
- `POST /fanout/bots/disable-until-restart` - stop bot modules and keep bots disabled until restart

### Statistics
- `GET /statistics` - aggregated mesh network stats (entity counts, message/packet splits, activity windows, busiest channels, `region_scope_24h` regional adoption)
- `GET /statistics/airtime/range?start_ts&end_ts&bin_count` - per-bin TX/RX airtime utilization % over a range. Default source: the persisted cumulative airtime counters via adjacent-sample deltas (counter resets / disconnect gaps are dropped, not spiked). On OpenHop nodes with the OpenHop API configured, it instead sources TX/RX from OpenHop's `/api/airtime_chart_data` (real per-packet time-on-air, RX included) because OpenHop's companion `STATS_RADIO` frame hardcodes `rx_air_secs=0`; any failure / missing config / non-OpenHop node falls back to the local computation. Each bin also carries `rx_errors` (sum of `recv_errors` counter deltas, None when unknown or on the OpenHop path). Feeds the My Node airtime and receive-error charts. See `app/services/airtime_util.py` (`compute_airtime_utilization`, `map_openhop_airtime_buckets`) and `app/services/openhop_api.py::airtime_chart_data`.
- `GET /packets/raw-feed-stats?start_ts&end_ts` - DB-computed Raw Packet Feed breakdowns (payload/route/hop/hop-byte-width/RSSI buckets + counts) for historical windows, from the decoded columns persisted on `raw_packets`. Neighbor/timeline/unique-source data is not included (needs decryption; stays live-only). See `app/services/raw_feed_stats.py`.

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

## WebSocket Events

- `health` - radio connection status (broadcast on change, personal on connect)
- `contact` - single contact upsert (from advertisements and radio sync)
- `contact_resolved` - prefix contact reconciled to a full contact row (payload: `{ previous_public_key, contact }`)
- `message` - new message (channel or DM, from packet processor or send endpoints)
- `message_acked` - ACK/echo update for existing message (ack count + paths)
- `message_failed` - outgoing DM ran out of retries without an ACK (payload: `{ message_id, failed_at }`)
- `raw_packet` - every incoming RF packet (for real-time packet feed UI); `relay_reception` is true when the copy was stored in `packet_receptions` (flood-routed) and `last_hop_hex` then names the delivering relay (null = heard from the origin), so the Mesh Health Relay reception tab refreshes on arrival
- `contact_deleted` - contact removed from database (payload: `{ public_key }`)
- `channel` - single channel upsert/update (payload: full `Channel`)
- `channel_deleted` - channel removed from database (payload: `{ key }`)
- `message_deleted` - message row removed: a local delete (one event per row, so a deleted reaction gets its own event alongside its target) or a failed DM replaced by a manual retry (payload: `{ message_id, type, conversation_key }`)
- `host_repeater` - host repeater settings saved (payload: `{ version, settings, state, env_enabled }`)
- `new_node` - a public key never stored before (first advert ever, or the radio's own NEW_CONTACT auto-add); batched into a summary on a busy mesh. See "New-node notifications" below
- `error` - toast notification (reconnect failure, missing private key, stuck radio startup, etc.)
- `success` - toast notification (historical decrypt complete, etc.)

Backend WS sends go through typed serialization in `events.py`. Initial WS connect sends `health` only. Contacts/channels are loaded by REST.
Client sends `"ping"` text; server replies `{"type":"pong"}`.

## Data Model Notes

Main tables:
- `contacts` (includes `first_seen` for contact age tracking and `direct_path_hash_mode` / `route_override_*` for DM routing; plus user-editable annotations `notes`, `owner_info`, `owner_key`, `manual_lat`, `manual_lon` - preserved through radio-sync upserts via `COALESCE`, never overwritten by adverts. `owner_key` references another contact; `manual_lat`/`manual_lon` are fallback coordinates used when the contact has no valid advertised location - by the frontend map/paths (`getEffectiveLocation`) and by the advert-links layer's `located_nodes()` query, which resolves the same advertised-wins/manual-fallback effective location so a manual-only node is still an edge endpoint. `battery_chemistry`, migration `_108`, nullable, follows the `telemetry_perms` pattern: absent from the upsert's column list entirely, so radio-sync never touches it, only `set_annotations` does)
- `channels`
  Includes optional `flood_scope_override` for channel-specific regional sends and optional `path_hash_mode_override` for per-channel path hop width.
- `messages` (includes `sender_name`, `sender_key` for per-contact channel message attribution)
- `link_edge_events` (migration `_107`) - per-packet link edge log: one row per resolved undirected node pair (`a_pubkey < b_pubkey`) per stored packet (`raw_packet_id`), with `ts`, `hop_width`, `payload_type`, `route_type`, `confidence` (`unique`/`confirmed`/`nearest`) and `snr`/`rssi` on the final hop into our node only. `UNIQUE(raw_packet_id, a_pubkey, b_pubkey, hop_width)`, so duplicate copies and the backfill are idempotent (first copy's signal wins). Written by `services/link_edges.record_packet_edges()` from `process_raw_packet` for every copy; resolution is the pure `services/traffic_links.py` (flood paths only, walked back from self and forward from an advert origin that is a contact; a hop needs a confirmed soft resolution, a unique prefix among the candidates, or a nearest located candidate at least `NEAREST_RATIO` = 2x closer than the next). Candidates come from `LinkEdgesRepository.known_nodes()`: contacts with a full 64-hex key only, located or not. Analyzer-only `external_map_nodes` are never link endpoints (an analyzer node joins once promoted to a contact by an applied partial resolution). `link_edge_backfill_state` (single row `next_id`/`end_id`) drives the one-time `services/link_edge_backfill.py` backfill over pre-`_107` `raw_packets`
- `raw_packets` (includes signal columns `rssi`/`snr`/`payload_type` and decoded-stat columns `route_type`/`hop_count`/`hop_byte_width`/`path_signature`, parsed from the packet header at ingest and backfilled by migration 089; used by `/packets/raw-feed-stats` for historical breakdowns)
- `airtime_history` (60s samples of the local radio's cumulative `tx_air_secs`/`rx_air_secs` plus, since migration `_116`, the cumulative `recv_errors` counter from `STATS_PACKETS` (firmware v1.12+, NULL on the legacy frame); utilization % and per-bin RX error counts are derived at query time. Sibling of the in-memory `noise_floor_samples`/`battery_history` pattern in `app/services/radio_stats.py`)
- `contact_advert_paths` (recent unique advertisement paths per contact, keyed by contact + path bytes + hop count; count per contact is `advert_paths_per_contact`)
- `contact_path_outcomes` (routes our DMs used per contact with outcomes and trip times, newest 100 per contact, migration `_115`; not covered by the retention pruner)
- `contact_name_history` (tracks name changes over time)
- `repeater_telemetry_history` (time-series telemetry snapshots for tracked repeaters)
- `contact_telemetry_history` (time-series LPP telemetry snapshots for tracked contacts; same schema as repeater table)
- `fanout_configs` (MQTT, bot, webhook, Apprise, SQS integration configs)
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
- `tracked_telemetry_repeaters`, `tracked_telemetry_contacts`
- `auto_resend_channel`
- `auto_add_mentioned_channels` (when enabled, #hashtag channels referenced in chat are auto-recorded in the browser Channel Registry; registry-only, no followed channel is created)
- `telemetry_interval_hours`, `telemetry_routed_hourly` (poll tracked nodes with a direct/routed path hourly instead of on the normal interval)
- Retention (all `0` = keep forever / no cap; enforced by `services/retention_pruner.py` every `retention_prune_interval_hours`, default 24): `raw_packet_retention_days` (default 0; bounds Packet History), `advert_retention_days` (30), `telemetry_retention_days` (30) + `telemetry_max_rows_per_node` (1000) for both telemetry tables, `link_signal_retention_days` (30), `noise_floor_retention_days` / `battery_retention_days` / `airtime_retention_days` (0), `message_retention_days` (0; deletes the message's linked `raw_packets` first), `link_edge_retention_days` (365; `link_edge_events`, migration `_107`), `device_history_retention_days` (0; one age limit for `device_config_history` by snapshot time and `contact_location_history` by `last_seen`, migration `_120`), `advert_paths_per_contact` (10; trimmed on insert and by the pruner, also the contact-analytics read limit). The newer fields are migration `_105`; `RETENTION_DEFAULTS` in `models.py` holds their defaults
- `registry_sync_url` (remote `{name: key}` channel list synced into the registry), `analyzer_sites` (external analyzer link targets, incl. per-site `channel_url_template`), `handy_info` (user overlay for the Handy Info section)
- `external_map_enabled`, `external_map_sync_url`, `external_map_sync_interval_hours` (external analyzer node-directory overlay on the map; also the candidate source for partial-node resolution)
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

Note: MQTT, community MQTT, and bot configs were migrated to the `fanout_configs` table (migrations 36-38).

## Security Posture (intentional)

- No per-user authn/authz model; optionally, operators may enable app-wide HTTP Basic auth for both HTTP and WS entrypoints.
- No CORS restriction (`*`).
- Bot code executes user-provided Python via `exec()`.

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
├── test_block_lists.py         # Blocked keys/names filtering across list/search surfaces
├── test_bot.py                 # Bot execution and sandboxing
├── test_channel_sender_backfill.py # Sender-key backfill uniqueness rules for channel messages
├── test_channels_router.py     # Channels router endpoints
├── test_community_mqtt.py      # Community MQTT publisher (JWT, packet format, hash, broadcast)
├── test_config.py              # Configuration validation
├── test_contact_reconciliation_service.py # Prefix/contact reconciliation service helpers
├── test_contacts_router.py     # Contacts router endpoints
├── test_decoder.py             # Packet parsing/decryption
├── test_device_history.py      # Contact location history + repeater pane snapshots (plan 14)
├── test_disable_bots.py        # MESHCORE_DISABLE_BOTS=true feature
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
├── test_repeater_routes.py     # Repeater command/telemetry/trace + granular pane endpoints
├── test_repository.py          # Data access layer
├── test_room_routes.py         # Room-server login/status/telemetry/ACL endpoints
├── test_rx_log_data.py         # on_rx_log_data event handler integration
├── test_security.py            # Optional Basic Auth middleware / config behavior
├── test_send_messages.py       # Outgoing messages, bot triggers, concurrent sends
├── test_settings_router.py     # Settings endpoints, advert validation
├── test_push_send.py           # Web Push send/dispatch
├── test_radio_stats.py         # Radio stats sampling and noise-floor history
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
