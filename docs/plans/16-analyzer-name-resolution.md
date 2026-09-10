# 16. Analyzer Name Resolution

Date: 2026-09-10
Status: local planning draft (feasibility-gated). No code changes by this
document. No PRs/issues/commits.
Category: C (External analyzer integration), per `docs/plans/README.md`
"C. External analyzer integration" section (which already describes this item
as [16] even though the dispatch table has not been re-rendered with a new
row; this file is that plan).
Model: Sonnet. State: Speculative for one of its two cases (see verdict).

Product context: RTFM-EV is a **MeshCore** server + browser terminal driving a
companion radio. It is not Meshtastic. Path hop identifiers, contact prefixes,
and the analyzer ecosystem referenced below are all MeshCore-specific.

## 1. Summary and feasibility verdict

The user asks for automatic/bulk resolution of node **names** from external
analyzers to fill in short ids (1-byte / 2-byte / 3-byte path-hash hop
identifiers, per `AGENTS.md` "Path Hash Modes", lines 138-152) wherever they
render unresolved, especially the visualizer.

**Verdict: partially feasible, split cleanly into two cases with very
different confidence.**

- **Case (a) - full pubkey known locally, no name.** RTFM-EV already has the
  contact's full 64-hex public key (e.g. `isUnknownFullKeyContact` in
  `frontend/src/utils/pubkey.ts:38-40`: full key but no advert heard yet, so no
  name). **FEASIBLE.** A full pubkey is exactly the input both reference
  analyzers accept for a direct node lookup (`docs/plans/04-analyzer-lookup.md`
  §3: mc-radar `/node/<64hex>`, cornmeister `#node?id=<64hex>`), and the local
  `cornmeister-mesh-analyzer` checkout additionally exposes a **JSON** detail
  endpoint for a full id, `GET /api/nodes/{id}/detail`
  (`internal/api/api.go:1081-1082`, dispatched from `handleNodeSubtree`,
  `internal/api/api.go:1062-1096`), which a server-side fetch can consume
  directly (no HTML scraping needed). This is the same shape as plan [04]'s
  node-lookup case, just automated instead of user-clicked.

- **Case (b) - only a short hop hash known (1/2/3-byte), no contact record at
  all.** **FEASIBLE, but only probabilistically, and only against a directory
  the size of the *querying* population** (RTFM-EV's own known contacts, or an
  analyzer's full node directory). It is **not** a hash-inversion problem
  (there is no cryptographic hash to invert - see §2.1); it is a
  **prefix-collision problem** with real, quantified ambiguity:
  - A 1-byte hop (2 hex chars) has only 256 possible values. Against a
    directory the size of a real regional/national mesh, most 1-byte prefixes
    are **not** unique. The reference implementation that actually operates at
    this scale documents the collision rate directly: *"a 1-byte hop \[resolves
    uniquely\] 0.01%"* of the time against an ~8,940-to-246,000-node directory
    (`EU-Meshcore-Analyzer/internal/nodemapview/resolve.go:20-30`, code comment
    citing that project's own `capability.go`). A 1-byte resolution is
    therefore **almost never a single answer** at analyzer scale; it is a
    candidate list.
  - 2-byte (4 hex, 65,536 values) and 3-byte (6 hex, 16.7M values) hops are
    proportionally much less ambiguous - the same source states 3-byte hops
    are "a single match" and 2-byte "averages ~4" candidates at that scale
    (`resolve.go:31-38`).
  - **Two independently-confirmed local analyzer repos already implement
    exactly this "prefix to candidate-list" reverse lookup as a first-class
    API**, not a hypothetical (full detail in §3). Given that, case (b) is
    feasible as a **best-effort, explicitly-ambiguous suggestion**, never as a
    confident single name. Any UI surfacing case (b) results MUST show
    ambiguity (candidate count, or a "possible names" list) and must never
    silently pick "the first candidate" as if it were confirmed - this mirrors
    a discipline RTFM-EV's own backend already applies to prefix lookups
    (`app/repository/contacts.py:20-25` `AmbiguousPrefixError`,
    `195-221` `get_by_key_prefix`/`_get_prefix_matches`: unique-match only,
    raises/returns None rather than guessing on a collision).

**Net verdict:** ship case (a) as the primary, high-confidence feature (a
straightforward "fetch name for a known pubkey, cache it" service). Ship case
(b) as an explicitly-labelled, opt-in "possible identity" suggestion, reusing
the exact ambiguity-surfacing pattern the visualizer already uses for its own
local, non-analyzer ambiguous-hop heuristics (`isAmbiguous`, `probableIdentity`,
`ambiguousNames`, per `AGENTS_packet_visualizer.md` "Ambiguous Nodes" /
"Advert-Path Identity Hints"). Do not present case (b) as equivalent-confidence
to case (a) anywhere in the UI.

## 2. Current state (cited)

### 2.1 What a path hop identifier actually is (fact, not assumption)

The task brief calls the hop identifier a "truncated hash." Reading the actual
wire-format code shows it is **not a cryptographic hash of the pubkey** - it is
a **literal byte-truncated prefix of the public key itself**:

- `app/decoder.py:517`: `"src_hash (1 byte): First byte of sender public
  key"`.
- `app/decoder.py:632-633`: `their_first_byte = their_public_key[0]`;
  `is_inbound = src_hash == their_first_byte`.
- `app/decoder.py:727-728`: `if dest_hash != our_public_key[0] or src_hash !=
  their_public_key[0]`.
- `app/path_utils.py:42-56` (`decode_path_byte`): the wire path byte encodes
  `hash_mode` (0/1/2 -> `hash_size` 1/2/3 bytes) and `hop_count`; nothing here
  computes a hash function over the pubkey, only how many leading bytes of it
  are carried per hop.
- Frontend confirms the same model: `frontend/src/networkGraph/
  packetNetworkGraph.ts:125` builds `prefix12 = contact.public_key.slice(0,
  12)` and `132-140` builds a `byPrefix` index for **every prefix length from
  1 to 12 hex chars** of each known contact's full key - i.e. RTFM-EV's own
  node-resolution code already treats a hop identifier as "the first N hex
  chars of a known pubkey," not as an opaque hash to invert.

This matters directly for feasibility: resolving a hop identifier to a node is
a **prefix/candidate-set lookup**, not "reverse a hash" (which would be
impossible). That reframing is what makes case (b) tractable at all, at the
cost of the ambiguity described in §1.

### 2.2 How RTFM-EV resolves hop identifiers today (frontend-only, local
contacts only)

