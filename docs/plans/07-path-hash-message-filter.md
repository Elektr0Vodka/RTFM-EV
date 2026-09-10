# 07 - Path-hash message filter

Date: 2026-09-10
Status: draft (local planning only, no code changes)
Category: B (Contacts & messaging UX), per `docs/plans/README.md` entry [07]
Model: Sonnet

## 1. Summary

The brain-dump item asks for a toggle to show/hide 1-byte / 2-byte / 3-byte
path-hash-mode traffic "in the channel/message and/or raw-packet lists." The
phrase names a wire-encoding property (`path_hash_mode`), not a message
attribute the backend stores. Investigation shows:

- The backend never stores a per-row hash-mode/width column on `raw_packets`
  or `messages`. Width is only ever derived at read time from raw packet
  bytes or from `path_len` + hex length.
- The frontend already derives hop-byte-width client-side in **two
  independent places**: the raw-packet feed's session stats
  (`hopByteWidth`/`inferHopByteWidth`) and the chat message list's path badge
  (`formatPathHopWidths`). Neither is currently wired to a filter.
- The raw-packet feed already has a live, per-packet-type filter UI
  (`FeedFilterControls` in `RawPacketFeedView.tsx`) that is the closest
  existing analog to what's being asked for.

**Recommendation:** build the filter in the **raw packet feed**
(`RawPacketFeedView.tsx` / `RawPacketList.tsx`), as an additional checkbox
group next to the existing payload-type filter, entirely client-side. Do
**not** filter the chat message list — see §3 and §6 for why. This is an
OPEN QUESTION to confirm with the user before implementation (see §6).

## Decision (2026-09-10, user)

Build the filter on **both** surfaces: the raw-packet feed (§4.1) and the
chat message list (§4.2), as **two independent, separate toggles** — not one
control shared across surfaces. §4.1 remains the primary/lower-risk
implementation. §4.2 is promoted from "sketch, pursue only if requested" to
committed scope, with the multi-path/virtualization/pagination/unread-anchor
caveats already documented in §4.2 and §6 carried forward as implementation
constraints for that surface, not as reasons to skip it.

## 2. Current state (cited)

### 2.1 Backend: no stored per-row hash mode for packets or messages

- `raw_packets` schema (`app/database.py:70-80`) has `id, timestamp, data,
  message_id, payload_hash, rssi, snr, payload_type`. No `path_hash_mode`,
  `hash_size`, or `path_len` column.
- `messages` schema (`app/database.py:49-68`) has no path/hash columns
  either; per-message routing is stored separately as JSON-ish rows via
  `MessageRepository.add_path`/`add_path` (`app/repository/messages.py:60-85,
  127-146`), which only records `path`, `path_len` (hop count), `rssi`, `snr`
  — no hash mode.
- `app/models.py` `MessagePath` (~406-413): `path`, `received_at`, and
  `path_len: int | None` with the comment "None = legacy (infer as
  len(path)//2, i.e. 1-byte hops)". There is no `path_hash_mode` field on a
  message path. Frontend mirrors this exactly in `types.ts:334-346`
  (`MessagePath` interface).
- `RawPacketBroadcast` and `RawPacketDetail` (`app/models.py:473-523`), the
  models sent over WS/`GET /packets/{id}`, expose `id`, `timestamp`, `data`
  (hex), `payload_type`, `snr`, `rssi`, `decrypted`, `decrypted_info`,
  `transport_code`, `region`. **No hash-mode or hash-size field.** The
  frontend `RawPacket` type (`frontend/src/types.ts:404-426`) matches this
  exactly.
- Hash width for a raw packet is only computable by decoding `data`
  (hex-encoded raw bytes, present on every packet). `app/path_utils.py`
  formalizes this: `decode_path_byte()` (42-56) extracts `(hop_count,
  hash_size)` from the packed path byte; `parse_packet_envelope()` (82-140)
  parses a full packet including hash_size; `bucket_path_hash_widths()`
  (263-304) is an existing backend aggregate that buckets a set of raw rows
  into single/double/triple-byte counts — used only for the 24h stats
  endpoint (`ChannelDetail.path_hash_width_24h`, `StatisticsResponse
  .path_hash_width_24h`; `app/models.py` field usage; surfaced in
  `ChannelInfoPane.tsx:242-244` and
  `SettingsStatisticsSection.tsx` ~410-430), not for filtering any list.

