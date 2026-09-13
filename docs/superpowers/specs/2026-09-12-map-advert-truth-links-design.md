# Map links from advert-path truth + confidence toggle

Date: 2026-09-12
Status: Design approved (brainstorming), pending plan
Related: Spec 1 (mesh-health advert direct/flood dedup, PR #94, merged as `5c3074a`) which added the `advert_events` table this spec consumes.

## Problem

The map's link layer today is liveness-only. It is derived client-side from live
`rawPackets` and explicitly does NOT use advert paths
(`frontend/src/components/MapView.tsx` ~line 322: `buildPacketNetworkContext`
with `useAdvertPathHints: false`, `repeaterAdvertPaths: []`). Edges are drawn by
`frontend/src/map/layers/linksLayer.ts` as a single-color GL line layer whose
opacity encodes liveness only.

We want links built from the ACTUAL advert paths we have heard (truth): the
relay chain each advert traveled. We also want a confidence control, because a
hop identifier is a truncated hash of the relaying node's public key:

- 1-byte hop (2 hex) is ambiguous (256 possible values; many nodes can share it).
- 2-byte (4 hex) and 3-byte (6 hex) hops are progressively more uniquely
  resolvable.

## Data sources (verified)

- `advert_events` (migration `_080`, in `origin/main`): one row per unique
  advert transmission. Columns used: `public_key` (the advertising origin, full
  hex), `path_hex` (the relay chain), `hop_width` (bytes per hop: 1/2/3, NULL
  for direct), `min_path_len` (0 = direct), `first_seen`. Per-transmission
  `hop_width` is exactly the confidence signal.
- `contacts`: local contacts with `public_key`, `lat`, `lon` (GPS when set).
- `external_map_nodes` (migration `_077`): analyzer directory cache. Full
  `pubkey`, `lat`, `lon`, `advert_count`, `last_seen`, `role`, `mobile`. A large
  pool of GPS-placed nodes RTFM-EV may not hold as contacts.

Reference for extracting consecutive hop pairs from a stored path:
`app/routers/packets.py` `get_relay_pairs` (~line 753) and
`app/path_utils.py` `split_path_hex`.

No new DB migration is required: all three tables already exist in `origin/main`.

## Hop -> GPS resolution model

A hop hex is a prefix of a node's public key. Resolution matches a hop prefix
against the public keys of GPS-placed nodes. The candidate pool is the union of:

1. local `contacts` that have valid GPS, and
2. `external_map_nodes` (analyzer-imported located nodes).

Both carry full pubkeys, so a single prefix index over the union resolves hops.
Wider hops (2b/3b) usually resolve to exactly one node; 1b hops often match
several.

### Anchored sequential walk (backend)

Each stored path is an anchored chain:

```
origin (public_key, full pubkey => unique)
  -> hop0 -> hop1 -> ... -> hopN
  -> self (our node, our own GPS)
```

Both ends are known exactly. Resolve each path as a sequential walk from the
origin anchor inward:

- A hop whose prefix matches exactly one located node resolves directly
  (typical for 2b/3b, and for 1b where only one located node shares the byte).
- A hop whose prefix matches several located nodes resolves to the candidate
  NEAREST (great-circle) to the previously-resolved node in the chain (the prior
  node is always already anchored). The edge is flagged `ambiguous: true`.
- A hop whose prefix matches NO located node breaks the chain at that point; the
  unresolved segment is dropped (no fabricated endpoints).

`self` is resolved from the app's own configured location. Direct adverts
(`min_path_len` 0, empty path) contribute a single origin->self edge.

Rationale for the walk direction: the origin is a strong anchor (full pubkey),
so walking forward from it gives every ambiguous hop an already-resolved
neighbor to measure "nearest" against. The self anchor terminates the chain.

### Edge scope

Full chain. For a path `origin -> hop0 -> ... -> hopN -> self` emit undirected
edges:

- `origin -> hop0`
- `hopI -> hopI+1` for all consecutive pairs
- `hopN -> self`
- `origin -> self` for direct adverts (no hops)

This captures 0-hop and 1-hop adverts, which inter-hop-pairs-only would miss.

### Aggregation

After resolution, aggregate identical undirected resolved pairs at the same
`hop_width`: `count` = number of contributing transmissions, `last_seen` =
max(`first_seen`), `ambiguous` = OR of the contributing edges. An edge keyed by
resolved node pubkeys, so the same hop hex resolving to different nodes in
different chains aggregates correctly.

## Backend endpoint

`GET /packets/advert-links` (read-only; no migration; no auth change).

Response: a list of resolved GPS edges.

```json
[
  {
    "a": { "pubkey": "...", "lat": 0.0, "lon": 0.0, "kind": "self|contact|external" },
    "b": { "pubkey": "...", "lat": 0.0, "lon": 0.0, "kind": "self|contact|external" },
    "hop_width": 1,
    "count": 3,
    "last_seen": 1750000000,
    "ambiguous": true
  }
]
```

Notes:
- Returns all widths. The frontend filters by the confidence selector, so
  changing confidence does not refetch. An optional `min_hop_width` query
  parameter MAY be added for callers that want server-side filtering, but the UI
  does not depend on it.
- `kind` lets the frontend style/attribute self vs local contact vs external
  node if desired.
- Bounded work: cap the number of `advert_events` rows scanned (most recent
  first) to keep the endpoint responsive; exact cap chosen during planning.

Resolution logic lives in a small, independently testable unit (a resolver
function taking advert paths + a located-node index and returning edges), kept
out of the router so it can be unit-tested without HTTP.

## Frontend

### Links control: mode switch

The existing Links control gains a `Liveness | Advert-truth` mode switch:

- `Liveness` mode: unchanged behavior. Client-derived layer from `rawPackets`
  via `buildPacketNetworkContext` / `linksLayer.ts`.
- `Advert-truth` mode: fetch `GET /packets/advert-links`, render the returned
  edges. The confidence selector is shown only in this mode.

The two modes share one map layer; only the data source and styling paint
differ. The liveness code path is preserved intact.

### Confidence selector

Cumulative minimum-confidence, three positions:

- `1b+` (low, show all)
- `2b+` (medium)
- `3b` (high, only 3-byte hops)

Filters returned edges to `hop_width >= threshold`, client-side. Default
position chosen during planning (proposal: `2b+`, hiding the noisiest 1b guesses
by default).

### Styling

- Opacity encodes recency: reuse `livenessOpacity` on `last_seen`.
- Line width encodes confidence: 1b thin, 2b medium, 3b thick.
- `ambiguous` edges rendered dashed (uncertain), solid otherwise.
- Confirmed: confidence drives line WIDTH (not color); a single base color is
  kept, matching the existing single-color links aesthetic.

### i18n

New user-facing strings (mode labels, confidence labels, any tooltip) need
`t()` keys added to EN + NL + DE. The parity test and eslint rule enforce this.

## Non-goals

- No change to the liveness layer's algorithm or appearance.
- No new persisted data, settings, or migration.
- No directed-edge / traffic-count semantics; edges remain undirected RF-link
  truth with a confidence and recency dimension.

## Assumptions and open items (resolve in planning)

- ASSUMPTION: `self` location comes from the same app config used elsewhere in
  MapView (`config.lat/lon`, `isValidLocation`). To confirm during planning.
- ASSUMPTION: contacts expose `public_key`, `lat`, `lon` server-side for the
  located-node index. To confirm the exact repository query during planning.
- OPEN: exact scan cap on `advert_events`, and whether to bound by a time window
  (e.g. reuse an advert retention horizon) vs a row count.
- OPEN: default confidence position (`2b+` proposed).

## Verification (before claiming done, per CLAUDE.md)

1. Backend unit tests in the container for the resolver (anchored walk, nearest
   tiebreaker, ambiguous flagging, chain-break drop, direct-advert edge) and the
   endpoint shape. Image `rtfm-ev-local:latest`, worktree bind-mounted to
   `/work`, dev deps via `UV_PROJECT_ENVIRONMENT=/app/.venv uv sync --frozen
   --group dev`, `MSYS_NO_PATHCONV=1`.
2. Frontend suite (`npm ci` in the worktree, then the test run).
3. `prettier format:check` on changed files; i18n parity test.
4. Rebase onto current `origin/main`, rebuild the live instance on this branch,
   and OBSERVE in the browser: Advert-truth mode renders edges, the confidence
   selector filters 1b/2b/3b, ambiguous edges are visually distinct. Runtime
   behavior observed, not reasoned about.

## Branch / logistics

- Current worktree branch `claude/mesh-health-map-links-070d03` is based on
  `c9ed8fa` (pre-#94). Rebase onto `origin/main` (`5c3074a`) to pick up
  `advert_events`. Rename off `claude/` to a `feat/` branch per convention
  (proposal: `feat/map-advert-truth-links`).
- Target `origin` (the fork `Elektr0Vodka/RTFM-EV`). No commit / push / PR
  without explicit instruction.
