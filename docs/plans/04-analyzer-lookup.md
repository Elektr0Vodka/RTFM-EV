# 04. Analyzer Lookup + Add-Contact-From-Analyzer

Date: 2026-09-10
Status: local planning draft. No code changed by this document. No PRs/issues/commits.
Category: C (External analyzer integration), per `docs/plans/README.md` line 68-71.
Model: Sonnet. State: Absent (greenfield).

## 1. Summary

Two related, independently shippable features:

- **(A) "Look up on analyzer"**: a context action on nodes (contacts), raw
  packets, and unknown/unresolved sender IDs that opens a user-configured
  external MeshCore analyzer site (e.g. mc-radar, cornmeister) at the page
  for that node or packet, in a new browser tab.
- **(B) "Add contact from analyzer"**: the reverse flow. Given a pubkey and
  name pasted or deep-linked in from an analyzer, create a local RTFM-EV
  contact via the existing `POST /api/contacts` create-contact path.

Both build on a new **user-configurable list of "favorite analyzer sites"**
(name plus URL template with a `{pubkey}` placeholder), stored in
`app_settings`, following the repo's existing pattern of simple JSON-shaped
settings fields (`known_regions`, `blocked_keys`) but introducing the first
list-of-objects field in `AppSettings`.

This is purely a client-side deep-link feature. RTFM-EV never talks to the
analyzer's API. The backend's only role is storing/serving the site list and
creating the contact. Opening the link is a `window.open(...)` navigation
already used elsewhere in this codebase (`ContactInfoPane.tsx:414-420`).

## 2. Current state (cited)

### 2.1 Contact public keys and "unknown sender" concept

- Full contact keys are 64-hex; server does `LIKE 'prefix%'` matching on
  12-char prefixes (`AGENTS.md` lines 413-417, "Contact Public Keys").
- `frontend/src/utils/pubkey.ts:34-40`:
  - `isPrefixOnlyContact(pubkey)`: `pubkey.length < 64` (we only have a
    12-char prefix, not the full identity).
  - `isUnknownFullKeyContact(pubkey, lastAdvert)`: full 64-hex key but no
    advert heard yet (`getContactDisplayName` renders these as
    `[unknown sender]`, `pubkey.ts:24-32`).
- **Implication for feature A**: a prefix-only contact (12 hex chars) cannot
  be looked up on an external analyzer, which needs the full 64-hex pubkey.
  The "Look up on analyzer" action must be disabled/hidden for prefix-only
  contacts, exactly like Path Discovery and Direct Trace already are in
  `ChatHeader.tsx:298-327` (`disabled={activeContactIsPrefixOnly}`).

### 2.2 Surfaces that would carry a "look up" action

- `frontend/src/components/ContactInfoPane.tsx`: contact detail sheet.
  Public key is rendered and already click-to-copy at lines 331-343. This
  is the natural place for a "Look up on analyzer" action/button next to
  the existing favorite/block/search actions (pattern at lines 439-458,
  461-502, 504-515).
- `frontend/src/components/ChatHeader.tsx`: conversation header icon row
  (lines 297-535: Path Discovery, Direct Trace, notifications, flood-scope,
  favorite, delete). A new icon button here would need
  `activeContact.public_key` (`ChatHeader.tsx:123-130`) and the same
  prefix-only guard used for Path Discovery/Trace (`ChatHeader.tsx:302-311`,
  `316-327`).
- Raw packet feed / detail:
  - `frontend/src/stores/rawPacketStore.ts` holds the live packet stream
    outside React (`recordRawPacket`, lines 81-91); it has no per-packet
    action affordances itself, those live in the consuming components.
  - `frontend/src/components/RawPacketList.tsx:168`: each row's `onClick`
    opens `RawPacketDetailModal` via `onPacketClick(packet)`. No
    right-click/context-menu exists in this file today (grep found only
    the one row `onClick`).
  - `frontend/src/components/RawPacketDetailModal.tsx`: the detail dialog.
    `RawPacket.decrypted_info.contact_key` (see 2.3) is the field carrying
    a resolvable pubkey for a decrypted packet; `packetContext`
    construction at `RawPacketDetailModal.tsx:227-276` already surfaces
    `decrypted_info.sender` (a display name, not a key) as "Sender: ...".
    An analyzer-lookup action here would need
    `packet.decrypted_info?.contact_key` or
    `packet.decrypted_info?.channel_key`, not the sender name.