Fact: today, whether a specific stored raw packet or message-path is
1/2/3-byte hash mode is **never persisted**; it is always re-derived from raw
bytes (`data`) or from `path_len` vs. hex length, and only on demand.

### 2.2 Frontend: hop-byte-width is already derived twice, independently

**Raw packet feed (session stats only, not a filter today):**
- `frontend/src/utils/rawPacketStats.ts`:
  - `summarizeRawPacketForStats()` (212-252) calls
    `MeshCoreDecoder.decode(packet.data)` (the multibyte-aware decoder fork,
    `frontend/AGENTS.md` "Stack") and reads `decoded.pathHashSize` (line 234)
    to set `hopByteWidth` on each in-memory stats observation. This is
    null when the packet carries no path tokens (`pathTokenCount <= 0`),
    i.e. direct/zero-hop packets with no hop bytes to inspect.
  - `inferHopByteWidth()` (254-267) falls back to inferring width from the
    first path token's hex length when `hopByteWidth` is missing.
  - This feeds the "Hop Byte Width" bar chart (`hopByteWidthProfile`,
    lines 367-399, 517-518) in the feed's stats drawer
    (`RawPacketFeedView.tsx` "Hop Byte Width" `RankedBars`, ~903-913).
  - This pipeline only touches `RawPacketStatsObservation` records kept in
    `rawPacketStore.ts`'s session stats buffer, **not** the actual rendered
    `RawPacket[]` list used by `RawPacketList`.

**Chat message list (display badge only, not a filter today):**
- `frontend/src/utils/pathUtils.ts`:
  - `inferPathHashMode()` (44-70) derives mode (0/1/2) from a single
    `MessagePath`'s `path` hex length and `path_len`.
  - `formatPathHopWidths()` (476-503) aggregates across all of a message's
    `paths[]` and returns a compact label like `"2B"` or `"1B/2B"` when
    different observed paths for the same message used different widths.
    Returns `null` for messages with no derivable width (no paths, all
    direct/0-hop, or legacy rows without `path_len`).
- `frontend/src/contexts/PathHopWidthContext.tsx` (full file) plus
  `frontend/src/utils/pathHopWidthPreference.ts` (localStorage key
  `remoteterm-show-path-hop-width`, off by default) implement a **browser-local
  display toggle** — not a filter — for whether the hop-width badge is shown
  at all next to a message's hop-count badge.
- Consumed in `MessageList.tsx:325-327`:
  `const { showPathHopWidth } = usePathHopWidth(); ... const widthLabel =
  showPathHopWidth ? formatPathHopWidths(paths) : null;`
- The toggle checkbox lives in
  `frontend/src/components/settings/SettingsLocalSection.tsx:489-498`
  ("Show Path Hop Width").

### 2.3 Existing filter UI pattern to extend (raw packet feed)

`frontend/src/components/RawPacketFeedView.tsx`:
- `FeedFilterControls` (90-198) renders a hex substring filter, an "All"
  checkbox, one checkbox + "(only)" link per `KNOWN_PAYLOAD_TYPES` entry
  (167-186), and an "Autoscroll" checkbox — explicitly session-only, not
  persisted (confirmed by the errata note in `frontend/AGENTS.md`
  "RawPacketList autoscroll").
- `enabledTypes` state (603) and `filteredPackets` memo (611-639) filter the
  live `packets` array (from `useRawPackets()`, backed by
  `stores/rawPacketStore.ts`) by payload type and hex substring before
  handing them to `RawPacketList`.
- This is the natural place to add a third filter dimension (hop byte
  width) using the same checkbox-group convention.

### 2.4 Terminology already used in the app (for consistency)

