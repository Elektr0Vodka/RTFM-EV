# [23] Packet-history browser (DB-backed, under Tools)

Date: 2026-09-12
Status: PLANNING (stub). Requested by Richard, 2026-09-12. Nothing built.
Category: H (Persistence). See `docs/plans/README.md`.
Model: Sonnet.

Scope: local planning only. No code changes, no migrations, no commits, no PRs
from this document.

Product framing: the raw packet feed shows only what has arrived in the current
browser session's in-memory buffer, so an operator can look back a limited time
even though the full packet history is persisted server-side. This plan adds a
Tools view for browsing the persisted `raw_packets` history over arbitrary time
ranges, presented in the style of the existing feed.

---

## 1. Summary

Build a packet-history browser as its own item under the Tools sidebar group. It
queries the stored `raw_packets` table (not the live buffer) with preset windows
(1 / 3 / 6 / 12 / 24 h) and an explicit date-to-date range, rendering rows with
the same layout and the same inspector dialog the live feed uses.

This is the unbuilt extension of the fork-port "packet-feed history" item, which
shipped only as **seed-on-mount** (rehydrating the live buffer after reconnect),
not as a browser. `docs/plans/README.md:174` marks Phase 3 packet-feed history
SHIPPED; that refers to the seed path below, so this plan is explicit that the
browsing UI is the remaining gap.

## 2. What exists today (facts)

- `raw_packets` persists full history including `rssi`, `snr`, `payload_type`
  (`app/routers/packets.py:178` selects those columns).
- `GET /api/packets/recent` already accepts `after_ts`, `before_ts`, and `limit`
  Unix-second bounds and returns oldest-first in broadcast shape
  (`app/routers/packets.py:151-190`). `limit` is capped at 5000
  (`packets.py:165`).
- The feed view renders the in-memory store, not the DB
  (`RawPacketFeedView.tsx`, `useRawPackets`), and reuses
  `RawPacketInspectorDialog` for per-packet detail.
- The Tools sidebar group is an ordered, reorderable key list
  (`frontend/src/utils/sidebarLayout.ts:27`); adding a tool means a new
  `SidebarToolKey`, a `buildToolRow` case, a label, and a view.

## 3. Gap and proposed shape

The backend primitive largely exists; this is mostly a frontend build:

- A new Tools view with a window selector (1/3/6/12/24 h presets + date-range
  pickers) that maps the selection to `after_ts`/`before_ts`.
- Row rendering reusing `RawPacketList` + `RawPacketInspectorDialog` for
  consistency with the live feed.
- Pagination or chunked fetch, because a wide range can exceed the 5000-row cap
  (`packets.py:165`). Open question: raise the cap, add cursor/offset paging over
  `after_ts`, or both.

## 4. Open questions

- Reuse the live feed's payload-type / hop-width / hex filters over the queried
  slice, or start read-only and add filters later?
- Server-side vs client-side filtering for large ranges (the current filters run
  client-side against the buffer).
- Does the browser share the feed's filter component, or is a distinct component
  cleaner given the DB-query lifecycle?

## 5. Dependencies

- Gated by plan [19] (retention): how far back the browser can reach is bounded
  by the retention policy, so the two must agree on "how much history is kept."
- Follows the historical-panel browsing pattern established in plan [11] (NOC
  history panels), though [11] browses MQTT node snapshots, not raw packets.

## 6. References

- `app/routers/packets.py:151` (`/recent` with `after_ts`/`before_ts`/`limit`).
- `frontend/src/components/RawPacketFeedView.tsx`,
  `frontend/src/components/RawPacketList.tsx`,
  `frontend/src/utils/sidebarLayout.ts:27`.
- `docs/plans/19-analyzer-persistence-retention.md`,
  `docs/plans/11-dmc-mqtt-ingest-noc.md`.