- Network visualizer node "menu": there is **no click/context menu today**,
  only a hover/pin **tooltip**
  (`frontend/src/components/visualizer/VisualizerTooltip.tsx`, a read-only
  `<div>` at lines 38-86) driven by pin-toggle state in
  `useVisualizer3DScene.ts:58-59, 296-304` (click toggles `pinnedNodeId`).
  Adding a "Look up on analyzer" action here means either (a) adding a
  clickable row inside the existing tooltip `<div>` (smallest change), or
  (b) building an actual context menu; treat (b) as out of scope for the
  first slice; see Section 5.
- Unknown-sender rendering: `pubkey.ts:24-32` (`getContactDisplayName`) and
  the "we haven't heard an advert" banners in `ContactInfoPane.tsx:353-366`
  are the two places an "unknown" identity is surfaced. The lookup action
  is only meaningful when the full 64-hex key is known
  (`!isPrefixOnlyContact`), which is already true for the
  `isUnknownFullKeyContact` case; it just lacks name/advert data, not key
  bytes.

### 2.3 Packet-side pubkey field

- `RawPacket.decrypted_info` (`frontend/src/types.ts:414-421`) has
  `contact_key: string | null` and `channel_key: string | null`.
- `app/models.py:468` (`contact_key: str | None = None`) is the backend
  field; it is populated from `contact.public_key` (full 64-hex) at
  `app/packet_processor.py:813: "contact_key": contact.public_key`, and
  from `message.sender_key` / `message.conversation_key` in the historical
  packet-detail endpoint (`app/routers/packets.py:593, 600`).
- **Fact**: when populated, `decrypted_info.contact_key` is a full 64-hex
  key suitable for an analyzer node lookup. It is `null` for undecrypted
  packets or packets from senders RTFM-EV hasn't resolved to a contact; in
  that case there is no key to look up, only the raw packet bytes (payload
  hash, not a node pubkey).

### 2.4 Settings: current shape and precedent

- `app/models.py:1009-1101` (`AppSettings`): every list field today is
  `list[str]` or `list[int]` (`known_regions`, `blocked_keys`,
  `blocked_names`, `discovery_blocked_types`, `tracked_telemetry_*`). There
  is **no existing list-of-objects field**; a "favorite analyzer sites"
  list (name plus URL template pairs) would be the first of that shape.
- `registry_sync_url: str` (`app/models.py:1098-1101`, added by
  `app/migrations/_068_add_registry_sync_url.py`) is the closest precedent
  for "a user-configured external URL living in settings," but it is a
  single scalar used for a **server-side fetch**
  (`app/routers/registry.py:22-75`, `httpx.AsyncClient(...).get(url)`) that
  pulls remote *data* into the app. That pattern does not fit here:
  analyzer lookup is a **client-side navigation** (`window.open`), not
  something the backend should fetch on the user's behalf (see privacy
  note, Section 6).
- `GET/PATCH /api/settings` (`app/routers/settings.py:204-211, 210-329`;
  `AGENTS.md` line 385-386) is the existing settings CRUD surface. A new
  `analyzer_sites` field would be added the same way `registry_sync_url`
  was: a new `AppSettingsUpdate` field, a new `AppSettings` field, a
  migration, and pass-through logic in `update_settings` mirroring
  `settings.py:290-291`.
- Frontend `AppSettings`/`AppSettingsUpdate` interfaces are in
  `frontend/src/types.ts:428-462`. `registry_sync_url` editing UI lives in
  `frontend/src/components/settings/SettingsDatabaseSection.tsx:34, 228-229`.
  `frontend/src/components/ChannelRegistryView.tsx` is the existing
  list-rendering UI precedent for a synced list, though it renders
  server-fetched data, not a locally-edited list; the analyzer-sites editor
  is closer in shape to the blocked-keys/blocked-names list editors in
  `frontend/src/components/settings/SettingsRadioAppSection.tsx` (not read
  in full for this pass; confirm exact list-editor pattern before
  implementation).

### 2.5 Add-contact path

