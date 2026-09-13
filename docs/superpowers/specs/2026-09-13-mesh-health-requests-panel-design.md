# Mesh Health: Adverts / Requests pill

Date: 2026-09-13
Status: Approved (design), not yet planned

## Summary

Add a second view to the Mesh Health page, switchable via a top-of-page pill
(`Adverts | Requests`). The current page becomes the "Adverts" view. The new
"Requests" view shows single-node observed REQUEST/RESPONSE traffic, modeled on
the EU Meshcore Analyzer's `requesthealth` analytics tab
(`meshcore-analyzer.eu/#analytics?tab=requesthealth`).

## Context and the single-node constraint

The EU Meshcore Analyzer is a multi-ingestor MQTT aggregator: it observes the
whole mesh from many vantage points, so it can judge whether a FLOOD request was
answered and report a "wasted flood request share".

RTFM-EV is a single connected node. It hears only what its own radio receives
over RF. A direct RESPONSE routed back along a path this node is not on is
invisible here. Therefore the answered/unanswered (and "wasted") judgment is not
reliably observable from one node and is deliberately out of scope.

Decision (confirmed with user): reframe the page as honest "Request traffic"
volume from this node's perspective. No answered/unanswered or waste claim.

## Data availability (verified)

- Decoder (`app/decoder.py`) defines `PayloadType.REQUEST = 0x00`,
  `RESPONSE = 0x01`, `ANON_REQUEST = 0x07`, and `RouteType`
  (`TRANSPORT_FLOOD`, `FLOOD`, `DIRECT`, `TRANSPORT_DIRECT`).
- `raw_packets` stores the full packet `data` bytes plus `payload_type` as the
  enum name string (`"REQUEST"`, `"RESPONSE"`, `"ANON_REQUEST"`, set in
  `app/packet_processor.py` via `payload_type.name`). So the window query can
  filter cheaply by `payload_type`.
- `route_type`, `dest_hash`, `src_hash` are NOT stored as columns. They are
  parsed per row from `data` via `parse_packet()`. For REQUEST/RESPONSE the
  payload begins with `payload[0] = dest_hash` (1 byte) and
  `payload[1] = src_hash` (1 byte), rendered as hex.
- ANON_REQUEST has an ephemeral sender, so it has no stable 1-byte src hash. It
  is counted in totals and the flood/direct split but excluded from the pairs
  table.
- Adverts are pre-extracted into `advert_events` (migration `_071`); REQ/RESPONSE
  are not pre-extracted, so the Requests view computes on demand over the
  windowed, type-filtered rows.

## Architecture

### Component structure (frontend)

`frontend/src/components/MeshHealthView.tsx` is currently 1192 lines and does one
job. Refactor into a shell plus two panels for clear boundaries and to shrink an
over-large file:

- `MeshHealthView.tsx` (shell): owns `selectedWindow` (lifted from its current
  local state) and the `Adverts | Requests` pill state. Renders the page header
  (title, pill toggle, refresh), the shared 30m-7d window selector, and the
  active panel. Passes `selectedWindow` and a refresh signal to the active panel.
- `MeshAdvertsPanel.tsx`: the current body moved out essentially verbatim
  (alerts, direct/flood split, hop/hash distributions, reachability rings,
  SNR-RSSI scatter, hourly heatmap, relay pairs, contacts table with
  pagination, focus-scroll, auto-refresh). Reads `selectedWindow` from props.
- `MeshRequestsPanel.tsx`: new view (below).

The pill is local React state. No new route, no new sidebar entry, no URL
deep-linking of the pill in v1. The view stays mounted where it is today
(`ConversationPane.tsx`, `activeConversation.type === 'mesh-health'`).

### Pill control

A segmented control styled like the existing window-selector pills, placed in the
page header. Two options: `Adverts` (default) and `Requests`.

### Requests panel content

Single-node observed request traffic over the selected window. Four panels:

1. Stat tiles (reuse `StatTile`): total requests (REQUEST + ANON_REQUEST),
   flood requests, direct requests, responses heard.