- `frontend/src/networkGraph/packetNetworkGraph.ts:107-156`
  (`buildPacketNetworkContext`): builds `byPrefix12` (exact 12-hex prefix ->
  contact), `byName`, and `byPrefix` (every prefix length 1-12 -> list of
  matching contacts) purely from the **already-known local contact list**
  passed in from React state. No backend endpoint computes this; it is
  rebuilt in the browser on every context rebuild.
- `resolveNode()` (`packetNetworkGraph.ts:344` onward, referenced by
  `AGENTS_packet_visualizer.md` "Node Resolution") looks a hop token up in
  these indexes: exact prefix match against a **known local contact**. If
  there is no match at all, and `showAmbiguous` is on, it creates a synthetic
  `"?prefix"` node (`AGENTS_packet_visualizer.md` "Ambiguous Nodes"). If the
  prefix matches **more than one** known local contact, it is also treated as
  ambiguous; `pickLikelyRepeaterByAdvertPath()`
  (`packetNetworkGraph.ts:302-342`) can suggest a best-guess identity from
  locally-observed advert-path traffic patterns, never from an external
  source.
- **This local resolution never touches the network.** It can only ever
  disambiguate against contacts RTFM-EV already knows about (i.e. nodes that
  have advertised to, or been manually added to, this specific instance). A
  hop hash for a node this instance has **never heard from** cannot be
  resolved locally at all today - it renders as a bare `"?32"`-style
  placeholder or a raw hex prefix forever. This is the gap the analyzer
  integration is meant to fill: extending the same "prefix -> candidate(s)"
  lookup RTFM-EV already does locally out to a much larger directory an
  analyzer maintains.
- Backend equivalent for full/12-hex-prefix contact lookups (a different,
  longer prefix than a 1/2/3-byte hop, but the same "ambiguous prefix"
  discipline): `app/repository/contacts.py:20-25`
  (`AmbiguousPrefixError`), `195-236` (`get_by_key_prefix`,
  `_get_prefix_matches`, `get_by_key_or_prefix`) - unique-match-or-none, never
  a guessed pick. `AGENTS.md` "Contact Public Keys" (lines 413-417) documents
  the general `LIKE 'prefix%'` matching convention this repo already follows.
  **This backend code does not currently participate in hop-hash resolution
  at all** - it is used for contact create/lookup by key-or-prefix, not for
  resolving `path` bytes in raw packets or path hops. Hop-hash resolution
  today is 100% frontend, 100% local-contacts-only.

### 2.3 Display surfaces with an unresolved short id today

- **Visualizer** (`frontend/src/components/visualizer/`,
  `frontend/src/networkGraph/packetNetworkGraph.ts`): ambiguous nodes render
  as `"?{hop}"` (e.g. `?32`, `?aa11`) per `AGENTS_packet_visualizer.md`
  "Ambiguous Nodes" / "Node ID format". `VisualizerTooltip.tsx:42`
  (`{node.name || (node.type === 'self' ? 'Me' : node.id.slice(0, 8))}`) falls
  back to the first 8 chars of `node.id` when no name is set;
  `VisualizerTooltip.tsx:49-55` already has UI slots for
  `node.probableIdentity` ("Probably: ...") and `node.ambiguousNames`
  ("Possible: ..." / "Other possible: ...") - this is the exact UI pattern
  an analyzer-sourced case-(b) suggestion should reuse rather than inventing a
  new one.
- **Path modal** (`frontend/src/components/PathModal.tsx`): each hop renders
  `hop.prefix` in raw hex (`PathModal.tsx:456`,
  `<span className="text-primary font-mono">{hop.prefix}</span>`) whenever
  `hop.matches.length === 0` (unknown, `PathModal.tsx:290, 424`) or `> 1`
  (ambiguous, `PathModal.tsx:286, 423`), with a truncated "(and N more)" list
  for ambiguous matches (`PathModal.tsx:487-493`). `hop.matches` comes from
  `frontend/src/utils/pathUtils.ts`'s `PathHop.matches: Contact[]` (local
  contacts only, per that file's own doc comment "Matched repeaters
  (empty=unknown, multiple=ambiguous)").
- **Chat message list** hop-width badge (not a name, but the same
  "short id, no identity" family): `frontend/src/utils/pathUtils.ts:44-70`
  (`inferPathHashMode`) and `formatPathHopWidths` (~476-503, per
  `docs/plans/07-path-hash-message-filter.md` §2.2) render `"1B"`/`"2B"`-style
  badges, not node names - this plan does not add name resolution to the chat
  list; the message list shows hop *width*, not per-hop identity, and adding
  per-hop names there is out of scope (see §6).
