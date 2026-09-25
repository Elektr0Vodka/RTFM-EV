"""Host repeater runtime: settings, shadow mode and statistics (plan 29, Phases 1-4).

Shadow mode runs every received frame through ``ForwardingEngine`` and records
what a repeater would have done ("would forward" / "would drop"), how long the
host pipeline took, and how much airtime the forwards would have used. It never
transmits: this module has no reference to the radio or its send path (radio facts
arrive as a ``RadioSnapshot`` argument), and a test enforces the import boundary.

Shadow mode is opt-in (``shadow_enabled``) and runs whenever the repeater is not
armed. Armed mode lives in ``host_repeater_tx`` and attaches itself as a ``ForwardSink``.

Score-based receive delay (Phase 4, the repeater's ``rxdelay``): a weak flood is held
back before it is judged, so a copy relayed by a neighbour with better reception is
judged first and the held copy becomes a duplicate, like the firmware's delayed
inbound queue.

Session statistics are in memory and reset on restart or via the API. Lifetime
totals (``LifetimeStats``) accumulate across restarts in ``host_repeater_stats``
(migration ``_114``): flushed at most once a minute from the RX path, at shutdown and
on reset.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import time
from collections import Counter, OrderedDict, deque
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Protocol

from pydantic import ValidationError

from app.config import settings as server_config
from app.decoder import derive_shared_secret
from app.keystore import get_private_key
from app.path_utils import parse_packet_envelope
from app.repository.host_repeater import (
    HostRepeaterConfigRepository,
    HostRepeaterContactsRepository,
    HostRepeaterStatsRepository,
)
from app.services import dm_ack_tracker
from app.services.host_repeater_engine import (
    PEER_TYPES,
    PT_ACK,
    PT_ANON_REQ,
    PT_GRP_DATA,
    PT_GRP_TXT,
    PT_TXT_MSG,
    ROUTE_DIRECT,
    ROUTE_TRANSPORT_DIRECT,
    Decision,
    ForwardingEngine,
    RxFacts,
    lora_airtime_ms,
)
from app.services.host_repeater_settings import HostRepeaterSettings, sub_band_duty_limit
from app.websocket import broadcast_event

if TYPE_CHECKING:
    from app.services.host_repeater_link import RadioSnapshot

logger = logging.getLogger(__name__)

RECENT_DECISIONS = 200
LATENCY_SAMPLES = 5000
ECHO_TRACK_MAX = 2000
ECHO_TRACK_SECONDS = 60.0
CONTACT_CACHE_SECONDS = 60.0
HOUR_SECONDS = 3600.0
LIFETIME_FLUSH_SECONDS = 60.0


@dataclass(frozen=True)
class PreFacts:
    """Facts that must be read before the packet processor consumes them."""

    ack_expected: bool = False


class ForwardSink(Protocol):
    """What the runtime needs from the armed-mode sender (``host_repeater_tx``).

    Declared here as a protocol so this module never imports the module that can
    transmit; the sender attaches itself at import time.
    """

    armed: bool
    armed_since: float | None
    disarm_reason: str | None

    @property
    def rearm_pending(self) -> bool: ...

    def enqueue(self, decision: Decision, arrival: float, *, now: float | None = None) -> None: ...

    def disarm(self, reason: str, *, rearm_when_reconnected: bool = False) -> None: ...

    def on_stats_sample(self, own_tx_last_hour_ms: float, freq_mhz: float | None) -> None: ...

    def reset_stats(self) -> None: ...

    def snapshot(self, now: float | None = None) -> dict[str, Any]: ...


@dataclass
class _EchoEntry:
    arrival: float
    hop_count: int
    would_forward: bool
    our_tx_at: float | None
    gap_recorded: bool = False


def _percentiles(values: deque[float] | list[float]) -> dict[str, float | int | None]:
    data = sorted(values)
    if not data:
        return {"count": 0, "p50": None, "p95": None, "p99": None, "max": None}

    def pick(q: float) -> float:
        return round(data[min(len(data) - 1, int(q * (len(data) - 1) + 0.5))], 1)

    return {
        "count": len(data),
        "p50": pick(0.50),
        "p95": pick(0.95),
        "p99": pick(0.99),
        "max": round(data[-1], 1),
    }


class ShadowStats:
    """In-memory shadow-mode statistics."""

    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self.since = time.time()
        self.observed = 0
        self.would_forward = 0
        self.would_drop = 0
        self.by_reason: Counter[str] = Counter()
        self.by_type: dict[str, Counter[str]] = {}
        self.policy_matches: Counter[str] = Counter()
        self.latency_ms: deque[float] = deque(maxlen=LATENCY_SAMPLES)
        self.delay_ms: deque[float] = deque(maxlen=LATENCY_SAMPLES)
        self.lock_busy = 0
        self.forward_airtime_total_ms = 0.0
        self.forward_airtime: deque[tuple[float, float]] = deque()
        self.echo_gap_ms: deque[float] = deque(maxlen=LATENCY_SAMPLES)
        self.echo_before_our_tx = 0
        self.echo_after_our_tx = 0
        self.rx_model_airtime_ms = 0.0
        self.pushes = 0
        # Stats-sampler deltas (60 s radio stats), only while shadow runs.
        self.sample_pushes = 0
        self.sample_model_rx_ms = 0.0
        self.radio_recv_delta = 0
        self.radio_rx_air_ms = 0.0
        self.radio_tx_air: deque[tuple[float, float]] = deque()
        self.stats_samples = 0
        # Score-based receive delay: frames held back, their delays, and how many of
        # them a neighbour's relay overtook (judged as duplicate after the hold).
        self.rx_delayed = 0
        self.rx_delay_ms: deque[float] = deque(maxlen=LATENCY_SAMPLES)
        self.rx_delay_yielded = 0
        self.recent: deque[dict[str, Any]] = deque(maxlen=RECENT_DECISIONS)

    def forward_airtime_last(self, seconds: float, now: float) -> float:
        while self.forward_airtime and now - self.forward_airtime[0][0] > HOUR_SECONDS:
            self.forward_airtime.popleft()
        return sum(ms for ts, ms in self.forward_airtime if now - ts <= seconds)


class LifetimeStats:
    """Decision totals that survive restarts (persisted as one JSON row)."""

    FIELDS = (
        "observed",
        "would_forward",
        "would_drop",
        "forward_airtime_total_ms",
        "rx_delayed",
        "rx_delay_yielded",
    )

    def __init__(self, since: float | None = None, runs: int = 1) -> None:
        self.since = int(since if since is not None else time.time())
        self.runs = runs
        self.observed = 0
        self.would_forward = 0
        self.would_drop = 0
        self.forward_airtime_total_ms = 0.0
        self.rx_delayed = 0
        self.rx_delay_yielded = 0
        self.by_reason: Counter[str] = Counter()
        self.by_type: dict[str, Counter[str]] = {}
        self.policy_matches: Counter[str] = Counter()

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> LifetimeStats:
        out = cls(row.get("since"), int(row.get("runs") or 1))
        data = row.get("stats") or {}
        for name in cls.FIELDS:
            value = data.get(name, 0)
            if isinstance(value, (int, float)):
                setattr(out, name, value)
        out.by_reason = Counter({str(k): int(v) for k, v in (data.get("by_reason") or {}).items()})
        out.by_type = {
            str(k): Counter({str(a): int(b) for a, b in v.items()})
            for k, v in (data.get("by_type") or {}).items()
            if isinstance(v, dict)
        }
        out.policy_matches = Counter(
            {str(k): int(v) for k, v in (data.get("policy_matches") or {}).items()}
        )
        return out

    def to_dict(self) -> dict[str, Any]:
        return {
            "observed": self.observed,
            "would_forward": self.would_forward,
            "would_drop": self.would_drop,
            "forward_airtime_total_ms": round(self.forward_airtime_total_ms, 1),
            "rx_delayed": self.rx_delayed,
            "rx_delay_yielded": self.rx_delay_yielded,
            "by_reason": dict(self.by_reason),
            "by_type": {k: dict(v) for k, v in self.by_type.items()},
            "policy_matches": dict(self.policy_matches),
        }


class HostRepeaterRuntime:
    def __init__(self) -> None:
        self.settings = HostRepeaterSettings()
        self.version = 0
        self.loaded = False
        self.engine = ForwardingEngine(self.settings, None, None)
        self.stats = ShadowStats()
        self._echo: OrderedDict[str, _EchoEntry] = OrderedDict()
        self._contacts_at = 0.0
        self._contacts_by_byte: dict[int, list[bytes]] = {}
        self._favorite_bytes: frozenset[int] = frozenset()
        self._contact_bytes: frozenset[int] = frozenset()
        self._secrets: OrderedDict[bytes, bytes] = OrderedDict()
        self._last_radio_counters: tuple[int, int, int] | None = None
        self._pushes_at_last_sample = 0
        self._model_rx_at_last_sample = 0.0
        self._lock = asyncio.Lock()
        # Lifetime totals (persisted); loaded with the settings, flushed when dirty.
        self.lifetime = LifetimeStats()
        self._lifetime_loaded = False
        self._lifetime_dirty = False
        self._lifetime_saved_at = 0.0
        # Frames held back by the score-based receive delay (one task each).
        self._held: set[asyncio.Task[None]] = set()
        # Armed-mode sender (``host_repeater_tx``), attached by that module at import.
        # Kept as an opaque attribute: this module must not import the send path.
        self._tx: ForwardSink | None = None

    # ── settings ─────────────────────────────────────────────────────────

    @property
    def env_enabled(self) -> bool:
        return bool(server_config.host_repeater_enabled)

    def attach_tx(self, tx: ForwardSink) -> None:
        self._tx = tx

    @property
    def armed(self) -> bool:
        return self._tx is not None and bool(self._tx.armed)

    @property
    def shadow_active(self) -> bool:
        # The engine judges every frame while shadow is enabled or the repeater is armed.
        return self.settings.shadow_enabled or self.armed

    @property
    def state(self) -> str:
        if self.armed:
            return "armed"
        return "shadow" if self.shadow_active else "off"

    async def load(self) -> None:
        stored = await HostRepeaterConfigRepository.get()
        if stored is None:
            self.version, self.settings = 0, HostRepeaterSettings()
        else:
            version, data = stored
            try:
                parsed = HostRepeaterSettings.model_validate(data)
            except ValidationError:
                logger.warning("Stored host repeater settings are invalid; using defaults")
                parsed = HostRepeaterSettings()
            self.version, self.settings = version, parsed
        self.engine.configure(settings=self.settings)
        self.loaded = True
        await self._load_lifetime()

    async def _load_lifetime(self) -> None:
        """Continue the persisted lifetime totals and count this server run."""
        if self._lifetime_loaded:
            return
        try:
            row = await HostRepeaterStatsRepository.get()
            if row is None:
                self.lifetime = LifetimeStats()
            else:
                self.lifetime = LifetimeStats.from_row(row)
                self.lifetime.runs += 1
            self._lifetime_loaded = True
            self._lifetime_dirty = True
            await self.flush_lifetime(force=True)
        except Exception:
            logger.warning("Could not load host repeater lifetime stats", exc_info=True)

    async def flush_lifetime(self, *, force: bool = False) -> bool:
        """Write the lifetime totals when they changed (at most once a minute unless forced)."""
        if not self._lifetime_dirty or not self._lifetime_loaded:
            return False
        now = time.monotonic()
        if not force and now - self._lifetime_saved_at < LIFETIME_FLUSH_SECONDS:
            return False
        try:
            lt = self.lifetime
            await HostRepeaterStatsRepository.save(lt.since, lt.runs, lt.to_dict())
        except Exception:
            logger.debug("Host repeater lifetime stats flush failed", exc_info=True)
            self._lifetime_saved_at = now  # retry after the interval, not on every frame
            return False
        self._lifetime_dirty = False
        self._lifetime_saved_at = now
        return True

    async def reset_lifetime(self) -> None:
        """Start the lifetime totals over (session stats are reset too)."""
        self.reset_stats()
        self.lifetime = LifetimeStats()
        self._lifetime_loaded = True
        self._lifetime_dirty = True
        await self.flush_lifetime(force=True)

    async def stop(self) -> None:
        """Process shutdown: drop held frames and write the lifetime totals."""
        for task in list(self._held):
            task.cancel()
        for task in list(self._held):
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        self._held.clear()
        await self.flush_lifetime(force=True)

    async def ensure_loaded(self) -> None:
        if not self.loaded:
            await self.load()

    async def save(self, expected_version: int, new_settings: HostRepeaterSettings) -> int | None:
        """Persist settings if ``expected_version`` is current; None on a version conflict."""
        async with self._lock:
            await self.ensure_loaded()
            was_active = self.shadow_active
            version = await HostRepeaterConfigRepository.save(
                expected_version, new_settings.model_dump(mode="json", by_alias=True)
            )
            if version is None:
                return None
            self.version, self.settings = version, new_settings
            self.engine.configure(settings=new_settings)
            if self._tx is not None and self._tx.armed and not new_settings.admin_enabled:
                # The admin half of the server switch was turned off: stop forwarding.
                self._tx.disarm("user")
            if self.shadow_active and not was_active:
                self.engine.reset_state()
                self.reset_stats()
        self.broadcast()
        return version

    def public_state(self) -> dict[str, Any]:
        tx = self._tx
        return {
            "state": self.state,
            "env_enabled": self.env_enabled,
            "armed_since": tx.armed_since if tx is not None else None,
            "disarm_reason": tx.disarm_reason if tx is not None else None,
            "rearm_pending": bool(tx.rearm_pending) if tx is not None else False,
        }

    def broadcast(self) -> None:
        try:
            broadcast_event(
                "host_repeater",
                {
                    "version": self.version,
                    "settings": self.settings.model_dump(mode="json", by_alias=True),
                    **self.public_state(),
                },
            )
        except RuntimeError:
            # No running event loop (sync test context); nothing to notify.
            pass

    # ── RX observation ───────────────────────────────────────────────────

    def pre_observe(self, raw: bytes) -> PreFacts | None:
        """Read state the packet processor is about to consume (pending ACK codes)."""
        if not self.shadow_active:
            return None
        env = parse_packet_envelope(raw)
        if env is None or env.payload_type != PT_ACK or len(env.payload) < 4:
            return PreFacts()
        return PreFacts(ack_expected=dm_ack_tracker.is_ack_expected(env.payload[:4].hex()))

    async def observe(
        self,
        raw: bytes,
        *,
        snr: float | None,
        rssi: int | None,
        arrival: float,
        result: dict | None,
        pre: PreFacts | None,
        radio: RadioSnapshot,
    ) -> Decision | None:
        """Judge one received frame in shadow mode. Never raises, never transmits.

        With ``rx_delay_base`` set, a weak flood is held back (returns None now) and
        judged after its score-based delay by a background task.
        """
        if not self.shadow_active or radio.is_openhop:
            # OpenHop repeats internally; the host repeater is disabled for it.
            return None
        try:
            self.engine.configure(public_key=radio.public_key, radio=radio.radio)
            hold_ms = self.engine.rx_delay_ms(raw, snr)
            if hold_ms > 0:
                self._hold(raw, snr, rssi, arrival, result or {}, pre or PreFacts(), radio, hold_ms)
                return None
            return await self._observe(
                raw, snr, rssi, arrival, result or {}, pre or PreFacts(), radio
            )
        except Exception:
            logger.exception("Host repeater shadow observation failed")
            return None

    def _hold(
        self,
        raw: bytes,
        snr: float | None,
        rssi: int | None,
        arrival: float,
        result: dict,
        pre: PreFacts,
        radio: RadioSnapshot,
        hold_ms: float,
    ) -> None:
        """Firmware ``queueInbound``: judge the frame once its receive delay has passed."""

        async def judge_later() -> None:
            await asyncio.sleep(hold_ms / 1000.0)
            if not self.shadow_active:
                return
            try:
                # The retransmit window starts when the firmware would have processed it.
                await self._observe(
                    raw, snr, rssi, arrival + hold_ms / 1000.0, result, pre, radio, hold_ms
                )
            except Exception:
                logger.exception("Host repeater delayed observation failed")

        task = asyncio.get_running_loop().create_task(judge_later(), name="host_repeater_hold")
        self._held.add(task)
        task.add_done_callback(self._held.discard)

    async def _observe(
        self,
        raw: bytes,
        snr: float | None,
        rssi: int | None,
        arrival: float,
        result: dict,
        pre: PreFacts,
        radio: RadioSnapshot,
        rx_delay_ms: float = 0.0,
    ) -> Decision | None:
        env = parse_packet_envelope(raw)
        self.engine.configure(public_key=radio.public_key, radio=radio.radio)
        await self._refresh_contacts()

        facts = RxFacts(
            snr=snr,
            rssi=rssi,
            for_us=False,
            own_origin=False,
            region=result.get("region"),
            acl_hashes=self._acl_bytes(),
        )
        if env is not None:
            for_us, own = self._for_us_or_own(env, radio, result, pre)
            is_channel = env.payload_type in (PT_GRP_TXT, PT_GRP_DATA)
            decrypted = bool(result.get("decrypted")) and is_channel
            facts = RxFacts(
                snr=snr,
                rssi=rssi,
                for_us=for_us,
                own_origin=own,
                region=result.get("region"),
                acl_hashes=facts.acl_hashes,
                channel_decryptable=decrypted,
                channel_sender=result.get("sender") if decrypted else None,
                channel_message_body=result.get("message") if decrypted else None,
            )

        now = time.monotonic()
        decision = self.engine.decide(raw, facts, now, wall_now=time.time())
        latency_ms = max(0.0, (now - arrival) * 1000.0)
        if decision.forward and latency_ms > self.settings.max_forward_latency_ms:
            decision = Decision(
                False,
                "too_late",
                decision.packet_hash,
                decision.payload_type,
                decision.route_type,
                decision.hop_count,
                decision.rx_len,
                policy_action=decision.policy_action,
                policy_rule_id=decision.policy_rule_id,
                score=decision.score,
            )
        self._record(decision, env, raw, radio, arrival, now, latency_ms, rx_delay_ms)
        if decision.forward and self._tx is not None and self._tx.armed:
            # Armed: the sender holds the job until its delay has passed, then transmits.
            self._tx.enqueue(decision, arrival, now=now)
        await self.flush_lifetime()
        return decision

    def _acl_bytes(self) -> frozenset[int]:
        mode = self.settings.filter_acl_bypass
        if mode == "favorites":
            return self._favorite_bytes
        if mode == "contacts":
            return self._contact_bytes
        return frozenset()

    async def _refresh_contacts(self) -> None:
        now = time.monotonic()
        if now - self._contacts_at < CONTACT_CACHE_SECONDS and self._contacts_at:
            return
        self._contacts_at = now
        try:
            rows = await HostRepeaterContactsRepository.full_keys()
        except Exception:
            logger.debug("Host repeater contact refresh failed", exc_info=True)
            return
        by_byte: dict[int, list[bytes]] = {}
        favorites: set[int] = set()
        for key_hex, favorite in rows:
            try:
                key = bytes.fromhex(key_hex)
            except ValueError:
                continue
            by_byte.setdefault(key[0], []).append(key)
            if favorite:
                favorites.add(key[0])
        self._contacts_by_byte = by_byte
        self._contact_bytes = frozenset(by_byte)
        self._favorite_bytes = frozenset(favorites)

    def _shared_secret(self, private_key: bytes, their_key: bytes) -> bytes | None:
        cached = self._secrets.get(their_key)
        if cached is not None:
            self._secrets.move_to_end(their_key)
            return cached
        try:
            secret = derive_shared_secret(private_key, their_key)
        except Exception:
            return None
        self._secrets[their_key] = secret
        while len(self._secrets) > 512:
            self._secrets.popitem(last=False)
        return secret

    @staticmethod
    def _mac_ok(secret: bytes, mac: bytes, ciphertext: bytes) -> bool:
        return bool(ciphertext) and hmac.new(secret, ciphertext, hashlib.sha256).digest()[:2] == mac

    def _for_us_or_own(
        self, env, radio: RadioSnapshot, result: dict, pre: PreFacts
    ) -> tuple[bool, bool]:
        """Host equivalents of the firmware's "for us" and "our own" knowledge.

        for_us: the firmware marks a packet do-not-retransmit after decrypting it
        with a contact's secret (PATH/REQ/RESPONSE/TXT_MSG), after decrypting an
        ANON_REQ with our key, and for an ACK it waits for. The host repeats the
        MAC check with the same keys, which is what the firmware's decrypt checks.
        own: echoes of what we sent (the firmware has them in its seen table).
        """
        our_key = radio.public_key
        if our_key is None or env.route_type in (ROUTE_DIRECT, ROUTE_TRANSPORT_DIRECT):
            return False, False
        payload = env.payload
        ptype = env.payload_type
        private_key = get_private_key()

        if ptype == PT_ACK:
            return pre.ack_expected, False

        if ptype in PEER_TYPES and len(payload) > 4:
            dest, src = payload[0], payload[1]
            if (
                ptype == PT_TXT_MSG
                and result.get("decrypted")
                and result.get("contact_key")
                and dest == our_key[0]
            ):
                return True, False
            if private_key is None:
                return False, False
            mac, ciphertext = payload[2:4], payload[4:]
            if dest == our_key[0]:
                for key in self._contacts_by_byte.get(src, []):
                    secret = self._shared_secret(private_key, key)
                    if secret and self._mac_ok(secret, mac, ciphertext):
                        return True, False
            if src == our_key[0]:
                for key in self._contacts_by_byte.get(dest, []):
                    secret = self._shared_secret(private_key, key)
                    if secret and self._mac_ok(secret, mac, ciphertext):
                        return False, True
            return False, False

        if ptype == PT_ANON_REQ and len(payload) > 35:
            sender = payload[1:33]
            if sender == our_key[:32]:
                return False, True
            if payload[0] == our_key[0] and private_key is not None:
                secret = self._shared_secret(private_key, sender)
                if secret and self._mac_ok(secret, payload[33:35], payload[35:]):
                    return True, False
            return False, False

        if (
            ptype == PT_GRP_TXT
            and result.get("decrypted")
            and radio.name
            and result.get("sender") == radio.name
        ):
            return False, True
        return False, False

    def _record(
        self,
        decision: Decision,
        env,
        raw: bytes,
        radio: RadioSnapshot,
        arrival: float,
        now: float,
        latency_ms: float,
        rx_delay_ms: float = 0.0,
    ) -> None:
        s = self.stats
        lt = self.lifetime
        s.observed += 1
        lt.observed += 1
        s.pushes += 1
        if rx_delay_ms > 0:
            s.rx_delayed += 1
            lt.rx_delayed += 1
            s.rx_delay_ms.append(rx_delay_ms)
            if decision.reason == "duplicate":
                # A neighbour's relay was judged while this copy was held: it went first.
                s.rx_delay_yielded += 1
                lt.rx_delay_yielded += 1
        s.latency_ms.append(latency_ms)
        if radio.lock_busy:
            s.lock_busy += 1
        if radio.radio is not None:
            s.rx_model_airtime_ms += lora_airtime_ms(
                len(raw), radio.radio, self.settings.preamble_symbols
            )
        type_counts = s.by_type.setdefault(decision.payload_type_name, Counter())
        lt_counts = lt.by_type.setdefault(decision.payload_type_name, Counter())
        if decision.forward:
            s.would_forward += 1
            lt.would_forward += 1
            type_counts["forward"] += 1
            lt_counts["forward"] += 1
            s.by_reason[f"forward:{decision.reason}"] += 1
            lt.by_reason[f"forward:{decision.reason}"] += 1
            if decision.delay_ms is not None:
                s.delay_ms.append(decision.delay_ms)
            if decision.airtime_ms is not None:
                s.forward_airtime_total_ms += decision.airtime_ms
                lt.forward_airtime_total_ms += decision.airtime_ms
                s.forward_airtime.append((time.time(), decision.airtime_ms))
        else:
            s.would_drop += 1
            lt.would_drop += 1
            type_counts["drop"] += 1
            lt_counts["drop"] += 1
            s.by_reason[decision.reason] += 1
            lt.by_reason[decision.reason] += 1
        if decision.policy_rule_id:
            s.policy_matches[decision.policy_rule_id] += 1
            lt.policy_matches[decision.policy_rule_id] += 1
        self._lifetime_dirty = True

        self._track_echo(decision, env, arrival, latency_ms)

        s.recent.appendleft(
            {
                "ts": round(time.time(), 3),
                "payload_type": decision.payload_type_name,
                "route_type": decision.route_type,
                "hop_count": decision.hop_count,
                "forward": decision.forward,
                "reason": decision.reason,
                "rx_len": decision.rx_len,
                "forwarded_len": len(decision.forwarded) if decision.forwarded else None,
                "priority": decision.priority,
                "delay_ms": round(decision.delay_ms, 1) if decision.delay_ms is not None else None,
                "airtime_ms": round(decision.airtime_ms, 1)
                if decision.airtime_ms is not None
                else None,
                "latency_ms": round(latency_ms, 1),
                "rx_delay_ms": round(rx_delay_ms, 1) if rx_delay_ms > 0 else None,
                "score": round(decision.score, 3) if decision.score is not None else None,
                "policy_rule_id": decision.policy_rule_id,
                "policy_action": decision.policy_action,
                "packet_hash": decision.packet_hash,
            }
        )

    def _track_echo(self, decision: Decision, env, arrival: float, latency_ms: float) -> None:
        """Measure the gap between our first reception and the first neighbour relay."""
        if env is None or env.route_type in (ROUTE_DIRECT, ROUTE_TRANSPORT_DIRECT):
            return
        key = decision.packet_hash
        entry = self._echo.get(key)
        if entry is None:
            if decision.reason == "duplicate":
                return
            our_tx_at = None
            if decision.forward:
                our_tx_at = arrival + max(latency_ms, decision.delay_ms or 0.0) / 1000.0
            self._echo[key] = _EchoEntry(arrival, env.hop_count, decision.forward, our_tx_at)
            while len(self._echo) > ECHO_TRACK_MAX:
                self._echo.popitem(last=False)
            return
        if entry.gap_recorded or arrival - entry.arrival > ECHO_TRACK_SECONDS:
            return
        if env.hop_count > entry.hop_count:
            entry.gap_recorded = True
            gap_ms = (arrival - entry.arrival) * 1000.0
            self.stats.echo_gap_ms.append(gap_ms)
            if entry.would_forward and entry.our_tx_at is not None:
                if arrival < entry.our_tx_at:
                    self.stats.echo_before_our_tx += 1
                else:
                    self.stats.echo_after_our_tx += 1

    # ── radio stats sampler hook ─────────────────────────────────────────

    def on_stats_sample(self, snapshot: dict[str, Any]) -> None:
        """Compare the firmware's counters with what reached the host (60 s sampler)."""
        if not self.shadow_active or not snapshot:
            self._last_radio_counters = None
            return
        packets = snapshot.get("packets") or {}
        recv = packets.get("recv")
        rx_air = snapshot.get("rx_air_secs")
        tx_air = snapshot.get("tx_air_secs")
        if not (isinstance(recv, int) and isinstance(rx_air, int) and isinstance(tx_air, int)):
            return
        s = self.stats
        current = (recv, rx_air, tx_air)
        previous = self._last_radio_counters
        self._last_radio_counters = current
        pushes_delta = s.pushes - self._pushes_at_last_sample
        model_delta = s.rx_model_airtime_ms - self._model_rx_at_last_sample
        self._pushes_at_last_sample = s.pushes
        self._model_rx_at_last_sample = s.rx_model_airtime_ms
        if previous is None:
            return
        d_recv, d_rx, d_tx = (c - p for c, p in zip(current, previous, strict=True))
        if d_recv < 0 or d_rx < 0 or d_tx < 0:
            return  # counter reset (radio reboot)
        s.stats_samples += 1
        s.sample_pushes += pushes_delta
        s.sample_model_rx_ms += model_delta
        s.radio_recv_delta += d_recv
        s.radio_rx_air_ms += d_rx * 1000.0
        s.radio_tx_air.append((time.time(), d_tx * 1000.0))
        # The radio's own sends use the same airtime budget as forwards (region gate).
        self.engine.add_own_tx(time.monotonic(), d_tx * 1000.0)
        while s.radio_tx_air and time.time() - s.radio_tx_air[0][0] > HOUR_SECONDS:
            s.radio_tx_air.popleft()
        if self._tx is not None:
            # Armed: the firmware's own TX counter is the truth for the duty-cycle cap.
            freq = self.engine.radio.freq_mhz if self.engine.radio is not None else None
            self._tx.on_stats_sample(sum(ms for _, ms in s.radio_tx_air), freq)

    # ── reporting ────────────────────────────────────────────────────────

    def reset_stats(self) -> None:
        self.stats.reset()
        self._echo.clear()
        self._last_radio_counters = None
        self._pushes_at_last_sample = 0
        self._model_rx_at_last_sample = 0.0
        if self._tx is not None:
            self._tx.reset_stats()

    def stats_snapshot(self, freq_mhz: float | None) -> dict[str, Any]:
        s = self.stats
        wall = time.time()
        minute_ms = s.forward_airtime_last(60.0, wall)
        hour_ms = s.forward_airtime_last(HOUR_SECONDS, wall)
        elapsed = max(1.0, wall - s.since)
        window_hours = min(elapsed, HOUR_SECONDS) / HOUR_SECONDS
        sub_band = sub_band_duty_limit(freq_mhz)
        own_tx_hour_ms = sum(ms for _, ms in s.radio_tx_air)
        echo_total = s.echo_before_our_tx + s.echo_after_our_tx
        return {
            "active": self.shadow_active,
            "since": s.since,
            "observed": s.observed,
            "would_forward": s.would_forward,
            "would_drop": s.would_drop,
            "by_reason": dict(s.by_reason),
            "by_type": {k: dict(v) for k, v in s.by_type.items()},
            "policy_matches": dict(s.policy_matches),
            "latency_ms": _percentiles(s.latency_ms),
            "delay_ms": _percentiles(s.delay_ms),
            "lock_busy": s.lock_busy,
            "airtime": {
                "would_forward_total_ms": round(s.forward_airtime_total_ms, 1),
                "would_forward_last_minute_ms": round(minute_ms, 1),
                "would_forward_last_hour_ms": round(hour_ms, 1),
                "would_forward_percent_last_hour": round(
                    hour_ms / (window_hours * HOUR_SECONDS * 1000.0) * 100.0, 3
                ),
                "budget_per_minute_ms": self.settings.max_airtime_per_minute_ms,
                "own_tx_last_hour_ms": round(own_tx_hour_ms, 1),
                "sub_band_limit_percent": sub_band,
            },
            "echo": {
                "gap_ms": _percentiles(s.echo_gap_ms),
                "neighbour_before_our_tx": s.echo_before_our_tx,
                "neighbour_after_our_tx": s.echo_after_our_tx,
                "late_fraction": round(s.echo_before_our_tx / echo_total, 3)
                if echo_total
                else None,
            },
            "invisible_rx": {
                "samples": s.stats_samples,
                "radio_recv": s.radio_recv_delta,
                "pushes": s.sample_pushes,
                "estimate": max(0, s.radio_recv_delta - s.sample_pushes)
                if s.stats_samples
                else None,
            },
            "rx_airtime_calibration": {
                "model_ms": round(s.sample_model_rx_ms, 1),
                "radio_ms": round(s.radio_rx_air_ms, 1),
                "ratio": round(s.sample_model_rx_ms / s.radio_rx_air_ms, 3)
                if s.radio_rx_air_ms > 0
                else None,
            },
            "rx_delay": {
                "enabled": self.settings.rx_delay_base > 0,
                "held": s.rx_delayed,
                "yielded": s.rx_delay_yielded,
                "pending": len(self._held),
                "delay_ms": _percentiles(s.rx_delay_ms),
            },
            "advert_limiter": self.engine.advert_limiter_snapshot(),
            "region_gate": self.engine.gate_snapshot(time.monotonic()),
            "tx": self._tx.snapshot() if self._tx is not None else None,
            "lifetime": {
                "since": self.lifetime.since,
                "runs": self.lifetime.runs,
                "persisted": self._lifetime_loaded,
                **self.lifetime.to_dict(),
            },
            "recent": list(s.recent),
        }


host_repeater = HostRepeaterRuntime()