- `ChannelPathHashModeOverrideModal.tsx:15-17,55-65`: "1-byte", "2-byte",
  "3-byte" / "N-byte hop identifiers".
- `ContactPathDiscoveryModal.tsx:31-33`: "1-byte hops" / "2-byte hops" /
  "3-byte hops".
- `SettingsRadioSection.tsx:1041-1043`: "1 byte — up to 63 hops (default)" /
  "2 bytes — up to 32 hops" / "3 bytes — up to 21 hops".
- `rawPacketStats.ts:369-371,393-397`: "1 byte / hop", "2 bytes / hop", "3
  bytes / hop" (existing stats-chart labels — closest precedent for the new
  filter's label set).

## 3. Reference / interpretation: what would the filter actually mean

Two different things could be filtered, and they behave differently:

**A. Raw packet feed.** Every raw packet's `data` field lets the decoder
report `pathHashSize` directly and unambiguously (when the packet carries
path bytes at all). One packet = one hash-mode value (or "no path" for
0-hop/direct packets, which is a distinct bucket, not 1-byte). This maps
cleanly onto the existing `FeedFilterControls` checkbox-group pattern.

**B. Chat message list.** A stored `Message` can have **zero, one, or many**
`MessagePath` entries (repeats/echoes heard via different routes,
`app/AGENTS.md` "Echo/repeat dedup"). Different paths for the *same* message
can have different widths (this is exactly why `formatPathHopWidths()`
returns a multi-value label like `"1B/2B"`). A message with no paths yet
(outgoing message, or a message not yet echoed) has no derivable width at
all. "Show/hide 1-byte messages" is therefore not a single well-defined
predicate for a message row — it would need an explicit policy (e.g. "match
if ANY path is that width" vs. "match if ALL paths are that width" vs. "only
messages that are unambiguously that width"), and messages with no
derivable width need an explicit bucket too. Filtering the message list
would need this policy decided (§6 open question) and would also filter
out/in a message based on a property most users never think about while
reading chat.

Given the AGENTS.md classification of the raw packet feed as a "tertiary...
debug/observation tool ('radio aquarium')" (`AGENTS.md` Feature Priority)
purpose-built for exactly this kind of protocol-encoding inspection, and
the message list's status as a "Primary" feature with fragile,
already-documented virtualization/pagination/unread-anchor invariants
(`frontend/AGENTS.md` "Virtualization (MessageList)", "packet isolation"
section), the raw packet feed is the lower-risk, more semantically correct
home for this filter.

## 4. Design

### 4.1 Recommended surface: Raw Packet Feed only

Add hop-byte-width as a fourth filter dimension in
`RawPacketFeedView.tsx`, alongside payload type and hex substring:

- New buckets, matching the labels already used in `rawPacketStats.ts`:
  `"1 byte / hop"`, `"2 bytes / hop"`, `"3 bytes / hop"`, and `"No path"`
  (0-hop/direct packets — distinct from "1-byte", since they carry no hop
  bytes to classify; `inferHopByteWidth()` already returns `null` for these,
  see `rawPacketStats.ts:254-267`).
- Derive per-packet width the same way `summarizeRawPacketForStats` does:
  decode `packet.data` with `MeshCoreDecoder.decode(...)`, read
  `decoded.pathHashSize`, falling back to inferring from the first path
  token when absent — i.e. reuse (not duplicate) the existing
  `inferHopByteWidth`-equivalent logic. Because that function currently
  takes a `RawPacketStatsObservation`, not a `RawPacket`, this needs either:
  (a) a small shared helper extracted from `rawPacketStats.ts` that takes a
  decoded packet and returns width, callable from both the stats path and
  the new filter path, or (b) computing width directly in
  `RawPacketFeedView.tsx` alongside the existing `getPacketTypeName()`
  helper (60-71), which already does its own `MeshCoreDecoder.decode()` call
  per packet. Given the "prefer fewer, stronger modules" ethos
  (`frontend/AGENTS.md` Code Ethos), (a) is preferred so the stats chart and
  the filter can't drift apart, but this is a small refactor, not new
  architecture.
- State: a second `Set<string>` (e.g. `enabledHopWidths`), defaulting to all
  four buckets enabled (parallel to `enabledTypes`), session-only (not
  persisted) — matching the existing filter checkboxes' explicit
  non-persistence (`autoScroll` errata note applies to the same UI region).
- UI: extend `FeedFilterControls` with a second checkbox row (or inline
  group) using the same "All" + per-bucket + "(only)" convention as the
  payload-type row (90-198), so mobile/desktop parity and the existing test
  coverage pattern (`frontend/src/test/rawPacketFeedView.test.tsx`) can be
  extended rather than reinvented.
- Filtering: extend the `filteredPackets` memo (627-639) to also require
  membership in `enabledHopWidths`.

**No backend change needed.** `RawPacket.data` (hex) is already present on
every packet delivered via WS `raw_packet` events and `GET /packets/{id}`;
no new field needs to be added to `RawPacketBroadcast`/`RawPacketDetail`.

### 4.2 Chat message list filter (RESOLVED into scope, per Decision above)

Committed as a second, independent toggle on the chat message list — separate
state, separate UI control from §4.1's raw-feed filter. Design below, still
sketch-level relative to §4.1's more worked-out plan; the multi-path/
virtualization caveats listed here must be addressed during implementation,
not treated as blockers to building it at all:

- Reuse `formatPathHopWidths()`'s per-path inference
  (`inferPathHashMode()`, `pathUtils.ts:44-70`) to classify each
  `Message.paths[]` entry, then decide and document the ANY/ALL policy from
  §3.
- Needs an explicit "no path / unresolved width" bucket, since many
  messages (all outgoing, and incoming messages before their first
  path-bearing echo) will have `paths === null` or all-0-hop paths.
- Filtering would need to interact correctly with:
  - `useConversationMessages` pagination/dedup (a filtered-out message must
    not silently break `hasOlder`/`hasNewer` bookkeping, which is
    server-cursor-based, not filtered-count-based).
  - The unread-divider anchor (`first_unread_ids`, keyed by message `id`,
    `frontend/AGENTS.md` "Types and Contracts") — if the anchor message gets
    filtered out client-side, `MessageList`'s `findIndex` returns `-1` and
    triggers the "Jump to unread" fallback path unnecessarily.
  - Virtualization (`@tanstack/react-virtual`) row-height/measurement
    caching, which is explicitly documented as fragile
    (`frontend/AGENTS.md` "Virtualization (MessageList)").
- This is materially more invasive than §4.1 and touches Primary-priority,
  already-fragile code. Per the Decision above, it is in scope anyway, as a
  separate toggle from §4.1 — implement with extra care and dedicated test
  coverage for the pagination/unread-anchor/virtualization interactions
  listed above, rather than treating those risks as a reason to drop it.

## 5. Phasing

1. Extract/confirm a shared "classify raw packet hop-byte-width" helper
   (reusing `inferHopByteWidth`'s logic, generalized to accept a decoded
   packet or `RawPacket` directly) so the stats chart and the new filter
   share one source of truth.
2. Add `enabledHopWidths` state + second checkbox row to
   `FeedFilterControls`/`RawPacketFeedView.tsx`; wire into `filteredPackets`.
3. Extend `frontend/src/test/rawPacketFeedView.test.tsx` for the new filter
   (toggle behavior, "(only)" behavior, interaction with existing type/hex
   filters, "No path" bucket for direct/0-hop packets).
4. Message-list variant per §4.2, as a separate, independent toggle from the
   raw-feed filter in step 2 — in scope per the Decision above, scoped and
   reviewed separately given its higher risk surface (pagination/unread-
   anchor/virtualization interactions, §4.2/§6).

## 6. Risks / open questions

- **RESOLVED (primary, 2026-09-10, user):** Build both surfaces — the raw
  packet feed (§4.1) and the chat message list (§4.2) — as two independent,
  separate toggles, not a single shared control. The brainstorm phrasing said
  "messages," and the underlying property has no natural single per-chat-
  message value (§3), so the chat-list toggle needs an explicit ANY/ALL
  policy and a "no derivable width" bucket (§4.2) plus the pagination/unread-
  anchor/virtualization coverage called out below — these are implementation
  constraints for §4.2, not reasons to omit it.
- **OPEN QUESTION:** Should "No path" (0-hop/direct) packets be filterable
  at all, or always shown regardless of the hop-width checkboxes? They are
  not "1-byte" in the wire-format sense (`path_hash_mode` only applies to
  hop identifiers; a 0-hop packet has none), so lumping them into "1-byte"
  would misrepresent the data.
- **OPEN QUESTION:** Should the new filter's checked/unchecked state persist
  across sessions (like `showPathHopWidth`, localStorage-backed) or stay
  session-only (like `enabledTypes`/`hexFilter`/`autoScroll` in the same
  component today)? Recommend matching the existing sibling filters
  (session-only) for consistency within `RawPacketFeedView.tsx`, but this is
  a UX call, not a technical constraint.
- **Risk:** `MeshCoreDecoder.decode()` runs once per packet already for
  `getPacketTypeName()` (`RawPacketFeedView.tsx:59-71`) and again inside
  `RawPacketList`'s `decodePacketSummary` (`RawPacketList.tsx:73-78`).
  Adding a third decode pass for hop-width classification (unless merged
  into the existing `packetsWithTypes` memo) would triple decode cost on
  large in-memory packet buffers. Mitigate by computing hop-width in the
  same pass as `getPacketTypeName()`/`packetsWithTypes` rather than as a
  separate `.map()`.
- **UNVERIFIED:** Whether `decoded.pathHashSize` from
  `@michaelhart/meshcore-decoder` is populated for all payload types that
  carry a path (not just `GroupText`/`TextMessage`), or only for the ones
  `rawPacketStats.ts` currently exercises. Confirm against the decoder's
  types/README before implementation; `rawPacketStats.ts:234` is the only
  current call site to check against.
- **Risk (message-list variant only):** see §4.2's interaction list
  (pagination cursors, unread anchor, virtualization). Any message-list
  filter implementation must add coverage in
  `frontend/src/test/messageList.test.tsx` and
  `frontend/src/test/useConversationMessages.test.ts` for these interactions
  specifically, not just the filter predicate itself.

## 7. Verification plan

- Backend: none required for §4.1 (no backend change). If §4.2 is pursued
  and needs a backend-computed field, add/extend `tests/test_packets_router.py`
  and `tests/test_messages_search.py` accordingly (not scoped here).
- Frontend:
  - `npm run test:run` after implementation, with new/updated cases in
    `frontend/src/test/rawPacketFeedView.test.tsx` covering: default
    all-enabled state, toggling one width off hides matching packets,
    "(only)" isolates one width, "No path" bucket behavior, and combination
    with the existing type/hex filters.
  - `npm run build` (repo standard gate per `AGENTS.md`/`frontend/AGENTS.md`).
  - Manual check in the running app: open the raw packet feed with live
    traffic (or replayed fixtures), confirm the new checkboxes visually
    hide/show packets consistent with each packet's decoded path length in
    the packet detail modal (`RawPacketDetailModal.tsx`), which independently
    renders `pathHashSize`-derived hop formatting today
    (`rawPacketInspector.ts:294-303`) — use it as a cross-check oracle.
- Run `./scripts/quality/all_quality.sh` before considering this done, per
  `AGENTS.md` "Important Rules".

## 8. Effort

Small-to-medium frontend-only change (§4.1): one shared helper extraction,
one new filter-state + checkbox row, one memo extension, plus test
additions. No migration, no API contract change, no cross-cutting risk.
Estimate: well within a single Sonnet-scoped implementation session.

Per the Decision above, the message-list variant (§4.2) is in scope, not a
stretch goal — but given the virtualization/pagination/unread-anchor
interactions in §6, its effort should be tracked separately from §4.1's
estimate above, not folded into a single combined number.