- **Raw packet feed / detail**: `frontend/src/utils/rawPacketInspector.ts`
  (shared decode helper used by `RawPacketList.tsx:76` and
  `RawPacketDetailModal.tsx`) surfaces `src_hash`/`dst_hash`/path hex directly
  when the packet's sender/path cannot be resolved to a contact
  (`AGENTS_packet_visualizer.md` "Sender Extraction by Packet Type": Direct
  Message and Request rows are explicitly "1-byte source hash / Ambiguous (may
  match multiple)"). `docs/plans/04-analyzer-lookup.md` §2.3 already
  identifies `RawPacket.decrypted_info.contact_key` as the resolvable
  full-pubkey field here when present; the *unresolved* case (no
  `contact_key`) is exactly case (b) territory this plan targets, though the
  raw packet feed is explicitly documented as a tertiary "debug/observation"
  surface (`AGENTS.md` "Feature Priority"), so it is a lower phasing priority
  than the visualizer (see §5).
- **Contact info pane** (`ContactInfoPane.tsx`): `isUnknownFullKeyContact`
  (`pubkey.ts:38-40`) already identifies the exact case-(a) target - a full
  64-hex key with no name. This is the highest-value, lowest-ambiguity surface
  to wire first (§5).

## 3. Reference research: analyzer resolution APIs

### 3.1 mc-radar.woodwar.com - UNVERIFIED beyond the single node-page URL

No local source checkout exists for mc-radar. Per
`docs/plans/04-analyzer-lookup.md` §3.1/3.4, only
`https://mc-radar.woodwar.com/node/<64-hex>` is confirmed, and only against
`docs/sources-of-truth.md:71` (a doc reference, not code). **No resolve/search
API is known for mc-radar.** If a user configures it as an analyzer site for
this feature, RTFM-EV cannot assume it exposes anything beyond the HTML node
page, which is not machine-readable without scraping (out of scope - see §6).

### 3.2 cornmeister-mesh-analyzer (Go) - CONFIRMED locally, exposes both cases

Local checkout: `G:\Github\repositories\Elektr0Vodka\cornmeister-mesh-analyzer`.

Route registration: `internal/api/api.go:1849-1859`.

- **Case (a) - full pubkey to name/detail:**
  `GET /api/nodes/{id}/detail` (`api.go:1081-1082`, dispatched via
  `handleNodeSubtree`, `api.go:1062-1096`). This is a real JSON endpoint (not
  an HTML page), the shape a server-side fetch can consume without scraping.
  Exact response schema was not read in this pass (the handler function body
  itself, `handleNodeDetail`, was not opened); **UNVERIFIED**: confirm the
  exact JSON field names (presumably a `Name`/`name` field) before
  implementation.
- **Case (b) - prefix/hash to candidate(s):** two distinct endpoints, with
  different, complementary contracts:
  - `GET /api/nodes/resolve?prefix=<hex>` -> `{"id": "<pubkey>"}` for a
    **unique** match only (`internal/api/noderesolve.go:15-35`). Backed by
    `internal/store/noderesolve.go:34-66`
    (`Postgres.ResolveNodePrefix`): a hex-validated
    `SELECT node_id FROM nodes WHERE node_id LIKE lower($1) || '%' ... LIMIT
    2`, returning `ErrPrefixNone` (0 rows) or `ErrPrefixAmbiguous` (>=2 rows) -
    **both map to a 404** at the API layer (`noderesolve.go:26-29`). This
    endpoint is useless for surfacing *candidates* on a collision; it only
    ever answers "yes, exactly one" or "no."
  - `GET /api/prefixes/{prefix}?days=7` -> full classification
    (`internal/api/prefixes.go:12-30`, `internal/prefix/prefix.go:37-95`
    `Classify`). Accepts exactly 2/4/6 lowercase hex chars (1/2/3 raw bytes -
    the exact three MeshCore path-hash widths, `prefix.go:47-58`
    `ErrInvalidPrefix`). Returns `Status` (`free`/`occupied`/`collision`/
    `repeater_or_room`), the **full list of matching nodes** (id, name, role,
    last-seen, capped at `nodeCap=100`,
    `prefix.go:24-45,55-95`), and a `days`-windowed activity filter so stale
    nodes do not pollute the candidate list. **This is the endpoint case (b)
    should actually use** - it gives names for every candidate, not just a
    unique-or-nothing answer.
- Confirmed via direct code read, not documentation. `sources.md` in this repo
  is a bill-of-materials for cornmeister's own dependencies and does not
  describe cornmeister's own URL scheme (per `docs/plans/04-analyzer-lookup.md`
  §3.2); the endpoints above come from reading the Go handler/route files
  directly.
- **Whether `cornmeister.nl`'s live deployment matches this dev checkout is
  UNVERIFIED** (same caveat plan [04] already raises for the node/packet
  link schemes, §3.4 of that plan) - treat as strong evidence of *shape*, not
  a guarantee the production site answers identically today.

### 3.3 EU-Meshcore-Analyzer (Go) - CONFIRMED locally, richer and explicitly
built for this exact use case

Local checkout: `G:\Github\repositories\Elektr0Vodka\EU-Meshcore-Analyzer`.
This is a **multi-binary** project; the task brief's suggested search path
(`cmd/api-analysis/`) does **not** contain node-resolution routes - confirmed
by reading `cmd/api-analysis/main.go:283-528` in full, which registers only
analytics/stats/packets/channels endpoints, no `/api/nodes*` or
`/api/prefixes*`. **The actual resolution capability lives in a different
binary, `cmd/api-map`** (`cmd/api-map/main.go:195-229`):

