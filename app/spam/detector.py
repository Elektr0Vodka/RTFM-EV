"""Spam Guard detector (pure, no I/O, clock injected).

Channel messages go in through ``ingest``; ``decide`` turns what was seen into
expiring *blocks*. A block describes spam behaviour, never a person:

- ``text`` / ``words``: a text (or a set of words) sent under several names
- ``hop``: a repeater that spam enters the mesh through
- ``suffix``: an onward route that keeps receiving spam from never-seen first
  repeaters (one spammer changing their repeater's identity)
- ``links``: links from names the detector does not know, during a campaign
- ``lockdown``: for a while, only known names get through

The detector decides nothing about forwarding itself. ``app/spam/rules.py``
renders the blocks as policy rules for a backend; ``_block_matches`` here
mirrors those rules so hit counts, the held list and the chat flag do not
depend on which backend is active.

Reasons and activity entries are codes plus numbers, not sentences: the
frontend words them in the user's language.

Behaviour is modelled on openhop-spamguard (flackrat/openhop-spamguard); the
code is our own. One deliberate difference: there is no way to block a sender
by name.
"""

from __future__ import annotations

import hashlib
import re
import time
from collections import OrderedDict, deque
from collections.abc import Callable, Iterable, Sequence
from dataclasses import asdict, dataclass, field, fields
from typing import Any, Literal, cast, get_args

from app.spam.settings import (
    PERMANENT_SECONDS,
    HopMatch,
    SpamConfig,
    SpamTunables,
    effective,
    normalise_hop,
)
from app.spam.text import (
    hops_related,
    is_disguised,
    longest_piece,
    middle_piece,
    name_score,
    normalise,
    rule_length,
    shared_text,
    shared_words,
    shingles,
    similar,
    strip_emoji,
    strip_mentions,
)

BlockKind = Literal["text", "words", "hop", "suffix", "links", "lockdown"]
BlockSource = Literal["manual", "hop", "campaign", "dedupe", "rotation", "links", "lockdown"]

DIRECT = "DIRECT"
LOCKDOWN_KEY = "lockdown"
LINKS_KEY = "links:new"
LINK_MARKERS = ["http", "www."]

# An event is judged for learning (known people, routes, history) once it is
# this old, so a campaign it belongs to has had time to show.
SETTLE_SECONDS = 120.0
SUPPRESS_SECONDS = 86400
LINK_HOLD_SECONDS = 3600
MAX_LOCKDOWN_MINUTES = 24 * 60
SENDER_HISTORY_SECONDS = 86400
MAX_SENDER_HISTORY = 5000
MAX_KNOWN = 5000
MAX_ROUTES = 5000
MAX_CAMPAIGN_EVENTS = 400
MIN_CAMPAIGN_CHARS = 8
MAX_VARIANT_BLOCKS = 5
HISTORY_HOURS = 8 * 24
MAX_SOURCES = 15
MAX_FLAGGED = 5000

# Blocks that hold people back rather than a spam text. A normal-looking name
# caught by one of these is a likely mistake and goes on the held list.
_PEOPLE_KINDS = frozenset({"hop", "suffix", "links", "lockdown"})
# Evaluation order, mirrored by the rule renderer: manual first, and blocks that
# let known people through after everything else.
_RANK = {"manual": 0, "hop": 1, "campaign": 2, "dedupe": 3}
_GATED_RANK = 10
_HOP_MODES = frozenset(get_args(HopMatch))


@dataclass(slots=True)
class Event:
    """One channel message as the detector sees it."""

    ts: float
    path: tuple[str, ...]
    sender: str
    text: str
    channel: str
    length: int
    message_id: int | None
    first_hop: str
    norm: str
    shingles: frozenset[str]
    name_score: int
    disguised: bool
    random: bool = False
    exempt: bool = False
    matched: str | None = None
    # Caught in a way that marks the message itself as spam (see ``_match``).
    spam: bool = False
    campaign: int | None = None
    settled: bool = False


@dataclass
class Block:
    key: str
    kind: BlockKind
    # text: str; words / links / suffix: list[str]; hop: str; lockdown: None
    value: Any
    channel: str | None
    # Stable code for why the block exists, with its numbers in ``detail``.
    reason: str
    source: BlockSource
    created: float
    expires: float
    detail: dict[str, Any] = field(default_factory=dict)
    hits: int = 0
    last_hit: float | None = None
    # Count matches but leave the block out of the rendered rules.
    observe: bool = False
    # Hop blocks: how to match; None follows the ``hop_match_mode`` setting.
    match: HopMatch | None = None
    # Text blocks from duplicate suppression: the original sender may re-send.
    sender: str | None = None
    # Hop blocks in ``exact_paths`` mode: learnt full routes, and routes the
    # user said not to block.
    paths: list[str] = field(default_factory=list)
    ignored_paths: list[str] = field(default_factory=list)
    # Suffix blocks: first hops the user (or a trusted sender) let through.
    user_allowed: list[str] = field(default_factory=list)


@dataclass
class DecideResult:
    # The block set or the known-names list changed: rules must be re-rendered.
    changed: bool
    # Worth writing to disk straight away. Routine duplicate-suppression blocks
    # are not: losing them in a power cut is harmless, and there are many.
    important: bool
    # Message ids to flag as spam in chat. Each id is reported once.
    flag: set[int]


@dataclass
class _SenderHistory:
    first: float
    last: float
    count: int = 0
    hops: set[str] = field(default_factory=set)


@dataclass
class _Campaign:
    events: list[Event] = field(default_factory=list)
    senders: set[str] = field(default_factory=set)
    # At least two senders look made-up, disguised or brand new.
    suspect: bool = False
    # At least two senders look made-up or disguised.
    strong: bool = False
    # Enough senders, and suspect: its text gets blocked.
    confirmed: bool = False


@dataclass
class _HopSignals:
    random: set[str] = field(default_factory=set)
    new: set[str] = field(default_factory=set)
    campaign: set[str] = field(default_factory=set)
    random_long: set[str] = field(default_factory=set)


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:10]