- `POST /api/contacts` (`app/routers/contacts.py:266-304`,
  `CreateContactRequest` at `app/models.py:221-232`):
  - `public_key: str = Field(min_length=64, max_length=64, ...)`: **only
    accepts a full 64-hex key**, which matches what an analyzer node page
    would supply.
  - `type: int = Field(default=0, ge=0, le=3, ...)`: **fact**, this caps
    type at 3 (unknown/client/repeater/room). Type `4` (Sensor, per
    `AGENTS.md` line 425 "Contact Types") **cannot** be set via this
    endpoint. If an analyzer distinguishes a "Sensor" role, "Add contact
    from analyzer" cannot pass that through as-is; see open question in
    Section 6.
  - Hex validation is re-checked at the router (`contacts.py:275-279`,
    `bytes.fromhex(...)`), independent of the Pydantic length constraint.
  - If the contact already exists, the name is updated and name history is
    recorded (`contacts.py:281-296`), so "Add contact from analyzer" is
    safe to call for an already-known contact (upserts the name).
- Frontend already has a contact-creation form and callback:
  `frontend/src/components/NewMessageModal.tsx`, the `new-contact` tab
  (placeholder text `"64-character hex public key"` at line 311) and
  `onCreateContact(name, publicKey, tryHistorical, type?)` prop
  (`NewMessageModal.tsx:35-40`). The modal already supports a
  `prefillRequest` union prop for pre-populating a tab from outside
  (currently only `{ tab: 'hashtag', hashtagName, nonce }`,
  `NewMessageModal.tsx:29-33`). **This is the natural integration seam for
  "Add contact from analyzer"**: extend the `prefillRequest` union with a
  `{ tab: 'new-contact', publicKey, name, nonce }` variant instead of
  building a new dialog.

## 3. Reference research: analyzer URL schemes

### 3.1 Confirmed via `docs/sources-of-truth.md` (verified 2026-09-10)

- mc-radar: `https://mc-radar.woodwar.com/node/<64-hex>` (line 71).
- cornmeister: `#node?id=<64-hex>` on `https://cornmeister.nl` (line 70).

No local source checkout for mc-radar.woodwar.com exists on this machine;
its scheme is **only** verified against `docs/sources-of-truth.md`, not
against source code. Any URL form beyond the single `/node/<64-hex>` path
is **UNVERIFIED** for mc-radar.

### 3.2 Confirmed via local source: `cornmeister-mesh-analyzer` (Go)

Note: `sources.md` in this repo
(`G:\Github\repositories\Elektr0Vodka\cornmeister-mesh-analyzer\sources.md`)
does not list Cornmeister's *own* URL scheme; it is a bill-of-materials for
Cornmeister's own external dependencies (e.g. `meshcore-go`, MQTT broker,
map tiles). The node/packet deep-link scheme itself was confirmed directly
in the frontend JS router/link-builder files:

- Node deep link: **`#node?id=<pubkey>`**, confirmed at
  `internal/web/static/analytics-links.js:6`
  (`export function nodeHref(id) { return '#node?id=' + encodeURIComponent(id || ''); }`),
  and reused at `internal/web/static/node-tabs.js:19`,
  `internal/web/static/ranking.js:471`, `internal/web/static/profile.js:88`,
  `internal/web/static/node.js:3-4, 846`.
- Optional tab suffix: `#node?id=<id>&tab=<details|analytics|reach|...>`,
  confirmed by `internal/web/static/node-tabs.js` and its test
  `internal/web/static/node-tabs.test.mjs:8-15`
  (`nodeTabHash('ABC','analytics') === '#node?id=ABC&tab=analytics'`).
  Omitting `tab` (or passing `details`) yields the bare `#node?id=<id>`
  form, so RTFM-EV's outbound link only ever needs the bare form.
- Packet deep link: **`#packets?hash=<packetHash>`**, confirmed at
  `internal/web/static/analytics-links.js:8` (`packetHref`), reused at
  `internal/web/static/channels.js:802` and
  `internal/web/static/packet-detail.js:235`
  (`location.origin + '/#packets?hash=' + p.Hash`, the site's own
  canonical share-link format, i.e. `<origin>/#packets?hash=<hash>`).
  Confirmed server-side handling of the query param:
  `internal/web/static/packets.js:981-982`
  (`if (qs.get('hash')) selectedHash = qs.get('hash'); traceHash = qs.get('trace') === '1' ? qs.get('hash') : null;`),
  i.e. `?hash=<hash>` selects/filters to that packet, and an additional
  `&trace=1` triggers trace mode for it.