```
GET /api/nodes                          -> node list (nodemapview.NewNodesHandler)
GET /api/nodes/resolve?prefix=<hex>     -> candidate list (NOT unique-only)
GET /api/resolve-hops?hops=<hex>,<hex>,...  -> BATCH resolve, up to 64 hops at once
GET /api/nodes/search?q=<prefix>        -> free-text/prefix node search
GET /api/nodes/{pubkey}/neighbors       -> neighbor list for a full pubkey
```

Key contract details, read directly from
`internal/nodemapview/resolve.go` and `internal/nodemapview/kiekr.go`:

- `normalizeResolvePrefix` (`resolve.go:231-247`) accepts **exactly** 2, 4, or
  6 lowercase hex chars - i.e. exactly the three MeshCore path-hash widths,
  explicitly documented as such in the source comment (`resolve.go:233-236`).
- `ResolveResult` (`resolve.go:218-229`): `Resolved: bool` is true **only**
  when `Count == 1`; `Candidates` is always populated (capped at
  `maxResolveCandidates = 100`, `resolve.go:76-81`), with `Count`/`Truncated`
  telling the caller whether the list was cut. This is a "candidates, never a
  single guessed answer" contract by explicit design
  (`resolve.go:20-30`, package doc: *"WHY CANDIDATES, NEVER A SINGLE ANSWER
  ... a 1-byte hash has only 256 possible values against a directory of
  thousands of nodes - collisions are the common case, not the exception"*).
- **Batch resolution exists and is exactly the shape a "bulk resolve" feature
  needs**: `GET /api/resolve-hops?hops=<hex>,<hex>,...`
  (`internal/nodemapview/kiekr.go:14-16, 262-289`). Up to 64 comma-separated
  1-byte hex prefixes per request (`maxResolveHops = 64`, `kiekr.go:68-73`),
  answers `{"resolved": {"<hex>": {"name","pubkey","ambiguous","candidates":
  [...]}}}}`, with a total-candidate budget across the whole batch
  (`maxResolveHopsCandidates = 512`, `kiekr.go:75-82`) to bound response size.
  This endpoint's wire contract is explicitly noted as **verified against a
  live production deployment**: *"WIRE CONTRACT (verified against the
  reference CoreScope implementation at analyzer.meshcorenetz.de,
  2026-08-09 ...)"* (`kiekr.go:11-29`). This is the strongest evidence in this
  research that a production MeshCore analyzer answers bulk hop-prefix
  resolution requests today, not just in a dev checkout.
- Scale evidence, directly quoted in code comments and load-bearing for the
  ambiguity risk in §1: *"a 1-byte hop \[resolves uniquely\] 0.01%"* of the
  time, and at ~246K nodes a 1-byte prefix averages **~960 candidates**
  (`resolve.go:20-30`, `kiekr.go:31-38`). A 2-byte prefix averages ~4
  candidates; a 3-byte prefix is "a single match" in the common case
  (`kiekr.go:35-38`).
- `GET /api/nodes/{pubkey}/neighbors` (`cmd/api-map/main.go:210`) takes a full
  pubkey, not a prefix - useful for enrichment beyond name resolution but not
  load-bearing for this plan.
- `internal/nodemapview/resolver.go` also exists (not read in this pass); it
  may be an internal (non-HTTP) resolver used by other projections in the
  package rather than a second API surface. **UNVERIFIED**; not needed for
  this plan's design since the HTTP contract above is already sufficient.

**Caveat identical to cornmeister's**: this is a development checkout, not
confirmed identical to whatever public production EU-Meshcore-Analyzer
instance (if any) a user would configure. The `kiekr.go` comment's own
cross-reference to `analyzer.meshcorenetz.de` is the strongest available
signal that *some* production MeshCore analyzer (same CoreScope contract
family) answers this exact bulk-hop-resolve shape live, but `analyzer.
meshcorenetz.de` has not been confirmed to be an EU-Meshcore-Analyzer
deployment specifically as opposed to the "reference CoreScope
implementation" the comment separately names Argus/cornmeister-family code as
matching. Treat the wire contract as solid; treat "which named production URL
serves it" as **UNVERIFIED**.

### 3.4 Summary table

| Analyzer | Full-pubkey -> name (case a) | Hop-prefix -> candidate(s) (case b) | Batch | Source |
|---|---|---|---|---|
| mc-radar.woodwar.com | Only an HTML node page (`/node/<64hex>`); no known JSON API | UNVERIFIED / none known | UNVERIFIED / none known | `docs/sources-of-truth.md:71` (doc only) |
| cornmeister-mesh-analyzer | `GET /api/nodes/{id}/detail` (JSON) | `GET /api/prefixes/{prefix}?days=N` (full candidate list); `GET /api/nodes/resolve?prefix=` (unique-only, useless for collisions) | No batch endpoint found | Local repo, `internal/api/api.go`, `internal/api/prefixes.go`, `internal/prefix/prefix.go`, `internal/api/noderesolve.go`, `internal/store/noderesolve.go` |
| EU-Meshcore-Analyzer (`cmd/api-map`) | `GET /api/nodes` / `GET /api/nodes/search?q=` (JSON, name+role+lat/lon) | `GET /api/nodes/resolve?prefix=` (candidate list, NOT unique-only - richest of the three) | `GET /api/resolve-hops?hops=a,b,c,...` (up to 64 hops/request, verified wire contract against a named production deployment) | Local repo, `cmd/api-map/main.go`, `internal/nodemapview/resolve.go`, `internal/nodemapview/kiekr.go` |