def text_key(snippet: str) -> str:
    return f"text:{_digest(snippet)}"


def words_key(words: Sequence[str]) -> str:
    return f"words:{_digest('|'.join(words))}"


def _empty_hour() -> dict[str, Any]:
    return {
        "messages": 0,
        "stopped": 0,
        "let_through": 0,
        "held_genuine": 0,
        "airtime_ms": 0.0,
        # Spam (stopped or let through) per first hop, and when each was last seen.
        "hops": {},
        "last": {},
    }


class SpamDetector:
    def __init__(self, config: SpamConfig, *, clock: Callable[[], float] = time.time) -> None:
        self._clock = clock
        self.events: deque[Event] = deque()
        self.blocks: dict[str, Block] = {}
        self.suppressed: dict[str, float] = {}
        self.senders: dict[str, _SenderHistory] = {}
        # name -> [first seen, last seen, genuine messages]
        self.known: dict[str, list[float]] = {}
        # "27>B1>7E" -> [first seen, last seen, genuine messages, spam messages]
        self.routes: dict[str, list[float]] = {}
        # hop -> last time it was seen relaying (anywhere but first in a path)
        self.relays: dict[str, float] = {}
        # start of hour (epoch seconds) -> counters, see ``_empty_hour``
        self.hours: dict[int, dict[str, Any]] = {}
        self.held: deque[dict[str, Any]] = deque(maxlen=60)
        self.activity: deque[dict[str, Any]] = deque(maxlen=300)
        self.campaigns: dict[int, _Campaign] = {}
        self._flagged: OrderedDict[int, None] = OrderedDict()
        self._changed = False
        self._important = False
        # Similarity cache: each distinct text is compared with the others once.
        self._sim_threshold = 0.0
        self._sim_shingles: dict[str, frozenset[str]] = {}
        self._sim_links: dict[str, set[str]] = {}
        self.configure(config)

    # ── configuration ────────────────────────────────────────────────────

    def configure(self, config: SpamConfig) -> None:
        self.config = config
        self.tunables: SpamTunables = effective(config)
        self._patterns = [re.compile(p, re.IGNORECASE) for p in self.tunables.random_name_patterns]
        self.allow_hops: set[str] = set(config.allow_hops)
        self.allow_senders: set[str] = set(config.allow_senders)
        self.allow_texts: set[str] = set(config.allow_texts)

    def exceptions(self) -> dict[str, list[str]]:
        """The exception lists as changed by user actions, for the caller to store."""
        return {
            "allow_hops": sorted(self.allow_hops),
            "allow_senders": sorted(self.allow_senders),
            "allow_texts": sorted(self.allow_texts),
        }

    def hop_allowed(self, hop: str) -> bool:
        return any(hops_related(hop, allowed) for allowed in self.allow_hops)

    def _text_allowed(self, text: str) -> bool:
        low = text.casefold()
        return any(allowed.casefold() in low for allowed in self.allow_texts)

    def _mark(self, *, important: bool = True) -> None:
        self._changed = True
        self._important = self._important or important

    def _note(self, event: str, **info: Any) -> None:
        self.activity.appendleft({"ts": self._clock(), "event": event, **info})

    # ── known people ─────────────────────────────────────────────────────

    def is_known(self, name: str) -> bool:
        if name in self.allow_senders:
            return True
        entry = self.known.get(name)
        return entry is not None and entry[2] >= self.tunables.known_min_msgs

    def known_names(self) -> list[str]:
        """Names that pass the gated blocks, for the known-people rule."""
        return sorted({n for n in self.known if self.is_known(n)} | self.allow_senders)

    def _passing_through(self, event: Event) -> bool:
        """Held only because the route passes THROUGH a blocked repeater.

        Spam starts at the blocked repeater itself, so such a message still
        counts towards its sender becoming known.
        """
        block = self.blocks.get(event.matched) if event.matched else None
        return bool(
            block
            and block.kind == "hop"
            and self.gated(block)
            and event.path
            and event.path[0] != block.value
        )

    def _spammy(self, event: Event) -> bool:
        campaign = self.campaigns.get(event.campaign) if event.campaign is not None else None
        caught = event.matched is not None and not self._passing_through(event)
        return event.random or caught or bool(campaign and campaign.suspect)

    def _learn_sender(self, event: Event) -> None:
        if self._spammy(event) or event.sender in ("", "?"):
            return
        if any(
            b.kind == "hop" and event.path and event.path[0] == b.value
            for b in self.blocks.values()
        ):
            return
        was_known = self.is_known(event.sender)
        entry = self.known.get(event.sender)
        if entry is None:
            self.known[event.sender] = [event.ts, event.ts, 1]
        else:
            entry[1] = max(entry[1], event.ts)
            entry[2] += 1
        if not was_known and self.is_known(event.sender):
            self._mark()

    def _forget_old(self, now: float) -> None:
        horizon = now - self.tunables.known_days * 86400
        stale = [name for name, entry in self.known.items() if entry[1] < horizon]
        for name in stale:
            del self.known[name]
            self._mark()
        if len(self.known) > MAX_KNOWN:
            newest = sorted(self.known.items(), key=lambda kv: -kv[1][1])[:MAX_KNOWN]
            self.known = dict(newest)
            self._mark()
        route_horizon = now - self.tunables.route_memory_days * 86400
        if len(self.routes) > MAX_ROUTES or any(r[1] < route_horizon for r in self.routes.values()):
            kept = {k: r for k, r in self.routes.items() if r[1] >= route_horizon}
            self.routes = dict(sorted(kept.items(), key=lambda kv: -kv[1][1])[:MAX_ROUTES])
            self.relays = {h: ts for h, ts in self.relays.items() if ts >= route_horizon}
        sender_horizon = now - SENDER_HISTORY_SECONDS
        for name in [n for n, h in self.senders.items() if h.last < sender_horizon]:
            del self.senders[name]

    # ── block matching (mirrors the rendered rules) ──────────────────────

    def hop_mode(self, block: Block) -> HopMatch:
        return block.match or self.tunables.hop_match_mode

    def gated(self, block: Block) -> bool:
        """Blocks that let known people through.

        Rotation (``suffix``) blocks are gated too, unlike in openhop-spamguard:
        they hold back whoever arrives over a route, so they belong with the
        other blocks that hold people, and it keeps this matching identical to
        the rendered rules (see ``app/spam/rules.py``).
        """
        return block.kind in ("links", "lockdown", "suffix") or (
            block.kind == "hop" and self.hop_mode(block) == "contains_known"
        )

    def known_origin(self, hop: str) -> bool:
        """A repeater with a genuine history: it relays, or has started genuine messages."""
        if self.hop_allowed(hop) or hop in self.relays:
            return True
        prefix = f"{hop}>"
        genuine = sum(r[2] for k, r in self.routes.items() if k == hop or k.startswith(prefix))
        return genuine >= 2

    def allowed_origins(self, block: Block) -> set[str]:
        """First hops let through a suffix block: known ones that have sent genuine
        traffic along exactly this route, plus any the user allowed."""
        suffix = ">".join(block.value)
        allowed = set(block.user_allowed)
        for route, record in self.routes.items():
            first, _, rest = route.partition(">")
            if rest == suffix and record[2] > 0 and self.known_origin(first):
                allowed.add(first)
        return allowed

    def _block_matches(self, block: Block, event: Event) -> bool:
        if self.gated(block) and self.is_known(event.sender):
            return False
        if block.kind == "lockdown":
            return True
        if block.kind == "links":
            return any(marker in event.text for marker in block.value)
        if block.kind == "hop":
            mode = self.hop_mode(block)
            if mode == "exact_paths":
                return ">".join(event.path) in block.paths
            if mode == "starts_at":
                return bool(event.path) and event.path[0] == block.value
            return block.value in event.path
        if block.kind == "suffix":
            suffix = block.value
            return (
                len(event.path) == len(suffix) + 1
                and all(hop in event.path for hop in suffix)
                and event.first_hop not in self.allowed_origins(block)
            )
        if block.channel is not None and block.channel != event.channel:
            return False
        if block.sender and event.sender == block.sender:
            return False
        if block.kind == "words":
            return all(word in event.text for word in block.value)
        return block.value in event.text

    def ordered_blocks(self) -> list[Block]:
        """Blocks in the order they are evaluated (and rendered as rules)."""
        return sorted(
            self.blocks.values(),
            key=lambda b: (
                _GATED_RANK if self.gated(b) else _RANK.get(b.source, 2),
                -b.created,
            ),
        )

    def _match(self, event: Event) -> None:
        for block in self.ordered_blocks():
            if event.ts < block.created - 1 or not self._block_matches(block, event):
                continue
            event.matched = block.key
            block.hits += 1
            block.last_hit = event.ts
            if block.kind in ("text", "words"):
                event.spam = block.source in ("campaign", "manual")
            elif block.kind in ("hop", "suffix"):
                event.spam = event.random
            if block.kind in _PEOPLE_KINDS and not event.random:
                # A normal-looking name held back: the likely mistakes, for review.
                self.held.append(
                    {
                        "ts": event.ts,
                        "sender": event.sender,
                        "text": event.text[:160],
                        "channel": event.channel,
                        "path": list(event.path),
                        "matched": block.key,
                        "kind": block.kind,
                        "message_id": event.message_id,
                    }
                )
            return

    # ── ingest ───────────────────────────────────────────────────────────

    def ingest(
        self,
        *,
        ts: float,
        path: Sequence[str],
        sender: str,
        text: str,
        channel: str,
        length: int = 0,
        message_id: int | None = None,
    ) -> Event:
        now = self._clock()
        sender = sender or "?"
        hops = tuple(hop.upper() for hop in path)
        norm = normalise(text)
        score = name_score(sender, self._patterns)
        disguised = is_disguised(strip_mentions(text)) or is_disguised(sender, name=True)
        trusted = sender in self.allow_senders
        event = Event(
            ts=ts,
            path=hops,
            sender=sender,
            text=text,
            channel=channel.upper(),
            length=length,
            message_id=message_id,
            first_hop=hops[0] if hops else DIRECT,
            norm=norm,
            shingles=shingles(norm),
            name_score=score,
            disguised=disguised,
            random=not trusted and (score >= self.tunables.name_score_threshold or disguised),
            exempt=self._text_allowed(text),
        )

        history = self.senders.get(sender)
        if history is None:
            history = self.senders[sender] = _SenderHistory(first=ts, last=ts)
        if (
            trusted
            and history.hops
            and not any(hops_related(event.first_hop, hop) for hop in history.hops)
        ):
            # Names can be faked: worth a look when a trusted one turns up elsewhere.
            self._note("trusted_new_place", sender=sender, hop=event.first_hop)
        history.count += 1
        history.last = max(history.last, ts)
        history.hops.add(event.first_hop)
        if len(self.senders) > MAX_SENDER_HISTORY:
            oldest = min(self.senders, key=lambda name: self.senders[name].last)
            del self.senders[oldest]

        self._match(event)
        self.events.append(event)
        tun = self.tunables
        horizon = now - max(tun.long_window_seconds, tun.dedupe_seconds, tun.window_seconds) - 60
        while self.events and self.events[0].ts < horizon:
            self.events.popleft()
        return event

    # ── blocks ───────────────────────────────────────────────────────────

    def _add_block(
        self,
        key: str,
        kind: BlockKind,
        value: Any,
        reason: str,
        source: BlockSource,
        *,
        detail: dict[str, Any] | None = None,
        channel: str | None = None,
        ttl: float | None = None,
        from_ts: float | None = None,
        sender: str | None = None,
        match: HopMatch | None = None,
    ) -> bool:
        """Create the block, or renew it. True when it is new."""
        now = self._clock()
        expires = (from_ts if from_ts is not None else now) + (
            ttl if ttl is not None else self.tunables.block_ttl_seconds
        )
        if expires <= now:
            return False
        block = self.blocks.get(key)
        if block is None:
            self.blocks[key] = Block(
                key=key,
                kind=kind,
                value=value,
                channel=channel,
                reason=reason,
                source=source,
                created=now,
                expires=expires,
                detail=detail or {},
                sender=sender,
                match=match,
            )
            if source != "dedupe":  # routine, and there are many of them
                self._note("block_started", key=key, kind=kind, value=value, reason=reason)
            self._mark(important=source != "dedupe")
            return True
        if expires >= block.expires:
            block.expires = expires
            if block.source != "manual":
                block.reason = reason
                block.detail = detail or {}
            if source == "campaign" and block.source == "dedupe":
                # A duplicate that turns out to be a campaign: longer life, and
                # no "original sender" who may keep re-sending it.
                block.source = "campaign"
                block.sender = None
                self._mark()
        return False

    def _want(self, key: str, *args: Any, **kwargs: Any) -> None:
        """Add or renew an automatic block, unless the user removed it recently."""
        if self.suppressed.get(key, 0) > self._clock():
            return
        self._add_block(key, *args, **kwargs)

    def _drop_block(self, key: str) -> Block | None:
        block = self.blocks.pop(key, None)
        if block is not None:
            self._mark()
        return block

    # ── detection ────────────────────────────────────────────────────────

    def _suspect(self, event: Event) -> bool:
        if event.sender in self.allow_senders:
            return False
        if event.random:
            return True
        history = self.senders.get(event.sender)
        return history is None or history.count <= 2

    def _find_campaigns(self, events: list[Event]) -> dict[int, _Campaign]:
        """Group near-identical messages sent under different names."""
        groups: dict[str, list[Event]] = {}
        for event in events[-MAX_CAMPAIGN_EVENTS:]:
            if not event.exempt and len(event.norm) >= MIN_CAMPAIGN_CHARS:
                groups.setdefault(event.norm, []).append(event)

        threshold = self.tunables.similarity / 100.0
        if threshold != self._sim_threshold:
            self._sim_threshold = threshold
            self._sim_shingles.clear()
            self._sim_links.clear()
        known, links = self._sim_shingles, self._sim_links
        for norm in [n for n in known if n not in groups]:  # left the window
            del known[norm]
            for other in links.pop(norm, ()):
                links.get(other, set()).discard(norm)
        for norm, members in groups.items():
            if norm in known:
                continue
            mine = members[0].shingles
            for other, theirs in known.items():
                if similar(mine, theirs, threshold):
                    links.setdefault(norm, set()).add(other)
                    links.setdefault(other, set()).add(norm)
            known[norm] = mine

        index = {norm: i for i, norm in enumerate(groups)}
        parent = list(range(len(groups)))

        def root(i: int) -> int:
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i

        for norm, others in links.items():
            for other in others:
                if norm in index and other in index:
                    parent[root(index[norm])] = root(index[other])

        clusters: dict[int, _Campaign] = {}
        for norm, i in index.items():
            cluster = clusters.setdefault(root(i), _Campaign())
            for event in groups[norm]:
                cluster.events.append(event)
                cluster.senders.add(event.sender)

        campaigns: dict[int, _Campaign] = {}
        needed = self.tunables.text_distinct_senders
        for cid, cluster in clusters.items():
            if len(cluster.senders) < 2:
                continue
            cluster.events.sort(key=lambda e: e.ts)
            # Regulars saying the same thing ("evening all") is a conversation:
            # a campaign needs two senders that look made-up, disguised or new.
            suspects = {e.sender for e in cluster.events if self._suspect(e)}
            randoms = {e.sender for e in cluster.events if e.random}
            cluster.suspect = len(suspects) >= 2
            cluster.strong = len(randoms) >= 2
            cluster.confirmed = cluster.suspect and len(cluster.senders) >= needed
            for event in cluster.events:
                event.campaign = cid
            campaigns[cid] = cluster
        return campaigns

    @staticmethod
    def _one_piece(common: str | None, originals: Sequence[str], minimum: int) -> str | None:
        """Shared text was worked out with mentions removed; keep one unbroken
        piece that really is in every message, so a ``contains`` rule matches."""
        if not common:
            return None
        piece = longest_piece(common)
        if rule_length(piece) >= minimum and all(piece in text for text in originals):
            return piece
        return None

    def _shared(self, originals: Sequence[str]) -> tuple[str | None, list[str] | None]:
        """(shared text, shared words) worth a rule for these copies."""
        minimum = self.tunables.min_rule_chars
        stripped = [strip_mentions(text) for text in originals]
        common = self._one_piece(shared_text(stripped, minimum), originals, minimum)
        words = shared_words(stripped, minimum)
        if words and common and len(common) >= 0.6 * len(strip_emoji(stripped[-1])):
            words = None  # the shared text already covers the copies
        return common, words

    def _block_campaigns(self) -> None:
        tun = self.tunables
        for campaign in self.campaigns.values():
            if not campaign.confirmed:
                continue
            originals = list(dict.fromkeys(e.text for e in campaign.events))
            channel = campaign.events[-1].channel
            last = campaign.events[-1].ts
            ttl: float | None = None
            if campaign.strong and tun.spam_text_days:
                # Made-up names: remember the text, so it is stopped from its
                # first copy when the spammer brings it back days later.
                ttl = max(tun.spam_text_days * 86400, tun.block_ttl_seconds)
            detail = {"senders": len(campaign.senders)}
            common, words = self._shared(originals)
            if common:
                self._want(
                    text_key(common),
                    "text",
                    common,
                    "campaign",
                    "campaign",
                    detail=detail,
                    channel=channel,
                    from_ts=last,
                    ttl=ttl,
                )
            if words:
                self._want(
                    words_key(words),
                    "words",
                    words,
                    "campaign_changed",
                    "campaign",
                    detail=detail,
                    channel=channel,
                    from_ts=last,
                    ttl=ttl,
                )
            if not common and not words and campaign.strong:
                # Heavily varied copies share no usable text: block each variant.
                for original in originals[-MAX_VARIANT_BLOCKS:]:
                    piece = middle_piece(
                        longest_piece(strip_mentions(original)), tun.text_rule_chars
                    )
                    if rule_length(piece) >= tun.min_rule_chars:
                        self._want(
                            text_key(piece),
                            "text",
                            piece,
                            "campaign_variant",
                            "campaign",
                            detail=detail,
                            channel=channel,
                            from_ts=last,
                        )

    def _block_duplicates(self, recent: list[Event]) -> None:
        """The first copy of a message gets through; copies under other names do not."""
        tun = self.tunables
        usable = [e for e in recent if not e.exempt and e.sender not in self.allow_senders]

        # One message re-sent with small changes (same normalised form).
        variants: dict[str, list[Event]] = {}
        for event in usable:
            if len(event.norm) >= tun.dedupe_min_chars * 0.6:
                variants.setdefault(event.norm, []).append(event)
        for copies in variants.values():
            originals = sorted({e.text for e in copies})
            if len(originals) < 2:
                continue
            senders = {e.sender for e in copies}
            # One person editing their own message may keep doing so.
            only = next(iter(senders)) if len(senders) == 1 else None
            last = max(e.ts for e in copies)
            common, words = self._shared(originals)
            if common:
                self._want(
                    text_key(common),
                    "text",
                    common,
                    "resent_changed",
                    "dedupe",
                    channel=copies[0].channel,
                    ttl=tun.dedupe_seconds,
                    from_ts=last,
                    sender=only,
                )
            if words:
                self._want(
                    words_key(words),
                    "words",
                    words,
                    "resent_changed",
                    "dedupe",
                    channel=copies[0].channel,
                    ttl=tun.dedupe_seconds,
                    from_ts=last,
                    sender=only,
                )

        # Exact copies: block a piece from the middle for everyone but the
        # first sender. Oldest first, so the rule remembers who that was.
        first: dict[str, Event] = {}
        last_seen: dict[str, float] = {}
        for event in usable:
            content = longest_piece(strip_mentions(event.text))
            if len(content) < tun.dedupe_min_chars:
                continue
            piece = middle_piece(content, tun.text_rule_chars)
            if len(piece) < tun.min_rule_chars:
                continue
            first.setdefault(piece, event)
            last_seen[piece] = event.ts
        for piece, event in first.items():
            self._want(
                text_key(piece),
                "text",
                piece,
                "duplicate",
                "dedupe",
                channel=event.channel,
                ttl=tun.dedupe_seconds,
                from_ts=last_seen[piece],
                sender=event.sender,
            )

    def _block_repeaters(self, window: list[Event], long_window: list[Event], now: float) -> None:
        tun = self.tunables
        signals: dict[str, _HopSignals] = {}
        for event in long_window:
            if event.random:
                signals.setdefault(event.first_hop, _HopSignals()).random_long.add(event.sender)
        for event in window:
            hop = signals.setdefault(event.first_hop, _HopSignals())
            if event.random:
                hop.random.add(event.sender)
            history = self.senders.get(event.sender)
            if (
                history is not None
                and history.count <= 2
                and history.first >= now - tun.window_seconds
                and event.sender not in self.allow_senders
            ):
                hop.new.add(event.sender)
            campaign = self.campaigns.get(event.campaign) if event.campaign is not None else None
            if campaign and campaign.confirmed:
                hop.campaign.add(event.sender)

        for hop_hash, hop in signals.items():
            if hop_hash == DIRECT or self.hop_allowed(hop_hash):
                continue
            checks = (
                ("hop_random", len(hop.random), tun.hop_random_senders),
                ("hop_new", len(hop.new), tun.hop_new_senders),
                ("hop_campaign", len(hop.campaign), tun.hop_campaign_senders),
                ("hop_random_long", len(hop.random_long), tun.hop_random_senders_long),
            )
            met = [(code, count) for code, count, needed in checks if count >= needed]
            if met:
                self._want(
                    f"hop:{hop_hash}",
                    "hop",
                    hop_hash,
                    met[0][0],
                    "hop",
                    detail={"count": met[0][1], "signals": [code for code, _ in met]},
                    ttl=tun.hop_block_ttl_seconds,
                )

    def _learn_paths(self, events: Iterable[Event]) -> None:
        """``exact_paths`` mode: remember each full route that starts at a blocked repeater."""
        for event in events:
            if not event.path:
                continue
            block = self.blocks.get(f"hop:{event.first_hop}")
            if block is None or self.hop_mode(block) != "exact_paths":
                continue
            route = ">".join(event.path)
            if (
                route in block.paths
                or route in block.ignored_paths
                or len(block.paths) >= self.tunables.max_paths_per_hop
            ):
                continue
            block.paths.append(route)
            self._note("path_learnt", key=block.key, path=route)
            self._mark()

    def _settle(self, events: Iterable[Event], now: float) -> None:
        """Learn from events old enough for their campaigns to have shown."""
        for event in events:
            if event.settled or now - event.ts < SETTLE_SECONDS:
                continue
            event.settled = True
            self._count(event)
            self._learn_sender(event)
            if not event.path:
                continue
            for hop in event.path[1:]:
                self.relays[hop] = max(self.relays.get(hop, 0.0), event.ts)
            block = self.blocks.get(event.matched) if event.matched else None
            spam = (
                event.random
                or event.campaign is not None
                or (block is not None and block.source != "dedupe")
            )
            record = self.routes.setdefault(">".join(event.path), [event.ts, event.ts, 0, 0])
            record[1] = max(record[1], event.ts)
            record[3 if spam else 2] += 1

    def _block_rotation(self, window: list[Event]) -> None:
        """One spammer whose repeater keeps changing identity: never-seen first
        repeaters, always the same onward route."""
        tun = self.tunables
        candidates: dict[tuple[str, ...], tuple[set[str], set[str]]] = {}
        for event in window:
            if not event.path or self.known_origin(event.first_hop):
                continue
            if not (event.random or event.campaign is not None):
                continue
            origins, senders = candidates.setdefault(event.path[1:], (set(), set()))
            origins.add(event.first_hop)
            senders.add(event.sender)

        # Onward routes already tied to a blocked repeater need less evidence.
        linked = {
            tuple(path.split(">")[1:])
            for block in self.blocks.values()
            if block.kind == "hop"
            for path in block.paths
        }
        for suffix, (origins, senders) in candidates.items():
            needed = 2 if suffix in linked else tun.rotate_first_hops
            if len(origins) >= needed and len(senders) >= 2:
                self._want(
                    f"suffix:{'>'.join(suffix)}",
                    "suffix",
                    list(suffix),
                    "rotation_linked" if suffix in linked else "rotation",
                    "rotation",
                    detail={"origins": len(origins)},
                )

        # A trusted person heard on a blocked route: let their repeater through.
        for event in window:
            if event.sender not in self.allow_senders or not event.path:
                continue
            block = self.blocks.get(f"suffix:{'>'.join(event.path[1:])}")
            if block is not None and event.first_hop not in block.user_allowed:
                block.user_allowed.append(event.first_hop)
                self._note(
                    "origin_allowed", key=block.key, hop=event.first_hop, sender=event.sender
                )
                self._mark()

    def _hold_links(self, now: float) -> None:
        mode = self.tunables.hold_links
        current = self.blocks.get(LINKS_KEY)
        if current is not None and current.detail.get("mode") != mode:
            self._drop_block(LINKS_KEY)  # setting changed: start again under the new one
        if mode == "always":
            self._want(
                LINKS_KEY,
                "links",
                list(LINK_MARKERS),
                "links_always",
                "links",
                detail={"mode": mode},
                ttl=PERMANENT_SECONDS,
            )
        elif mode == "campaign":
            latest = max(
                (
                    max(b.created, b.last_hit or 0.0)
                    for b in self.blocks.values()
                    if b.source == "campaign" and b.kind in ("text", "words")
                ),
                default=0.0,
            )
            if latest > now - LINK_HOLD_SECONDS:
                self._want(
                    LINKS_KEY,
                    "links",
                    list(LINK_MARKERS),
                    "links_campaign",
                    "links",
                    detail={"mode": mode},
                    ttl=LINK_HOLD_SECONDS,
                    from_ts=latest,
                )

    def _collect_flags(self, events: Iterable[Event]) -> set[int]:
        flag: set[int] = set()
        for event in events:
            if event.message_id is None or event.message_id in self._flagged:
                continue
            campaign = self.campaigns.get(event.campaign) if event.campaign is not None else None
            in_campaign = bool(
                campaign and campaign.confirmed and event.sender not in self.allow_senders
            )
            if event.spam or in_campaign:
                flag.add(event.message_id)
                self._flagged[event.message_id] = None
        while len(self._flagged) > MAX_FLAGGED:
            self._flagged.popitem(last=False)
        return flag

    def decide(self, rematch: Event | None = None) -> DecideResult:
        """Turn what was seen into blocks.

        ``rematch`` is the message just ingested, for a backend that applies new
        rules before it judges that same message (the host repeater): if this
        call creates a block that catches it, it is counted as caught.
        """
        now = self._clock()
        tun = self.tunables
        window = [e for e in self.events if e.ts >= now - tun.window_seconds]
        long_window = [e for e in self.events if e.ts >= now - tun.long_window_seconds]

        for event in long_window:
            event.campaign = None
        self.campaigns = self._find_campaigns(long_window)

        if tun.enable_text_rules:
            self._block_campaigns()
        if tun.dedupe_enabled:
            self._block_duplicates([e for e in long_window if e.ts >= now - tun.dedupe_seconds])
        if tun.enable_hop_rules:
            self._block_repeaters(window, long_window, now)
        self._learn_paths(long_window)
        self._settle(long_window, now)
        if tun.enable_rotation_guard:
            self._block_rotation(window)
        self._hold_links(now)

        for key in [k for k, b in self.blocks.items() if b.expires <= now]:
            block = self.blocks.pop(key)
            if block.source != "dedupe":
                self._note("block_expired", key=key, kind=block.kind, hits=block.hits)
            self._mark(important=block.source != "dedupe")
        for key in [k for k, until in self.suppressed.items() if until <= now]:
            del self.suppressed[key]
        self._forget_old(now)
        if rematch is not None and rematch.matched is None:
            self._match(rematch)

        changed, self._changed = self._changed, False
        important, self._important = self._important, False
        return DecideResult(
            changed=changed, important=important, flag=self._collect_flags(long_window)
        )

    # ── history for the overview ─────────────────────────────────────────

    def _count(self, event: Event) -> None:
        hour = self.hours.setdefault(int(event.ts // 3600) * 3600, _empty_hour())
        hour["messages"] += 1
        block = self.blocks.get(event.matched) if event.matched else None
        campaign = self.campaigns.get(event.campaign) if event.campaign is not None else None
        spammy = event.random or bool(campaign and campaign.strong)
        if event.matched:
            if block is not None and block.kind in _PEOPLE_KINDS and not spammy:
                hour["held_genuine"] += 1
                return
            hour["stopped"] += 1
        elif spammy:
            hour["let_through"] += 1
        else:
            return
        hour["hops"][event.first_hop] = hour["hops"].get(event.first_hop, 0) + 1
        hour["last"][event.first_hop] = max(hour["last"].get(event.first_hop, 0.0), event.ts)
        if len(self.hours) > HISTORY_HOURS + 8:
            for stale in sorted(self.hours)[:-HISTORY_HOURS]:
                del self.hours[stale]

    def add_airtime(self, ts: float, airtime_ms: float) -> None:
        """Airtime not spent re-sending a stopped message (the caller knows the radio)."""
        hour = self.hours.setdefault(int(ts // 3600) * 3600, _empty_hour())
        hour["airtime_ms"] = round(hour["airtime_ms"] + airtime_ms, 1)

    def metrics(self) -> dict[str, Any]:
        now = self._clock()
        day_ago, week_ago = now - 86400, now - 7 * 86400
        counters = ("messages", "stopped", "let_through", "held_genuine", "airtime_ms")

        def total(since: float) -> dict[str, Any]:
            out: dict[str, Any] = dict.fromkeys(counters, 0)
            for start, hour in self.hours.items():
                if start >= since - 3600:
                    for name in counters:
                        out[name] += hour.get(name, 0)
            spam = out["stopped"] + out["let_through"]
            out["spam"] = spam
            out["stop_rate"] = round(100 * out["stopped"] / spam) if spam else None
            out["spam_share"] = round(100 * spam / out["messages"]) if out["messages"] else None
            return out

        def point(start: int, hours: Iterable[dict[str, Any]]) -> dict[str, int]:
            out = {"t": start, "messages": 0, "stopped": 0, "let_through": 0}
            for hour in hours:
                for name in ("messages", "stopped", "let_through"):
                    out[name] += hour.get(name, 0)
            return out

        this_hour = int(now // 3600) * 3600
        hourly = [
            point(start, [self.hours[start]] if start in self.hours else [])
            for start in range(this_hour - 23 * 3600, this_hour + 3600, 3600)
        ]
        local = time.localtime(now)
        midnight = int(time.mktime((local.tm_year, local.tm_mon, local.tm_mday, 0, 0, 0, 0, 0, -1)))
        daily = []
        for back in range(6, -1, -1):
            start = midnight - back * 86400
            daily.append(
                point(start, [h for s, h in self.hours.items() if start <= s < start + 86400])
            )

        by_hour = [0] * 24
        sources: dict[str, dict[str, Any]] = {}
        for start, hour in self.hours.items():
            if start < week_ago:
                continue
            # Hour of day in UTC: the server's time zone is not the viewer's, so
            # the frontend shifts this to local time.
            by_hour[time.gmtime(start).tm_hour] += hour["stopped"] + hour["let_through"]
            for hop, count in hour["hops"].items():
                source = sources.setdefault(hop, {"hop": hop, "d7": 0, "d1": 0, "last": 0})
                source["d7"] += count
                if start >= day_ago - 3600:
                    source["d1"] += count
                source["last"] = max(source["last"], hour["last"].get(hop, start))
        top = sorted(sources.values(), key=lambda s: (-s["d7"], -s["d1"]))[:MAX_SOURCES]
        for source in top:
            source["blocked"] = f"hop:{source['hop']}" in self.blocks
            source["allowed"] = source["hop"] != DIRECT and self.hop_allowed(source["hop"])
        return {
            "d1": total(day_ago),
            "d7": total(week_ago),
            "hourly": hourly,
            "daily": daily,
            "by_hour": by_hour,
            "sources": top,
            "since": min(self.hours, default=None),
        }

    # ── state ────────────────────────────────────────────────────────────

    def dump(self) -> dict[str, Any]:
        """Everything worth keeping across a restart, as plain JSON types."""
        return {
            "blocks": {key: asdict(block) for key, block in self.blocks.items()},
            "suppressed": dict(self.suppressed),
            "known": {name: list(entry) for name, entry in self.known.items()},
            "routes": {route: list(record) for route, record in self.routes.items()},
            "relays": dict(self.relays),
            "hours": {str(start): hour for start, hour in self.hours.items()},
            "held": list(self.held),
            "activity": list(self.activity),
            "senders": {
                name: [h.first, h.last, h.count]
                for name, h in list(self.senders.items())[-MAX_SENDER_HISTORY:]
            },
        }

    def load(self, state: dict[str, Any]) -> None:
        """Restore ``dump()`` output. Expired entries are dropped and anything
        with the wrong shape is ignored, so a damaged row cannot stop a start."""
        now = self._clock()

        def section(name: str) -> dict[str, Any]:
            value = state.get(name)
            return value if isinstance(value, dict) else {}

        def rows(name: str, length: int) -> dict[str, list[float]]:
            return {
                str(key): list(row)
                for key, row in section(name).items()
                if isinstance(row, list)
                and len(row) == length
                and all(isinstance(v, (int, float)) for v in row)
            }

        self.blocks = {}
        names = {f.name for f in fields(Block)}
        for key, raw in section("blocks").items():
            if not isinstance(raw, dict):
                continue
            try:
                block = Block(**{k: v for k, v in raw.items() if k in names})
            except TypeError:
                continue
            if isinstance(block.expires, (int, float)) and block.expires > now:
                self.blocks[str(key)] = block
        self.suppressed = {
            str(k): float(v)
            for k, v in section("suppressed").items()
            if isinstance(v, (int, float)) and v > now
        }
        self.known = rows("known", 3)
        self.routes = rows("routes", 4)
        self.relays = {
            str(k): float(v) for k, v in section("relays").items() if isinstance(v, (int, float))
        }
        self.hours = {}
        for start, hour in section("hours").items():
            if (
                isinstance(hour, dict)
                and str(start).isdigit()
                and isinstance(hour.get("hops"), dict)
                and isinstance(hour.get("last", {}), dict)
            ):
                self.hours[int(start)] = {**_empty_hour(), **hour}
        self.senders = {
            name: _SenderHistory(first=row[0], last=row[1], count=int(row[2]))
            for name, row in rows("senders", 3).items()
        }
        for name, target in (("held", self.held), ("activity", self.activity)):
            target.clear()
            items = state.get(name)
            if isinstance(items, list):
                target.extend(item for item in items if isinstance(item, dict))

    # ── user actions ─────────────────────────────────────────────────────

    def action(self, op: str, **body: Any) -> dict[str, Any]:
        """Run one user action. Raises ValueError for bad input or an unknown ``op``."""
        handler = getattr(self, f"_do_{op}", None) if op.isidentifier() else None
        if handler is None:
            raise ValueError("Unknown action")
        try:
            result = handler(**body)
        except TypeError as exc:
            raise ValueError(f"Bad arguments for {op}: {exc}") from exc
        self._mark()
        return result or {}

    def _existing(self, key: str, kind: BlockKind | None = None) -> Block:
        block = self.blocks.get(key)
        if block is None or (kind is not None and block.kind != kind):
            raise ValueError("That block no longer exists")
        return block

    def _do_unblock(self, key: str, suppress_seconds: int = SUPPRESS_SECONDS) -> dict[str, Any]:
        block = self.blocks.pop(key, None)
        if block is not None:
            self._note("block_removed", key=key, kind=block.kind)
        # Otherwise the same evidence would put it straight back.
        self.suppressed[key] = self._clock() + suppress_seconds
        return {"key": key}

    def _do_lockdown(self, minutes: int = 0) -> dict[str, Any]:
        if minutes > MAX_LOCKDOWN_MINUTES:
            raise ValueError("A lockdown can last at most 24 hours")
        ended = self.blocks.pop(LOCKDOWN_KEY, None)
        if minutes <= 0:
            if ended is not None:
                self._note("lockdown_ended")
            return {"active": False}
        self.suppressed.pop(LOCKDOWN_KEY, None)
        self._add_block(
            LOCKDOWN_KEY,
            "lockdown",
            None,
            "lockdown",
            "lockdown",
            detail={"minutes": minutes},
            ttl=minutes * 60,
        )
        return {"active": True, "known": len(self.known_names())}

    def _do_block_hop(
        self, hop: str, ttl_seconds: int | None = None, match: str | None = None
    ) -> dict[str, Any]:
        hop_hash = normalise_hop(hop)
        if match is not None and match not in _HOP_MODES:
            raise ValueError("Unknown matching mode")
        key = f"hop:{hop_hash}"
        self.suppressed.pop(key, None)
        self.allow_hops = {a for a in self.allow_hops if not hops_related(a, hop_hash)}
        self.blocks.pop(key, None)
        self._add_block(
            key,
            "hop",
            hop_hash,
            "manual",
            "manual",
            ttl=ttl_seconds,
            match=cast("HopMatch | None", match),
        )
        self._learn_paths(self.events)
        return {"key": key}

    def _manual_text(self, text: str, channel: str, reason: str, ttl: int | None) -> dict[str, Any]:
        if len(text) < 5:
            raise ValueError("The text must be at least 5 characters")
        key = text_key(text)
        self.suppressed.pop(key, None)
        self.blocks.pop(key, None)
        self._add_block(key, "text", text, reason, "manual", channel=channel.upper(), ttl=ttl)
        return {"key": key, "text": text}

    def _do_block_text(
        self, text: str, channel: str, ttl_seconds: int | None = None
    ) -> dict[str, Any]:
        return self._manual_text(text.strip(), channel, "manual", ttl_seconds)

    def _do_mark_spam(
        self, text: str, channel: str, ttl_seconds: int | None = None
    ) -> dict[str, Any]:
        piece = middle_piece(text.strip(), self.tunables.text_rule_chars)
        return self._manual_text(piece, channel, "marked_spam", ttl_seconds)

    def _do_not_spam(self, sender: str = "", matched: str | None = None) -> dict[str, Any]:
        if sender:
            self.allow_senders.add(sender)
        block = self.blocks.get(matched) if matched else None
        removed = False
        if matched and block is not None and block.kind in ("text", "words"):
            del self.blocks[matched]
            self.suppressed[matched] = self._clock() + SUPPRESS_SECONDS
            removed = True
        self._note("not_spam", sender=sender, key=matched)
        return {"sender": sender, "removed": removed, "kind": block.kind if block else None}

    def _do_extend(self, key: str, seconds: int = 3600, permanent: bool = False) -> dict[str, Any]:
        block = self._existing(key)
        now = self._clock()
        if permanent:
            block.expires = now + PERMANENT_SECONDS
        else:
            block.expires = max(block.expires, now) + seconds
        if block.source == "dedupe":
            block.source = "manual"
        return {"key": key, "expires": block.expires}

    def _do_block_action(self, key: str, observe: bool) -> None:
        self._existing(key).observe = bool(observe)

    def _do_hop_mode(self, key: str, match: str | None = None) -> None:
        block = self._existing(key, "hop")
        if match is not None and match not in _HOP_MODES:
            raise ValueError("Unknown matching mode")
        block.match = cast("HopMatch | None", match)
        self._learn_paths(self.events)

    def _do_forget_path(self, key: str, path: str) -> None:
        block = self._existing(key, "hop")
        if path in block.paths:
            block.paths.remove(path)
            block.ignored_paths.append(path)

    def _do_allow_origin(self, key: str, hop: str) -> None:
        block = self._existing(key, "suffix")
        hop_hash = normalise_hop(hop)
        if hop_hash not in block.user_allowed:
            block.user_allowed.append(hop_hash)

    def _do_unallow_origin(self, key: str, hop: str) -> None:
        block = self._existing(key, "suffix")
        hop_hash = normalise_hop(hop)
        if hop_hash in block.user_allowed:
            block.user_allowed.remove(hop_hash)

    def _do_allow_hop(self, hop: str) -> None:
        hop_hash = normalise_hop(hop)
        self.allow_hops.add(hop_hash)
        for key in [
            k for k, b in self.blocks.items() if b.kind == "hop" and hops_related(b.value, hop_hash)
        ]:
            del self.blocks[key]

    def _do_unallow_hop(self, hop: str) -> None:
        self.allow_hops.discard(hop.strip().upper())

    def _do_allow_sender(self, sender: str) -> None:
        if not sender.strip():
            raise ValueError("Enter a name")
        self.allow_senders.add(sender)

    def _do_unallow_sender(self, sender: str) -> None:
        self.allow_senders.discard(sender)

    def _do_allow_text(self, text: str) -> None:
        text = text.strip()
        if len(text) < 3:
            raise ValueError("Enter at least 3 characters")
        self.allow_texts.add(text)
        low = text.casefold()
        for key in [
            k for k, b in self.blocks.items() if b.kind == "text" and low in b.value.casefold()
        ]:
            del self.blocks[key]

    def _do_unallow_text(self, text: str) -> None:
        self.allow_texts.discard(text.strip())

    def _do_clear_auto(self) -> None:
        self.blocks = {k: b for k, b in self.blocks.items() if b.source == "manual"}
        self._note("cleared_auto")

    def _do_clear_suppressed(self) -> None:
        self.suppressed.clear()