- **Caveat (not fully resolved)**: `internal/web/static/touch-gestures.js:97-98`
  builds two different hrefs from a swipe gesture: `#packets?hash=<hash>`
  ("filter" action) and `#packets?packet=<hash>` ("trace" action). The
  `packets.js` query-param reader (981-982) only reads `hash` and `trace`,
  never `packet`, so the `?packet=` form built by `touch-gestures.js:98`
  does not match what `packets.js` consumes. This looks like a stale/dead
  code path in the reference repo rather than a second supported query
  param. **Do not build against `?packet=`**; use `?hash=` only, marked
  UNVERIFIED beyond that one confirmed reader.
- **Packet hash semantics is a real cross-repo gap, not just a naming
  question.** Cornmeister's packet hash is a payload/observation identity
  computed by its own Go decoder (`internal/decode/decoder.go`), not
  necessarily the same value as RTFM-EV's raw-packet `id` (payload-hash
  dedup key, excludes path bytes; `AGENTS.md` lines 121-125) or
  `observation_id` (per-arrival WS identity). **Do not assume RTFM-EV's
  `packet.id` can be substituted directly into `#packets?hash=<id>`** on an
  arbitrary analyzer without confirming that analyzer's hash algorithm
  matches. Mark this UNVERIFIED per-analyzer; treat packet lookup as
  "best-effort, may 404 on the analyzer side" rather than a guaranteed
  round-trip.

### 3.3 Confirmed via local source: `EU-Meshcore-Analyzer` (Go)

Same link-builder pattern exists in this sibling codebase
(`web/js/lib/analytics-links.js:34-39`), confirming the `#node?id=`,
`#observers?observer=`, `#packets?hash=` family is used consistently
across both local repos (they appear to share development lineage and
authorship, per shared filenames `node-tabs.js`, `analytics-links.js`,
`router.js` and comment style in both trees). Notably, this build's
`nodeHref` has a **fallback**: `#map?node=<id>` when the `#node` detail
page shell is not present (`analytics-links.js:34-37`,
`hasNodeDetailPage()` probe at lines 25-28). This confirms the node-link
query-param name is not universally `id=` on every page of every such
site; some pages use `#map?node=<id>` instead. **This is a second,
distinct URL form** worth keeping in mind for the site-template design (a
per-site URL *template*, not a hardcoded `#node?id=` builder), but
RTFM-EV cannot know which form a given user-added site expects; the URL
template mechanism (Section 4.1) exists specifically so users supply the
correct form per site rather than RTFM-EV guessing.

EU-Meshcore-Analyzer's `README.md` (lines 1-57) describes it as
"Greenfield, architecture draft plus compiling skeleton" with no fixed
public production domain documented in this checkout; it is a **map/UX
reference**, not a second confirmed production analyzer target. Do not
treat it as a third "known site" beyond mc-radar/cornmeister.

### 3.4 Summary table