Every URL/schema in this table (aside from the `sources-of-truth.md` line) was
confirmed by reading Go source directly in this pass, not by network access -
this machine issued no HTTP requests to any live analyzer while producing this
plan. **Whether a user's actual configured analyzer instance (a fork, a
different version, a differently-configured deployment) answers identically
is unverifiable from this codebase alone and must degrade gracefully** (see
§4.2, §6).

## 4. Design

### 4.1 Reuse of [04]'s analyzer-site config (design-level reuse, not code
reuse - [04] has not shipped)

`docs/plans/04-analyzer-lookup.md` §4.1 proposes an `AnalyzerSite` model
(`name`, `node_url_template` with a `{pubkey}` placeholder,
`packet_url_template`) stored in `app_settings.analyzer_sites`. **As of this
plan's writing, `app/models.py` has no `analyzer_sites` field** (confirmed:
`grep analyzer_sites app/models.py` -> no matches; only `registry_sync_url`,
`app/models.py:1098`, exists as a settings-URL precedent). This plan therefore
reuses [04]'s **design**, not shipped code, and both plans should land the
same schema rather than each inventing a competing one.

This plan needs **more** than [04]'s node/packet URL templates, because [04]
is purely client-side (`window.open`, never fetched by the backend) while this
plan requires a server-side JSON fetch (§4.2). Extend the `AnalyzerSite` model
[04] proposes with optional API fields, used only by this plan:

```python
class AnalyzerSite(BaseModel):
    name: str
    node_url_template: str            # from [04]: client-side deep link, {pubkey}
    packet_url_template: str | None = None   # from [04]

    # New fields for [16], all optional (a site with none of these supports
    # deep-linking only, per [04], and gets none of this plan's automation):
    node_api_url_template: str | None = None
    """JSON node-detail endpoint, e.g. cornmeister's
    'https://cornmeister.nl/api/nodes/{pubkey}/detail'. Case (a): resolve a
    known full pubkey to a name."""
    prefix_api_url_template: str | None = None
    """JSON prefix-classification endpoint, e.g. cornmeister's
    'https://cornmeister.nl/api/prefixes/{prefix}' or EU-Meshcore-Analyzer's
    'https://<host>/api/nodes/resolve?prefix={prefix}'. Case (b): resolve an
    unmatched hop hash to candidate name(s)."""
    resolution_enabled: bool = False
    """Opt-in gate, per-site, independent of whether the site is used for
    manual [04] deep-links. See privacy note, §4.4."""
```

Reasoning for per-site optional fields rather than a fixed "this analyzer's
API shape": §3 shows the three known sites have **three different** API
shapes (mc-radar: none known; cornmeister: `/detail` + `/prefixes/{p}`;
EU-Meshcore-Analyzer api-map: `/nodes/search` + `/nodes/resolve?prefix=`).
There is no single schema to hardcode; the URL-template mechanism [04]
established for exactly this reason (user-supplied sites, RTFM-EV cannot
catalog every analyzer) extends naturally here.

Migration numbering: **do not build this on `_069`.** `git ls-tree -r
--name-only origin/main app/migrations | sort | tail` (run during this
research pass) shows origin/main's highest migration is
`_070_create_battery_history.py`; next free is **`_071`**. This confirms
`docs/plans/README.md`'s note that the number has drifted from the `_069`
several other plans (including [04], [05], [08], [10], [14]) cite. This
worktree's own `app/migrations/` only goes up to `_068_add_registry_sync_url.
py` - re-verify at implementation time regardless of what any plan file says,
since parallel branches race for the same number (per README's fork-port-plan
cross-reference).

### 4.2 Resolution service: server-side fetch + cache (not client-side)

**Server-side, not client-side**, for two independent reasons stated in the
task brief and confirmed by this research:

1. **Privacy** (see §4.4): a client-side `fetch()` from the browser would send
   the analyzer request from the operator's own browser/IP, once per render,
   for every unresolved id on every page load - the least controllable, least
   auditable way to leak the local mesh's node set to a third party.
2. **Batching**: §3.3 shows a real batch endpoint
   (`GET /api/resolve-hops?hops=a,b,c,...`) exists specifically so many hops
   can be resolved in one request. A client-side per-node-render fetch cannot
   batch across an entire visualizer frame's worth of unresolved hops the way
   a backend service collecting "all currently-unresolved ids this render
   pass" can.

Precedent for the server-side-fetch shape already exists in this codebase:
`app/routers/registry.py` (full file, 76 lines) - `GET /registry/sync` fetches
a user-configured URL via `httpx.AsyncClient(timeout=10.0,
follow_redirects=True)`, maps non-2xx/non-JSON to a `502`, and returns a
normalized model. The new resolution service follows the same shape:
`httpx` fetch, same timeout discipline, graceful degradation to "unresolved"
on any failure (never surface an analyzer 5xx/timeout as an app-breaking
error - the whole feature is best-effort enrichment).

New backend module, e.g. `app/services/analyzer_resolution.py`:

```python
async def resolve_pubkey_name(pubkey: str) -> str | None:
    """Case (a): full pubkey -> name, via configured sites' node_api_url_template.
    Tries configured resolution-enabled sites in order; returns the first name
    found, or None. Cache-first (see below)."""

async def resolve_hop_candidates(hop_hex: str) -> HopResolution | None:
    """Case (b): 1/2/3-byte hop hex -> HopResolution{resolved: bool, count: int,
    candidates: list[{pubkey, name}]}. `resolved` mirrors the EU-Meshcore-Analyzer
    contract: true only when exactly one candidate. Cache-first."""
