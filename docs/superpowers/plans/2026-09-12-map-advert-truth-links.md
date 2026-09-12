# Map Advert-Truth Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the map link layer from actual advert paths (truth), resolving hop hashes to GPS-placed nodes on the backend, with a Liveness/Advert-truth mode switch and a cumulative confidence selector (1b+/2b+/3b) in the map's Links control.

**Architecture:** A pure backend resolver turns stored `advert_events` paths into resolved GPS edges by walking each anchored chain (origin full-pubkey -> hops -> self) and disambiguating multi-match hops by nearest-to-previous. A new read-only endpoint joins `advert_events` + located nodes (`contacts` GPS UNION `external_map_nodes`). The frontend adds a mode switch and confidence selector to the Links panel, fetches resolved edges, filters by confidence client-side, and renders them in a dedicated GL layer (width = confidence, opacity = recency, dashed = ambiguous).

**Tech Stack:** FastAPI + aiosqlite (backend), pytest; React + TypeScript + maplibre-gl (frontend), vitest.

**Spec:** `docs/superpowers/specs/2026-09-12-map-advert-truth-links-design.md`

---

## Standing rules for this plan

- **No commits.** The repo's CLAUDE.md forbids commits/pushes/PRs without an explicit instruction from the user. This overrides the writing-plans default of per-task commits. Each task ends by running its tests; do NOT `git commit`. When the user later says to commit, stage only related files.
- **No em dashes** anywhere in code, comments, strings, or docs.
- **i18n:** every new user-facing string needs a `t()` key added to `frontend/src/i18n/locales/en.json`, `nl.json`, and `de.json`. The parity test and eslint rule enforce this.
- **Backend tests run in the container:** image `rtfm-ev-local:latest`, this worktree bind-mounted to `/work`, dev deps via `UV_PROJECT_ENVIRONMENT=/app/.venv uv sync --frozen --group dev`, and `MSYS_NO_PATHCONV=1` for `docker -v`//`-w` on Windows. See Task 9 for the exact command.
- **Frontend tests:** run `npm ci` in the worktree first (once), then `npm run test`.
- Target `origin` (the fork `Elektr0Vodka/RTFM-EV`), never upstream.

## File structure

**Backend (new):**
- `app/services/advert_links.py` - pure resolver: dataclasses (`LocatedNode`, `AdvertPathRow`, `ResolvedEdge`), `haversine_km`, `build_prefix_index`, `resolve_advert_edges`. No DB, no HTTP. Independently unit-testable.
- `app/repository/advert_links.py` - `AdvertLinksRepository`: `recent_events(limit)` and `located_nodes()`.
- `tests/test_advert_links_resolver.py` - resolver unit tests (no DB).
- `tests/test_advert_links_endpoint.py` - endpoint + repository integration tests.

**Backend (modified):**
- `app/models.py` - add `AdvertLinkNode`, `AdvertLinkEdge` Pydantic models.
- `app/routers/packets.py` - add `GET /advert-links`.

**Frontend (new):**
- `frontend/src/map/layers/advertLinksLayer.ts` - `buildAdvertArcs` + `createAdvertLinksLayer` (solid + dashed GL sub-layers).
- `frontend/src/test/map/advertLinksLayer.test.ts` - `buildAdvertArcs` unit tests.

**Frontend (modified):**
- `frontend/src/types.ts` - `AdvertLinkNode`, `AdvertLinkEdge` interfaces.
- `frontend/src/api.ts` - `getAdvertLinks`.
- `frontend/src/map/controls/MapControls.tsx` - convert Links from a toggle FAB to a panel FAB holding enable + mode + confidence controls.
- `frontend/src/map/MapSurface.tsx` - pass the new links props through.
- `frontend/src/components/MapView.tsx` - `linkMode`/`linkConfidence` state, fetch effect, confidence filter, advert layer show/hide.
- `frontend/src/i18n/locales/{en,nl,de}.json` - new `map_links_*` keys.

---

## Task 1: Rebase onto origin/main and rename the branch

`advert_events` (migration `_080`) landed in `origin/main` via PR #94. This worktree branch `claude/mesh-health-map-links-070d03` is based on `c9ed8fa` (pre-#94). Fast-forward it and rename off `claude/` per convention.

**Files:** none (git only).

- [ ] **Step 1: Confirm the worktree is clean and has no unique commits**

Run:
```bash
git status --porcelain
git log --oneline origin/main..HEAD
```
Expected: `git status --porcelain` shows only the untracked `docs/superpowers/specs/2026-09-12-map-advert-truth-links-design.md` and `docs/superpowers/plans/2026-09-12-map-advert-truth-links.md` (both fine to keep). The `log` command prints nothing (no local commits ahead of main).

- [ ] **Step 2: Fetch and fast-forward onto origin/main**

Run:
```bash
git fetch origin
git rebase origin/main
```
Expected: "Successfully rebased" or a clean fast-forward. The two untracked doc files remain. `git log --oneline -1` now shows `5c3074a ... (#94)` as an ancestor and `app/migrations/_080_create_advert_events.py` exists.

If a conflict appears (it should not, since there are no local commits), stop and report; do not force anything.

- [ ] **Step 3: Rename the branch off `claude/`**

Run:
```bash
git branch -m feat/map-advert-truth-links
git branch --show-current
```
Expected: `feat/map-advert-truth-links`.

- [ ] **Step 4: Verify advert_events is present and note the highest migration number**

Run:
```bash
ls app/migrations | grep -E "_080|_081"
```
Expected: `_080_create_advert_events.py` present, no `_081`. This spec adds NO migration, so the number is informational only. If any `_081+` appears from another session, this spec still needs no migration; proceed.

---

## Task 2: Backend resolver (pure) with unit tests

The resolver is the crux. It takes plain data (advert path rows, located nodes, optional self node) and returns resolved undirected edges. No DB, no radio, no HTTP, so it is fast and fully unit-testable.

**Files:**
- Create: `app/services/advert_links.py`
- Test: `tests/test_advert_links_resolver.py`

- [ ] **Step 1: Write the failing resolver unit tests**

Create `tests/test_advert_links_resolver.py`:

```python
"""Unit tests for the advert-links resolver (pure, no DB/radio)."""

from app.services.advert_links import (
    AdvertPathRow,
    LocatedNode,
    resolve_advert_edges,
)

# Located nodes. Pubkeys chosen so 1-byte prefixes collide (aa...) but
# 2-byte prefixes are unique. Coordinates spread so "nearest" is unambiguous.
ORIGIN = LocatedNode(pubkey="ff00000000", lat=52.0, lon=5.0, kind="contact")
R1 = LocatedNode(pubkey="aa11000000", lat=52.1, lon=5.0, kind="external")
R2 = LocatedNode(pubkey="aa22000000", lat=52.2, lon=5.0, kind="external")
FAR = LocatedNode(pubkey="aa99000000", lat=10.0, lon=5.0, kind="external")
SELF = LocatedNode(pubkey="ee00000000", lat=52.3, lon=5.0, kind="self")


def _edge_key(edge):
    return (tuple(sorted((edge.a_pubkey, edge.b_pubkey))), edge.hop_width)


def test_direct_advert_emits_origin_to_self_high_confidence():
    rows = [AdvertPathRow(public_key="ff00000000", path_hex="", hop_width=None,
                          min_path_len=0, first_seen=1000)]
    edges = resolve_advert_edges(rows, [ORIGIN], SELF)
    assert len(edges) == 1
    e = edges[0]
    assert _edge_key(e) == (("ee00000000", "ff00000000"), 3)
    assert e.ambiguous is False
    assert e.last_seen == 1000


def test_unique_two_byte_hop_resolves_and_builds_full_chain():
    # width 2 => 4 hex per hop. One hop "aa11" resolves uniquely to R1.
    rows = [AdvertPathRow(public_key="ff00000000", path_hex="aa11", hop_width=2,
                          min_path_len=1, first_seen=2000)]
    edges = resolve_advert_edges(rows, [ORIGIN, R1], SELF)
    keys = {_edge_key(e) for e in edges}
    assert keys == {
        (("aa11000000", "ff00000000"), 2),  # origin -> hop
        (("aa11000000", "ee00000000"), 2),  # hop -> self
    }
    assert all(e.ambiguous is False for e in edges)


def test_ambiguous_one_byte_hop_picks_nearest_to_previous():
    # width 1 => 2 hex per hop. Hop "aa" matches R1, R2, FAR. Anchored at ORIGIN
    # (lat 52.0); nearest is R1 (lat 52.1), not FAR (lat 10.0).
    rows = [AdvertPathRow(public_key="ff00000000", path_hex="aa", hop_width=1,
                          min_path_len=1, first_seen=3000)]
    edges = resolve_advert_edges(rows, [ORIGIN, R1, R2, FAR], SELF)
    origin_edges = [e for e in edges if "ff00000000" in (e.a_pubkey, e.b_pubkey)]
    assert len(origin_edges) == 1
    other = [p for p in (origin_edges[0].a_pubkey, origin_edges[0].b_pubkey)
             if p != "ff00000000"][0]
    assert other == "aa11000000"  # R1, nearest to origin
    assert origin_edges[0].ambiguous is True


def test_unresolvable_hop_breaks_chain_and_drops_tail():
    # First hop "aa11" resolves to R1; second hop "bbbb" matches nothing.
    # Expect origin->R1 only; no R1->self (chain broke before the end).
    rows = [AdvertPathRow(public_key="ff00000000", path_hex="aa11bbbb", hop_width=2,
                          min_path_len=2, first_seen=4000)]
    edges = resolve_advert_edges(rows, [ORIGIN, R1], SELF)
    keys = {_edge_key(e) for e in edges}
    assert keys == {(("aa11000000", "ff00000000"), 2)}


def test_aggregates_identical_edges_across_rows():
    rows = [
        AdvertPathRow(public_key="ff00000000", path_hex="aa11", hop_width=2,
                      min_path_len=1, first_seen=5000),
        AdvertPathRow(public_key="ff00000000", path_hex="aa11", hop_width=2,
                      min_path_len=1, first_seen=6000),
    ]
    edges = resolve_advert_edges(rows, [ORIGIN, R1], SELF)
    origin_edges = [e for e in edges if _edge_key(e) == (("aa11000000", "ff00000000"), 2)]
    assert len(origin_edges) == 1
    assert origin_edges[0].count == 2
    assert origin_edges[0].last_seen == 6000


def test_no_self_node_omits_self_edges_but_keeps_hop_chain():
    rows = [AdvertPathRow(public_key="ff00000000", path_hex="aa11", hop_width=2,
                          min_path_len=1, first_seen=7000)]
    edges = resolve_advert_edges(rows, [ORIGIN, R1], None)
    keys = {_edge_key(e) for e in edges}
    assert keys == {(("aa11000000", "ff00000000"), 2)}  # origin -> hop only
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (in the container, see Task 9 for the wrapper; locally this import will simply not resolve):
```bash
pytest tests/test_advert_links_resolver.py -v
```
Expected: FAIL / collection error - `app.services.advert_links` does not exist yet.

- [ ] **Step 3: Implement the resolver**

Create `app/services/advert_links.py`:

```python
"""Resolve stored advert paths into GPS edges (map link truth).

Pure module: it takes plain data (advert path rows + located nodes + an
optional self node) and returns resolved undirected edges. No DB, no radio,
no HTTP, so it is fully unit-testable.

Each stored path is an anchored chain:

    origin (advertiser, full pubkey => unique)
      -> hop0 -> hop1 -> ... -> hopN
      -> self (our node)

A hop hex is a prefix of a node's public key. Wide hops (2b/3b) usually match
one located node; 1b hops often match several. We resolve each path by walking
from the origin anchor inward, disambiguating a multi-match hop by choosing the
candidate nearest to the previously-resolved node. A hop matching no located
node breaks the chain there (the tail is dropped, no self edge).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

# hop_width assigned to direct adverts (origin heard with no hops). Both
# endpoints are exactly known, so it is maximum confidence and always passes
# the confidence filter.
DIRECT_HOP_WIDTH = 3


@dataclass(frozen=True)
class LocatedNode:
    """A GPS-placed node keyed by full public key (lowercase hex)."""

    pubkey: str
    lat: float
    lon: float
    kind: str  # "self" | "contact" | "external"


@dataclass(frozen=True)
class AdvertPathRow:
    """One advert transmission's stored path."""

    public_key: str  # advertiser, full lowercase hex
    path_hex: str  # relay chain hex; "" for direct
    hop_width: int | None  # bytes per hop (1/2/3); None for direct
    min_path_len: int  # 0 = heard direct
    first_seen: int