| Analyzer | Node URL | Packet URL | Source |
|---|---|---|---|
| mc-radar.woodwar.com | `/node/<64-hex>` | UNVERIFIED | `docs/sources-of-truth.md:71` (doc only, no local source) |
| cornmeister.nl | `#node?id=<64-hex>` | `#packets?hash=<hash>` (UNVERIFIED whether cornmeister.nl's *live* deployment matches this local dev checkout) | `docs/sources-of-truth.md:70` plus local repo `cornmeister-mesh-analyzer` (`analytics-links.js:6,8`) |
| EU-Meshcore-Analyzer-family sites (generic) | `#node?id=<id>` or `#map?node=<id>` | `#packets?hash=<hash>` | Local repo `EU-Meshcore-Analyzer` (`analytics-links.js:34-39`); reference architecture only, not a named production site |

The local `cornmeister-mesh-analyzer` and `EU-Meshcore-Analyzer` checkouts
are **development trees** with commit/doc dates through 2026-09; they are
not guaranteed to exactly match what is currently deployed at
`cornmeister.nl`. Treat the `sources-of-truth.md` lines as the ground
truth for the deployed scheme, and the local source as corroboration plus
the best available evidence for the *shape* of a packet-lookup URL, which
`sources-of-truth.md` does not mention at all.

## 4. Design

### 4.1 Settings model: favorite analyzer sites

New typed model (backend, `app/models.py`, alongside other settings
sub-models):

```python
class AnalyzerSite(BaseModel):
    name: str = Field(description="Display name, e.g. 'mc-radar'")
    node_url_template: str = Field(
        description="URL template with a {pubkey} placeholder, e.g. "
        "'https://mc-radar.woodwar.com/node/{pubkey}'"
    )
    packet_url_template: str | None = Field(
        default=None,
        description="Optional URL template with a {hash} placeholder for "
        "packet lookups. Best-effort: not every analyzer's packet hash "
        "matches RTFM-EV's raw-packet id.",
    )
```

Added to `AppSettings` as
`analyzer_sites: list[AnalyzerSite] = Field(default_factory=list, ...)`.
This is the **first list-of-objects field** in `AppSettings` (Section 2.4);
model it as its own `BaseModel`, per the repo's "typed contracts at
important boundaries" ethos (`AGENTS.md` line 108).

Backend changes needed (new migration plus wiring), mirroring the
`registry_sync_url` precedent (`app/migrations/_068_add_registry_sync_url.py`,
`app/routers/settings.py:98-101, 290-291`):

- New migration `app/migrations/_0NN_add_analyzer_sites.py` adding an
  `analyzer_sites` TEXT column (JSON-encoded), default `'[]'`.
- `AppSettingsRepository` read/write support for the new field (repository
  file not read in this pass; confirm its JSON (de)serialization pattern
  for existing list fields, e.g. `known_regions`, before implementing).
- `AppSettingsUpdate.analyzer_sites: list[AnalyzerSite] | None` in
  `app/routers/settings.py`, with basic validation: non-empty `name`,
  non-empty `node_url_template` containing the literal substring
  `{pubkey}` (reject templates missing the placeholder; a template with no
  placeholder is a configuration bug, not a valid site).
- No server-side fetch of the analyzer URL at any point; this setting is
  purely stored and handed back to the frontend for `window.open(...)`.
  Unlike `registry_sync_url`, there is no `/api/analyzer-sites/open` or
  similar backend endpoint; the frontend builds the final URL client-side
  and navigates directly. This avoids the backend acting as an
  SSRF-capable proxy for a user-supplied URL, and avoids leaking the
  pubkey through server logs of an outbound backend request.

Frontend: extend `AppSettings`/`AppSettingsUpdate` in
`frontend/src/types.ts:428-462` with `analyzer_sites: AnalyzerSite[]`, and
add a settings-section editor. Placement: a new subsection alongside
`registry_sync_url` in `SettingsDatabaseSection.tsx` (external-integration
theme) or a new "Integrations" grouping; confirm against
`frontend/AGENTS.md` "Canonical style reference" (`SettingsLocalSection.tsx`
ThemePreview) for list-editor conventions before choosing. Do not invent a
new visual pattern (see `frontend/AGENTS.md` styling conventions, lines
482-499).

### 4.2 Feature A: "Look up on analyzer"

Client-side only. Given a full 64-hex pubkey (or a packet hash) and the
configured `analyzer_sites` list:

1. If the list has exactly one site, act directly; if more than one, show
   a small chooser (reuse the manual dropdown pattern already used for
   notification settings in `ChatHeader.tsx:332-445`, i.e.
   `notifDropdownOpen` state plus outside-click handler, rather than
   adding a new dependency; see below).
2. Build the URL by substituting `{pubkey}` (or `{hash}`) into the chosen
   site's template.
3. `window.open(url, '_blank')`, matching the existing pattern in
   `ContactInfoPane.tsx:414-420` for map-focus links.

Surfaces to wire (smallest-change-first order, see Section 5 phasing):

- `ContactInfoPane.tsx`: add a "Look up on analyzer" action row next to
  the existing favorite/block/search action rows (pattern at lines
  439-458, 504-515), guarded by `!isPrefixOnlyResolvedContact`
  (contact.public_key is full-length) and `analyzer_sites.length > 0`.
- `ChatHeader.tsx`: optional icon-button addition in the action row
  (lines 297-535), guarded the same way as Path Discovery/Trace
  (`activeContactIsPrefixOnly`, lines 302-311/316-327). Lower priority
  than ContactInfoPane since the info pane is reachable from the same
  click target (`ChatHeader.tsx:180-196` already opens `ContactInfoPane`
  from the avatar).
- `RawPacketDetailModal.tsx`: add a "Look up sender" action when
  `packet.decrypted_info?.contact_key` is present (Section 2.3), and
  optionally a "Look up packet" action using `packet.data`'s payload hash
  IF a site has `packet_url_template` configured; mark this second one
  experimental given the Section 3.2 hash-semantics caveat.
- Network visualizer: smallest change is adding a clickable line inside
  the existing `VisualizerTooltip.tsx` (lines 38-86) when a node is
  **pinned** (not just hovered, since hover tooltips should not offer an
  action a hover-away would cancel), e.g. below the "Traffic exchanged
  with" section, a "Look up {node.name} on analyzer" line calling the
  same helper as ContactInfoPane's action, keyed off `node.id`. `node.id`
  here needs confirming as a full 64-hex key versus a display-derived id
  (not verified in this pass; check `packetNetworkGraph.ts` before
  implementing; `VisualizerTooltip.tsx:42-44` shows `node.id.slice(0, 8)`
  used as a *display* fallback, which implies `node.id` itself is
  expected to be the full key, but this needs confirming against the
  graph builder).
- Unknown-sender rendering: no separate surface. An `isUnknownFullKeyContact`
  contact already has a full 64-hex `public_key` (only advert/name data is
  missing, Section 2.2), so it is covered by the ContactInfoPane action
  once that pane is open for such a contact.

**No new npm dependency required.** There is no `dropdown-menu` or
`context-menu` shadcn primitive in this codebase today (confirmed: no
`frontend/src/components/ui/*menu*` files, and only
`@radix-ui/react-{checkbox,dialog,label,separator,slot,tabs}` in
`frontend/package.json:22-27`). Reuse the manual open/close-on-outside-click
pattern already proven in `ChatHeader.tsx:81-102, 332-357` rather than
adding `@radix-ui/react-dropdown-menu`, consistent with "no new
dependencies without justification" (`CLAUDE.md` "Code Changes").

### 4.3 Feature B: "Add contact from analyzer"

Two entry points:

1. **Paste flow** (always available, no deep-link needed): extend
   `NewMessageModal`'s `prefillRequest` union (`NewMessageModal.tsx:29-33`)
   with a `{ tab: 'new-contact', publicKey, name, nonce }` variant, so a
   "Paste from analyzer" affordance (e.g. in Settings or the sidebar's
   new-conversation entry point) can open the modal pre-filled on the
   existing `new-contact` tab, reusing existing validation and the
   existing `onCreateContact(name, publicKey, tryHistorical, type?)`
   callback (`NewMessageModal.tsx:35-40`). No new backend endpoint is
   needed; this is `POST /api/contacts` as-is
   (`app/routers/contacts.py:266-304`).
2. **Deep-link flow** (RTFM-EV as the link target from the analyzer side):
   OUT OF SCOPE for this plan as a first slice. It requires the analyzer
   site to link *back* to a running RTFM-EV instance with pubkey and name
   in the URL, which is not something RTFM-EV controls (analyzers are
   independent third-party sites) and has no known/requested URL scheme on
   the RTFM-EV side today (`frontend/AGENTS.md` "URL Hash Navigation"
   lines 337-354 lists no such route). If desired later, it would need a
   new `#add-contact?pubkey=...&name=...` hash route in `utils/urlHash.ts`.

**Type field**: `CreateContactRequest.type` is capped at `le=3`
(`app/models.py:226-227`); Sensor (type 4) contacts cannot be created via
this path. If an analyzer's node page distinguishes a "sensor" node and a
user pastes one in expecting a Sensor-typed contact, they will only be
able to create it as Unknown/Client/Repeater/Room. Flag as an open
question (Section 6) rather than silently working around it; expanding
the endpoint's accepted range is out of scope for this plan (smallest
change principle, since that is a pre-existing constraint unrelated to
analyzer integration).