2. Split bars (reuse `DistBars`): flood vs direct requests; REQUEST vs
   ANON_REQUEST.
3. Volume over time: time-bucketed bar chart across the window showing
   flood/direct requests, with responses heard overlaid. Bucket count sized to
   the window (target ~24-48 buckets).
4. Top src->dest pairs table: columns are the 1-byte `src -> dest` hex pair,
   request count, flood/direct breakdown, last heard. Pairs are shown as raw hex
   and never resolved to names (matches the analyzer's deliberate choice so no
   node can be accused from a 1-byte hash collision). ANON_REQUEST excluded.

Time windows reuse the existing shared selector (30m, 1h, 3h, 6h, 12h, 24h, 7d).
Auto-refresh follows the existing rule (short windows only).

### Backend

New endpoint: `GET /api/packets/request-traffic?start_ts=<int>&end_ts=<int>`.

Response shape:

```
{
  "start_ts": <int>,
  "end_ts": <int>,
  "totals": {
    "requests": <int>,          // REQUEST + ANON_REQUEST
    "anon_requests": <int>,
    "responses": <int>,
    "flood_requests": <int>,
    "direct_requests": <int>
  },
  "series": [
    { "bucket_ts": <int>, "flood": <int>, "direct": <int>, "responses": <int> }
  ],
  "pairs": [
    { "src_hash": "ab", "dest_hash": "cd", "requests": <int>,
      "flood": <int>, "direct": <int>, "last_ts": <int> }
  ]
}
```

Implementation:

- Query `raw_packets WHERE payload_type IN ('REQUEST','ANON_REQUEST','RESPONSE')
  AND timestamp BETWEEN start_ts AND end_ts`.
- For each row call `parse_packet(data)`; derive route (flood vs direct from
  `RouteType`: FLOOD/TRANSPORT_FLOOD => flood, DIRECT/TRANSPORT_DIRECT =>
  direct) and, for REQUEST/RESPONSE, `dest_hash = payload[0]`,
  `src_hash = payload[1]`.
- Aggregate totals, time buckets, and top-N src->dest pairs (REQUEST only) in
  Python.
- Put aggregation in its own module `app/repository/request_traffic.py` to keep
  the router thin. Router handler in `app/routers/packets.py` mirrors the
  existing mesh-health / relay-pairs endpoints.
- Confirm an index covering `(payload_type, timestamp)` on `raw_packets`; if
  absent, add one via a new migration so the windowed scan stays cheap. (Verify
  existing indexes before adding; do not duplicate.)

Pydantic response models added alongside the existing packet models.

### i18n

New `mesh_health_req_*` keys (panel titles, stat labels, column headers, pill
labels `Adverts` / `Requests`, empty/error states) added to en, nl, de. The
parity test and eslint rule enforce all three locales and forbid hardcoded
strings.

### Tests

- Backend: test `request-traffic` aggregation (totals, flood/direct split,
  bucketing, pair extraction, ANON exclusion from pairs) with synthetic packets.
  Run in the container per the repo convention.
- Frontend: update `meshHealthView.test.tsx` for the shell/pill; add a test for
  `MeshRequestsPanel` (renders tiles, handles empty, renders pairs).

### Docs

- `CHANGELOG-DMC-EV.md`: add an entry under the frontend/backend areas.
- `README*.md`: update the Mesh Health feature description to mention the
  Adverts/Requests pill.
- `app/AGENTS.md`: add the new endpoint to the endpoint list.

## Out of scope (v1)

- Answered/unanswered matching and wasted-share percentage.
- Home-repeater and target-candidate name resolution.
- Day-scoped windows with a 7-day floor.
- URL deep-linking / persistence of the pill selection.

## Risks and notes

- A 7-day window may scan many rows. Mitigated by the type filter and the
  `(payload_type, timestamp)` index. If still heavy, a follow-up could
  pre-extract REQ/RESPONSE into a dedicated table as adverts are.
- The Adverts panel extraction is mechanical but touches a large file; preserve
  auto-refresh, focus-scroll, and pagination behavior exactly. Verify at runtime
  on the live instance, not just by type-checking.