```

Both functions consult the cache (§4.3) before any network call, and both are
called from a **batch-aware** entry point (`resolve_many(pubkeys: list[str],
hops: list[str])`) so callers (a new `POST /api/analyzer-resolution/resolve`
endpoint, or a background task) always ask for everything they need in one
request rather than N sequential ones - mirroring the batch endpoint pattern
§3.3 confirms exists analyzer-side.

**Do not query the network per visualizer frame or per raw-packet-feed
render.** The natural trigger points are: (1) a periodic background task
(mirroring the existing telemetry auto-collect pattern in `radio_sync.py`,
per `app/AGENTS.md` "Fanout bus" section) that resolves any *new* unresolved
pubkeys/hops seen since the last run, capped and rate-limited; and (2) an
on-demand "Resolve names" action the user triggers explicitly (lower risk,
simpler first slice - see §5).

### 4.3 Resolved-name cache: new table, not `app_settings` JSON

Per the task brief's instruction to verify against plan [14]: [14]'s
`device_config_history` (`docs/plans/14-historical-device-info.md` §3a) is an
**append-on-change history** table for repeater CLI/binary-response snapshots
- a different shape and a different data source (host-initiated CLI fetch,
not a third-party analyzer). This plan's cache is **latest-value-only** (a
name either matches the analyzer's current record or it does not; there is no
"trend" value in keeping every past resolution), so it does not fit [14]'s
append-on-change table and should not be shoehorned into it. No overlap;
cite [14] here only to document that this was checked, not reused.

`app_settings` JSON is also the wrong shape: existing list fields there
(`known_regions`, `blocked_keys`, etc., `app/models.py:1009-1101`) are small,
operator-edited lists, not a growing cache keyed by pubkey/hop-hex with TTL
semantics. A resolved-name cache can grow to one row per ever-seen unresolved
id and needs indexed lookup by key, which `app_settings`' single-JSON-blob
model does not support well.

**Decision: new table**, migration `_071_analyzer_resolved_names.py` (subject
to the re-verification note in §4.1):

```sql
CREATE TABLE IF NOT EXISTS analyzer_resolved_names (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_type TEXT NOT NULL,       -- 'pubkey' | 'hop_prefix'
    key_value TEXT NOT NULL,      -- full 64-hex pubkey, or lowercase hop hex (2/4/6 chars)
    resolved_name TEXT,           -- NULL = queried, no name found (still cache this - avoid re-querying a miss every cycle)
    candidate_count INTEGER,      -- NULL for case (a); candidate count for case (b) (1 = unique)
    source_site TEXT NOT NULL,    -- which configured AnalyzerSite answered
    resolved_at INTEGER NOT NULL,
    UNIQUE(key_type, key_value)
);
CREATE INDEX IF NOT EXISTS idx_analyzer_resolved_names_key
    ON analyzer_resolved_names(key_type, key_value);