### 4.4 Typed contracts summary

- Backend: new `AnalyzerSite` Pydantic model (Section 4.1);
  `AppSettings.analyzer_sites: list[AnalyzerSite]`;
  `AppSettingsUpdate.analyzer_sites: list[AnalyzerSite] | None`.
- Frontend: `AnalyzerSite` TS interface mirroring the backend model;
  `AppSettings.analyzer_sites: AnalyzerSite[]`;
  `AppSettingsUpdate.analyzer_sites?: AnalyzerSite[]`.
- No new WebSocket event types needed; analyzer sites change via normal
  settings PATCH/refetch, same as every other `AppSettings` field.
- No new REST endpoints needed for feature A (client-side only). Feature B
  reuses `POST /api/contacts` unchanged.

## 5. Phasing (first slice)

1. **Settings plumbing only**: `AnalyzerSite` model, migration,
   `AppSettingsRepository` support, `GET/PATCH /api/settings` wiring,
   frontend types plus a minimal list editor (add/remove/edit name and
   node template) in Settings. No lookup UI yet. Verifiable in isolation
   via `tests/test_settings_router.py`-style round-trip tests.
2. **ContactInfoPane lookup action**: single most valuable surface
   (richest context, already has the full pubkey and action-row pattern).
   Ship with the single-site direct-open behavior; add the multi-site
   chooser only if more than one site is configured (avoids building UI
   for a zero-instance case on day one).