@dataclass(frozen=True)
class ResolvedEdge:
    a_pubkey: str
    b_pubkey: str
    hop_width: int
    count: int
    last_seen: int
    ambiguous: bool


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in kilometres between two lat/lon points."""
    r = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def build_prefix_index(nodes: list[LocatedNode]) -> dict[str, list[LocatedNode]]:
    """Index located nodes by their 1/2/3-byte (2/4/6 hex) pubkey prefixes."""
    index: dict[str, list[LocatedNode]] = {}
    for node in nodes:
        pk = node.pubkey.lower()
        for width in (1, 2, 3):
            prefix = pk[: width * 2]
            if len(prefix) == width * 2:
                index.setdefault(prefix, []).append(node)
    return index


def _split_hops(path_hex: str, hop_width: int) -> list[str]:
    step = hop_width * 2
    if step <= 0 or not path_hex or len(path_hex) % step != 0:
        return []
    return [path_hex[i : i + step] for i in range(0, len(path_hex), step)]


def _resolve_hop(
    hop_hex: str,
    prev: LocatedNode | None,
    index: dict[str, list[LocatedNode]],
) -> tuple[LocatedNode | None, bool]:
    """Resolve a single hop prefix. Returns (node, ambiguous). node is None
    when the prefix matches no located node, or matches several with no prior
    anchor to disambiguate against."""
    candidates = index.get(hop_hex.lower(), [])
    if not candidates:
        return None, False
    if len(candidates) == 1:
        return candidates[0], False
    if prev is None:
        return None, False
    nearest = min(candidates, key=lambda c: haversine_km(prev.lat, prev.lon, c.lat, c.lon))
    return nearest, True


def resolve_advert_edges(
    rows: list[AdvertPathRow],
    located: list[LocatedNode],
    self_node: LocatedNode | None,
) -> list[ResolvedEdge]:
    """Resolve advert paths into aggregated undirected GPS edges."""
    index = build_prefix_index(located)
    by_key: dict[tuple[str, str, int], dict] = {}

    def add_edge(a: LocatedNode, b: LocatedNode, width: int, ambiguous: bool, seen: int) -> None:
        if a.pubkey == b.pubkey:
            return
        lo, hi = sorted((a.pubkey, b.pubkey))
        key = (lo, hi, width)
        agg = by_key.get(key)
        if agg is None:
            by_key[key] = {"count": 1, "last_seen": seen, "ambiguous": ambiguous}
        else:
            agg["count"] += 1
            agg["last_seen"] = max(agg["last_seen"], seen)
            agg["ambiguous"] = agg["ambiguous"] or ambiguous

    origin_by_key = {n.pubkey: n for n in located}

    for row in rows:
        origin = origin_by_key.get(row.public_key.lower())
        width = row.hop_width or 0
        hops = _split_hops(row.path_hex, width) if width else []

        if not hops:
            # Direct advert: origin -> self (if both known).
            if origin and self_node:
                add_edge(origin, self_node, DIRECT_HOP_WIDTH, False, row.first_seen)
            continue

        # Walk the chain from the origin anchor inward.
        chain: list[tuple[LocatedNode, bool]] = []
        if origin is not None:
            chain.append((origin, False))
        prev = origin
        broke = False
        for hop in hops:
            node, ambiguous = _resolve_hop(hop, prev, index)
            if node is None:
                broke = True
                break
            chain.append((node, ambiguous))
            prev = node

        # Emit consecutive edges along the resolved chain.
        for (a, _), (b, amb_b) in zip(chain, chain[1:]):
            add_edge(a, b, width, amb_b, row.first_seen)

        # Tail -> self only if the whole chain resolved (no break) and self known.
        if not broke and self_node is not None and chain:
            last_node, last_amb = chain[-1]
            add_edge(last_node, self_node, width, last_amb, row.first_seen)

    return [
        ResolvedEdge(
            a_pubkey=lo,
            b_pubkey=hi,
            hop_width=width,
            count=agg["count"],
            last_seen=agg["last_seen"],
            ambiguous=agg["ambiguous"],
        )
        for (lo, hi, width), agg in by_key.items()
    ]
```

Note on the origin->hop0 edge's `ambiguous`: it is set from `amb_b` (the freshly-resolved hop's ambiguity), because origin itself is exact. The `zip(chain, chain[1:])` uses the second element's ambiguity, which is correct for every edge (origin is index 0 with `False`).

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
pytest tests/test_advert_links_resolver.py -v
```
Expected: PASS (6 tests).

---

## Task 3: Backend repository (advert events + located nodes)

**Files:**
- Create: `app/repository/advert_links.py`
- Test: add to `tests/test_advert_links_endpoint.py` (created here; endpoint added in Task 4).

- [ ] **Step 1: Write the failing repository test**

Create `tests/test_advert_links_endpoint.py`:

```python
"""Tests for AdvertLinksRepository and the GET /api/packets/advert-links endpoint."""

import pytest

from app.database import db
from app.models import ContactUpsert, ExternalMapNode
from app.repository import ContactRepository
from app.repository.advert_links import AdvertLinksRepository
from app.repository.external_map import ExternalMapRepository


async def _insert_advert_event(
    public_key: str, path_hex: str, hop_width, min_path_len: int, first_seen: int
) -> None:
    async with db.tx() as conn:
        await conn.execute(
            """
            INSERT INTO advert_events
                (transmission_id, public_key, first_seen, min_path_len, path_hex, hop_width)
            VALUES (NULL, ?, ?, ?, ?, ?)
            """,
            (public_key.lower(), first_seen, min_path_len, path_hex, hop_width),
        )


class TestLocatedNodes:
    @pytest.mark.asyncio
    async def test_unions_located_contacts_and_external_nodes(self, test_db):
        await ContactRepository.upsert(
            ContactUpsert(public_key="ff00000000", name="Origin", lat=52.0, lon=5.0)
        )
        # A contact with no GPS must be excluded.
        await ContactRepository.upsert(ContactUpsert(public_key="dd00000000", name="NoGps"))
        await ExternalMapRepository.replace_all(
            [ExternalMapNode(pubkey="aa11000000", name="R1", role="Repeater",
                             lat=52.1, lon=5.0, last_seen=1, advert_count=3, mobile=False)],
            source="test",
            synced_at=1,
        )
        nodes = await AdvertLinksRepository.located_nodes()
        by_pk = {n.pubkey: n for n in nodes}
        assert "ff00000000" in by_pk and by_pk["ff00000000"].kind == "contact"
        assert "aa11000000" in by_pk and by_pk["aa11000000"].kind == "external"
        assert "dd00000000" not in by_pk

    @pytest.mark.asyncio
    async def test_contact_wins_over_external_on_pubkey_collision(self, test_db):
        await ContactRepository.upsert(
            ContactUpsert(public_key="aa11000000", name="LocalRepeater", lat=1.0, lon=2.0)
        )
        await ExternalMapRepository.replace_all(
            [ExternalMapNode(pubkey="aa11000000", name="ExtRepeater", role="Repeater",
                             lat=9.0, lon=9.0, last_seen=1, advert_count=0, mobile=False)],
            source="test",
            synced_at=1,
        )
        nodes = await AdvertLinksRepository.located_nodes()
        match = [n for n in nodes if n.pubkey == "aa11000000"]
        assert len(match) == 1
        assert match[0].kind == "contact" and match[0].lat == 1.0


class TestRecentEvents:
    @pytest.mark.asyncio
    async def test_returns_rows_newest_first_capped(self, test_db):
        for i in range(3):
            await _insert_advert_event("ff00000000", "aa11", 2, 1, 1000 + i)
        rows = await AdvertLinksRepository.recent_events(limit=2)
        assert len(rows) == 2
        assert rows[0].first_seen == 1002 and rows[1].first_seen == 1001
        assert rows[0].hop_width == 2 and rows[0].public_key == "ff00000000"
```

- [ ] **Step 2: Run to verify it fails**

Run:
```bash
pytest tests/test_advert_links_endpoint.py::TestLocatedNodes -v
```
Expected: FAIL / import error - `app.repository.advert_links` does not exist.

- [ ] **Step 3: Implement the repository**

Create `app/repository/advert_links.py`:

```python
"""Read queries backing the advert-links map layer."""

from app.database import db
from app.services.advert_links import AdvertPathRow, LocatedNode

# Cap on advert_events rows scanned per request (newest first) to bound work.
DEFAULT_EVENT_LIMIT = 5000


class AdvertLinksRepository:
    @staticmethod
    async def recent_events(limit: int = DEFAULT_EVENT_LIMIT) -> list[AdvertPathRow]:
        """Most recent advert transmissions, newest first, capped at ``limit``."""
        async with db.readonly() as conn:
            async with conn.execute(
                """
                SELECT public_key, path_hex, hop_width, min_path_len, first_seen
                FROM advert_events
                ORDER BY first_seen DESC
                LIMIT ?
                """,
                (limit,),
            ) as cur:
                rows = await cur.fetchall()
        return [
            AdvertPathRow(
                public_key=(r["public_key"] or "").lower(),
                path_hex=(r["path_hex"] or "").lower(),
                hop_width=r["hop_width"],
                min_path_len=r["min_path_len"] or 0,
                first_seen=r["first_seen"] or 0,
            )
            for r in rows
        ]

    @staticmethod
    async def located_nodes() -> list[LocatedNode]:
        """GPS-placed nodes: local contacts UNION analyzer nodes.

        A local contact wins over an external node with the same pubkey.
        """
        by_pk: dict[str, LocatedNode] = {}
        async with db.readonly() as conn:
            async with conn.execute(
                """
                SELECT pubkey, lat, lon FROM external_map_nodes
                WHERE lat IS NOT NULL AND lon IS NOT NULL
                """
            ) as cur:
                for r in await cur.fetchall():
                    pk = (r["pubkey"] or "").lower()
                    if pk:
                        by_pk[pk] = LocatedNode(pk, r["lat"], r["lon"], "external")
            async with conn.execute(
                """
                SELECT public_key, lat, lon FROM contacts
                WHERE lat IS NOT NULL AND lon IS NOT NULL
                """
            ) as cur:
                for r in await cur.fetchall():
                    pk = (r["public_key"] or "").lower()
                    if pk:
                        by_pk[pk] = LocatedNode(pk, r["lat"], r["lon"], "contact")
        return list(by_pk.values())
```

- [ ] **Step 4: Run to verify it passes**

Run:
```bash
pytest tests/test_advert_links_endpoint.py::TestLocatedNodes tests/test_advert_links_endpoint.py::TestRecentEvents -v
```
Expected: PASS (3 tests). If `ExternalMapNode`/`ContactUpsert` constructor fields differ, adjust the test's kwargs to match `app/models.py` (verify field names there first); the repository code itself does not depend on those.

---

## Task 4: Backend response models + endpoint

**Files:**
- Modify: `app/models.py` (add two models near the other packet/response models)
- Modify: `app/routers/packets.py` (add `GET /advert-links`, near `get_relay_pairs`)
- Test: append to `tests/test_advert_links_endpoint.py`

- [ ] **Step 1: Write the failing endpoint test**

Append to `tests/test_advert_links_endpoint.py`:

```python
class TestAdvertLinksEndpoint:
    @pytest.mark.asyncio
    async def test_returns_resolved_edges_without_radio(self, test_db, client):
        # Origin (contact, GPS) advertises via one unique 2-byte hop (external node).
        await ContactRepository.upsert(
            ContactUpsert(public_key="ff00000000", name="Origin", lat=52.0, lon=5.0)
        )
        await ExternalMapRepository.replace_all(
            [ExternalMapNode(pubkey="aa11000000", name="R1", role="Repeater",
                             lat=52.1, lon=5.0, last_seen=1, advert_count=3, mobile=False)],
            source="test",
            synced_at=1,
        )
        await _insert_advert_event("ff00000000", "aa11", 2, 1, 9000)

        response = await client.get("/api/packets/advert-links")
        assert response.status_code == 200
        edges = response.json()
        # No radio in tests => no self node => only origin -> hop edge.
        assert len(edges) == 1
        e = edges[0]
        assert {e["a"]["pubkey"], e["b"]["pubkey"]} == {"ff00000000", "aa11000000"}
        assert e["hop_width"] == 2
        assert e["count"] == 1
        assert e["last_seen"] == 9000
        assert e["ambiguous"] is False
        kinds = {e["a"]["kind"], e["b"]["kind"]}
        assert kinds == {"contact", "external"}

    @pytest.mark.asyncio
    async def test_empty_when_no_events(self, test_db, client):
        response = await client.get("/api/packets/advert-links")
        assert response.status_code == 200
        assert response.json() == []
```

- [ ] **Step 2: Run to verify it fails**

Run:
```bash
pytest tests/test_advert_links_endpoint.py::TestAdvertLinksEndpoint -v
```
Expected: FAIL - 404 (route not defined).

- [ ] **Step 3: Add the Pydantic models**

In `app/models.py`, add (place near the other response models; keep imports tidy - `Literal` is already used across the file, otherwise add `from typing import Literal`):

```python
class AdvertLinkNode(BaseModel):
    pubkey: str
    lat: float
    lon: float
    kind: Literal["self", "contact", "external"]


class AdvertLinkEdge(BaseModel):
    a: AdvertLinkNode
    b: AdvertLinkNode
    hop_width: int
    count: int
    last_seen: int
    ambiguous: bool
```

- [ ] **Step 4: Add the endpoint**

In `app/routers/packets.py`, add the import at the top with the other imports:

```python
from app.models import AdvertLinkEdge, AdvertLinkNode
from app.repository.advert_links import AdvertLinksRepository
from app.services.advert_links import LocatedNode, resolve_advert_edges
from app.services.radio_runtime import radio_runtime as radio_manager
```

(If `radio_runtime` or some of these names are already imported in this file, do not duplicate the import.)

Then add the route (next to `get_relay_pairs`, before the `"/{packet_id}"` catch-all route so the literal path is matched first):

```python
def _self_located_node() -> LocatedNode | None:
    """The app's own node as a located node, or None if unavailable.

    Never raises: if the radio is not connected or has no location, self edges
    are simply omitted.
    """
    try:
        if not getattr(radio_manager, "is_connected", False):
            return None
        mc = getattr(radio_manager, "meshcore", None)
        info = getattr(mc, "self_info", None) if mc else None
        if not info:
            return None
        pubkey = (info.get("public_key") or "").lower()
        lat = info.get("adv_lat")
        lon = info.get("adv_lon")
        if not pubkey or lat is None or lon is None:
            return None
        if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
            return None
        if lat == 0.0 and lon == 0.0:
            return None
        return LocatedNode(pubkey=pubkey, lat=float(lat), lon=float(lon), kind="self")
    except Exception:
        return None


@router.get("/advert-links", response_model=list[AdvertLinkEdge])
async def get_advert_links(limit: int = 5000) -> list[AdvertLinkEdge]:
    """Resolved advert-path edges for the map link layer (truth).

    Each edge is an undirected RF link derived from stored advert paths, carrying
    hop_width (confidence), count, last_seen (recency), and an ambiguous flag.
    Hop hashes are resolved against local contacts UNION analyzer nodes.
    """
    rows = await AdvertLinksRepository.recent_events(limit=min(max(limit, 1), 20000))
    located = await AdvertLinksRepository.located_nodes()
    self_node = _self_located_node()
    node_by_pk = {n.pubkey: n for n in located}
    if self_node is not None:
        node_by_pk[self_node.pubkey] = self_node

    edges = resolve_advert_edges(rows, located, self_node)

    def to_node(pubkey: str) -> AdvertLinkNode:
        n = node_by_pk[pubkey]
        return AdvertLinkNode(pubkey=n.pubkey, lat=n.lat, lon=n.lon, kind=n.kind)

    return [
        AdvertLinkEdge(
            a=to_node(e.a_pubkey),
            b=to_node(e.b_pubkey),
            hop_width=e.hop_width,
            count=e.count,
            last_seen=e.last_seen,
            ambiguous=e.ambiguous,
        )
        for e in edges
    ]
```

Note: `resolve_advert_edges` only ever emits edges whose endpoints are in `located` or are `self_node`, so `node_by_pk[pubkey]` cannot KeyError.

- [ ] **Step 5: Run to verify it passes**

Run:
```bash
pytest tests/test_advert_links_endpoint.py -v
```
Expected: PASS (all classes).

---

## Task 5: Frontend API client + types

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api.ts`

- [ ] **Step 1: Add the types**

In `frontend/src/types.ts`, add:

```typescript
export interface AdvertLinkNode {
  pubkey: string;
  lat: number;
  lon: number;
  kind: 'self' | 'contact' | 'external';
}

export interface AdvertLinkEdge {
  a: AdvertLinkNode;
  b: AdvertLinkNode;
  hop_width: number;
  count: number;
  last_seen: number;
  ambiguous: boolean;
}
```

- [ ] **Step 2: Add the API method**

In `frontend/src/api.ts`, add `AdvertLinkEdge` to the type import block from `./types`, then add near `getRepeaterAdvertPaths`:

```typescript
  getAdvertLinks: (signal?: AbortSignal) =>
    fetchJson<AdvertLinkEdge[]>('/packets/advert-links', { signal }),
```

(If `getRepeaterAdvertPaths` uses a different fetch signature, match its style; `fetchJson` is the shared helper used across `api.ts`.)

- [ ] **Step 3: Typecheck**

Run:
```bash
cd frontend && npm run build 2>&1 | tail -20
```
Expected: no type errors referencing the new symbols. (A full build is fine here; a lighter `tsc --noEmit` is acceptable if the project exposes it.)

---

## Task 6: Frontend advert-links GL layer with unit test

Resolved edges already carry both endpoints' lat/lon, so the layer just builds LineStrings. Confidence -> line width; recency -> opacity (reuse `livenessOpacity`); ambiguity -> dashed via a second filtered sub-layer (maplibre `line-dasharray` is not data-driven, so ambiguity is split across two layers sharing one source).

**Files:**
- Create: `frontend/src/map/layers/advertLinksLayer.ts`
- Test: `frontend/src/test/map/advertLinksLayer.test.ts`

- [ ] **Step 1: Write the failing unit test**

Create `frontend/src/test/map/advertLinksLayer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildAdvertArcs, widthForHop } from '../../map/layers/advertLinksLayer';
import type { AdvertLinkEdge } from '../../types';

const now = 1_000_000_000_000; // ms

function edge(partial: Partial<AdvertLinkEdge>): AdvertLinkEdge {
  return {
    a: { pubkey: 'ff00', lat: 52, lon: 5, kind: 'contact' },
    b: { pubkey: 'aa11', lat: 53, lon: 6, kind: 'external' },
    hop_width: 2,
    count: 1,
    last_seen: Math.floor(now / 1000),
    ambiguous: false,
    ...partial,
  };
}

describe('widthForHop', () => {
  it('increases with confidence', () => {
    expect(widthForHop(1)).toBeLessThan(widthForHop(2));
    expect(widthForHop(2)).toBeLessThan(widthForHop(3));
  });
});

describe('buildAdvertArcs', () => {
  it('builds one LineString per edge with endpoints in lon,lat order', () => {
    const fc = buildAdvertArcs([edge({})], now);
    expect(fc.features).toHaveLength(1);
    const f = fc.features[0];
    expect(f.geometry.coordinates[0]).toEqual([5, 52]);
    expect(f.geometry.coordinates[1]).toEqual([6, 53]);
    expect(f.properties.width).toBe(widthForHop(2));
    expect(f.properties.ambiguous).toBe(0);
    expect(f.properties.opacity).toBeGreaterThan(0);
  });

  it('marks ambiguous edges with ambiguous=1', () => {
    const fc = buildAdvertArcs([edge({ ambiguous: true })], now);
    expect(fc.features[0].properties.ambiguous).toBe(1);
  });

  it('fades opacity with recency (older edge is fainter)', () => {
    const fresh = buildAdvertArcs([edge({ last_seen: Math.floor(now / 1000) })], now);
    const old = buildAdvertArcs(
      [edge({ last_seen: Math.floor((now - 40 * 24 * 3600e3) / 1000) })],
      now
    );
    expect(fresh.features[0].properties.opacity).toBeGreaterThan(
      old.features[0].properties.opacity
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run:
```bash
cd frontend && npm run test -- advertLinksLayer 2>&1 | tail -20
```
Expected: FAIL - module not found.

- [ ] **Step 3: Implement the layer**

Create `frontend/src/map/layers/advertLinksLayer.ts`:

```typescript
import type { Map as MlMap } from 'maplibre-gl';
import type { AdvertLinkEdge } from '../../types';
import { livenessOpacity } from './linksLayer';

// Confidence -> line width (px). Wider hop hash = more uniquely resolvable.
const WIDTH_BY_HOP: Record<number, number> = { 1: 1.0, 2: 2.0, 3: 3.5 };

export function widthForHop(hopWidth: number): number {
  return WIDTH_BY_HOP[hopWidth] ?? WIDTH_BY_HOP[1];
}

export interface AdvertArcCollection {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    properties: { opacity: number; width: number; ambiguous: 0 | 1 };
    geometry: { type: 'LineString'; coordinates: [number, number][] };
  }[];
}

export function buildAdvertArcs(edges: AdvertLinkEdge[], now: number): AdvertArcCollection {
  const features: AdvertArcCollection['features'] = [];
  for (const e of edges) {
    features.push({
      type: 'Feature',
      properties: {
        opacity: livenessOpacity(e.last_seen * 1000, now),
        width: widthForHop(e.hop_width),
        ambiguous: e.ambiguous ? 1 : 0,
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [e.a.lon, e.a.lat],
          [e.b.lon, e.b.lat],
        ],
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

export interface AdvertLinksLayerController {
  ensure(): void;
  reattach(): void;
  show(): void;
  hide(): void;
  setData(edges: AdvertLinkEdge[]): void;
}

const SOURCE_ID = 'rt-advert-links';
const SOLID_LAYER = 'rt-advert-links-solid';
const DASHED_LAYER = 'rt-advert-links-dashed';
const LINE_COLOR = '#58a6ff';

/** GL layer for advert-truth edges. Two line sub-layers share one source so
 *  ambiguous edges can be dashed (line-dasharray is not data-driven). Width is
 *  data-driven by confidence, opacity by recency. Hidden until shown. */
export function createAdvertLinksLayer(map: MlMap): AdvertLinksLayerController {
  const m = map as unknown as {
    getSource: (id: string) => { setData: (d: AdvertArcCollection) => void } | undefined;
    getLayer: (id: string) => unknown;
    addSource: (id: string, src: unknown) => void;
    addLayer: (layer: unknown, before?: string) => void;
    setLayoutProperty: (id: string, prop: string, value: unknown) => void;
  };
  let visible = false;

  function ensureLayers(): void {
    if (!m.getSource(SOURCE_ID)) {
      m.addSource(SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    const before = m.getLayer('rt-nodes') ? 'rt-nodes' : undefined;
    const vis = visible ? 'visible' : 'none';
    if (!m.getLayer(SOLID_LAYER)) {
      m.addLayer(
        {
          id: SOLID_LAYER,
          type: 'line',
          source: SOURCE_ID,
          filter: ['==', ['get', 'ambiguous'], 0],
          layout: { visibility: vis, 'line-cap': 'round' },
          paint: {
            'line-color': LINE_COLOR,
            'line-opacity': ['get', 'opacity'],
            'line-width': ['get', 'width'],
          },
        },
        before
      );
    }
    if (!m.getLayer(DASHED_LAYER)) {
      m.addLayer(
        {
          id: DASHED_LAYER,
          type: 'line',
          source: SOURCE_ID,
          filter: ['==', ['get', 'ambiguous'], 1],
          layout: { visibility: vis, 'line-cap': 'round' },
          paint: {
            'line-color': LINE_COLOR,
            'line-opacity': ['get', 'opacity'],
            'line-width': ['get', 'width'],
            'line-dasharray': [2, 2],
          },
        },
        before
      );
    }
  }

  function setVisibility(v: 'visible' | 'none'): void {
    for (const id of [SOLID_LAYER, DASHED_LAYER]) {
      if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', v);
    }
  }

  return {
    ensure(): void {
      ensureLayers();
    },
    reattach(): void {
      ensureLayers();
      if (visible) setVisibility('visible');
    },
    show(): void {
      ensureLayers();
      visible = true;
      setVisibility('visible');
    },
    hide(): void {
      visible = false;
      setVisibility('none');
    },
    setData(edges: AdvertLinkEdge[]): void {
      const src = m.getSource(SOURCE_ID);
      if (src) src.setData(buildAdvertArcs(edges, Date.now()));
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run:
```bash
cd frontend && npm run test -- advertLinksLayer 2>&1 | tail -20
```
Expected: PASS.

---

## Task 7: MapControls Links panel (mode + confidence) + i18n

Convert the Links FAB from a one-tap toggle into a panel FAB (like `nodeSize`) holding an enable checkbox, a Liveness/Advert-truth mode radiogroup, and a confidence radiogroup shown only in Advert-truth mode.

**Files:**
- Modify: `frontend/src/map/controls/MapControls.tsx`
- Modify: `frontend/src/i18n/locales/en.json`, `nl.json`, `de.json`
- Test: `frontend/src/test/map/mapControls.test.tsx` (extend)

- [ ] **Step 1: Add i18n keys**

In `frontend/src/i18n/locales/en.json`, add (near `map_links_label`):

```json
  "map_links_enable": "Show links",
  "map_links_mode_label": "Link source",
  "map_links_mode_liveness": "Liveness",
  "map_links_mode_advert": "Advert paths",
  "map_links_confidence_label": "Confidence",
  "map_links_confidence_low": "1b+ (low)",
  "map_links_confidence_medium": "2b+",
  "map_links_confidence_high": "3b (high)",
```

In `nl.json` add the same keys with Dutch values:

```json
  "map_links_enable": "Verbindingen tonen",
  "map_links_mode_label": "Verbindingsbron",
  "map_links_mode_liveness": "Activiteit",
  "map_links_mode_advert": "Advertentiepaden",
  "map_links_confidence_label": "Betrouwbaarheid",
  "map_links_confidence_low": "1b+ (laag)",
  "map_links_confidence_medium": "2b+",
  "map_links_confidence_high": "3b (hoog)",
```

In `de.json` add the same keys with German values:

```json
  "map_links_enable": "Verbindungen anzeigen",
  "map_links_mode_label": "Verbindungsquelle",
  "map_links_mode_liveness": "Aktivitaet",
  "map_links_mode_advert": "Advert-Pfade",
  "map_links_confidence_label": "Konfidenz",
  "map_links_confidence_low": "1b+ (niedrig)",
  "map_links_confidence_medium": "2b+",
  "map_links_confidence_high": "3b (hoch)",
```

(No umlaut in `Aktivitaet`/`Konfidenz`... use standard German spelling `Aktivitat`/`Konfidenz` if the file convention avoids umlauts; match how existing `de.json` values handle umlauts. Do not use em dashes.)

- [ ] **Step 2: Extend the MapControls props and add the panel**

In `frontend/src/map/controls/MapControls.tsx`:

Add to `MapControlsProps` (after `onToggleLinks`):

```typescript
  linkMode?: 'liveness' | 'advert';
  onLinkMode?: (mode: 'liveness' | 'advert') => void;
  linkConfidence?: 1 | 2 | 3;
  onLinkConfidence?: (level: 1 | 2 | 3) => void;
```

Destructure them in the component body (near `linksOn`/`onToggleLinks`) with defaults:

```typescript
    linkMode = 'liveness',
    onLinkMode,
    linkConfidence = 2,
    onLinkConfidence,
```

Remove the `if (fabs.links) { toggles.push(...) }` block. Add a Links PANEL instead (place after the `nodeSize` panel, before the `extraFabs` loop):

```tsx
  if (fabs.links) {
    const confidenceOptions: { level: 1 | 2 | 3; label: string }[] = [
      { level: 1, label: t('map_links_confidence_low') },
      { level: 2, label: t('map_links_confidence_medium') },
      { level: 3, label: t('map_links_confidence_high') },
    ];
    panels.push({
      id: 'links',
      label: t('map_links_label'),
      icon: <Spline size={20} aria-hidden />,
      body: (
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={linksOn}
              onChange={(e) => onToggleLinks?.(e.target.checked)}
            />
            {t('map_links_enable')}
          </label>
          <div role="radiogroup" aria-label={t('map_links_mode_label')} className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              {t('map_links_mode_label')}
            </span>
            {(['liveness', 'advert'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={linkMode === mode}
                className={
                  'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ' +
                  (linkMode === mode ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50')
                }
                onClick={() => onLinkMode?.(mode)}
              >
                {mode === 'liveness' ? t('map_links_mode_liveness') : t('map_links_mode_advert')}
              </button>
            ))}
          </div>
          {linkMode === 'advert' && (
            <div
              role="radiogroup"
              aria-label={t('map_links_confidence_label')}
              className="flex flex-col gap-1"
            >
              <span className="text-xs font-medium text-muted-foreground">
                {t('map_links_confidence_label')}
              </span>
              {confidenceOptions.map((opt) => (
                <button
                  key={opt.level}
                  type="button"
                  role="radio"
                  aria-checked={linkConfidence === opt.level}
                  className={
                    'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ' +
                    (linkConfidence === opt.level
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-accent/50')
                  }
                  onClick={() => onLinkConfidence?.(opt.level)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ),
    });
  }
```

- [ ] **Step 3: Extend the mapControls test**

In `frontend/src/test/map/mapControls.test.tsx`, add a test that opening the Links panel shows the mode radios and that the confidence group appears only in advert mode. Mirror the existing render/setup in that file (reuse its render helper and i18n wrapper). Concretely add:

```tsx
  it('shows link mode radios and confidence only in advert mode', async () => {
    const onLinkMode = vi.fn();
    renderControls({
      fabs: { links: true },
      linksOn: true,
      linkMode: 'liveness',
      onLinkMode,
      linkConfidence: 2,
    });
    // Open the Links panel via its FAB (aria-label = "Links").
    await userEvent.click(screen.getByRole('button', { name: 'Links' }));
    expect(screen.getByRole('radio', { name: 'Liveness' })).toBeInTheDocument();
    // Confidence group hidden in liveness mode.
    expect(screen.queryByRole('radio', { name: /1b\+/ })).not.toBeInTheDocument();
  });
```

Adjust `renderControls` to whatever the existing helper in that file is called and how it injects props; if the file renders `<MapControls .../>` directly, follow that form. Verify the FAB `aria-label` for Links resolves to the English `map_links_label` ("Links") under the test i18n setup.

- [ ] **Step 4: Run the frontend tests**

Run:
```bash
cd frontend && npm run test -- mapControls advertLinksLayer 2>&1 | tail -30
```
Expected: PASS.

---

## Task 8: MapSurface passthrough + MapView wiring

**Files:**
- Modify: `frontend/src/map/MapSurface.tsx`
- Modify: `frontend/src/components/MapView.tsx`

- [ ] **Step 1: MapSurface passthrough**

In `frontend/src/map/MapSurface.tsx`, add the four props to the `MapSurface` props interface (mirroring the existing `linksOn`/`onToggleLinks` lines):

```typescript
  linkMode?: 'liveness' | 'advert';
  onLinkMode?: (mode: 'liveness' | 'advert') => void;
  linkConfidence?: 1 | 2 | 3;
  onLinkConfidence?: (level: 1 | 2 | 3) => void;
```

And forward them to `<MapControls>` (next to `linksOn={props.linksOn}`):

```tsx
        linkMode={props.linkMode}
        onLinkMode={props.onLinkMode}
        linkConfidence={props.linkConfidence}
        onLinkConfidence={props.onLinkConfidence}
```

- [ ] **Step 2: MapView state + advert layer ref**

In `frontend/src/components/MapView.tsx`:

Add imports:

```typescript
import { createAdvertLinksLayer } from '../map/layers/advertLinksLayer';
import type { AdvertLinkEdge } from '../types';
```

Add state near `const [linksOn, setLinksOn] = useState(false);`:

```typescript
  const [linkMode, setLinkMode] = useState<'liveness' | 'advert'>('liveness');
  const [linkConfidence, setLinkConfidence] = useState<1 | 2 | 3>(2);
  const [advertEdges, setAdvertEdges] = useState<AdvertLinkEdge[]>([]);
```

Add a layer ref near `linksLayerRef`:

```typescript
  const advertLinksLayerRef = useRef<ReturnType<typeof createAdvertLinksLayer> | null>(null);
```

- [ ] **Step 3: Create and reattach the advert layer alongside the liveness layer**

Where `linksLayerRef.current = links;` is set during map init (around line 762), also create the advert layer from the same `map`:

```typescript
      advertLinksLayerRef.current = createAdvertLinksLayer(map);
```

Where `linksLayerRef.current?.reattach();` is called (around line 793), also add:

```typescript
      advertLinksLayerRef.current?.reattach();
```

- [ ] **Step 4: Fetch advert edges when in advert mode**

Add an effect (after the existing links ingest effect):

```typescript
  // Fetch resolved advert-truth edges while links are on in advert mode.
  useEffect(() => {
    if (!linksOn || linkMode !== 'advert') return;
    const controller = new AbortController();
    api
      .getAdvertLinks(controller.signal)
      .then(setAdvertEdges)
      .catch((err) => {
        if (!isAbortError(err)) console.error('Advert links fetch failed', err);
      });
    return () => controller.abort();
  }, [linksOn, linkMode]);
```

- [ ] **Step 5: Feed the advert layer with confidence-filtered edges and toggle layer visibility by mode**

Add an effect that filters by confidence and paints, and that shows exactly one layer based on mode:

```typescript
  // Paint advert edges (filtered by the confidence selector) and switch which
  // links layer is visible based on the mode.
  useEffect(() => {
    const liveness = linksLayerRef.current;
    const advert = advertLinksLayerRef.current;
    if (!linksOn) {
      liveness?.hide();
      advert?.hide();
      return;
    }
    if (linkMode === 'advert') {
      liveness?.hide();
      advert?.setData(advertEdges.filter((e) => e.hop_width >= linkConfidence));
      advert?.show();
    } else {
      advert?.hide();
      liveness?.show();
      refreshLinks();
    }
  }, [linksOn, linkMode, linkConfidence, advertEdges, refreshLinks]);
```

- [ ] **Step 6: Pass the new props to MapSurface and stop double-toggling visibility**

Update the `onToggleLinks` handler and add the new props on `<MapSurface>` (replace the existing `linksOn`/`onToggleLinks` block from ~line 1056):

```tsx
        linksOn={linksOn}
        onToggleLinks={(on) => setLinksOn(on)}
        linkMode={linkMode}
        onLinkMode={setLinkMode}
        linkConfidence={linkConfidence}
        onLinkConfidence={setLinkConfidence}
```

Visibility is now owned entirely by the effect in Step 5, so `onToggleLinks` only updates state. This removes the old direct `layer.show()/hide()` call, avoiding a double source of truth.

- [ ] **Step 7: Typecheck and run the frontend suite**

Run:
```bash
cd frontend && npm run build 2>&1 | tail -20
cd frontend && npm run test 2>&1 | tail -30
```
Expected: no type errors; all tests pass (existing + new).

---

## Task 9: Full verification (container + frontend + prettier + i18n + runtime)

- [ ] **Step 1: Backend suite in the container**

Run (from the worktree root):
```bash
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "/$(pwd)://work" -w "//work" \
  -e UV_PROJECT_ENVIRONMENT=/app/.venv \
  rtfm-ev-local:latest \
  bash -lc "uv sync --frozen --group dev && /app/.venv/bin/pytest tests/test_advert_links_resolver.py tests/test_advert_links_endpoint.py -v"
```
Expected: all new tests PASS. Then run the full backend suite the same way (drop the specific test paths) to confirm no regressions. Note: the memory records ~14 pre-existing Windows-only failures and charmap collection errors; those are environment issues, not regressions. Compare against a baseline run on `origin/main` if in doubt.

- [ ] **Step 2: Frontend suite + prettier + build**

Run:
```bash
cd frontend && npm run test 2>&1 | tail -20
cd frontend && npx prettier --check "src/**/*.{ts,tsx,json}" 2>&1 | tail -20
cd frontend && npm run build 2>&1 | tail -10
```
Expected: tests pass; prettier reports the changed files as formatted (fix any that are not with `npx prettier --write` on only the files this plan touched); build succeeds. Do not reformat pre-existing unrelated files.

- [ ] **Step 3: i18n parity**

Run the i18n parity test (the repo enforces EN/NL/DE key parity). Run:
```bash
cd frontend && npm run test -- i18n 2>&1 | tail -20
```
Expected: parity test passes, confirming the new keys exist in all three locales. If the parity test lives under a different name, run the full `npm run test` (Step 2 already does) and confirm no i18n parity failure.

- [ ] **Step 4: Runtime observation (required before claiming done)**

Rebuild the live instance on this branch and observe in the browser (per CLAUDE.md: runtime behavior must be observed, not reasoned about). See the memory note `local-docker-instance` for the rebuild/verify procedure for `rtfm-ev-local`. Confirm ALL of:

1. Open the map, open the Links panel, enable links, switch to Advert paths mode: edges render.
2. The confidence selector at 1b+ shows more edges than 3b; moving to 3b removes the thin/ambiguous ones.
3. Ambiguous edges render dashed; unique edges solid; wider hops render thicker.
4. Switching back to Liveness mode restores the original liveness layer unchanged.
5. `GET /api/packets/advert-links` returns a non-empty array on the live DB (check via the browser network tab or `curl`).

Record what was actually observed (screenshots or explicit description). If any check fails, treat it as a bug and debug before marking the task done.

---

## Self-review notes (author)

- Spec coverage: data source advert_events (Task 3/4), hop resolution incl. analyzer union (Task 3 `located_nodes`, Task 2 resolver), anchored nearest-to-previous walk (Task 2), full-chain scope incl. origin/self and direct edges (Task 2), backend endpoint returning resolved GPS edges with hop_width/count/last_seen/ambiguous (Task 4), mode switch (Task 7/8), cumulative confidence filter client-side (Task 8 Step 5), styling width=confidence + opacity=recency + dashed=ambiguous (Task 6), i18n EN/NL/DE (Task 7), verification incl. runtime (Task 9). No migration needed (Task 1 Step 4).
- Type consistency: `LocatedNode`/`AdvertPathRow`/`ResolvedEdge` defined in Task 2 and reused verbatim in Tasks 3-4; `AdvertLinkNode`/`AdvertLinkEdge` defined in Task 4 (backend) and Task 5 (frontend mirror); `buildAdvertArcs`/`widthForHop`/`createAdvertLinksLayer` defined in Task 6 and used in Task 8; `livenessOpacity` reused from `linksLayer.ts` (exported already).
- Open item resolved: default confidence = 2 (`2b+`), set in MapView state (Task 8) and MapControls default (Task 7).