```

- **Cache negative results too** (`resolved_name IS NULL` rows), with a
  shorter re-check TTL than positive hits, so an unresolved id is not
  re-queried against the analyzer on every background cycle - this is the
  same "amortize the expensive lookup" reasoning EU-Meshcore-Analyzer's own
  `ResolveCache` uses server-side (`resolve.go:161-208`, 60s TTL over its own
  node directory).
- **Display fallback chain** (case a and b unified at read time):
  1. Local contact name (`contacts.name`, if the id resolves to a known local
     contact via the existing frontend `resolveNode`/`byPrefix` logic, §2.2) -
     always wins, since it is first-party and free.
  2. Cached analyzer-resolved name (`analyzer_resolved_names.resolved_name`,
     case a or an unambiguous case-b match, `candidate_count IN (1, NULL)`).
  3. Cached case-b **ambiguous** result: show as a suggestion
     (`probableIdentity`-style, never as a confirmed name), matching
     `VisualizerTooltip.tsx:49-55`'s existing "Probably:" / "Possible:" slots.
  4. Bare short id (today's behavior), unchanged when nothing resolves.

### 4.4 Privacy: opt-in, and prominent

The task brief is explicit that bulk-sending observed node ids to a
third-party analyzer leaks the local mesh's node set. This is real and must
be surfaced, not buried:

- **Default: disabled.** `AnalyzerSite.resolution_enabled` (§4.1) defaults to
  `False` per site; the background resolution task (§4.2) does nothing until
  at least one configured site has it enabled.
- **A one-time, explicit opt-in confirmation** when a user first enables
  resolution for a site (not just a settings checkbox buried in a list) -
  the settings UI should state plainly: *"Enabling this sends every node id
  and path-hop identifier your radio observes to \[site name\] so it can
  return names. This reveals your local mesh's node set to that third party
  over time."* This is a stronger disclosure than [04]'s "look up on
  analyzer" privacy note (`docs/plans/04-analyzer-lookup.md` §6, one-line
  settings note plus optional first-use toast), because [04] discloses one
  pubkey per explicit user click, while this plan discloses the **entire
  observed node set, continuously, without a per-lookup click**. Match or
  exceed [04]'s disclosure bar, not just meet it.
- **Case (b) is a strictly bigger leak than case (a).** Case (a) only ever
  asks about pubkeys RTFM-EV already fully knows (already-seen contacts);
  case (b) asks about **short hop hashes for nodes RTFM-EV has never
  otherwise heard of** - i.e. it actively probes an analyzer's directory
  with fragments of RF traffic overheard from possibly-unrelated third-party
  nodes repeating packets through the local area, not just this operator's
  own contacts. Consider gating case (b) behind a separate, more prominent
  opt-in from case (a) in the settings UI (OPEN QUESTION, §6 - the task brief
  does not resolve which UX shape to use, and this is a product decision that
  should be confirmed with the user before implementation, per `CLAUDE.md`
  "Do not infer requirements that were not explicitly provided").
- No server-side proxy that forwards arbitrary user-supplied URLs
  (`app/routers/registry.py`'s existing pattern already avoids SSRF by only
  ever fetching an operator-configured URL, not a request-supplied one - this
  plan's fetch targets are equally operator-configured `AnalyzerSite` entries,
  not attacker-influenced input).

### 4.5 Typed contracts summary

- Backend: extend the (not-yet-shipped) `AnalyzerSite` model per §4.1;
  new `HopResolution` Pydantic model (`resolved: bool`, `count: int`,
  `candidates: list[ResolvedCandidate]` where `ResolvedCandidate = {pubkey:
  str, name: str | None}`); new `AnalyzerResolvedName` row model matching the
  table in §4.3.
- New endpoint: `POST /api/analyzer-resolution/resolve` accepting
  `{pubkeys: list[str], hops: list[str]}`, returning per-key results from the
  cache (triggering a background fetch for cache misses, not blocking the
  request on a live analyzer round-trip - degrade to "unresolved, check back
  later" rather than making the frontend wait on a third-party HTTP call).
- Frontend: `AnalyzerSite` TS interface extended to match; a small
  `useAnalyzerResolvedNames` hook (or extension of the existing visualizer
  data hook) that requests resolution for the currently-unresolved id set and
  applies the fallback chain (§4.3) at render time.
- No new WebSocket event type is required for the first slice (§5); resolved
  names can be polled/refetched on the same cadence the visualizer already
  re-renders. A `resolved_name` WS event could be added later if live-update
  latency matters, but that is speculative scope, not needed to ship case (a).

## 5. Phasing

**First slice: case (a) only - resolve full-pubkey-known-but-unnamed
contacts.** This is the low-ambiguity, high-confidence half of the feature and
should ship alone before any case-(b) work starts:

1. Settings plumbing: extend [04]'s `AnalyzerSite` model with the
   `node_api_url_template` / `resolution_enabled` fields (§4.1), migration,
   `AppSettingsRepository` support - built together with (or after) [04]'s own
   settings plumbing slice, since both touch the same model. If [04] has not
   yet shipped when this work starts, land [04]'s base fields first, then
   this plan's extension, rather than duplicating the base model.
2. `analyzer_resolved_names` table (§4.3), migration `_0NN` (re-verify the
   number at build time).
3. `resolve_pubkey_name()` service function (§4.2) plus a manual, user-
   triggered "Resolve names" action (e.g. a button in Settings or
   `ContactInfoPane`) rather than an automatic background task for this first
   slice - simpler, no scheduler/rate-limit design needed yet, and keeps the
   privacy opt-in an explicit per-use action rather than an always-on
   background leak while the feature is new.
4. Wire the display fallback chain (§4.3, steps 1-2 only - no case-b
   ambiguous-suggestion step yet) into `ContactInfoPane.tsx` (already
   identifies `isUnknownFullKeyContact`, `pubkey.ts:38-40`) and the visualizer
   node label (`VisualizerTooltip.tsx:42`, extending the existing
   `node.name ||` fallback chain with the cached resolved name before falling
   back to `node.id.slice(0, 8)`).
5. Tests: round-trip settings PATCH with the new fields; service-level test
   for `resolve_pubkey_name()` against a mocked `httpx` response (success,
   404, timeout, malformed JSON - mirroring `app/routers/registry.py`'s own
   error handling, which already has this exact failure-mode list to copy
   from); frontend test that `ContactInfoPane` shows a resolved name once the
   cache has one.

**Second slice (only after first slice ships and is reviewed): case (b)** -
the batch hop-resolution flow (§4.2's `resolve_hop_candidates`/
`resolve_many`), the background periodic task, and the visualizer's
`probableIdentity`/`ambiguousNames` wiring for analyzer-sourced (not just
locally-sourced) suggestions. This slice needs the §4.4 opt-in UX question
resolved first (whether case (b) gets its own, separate consent from case
(a)) - do not build the network calls before that product decision is made.

**Out of scope for both slices:** the raw packet feed (§2.3) and chat message
list (per §2.3, the hop-width badge is a different, non-identity concept,
already fully scoped in `docs/plans/07-path-hash-message-filter.md` and
explicitly not extended here). Both could consume the same cache later as a
fast-follow once it exists, but neither is needed to deliver the user's
stated primary ask (the visualizer).

## 6. Risks / open questions

- **Hash/prefix ambiguity is real and quantified** (§1, §3.3): a 1-byte hop is
  "resolved uniquely" only ~0.01% of the time at real analyzer scale. Any
  case-(b) UI must never present an ambiguous result with the same visual
  confidence as a case-(a) or unique case-(b) result. This is not a
  probability RTFM-EV can improve by itself; it is intrinsic to a 256-value
  namespace shared across a large mesh.
- **OPEN QUESTION**: should case (b) (probing an analyzer about hop hashes
  for nodes RTFM-EV has never directly seen) require a separate, more
  prominent opt-in from case (a) (asking about nodes RTFM-EV already fully
  knows)? §4.4 argues yes given the larger privacy surface, but this is a
  product decision for the user, not something to assume.
- **Analyzer API stability/availability is unverified for any specific
  production URL.** §3 confirms endpoint *shapes* by reading each analyzer's
  source code directly (not by calling a live service), and explicitly flags
  that a user's actual configured instance (fork, different version, or
  different deployment) may not match. The resolution service (§4.2) must
  degrade to "no name found" on any HTTP error, unexpected JSON shape, or
  timeout - never treat an analyzer response as trusted-shape input without
  validation, and never surface an analyzer-side failure as an RTFM-EV error
  toast (this is best-effort enrichment, per `AGENTS.md`'s framing of
  similarly-optional features like the raw packet feed).
- **Rate limits are unknown for all three analyzers.** None of the three
  sources document a rate limit in the code read for this plan. The batching
  design (§4.2's `resolve_many`, and reuse of `GET /api/resolve-hops`'s
  60-hop batching where available) minimizes request count, and the
  background task (second slice) must apply its own conservative interval
  (mirroring the existing telemetry auto-collect cadence pattern,
  `app/AGENTS.md` "Fanout bus") rather than resolving on every packet.
- **mc-radar has no known JSON API at all** (§3.1, §3.4) - a user configuring
  it as an `AnalyzerSite` for this feature gets nothing from this plan beyond
  what [04] already gives them (manual deep-link only), unless they separately
  discover and configure an API endpoint RTFM-EV does not know about. Do not
  claim mc-radar support beyond deep-linking.
- **cornmeister's `GET /api/nodes/{id}/detail` response schema is
  UNVERIFIED** - the handler function body was not read in this pass, only
  its route registration and dispatch. Confirm exact field names before
  implementing the case-(a) parser for that specific site.
- **`internal/nodemapview/resolver.go` in EU-Meshcore-Analyzer was not read**;
  it may indicate a second, non-HTTP resolution path in that codebase.
  Unlikely to change this plan's design (the HTTP contract in §3.3 is already
  sufficient and directly usable), but flagged as an unread file for
  completeness.
- **Interaction with plan [04]**: both plans modify `AppSettings.
  analyzer_sites`. Whichever ships first should land the base `AnalyzerSite`
  model; the other extends it. Coordinate rather than let both plans define
  divergent versions of the same settings field.
- **Interaction with plan [14]**: checked and explicitly not reused (§4.3) -
  different data shape (latest-value cache vs. append-on-change history),
  different source (third-party analyzer vs. own-radio CLI fetch). No schema
  conflict.
- **Interaction with plan [07]**: the chat-message hop-width badge
  (`formatPathHopWidths`) is a hop-*width* indicator, not an identity lookup;
  explicitly out of scope for this plan's display surfaces (§5). No overlap.

## 7. Verification plan

Backend:
- New test file (e.g. `tests/test_analyzer_resolution.py`) covering
  `resolve_pubkey_name()` against a mocked `httpx.AsyncClient`: success (name
  found), 404/not-found, malformed JSON, timeout - each must degrade to
  `None` without raising, matching `app/routers/registry.py`'s existing
  error-handling shape.
- Repository-level round-trip test for `analyzer_resolved_names` (write,
  read-back, upsert-on-`UNIQUE(key_type, key_value)`, negative-result
  caching).
- `tests/test_settings_router.py` extension for the new `AnalyzerSite` fields
  (`node_api_url_template`, `prefix_api_url_template`,
  `resolution_enabled`), including that `resolution_enabled` defaults to
  `False`.

Frontend:
- Unit test for the fallback-chain helper (local contact name > cached
  resolved name > bare short id), covering all three tiers plus the
  ambiguous-suggestion tier once case (b) lands.
- `ContactInfoPane` test: a resolved name from the cache renders where
  `isUnknownFullKeyContact` would otherwise show `[unknown sender]`.
- Visualizer: extend existing visualizer test coverage (per
  `frontend/AGENTS.md` test list) to confirm a cached resolved name appears
  in `VisualizerTooltip` ahead of the `node.id.slice(0, 8)` fallback.

Runtime observation (per repo rule - UI/live behavior must be observed, not
reasoned about):
- After implementing the first slice, run the app, configure a real or
  reachable-test analyzer site with `node_api_url_template` set, trigger the
  manual "Resolve names" action against a contact with `isUnknownFullKeyContact
  === true`, and confirm: (a) the name appears in `ContactInfoPane`, (b) it
  persists across a page reload (cache round-trip), (c) disabling
  `resolution_enabled` for that site stops any further resolution attempts.
- Confirm graceful degradation by pointing `node_api_url_template` at an
  unreachable host and verifying no error toast, no crash, and the contact
  still renders as `[unknown sender]`.
- `./scripts/quality/all_quality.sh` before considering either slice done, per
  `AGENTS.md` "Important Rules".

## 8. Effort

- **First slice (case a)**: settings model extension (shared with [04] if
  concurrent, otherwise a small addition to already-shipped [04] fields),
  one migration, one new repository, one new service module, one manual-
  trigger endpoint, `ContactInfoPane` + visualizer tooltip wiring, tests.
  Roughly 1-1.5 focused sessions - similar scope to [04]'s own step 1-2
  estimate (`docs/plans/04-analyzer-lookup.md` §8: ~1-1.5 days combined for
  settings plumbing plus one consuming surface).
- **Second slice (case b)**: batch resolution service, background task with
  rate limiting, ambiguous-suggestion UI wiring across the visualizer's
  existing `probableIdentity`/`ambiguousNames` slots, plus resolving the
  §4.4/§6 opt-in-scope open question before starting. Materially larger than
  the first slice given the privacy-UX decision and the periodic-task design;
  do not estimate concretely until that open question is answered.
- Total, sequential, first-slice-only (recommended initial commitment): well
  within a single Sonnet-scoped session. Second slice: track separately,
  contingent on product sign-off per §6.
