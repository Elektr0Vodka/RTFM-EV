"""Host repeater runtime: settings, shadow mode and statistics (plan 29, Phases 1-2).

Shadow mode runs every received frame through ``ForwardingEngine`` and records
what a repeater would have done ("would forward" / "would drop"), how long the
host pipeline took, and how much airtime the forwards would have used. It never
transmits: this module has no reference to the radio or its send path (radio facts
arrive as a ``RadioSnapshot`` argument), and a test enforces the import boundary.

Shadow mode is opt-in (``shadow_enabled``) and runs whenever the repeater is not
armed. Arming (live forwarding) is a later phase and does not exist yet.

Statistics are in memory only and reset on restart or via the API.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import time
from collections import Counter, OrderedDict, deque
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from pydantic import ValidationError

from app.config import settings as server_config
from app.decoder import derive_shared_secret
from app.keystore import get_private_key
from app.path_utils import parse_packet_envelope
from app.repository.host_repeater import (
    HostRepeaterConfigRepository,
    HostRepeaterContactsRepository,
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


@dataclass(frozen=True)
class PreFacts:
    """Facts that must be read before the packet processor consumes them."""

    ack_expected: bool = False


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
        self.recent: deque[dict[str, Any]] = deque(maxlen=RECENT_DECISIONS)

    def forward_airtime_last(self, seconds: float, now: float) -> float:
        while self.forward_airtime and now - self.forward_airtime[0][0] > HOUR_SECONDS:
            self.forward_airtime.popleft()
        return sum(ms for ts, ms in self.forward_airtime if now - ts <= seconds)


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

    # ── settings ─────────────────────────────────────────────────────────

    @property
    def env_enabled(self) -> bool:
        return bool(server_config.host_repeater_enabled)

    @property
    def shadow_active(self) -> bool:
        # Armed mode does not exist yet, so shadow runs whenever it is enabled.
        return self.settings.shadow_enabled

    @property
    def state(self) -> str:
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
            if self.shadow_active and not was_active:
                self.engine.reset_state()
                self.reset_stats()
        self.broadcast()
        return version

    def public_state(self) -> dict[str, Any]:
        return {"state": self.state, "env_enabled": self.env_enabled}

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
        """Judge one received frame in shadow mode. Never raises, never transmits."""
        if not self.shadow_active or radio.is_openhop:
            # OpenHop repeats internally; the host repeater is disabled for it.
            return None
        try:
            return await self._observe(
                raw, snr, rssi, arrival, result or {}, pre or PreFacts(), radio
            )
        except Exception:
            logger.exception("Host repeater shadow observation failed")
            return None

    async def _observe(
        self,
        raw: bytes,
        snr: float | None,
        rssi: int | None,
        arrival: float,
        result: dict,
        pre: PreFacts,
        radio: RadioSnapshot,
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
            )
        self._record(decision, env, raw, radio, arrival, now, latency_ms)
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
    ) -> None:
        s = self.stats
        s.observed += 1
        s.pushes += 1
        s.latency_ms.append(latency_ms)
        if radio.lock_busy:
            s.lock_busy += 1
        if radio.radio is not None:
            s.rx_model_airtime_ms += lora_airtime_ms(
                len(raw), radio.radio, self.settings.preamble_symbols
            )
        type_counts = s.by_type.setdefault(decision.payload_type_name, Counter())
        if decision.forward:
            s.would_forward += 1
            type_counts["forward"] += 1
            s.by_reason[f"forward:{decision.reason}"] += 1
            if decision.delay_ms is not None:
                s.delay_ms.append(decision.delay_ms)
            if decision.airtime_ms is not None:
                s.forward_airtime_total_ms += decision.airtime_ms
                s.forward_airtime.append((time.time(), decision.airtime_ms))
        else:
            s.would_drop += 1
            type_counts["drop"] += 1
            s.by_reason[decision.reason] += 1
        if decision.policy_rule_id:
            s.policy_matches[decision.policy_rule_id] += 1

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

    # ── reporting ────────────────────────────────────────────────────────

    def reset_stats(self) -> None:
        self.stats.reset()
        self._echo.clear()
        self._last_radio_counters = None
        self._pushes_at_last_sample = 0
        self._model_rx_at_last_sample = 0.0

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
            "region_gate": self.engine.gate_snapshot(time.monotonic()),
            "recent": list(s.recent),
        }


host_repeater = HostRepeaterRuntime()