3. **RawPacketDetailModal "look up sender" action**: reuses the same
   helper from step 2, gated on `decrypted_info.contact_key` presence.
4. **ChatHeader icon plus network visualizer tooltip action**: same
   helper, lower traffic surfaces; do last since they are smallest
   marginal value given step 2 already covers the same contacts via one
   extra click.
5. **Add-contact-from-analyzer (paste flow)**: independent of steps 1-4;
   can be built in parallel once `NewMessageModal`'s `prefillRequest`
   extension is agreed. Packet-hash lookup (`packet_url_template`) is
   explicitly deferred past this first slice given the Section 3.2
   semantics gap.

Steps 2-4 all depend on step 1 (need the settings data to exist). Step 5
is independent and could ship first or in parallel.

## 6. Risks / open questions

- **Privacy (must surface to the user)**: opening an analyzer link puts
  the queried pubkey (and, for packet lookup, a packet hash) into a URL
  sent to a third-party site not operated by RTFM-EV or its maintainers.
  That site can log the query, correlate it with the visitor's IP, and
  infer that "someone using RTFM-EV is interested in node X" at a
  specific time. This should be disclosed in the settings UI where sites
  are configured (e.g. a one-line note near the analyzer-sites list) and
  possibly on first use (a one-time toast/confirm), not silently done.
  This is a deliberate trade; the feature's entire value is sending the
  pubkey to that site, but the user should know it is happening,
  especially since RTFM-EV's own security posture assumes a trusted local
  network (`AGENTS.md` "Intentional Security Design Decisions") while an
  analyzer site is an arbitrary external destination.
- **User-supplied URL templates are somewhat trusted input.** A malicious
  or malformed template (e.g. `javascript:...`, or a template with no
  `{pubkey}` placeholder) should be rejected/sanitized before
  `window.open`. Validate the template is `http(s)://` and contains the
  placeholder, both at save time (backend, Section 4.1) and use time
  (frontend, defense in depth).
- **Packet-hash semantics across analyzers is unresolved** (Section 3.2).
  Treat `packet_url_template` as best-effort/experimental; do not present
  it with the same confidence as the node lookup.
- **mc-radar.woodwar.com has no local source to verify against**; only
  the single `/node/<64-hex>` path is confirmed (via
  `docs/sources-of-truth.md`, not code). Do not assume mc-radar has a
  packet-lookup URL; if a user wants one, they configure it themselves
  (this is exactly what the user-configurable template mechanism is for;
  RTFM-EV need not hardcode or fully catalog every analyzer's URL forms).
- **Network visualizer node id**: not confirmed in this pass whether
  `PacketNetworkNode.id` (`networkGraph/packetNetworkGraph.ts`, not read)
  is always a full 64-hex pubkey or can be a synthetic/display id for
  ambiguous nodes (`VisualizerTooltip.tsx` has `node.isAmbiguous`,
  `node.ambiguousNames` fields suggesting some nodes are name-resolved
  rather than key-resolved). Confirm before wiring the lookup action
  there; may need the same prefix-only-style guard as contacts.
- **Sensor contact type (4) cannot be created via `POST /api/contacts`**
  (Section 4.3); a pre-existing endpoint constraint, not introduced by
  this feature, but it does limit "Add contact from analyzer" fidelity
  for sensor nodes.
- **Upstream issue #347** ("inline `<pubkey:1:Name>` contact sharing"),
  named in the task brief as adjacent-but-out-of-scope: **could not be
  located/verified**. `gh issue view 347` against `Elektr0Vodka/RTFM-EV`
  fails because that repository has issues disabled; against
  `meshcore-dev/MeshCore`, issue #347 is an unrelated closed issue ("Gps
  time sync"). Treat the "#347" reference as UNVERIFIED; confirm the
  correct repo/number before citing it in any follow-up work. If it does
  describe an inline-text contact-sharing format (e.g. pasted into chat
  rather than via an analyzer site), it is a different feature (message
  parsing) from this plan's analyzer-URL-driven add-contact flow, and the
  two should not be conflated without checking whether they would want to
  share the same `NewMessageModal.prefillRequest` extension point
  (Section 4.3).
- **Settings UI placement** not finalized: `SettingsDatabaseSection.tsx`
  (where `registry_sync_url` lives) is themed around storage/sync, not
  general external integrations. Confirm placement against
  `frontend/AGENTS.md` "Canonical style reference" before implementing
  (Section 4.1); this plan does not prescribe the exact section.
- **`AppSettingsRepository`'s exact JSON (de)serialization mechanics for
  list fields were not read in this pass**; confirm the existing
  `known_regions`/`blocked_keys` (de)serialization path in
  `app/repository/settings.py` before adding `analyzer_sites`, so the new
  field follows the same convention rather than inventing a second one.

## 7. Verification plan

Backend:
- New/updated test in `tests/test_settings_router.py` (existing suite,
  `app/AGENTS.md` line 470): round-trip `PATCH /settings` with
  `analyzer_sites`, including rejection of a template missing `{pubkey}`
  and of a non-`http(s)` URL.
- Repository-level test alongside `known_regions`/`blocked_keys` coverage
  in `tests/test_repository.py` or `test_settings_router.py` (confirm
  which file already covers `AppSettingsRepository` list fields) for
  serialize/deserialize round-trip of `analyzer_sites`.
- `POST /api/contacts` is unchanged by this plan; existing
  `tests/test_contacts_router.py` coverage should remain green. No new
  backend test is needed for feature B beyond the settings plumbing,
  since the "add contact from analyzer" flow is a frontend prefill on an
  existing endpoint.

Frontend:
- Unit test for the URL-template substitution helper (new, e.g.
  `frontend/src/utils/analyzerLink.ts` plus a `.test.ts`), covering: valid
  substitution, missing-placeholder rejection, non-http(s) rejection.
- Component test additions: `ContactInfoPane` gains an analyzer-lookup
  action; extend `frontend/src/test/contactInfoPane.test.tsx` (existing
  suite, `frontend/AGENTS.md` test list) to assert the action is hidden
  for prefix-only contacts and visible/wired for full-key contacts when
  at least one site is configured.
- `frontend/src/test/settingsModal.test.tsx` extension for the new
  analyzer-sites list editor (add/remove/edit round-trip against a mocked
  `api.updateSettings`).
- `NewMessageModal` prefill extension: extend
  `frontend/src/test/newMessageModal.test.tsx` to cover the new
  `prefillRequest` variant opening on the `new-contact` tab with fields
  populated.

Runtime observation (per repo rule: UI/live behavior must be observed,
not reasoned about):
- After implementing steps 1-2 of Section 5, run the app (`npm run dev`
  plus backend per `AGENTS.md` "Development Setup"), configure a fake
  analyzer site pointing at e.g. `https://example.com/node/{pubkey}`,
  open a known contact's info pane, click "Look up on analyzer", and
  confirm (a) a new tab opens, (b) the URL has the pubkey substituted
  correctly, (c) the action is absent/disabled for a prefix-only contact
  in the same session.
- Confirm settings persist across a page reload (`GET /api/settings`
  round-trip) before considering step 1 done.

## 8. Effort

- Step 1 (settings plumbing, backend plus minimal editor): roughly 0.5-1
  day.
- Step 2 (ContactInfoPane action): roughly 0.5 day, including the
  single/multi-site chooser.
- Step 3 (RawPacketDetailModal action): roughly 0.25 day (reuses step 2's
  helper).
- Step 4 (ChatHeader plus visualizer tooltip): roughly 0.5 day combined,
  mostly spent confirming the visualizer node-id question (Section 6)
  before wiring it.
- Step 5 (add-contact paste flow via `NewMessageModal` prefill): roughly
  0.5 day.
- Total, sequential: roughly 2.5-3 days of focused work, most of it in
  step 1 (new settings shape) and the open questions in Section 6 that
  need resolving before step 4 can start confidently.
