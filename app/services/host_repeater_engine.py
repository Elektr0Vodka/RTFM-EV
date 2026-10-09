"""Host repeater forwarding engine (plan 29, Phase 2): decisions only, no I/O.

``ForwardingEngine.decide`` takes one received frame (exactly the bytes of a
``PUSH_CODE_LOG_RX_DATA`` push) plus facts the host pipeline already knows, and
returns what a repeater would do with it: forward (with the exact bytes, TX
priority, retransmit delay and airtime) or drop (with a reason).

RF safety: this module never talks to the radio. It must not import the radio
manager, radio command services or the meshcore library; a test enforces that.

Order of checks:
1. Frame parse (firmware ``tryParsePacket``).
2. OpenHop policy rules (evaluated before every other gate, like OpenHop).
3. Firmware forwarding rules from MeshCore ``src/Mesh.cpp`` ``onRecvPacket`` /
   ``routeRecvPacket``: direct next-hop handling (TRACE, CONTROL, routed ACK,
   multipart ACK), flood payload-type switch, dedup (seen table), packets for us.
4. Repeater firmware gates for floods (``simple_repeater`` ``allowPacketForward``):
   region map (with DMC duty-cycle region gating) / unscoped, flood.max*, loop detect.
5. DMC RF packet filter for floods (last, like DMC's hook); in dry-run a filter hit is
   counted and the flood carries on.
6. Per-source advert token bucket (OpenHop ``advert_rate_limit``), adverts only.
7. Raw-send size limit and the OpenHop duty-cycle window.

TX priority follows MeshCore: direct forwards 0, TRACE 5, floods the new hop count.

Score-based delays (Phase 4): ``packet_score`` ports the firmware's
``RadioLibWrapper::packetScoreInt``. ``rx_delay_ms`` is the repeater's ``rxdelay``
(``MyMesh::calcRxDelay``): the host holds a weak flood back before judging it, so a
copy relayed by a neighbour with better reception is judged first and the held copy
becomes a duplicate, exactly like the firmware's delayed inbound queue. With
``use_score_for_tx`` (OpenHop) a strong reception gets a shorter random delay.

Region gating follows DMC ``dmc-dev``: the gate reads how much of the airtime budget
is in use (``Dispatcher::getTxDutyCyclePercent``: a bucket of one hour times the
sub-band duty cycle, refilled at that rate), and every 10 s closes one more layer
of the region tree above ``dc_gate_threshold`` or re-opens one below threshold minus
hysteresis (``MyMesh::loop``, ``RegionMap::applyDutyGate``). The engine has no loop
of its own, so pending 10 s checks are replayed in order whenever it is called.
"""

from __future__ import annotations

import hashlib
import hmac
import math
import random
from collections import OrderedDict, deque
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from Crypto.Cipher import AES

from app.channel_constants import PUBLIC_CHANNEL_KEY
from app.decoder import verify_advert_signature
from app.path_utils import MAX_PATH_SIZE, ParsedPacketEnvelope, parse_packet_envelope
from app.region_resolver import compute_transport_code
from app.services.host_repeater_policy import PolicyDecision, PolicyState, evaluate_layers
from app.services.host_repeater_settings import (
    PAYLOAD_TYPE_NAMES,
    FilterRule,
    HostRepeaterSettings,
    PolicyRule,
    sub_band_duty_limit,
)

# Route types (src/Packet.h)
ROUTE_TRANSPORT_FLOOD = 0
ROUTE_FLOOD = 1
ROUTE_DIRECT = 2
ROUTE_TRANSPORT_DIRECT = 3

# Payload types (src/Packet.h)
PT_REQ = 0x00
PT_RESPONSE = 0x01
PT_TXT_MSG = 0x02
PT_ACK = 0x03
PT_ADVERT = 0x04
PT_GRP_TXT = 0x05
PT_GRP_DATA = 0x06
PT_ANON_REQ = 0x07
PT_PATH = 0x08
PT_TRACE = 0x09
PT_MULTIPART = 0x0A
PT_CONTROL = 0x0B

# Payload types Mesh::onRecvPacket flood-routes (RAW_CUSTOM, MULTIPART, CONTROL,
# TRACE-as-flood and unknown types are never flood-forwarded).
FLOOD_FORWARDED_TYPES = frozenset(
    {
        PT_ACK,
        PT_PATH,
        PT_REQ,
        PT_RESPONSE,
        PT_TXT_MSG,
        PT_ANON_REQ,
        PT_GRP_TXT,
        PT_GRP_DATA,
        PT_ADVERT,
    }
)
# Types whose payload starts with dest hash, src hash (Mesh.cpp PATH/REQ/RESPONSE/TXT_MSG case).
PEER_TYPES = frozenset({PT_PATH, PT_REQ, PT_RESPONSE, PT_TXT_MSG})

# CMD_SEND_RAW_PACKET frame is [65][priority][packet] in cmd_frame[MAX_FRAME_SIZE + 1]
# (companion MyMesh.h, MAX_FRAME_SIZE 176), so the largest raw packet is 174 bytes.
MAX_RAW_SEND_LEN = 174
PAYLOAD_VER_1 = 0  # header bits 6-7; tryParsePacket rejects anything newer
CIPHER_MAC_SIZE = 2
PUB_KEY_SIZE = 32
SIGNATURE_SIZE = 64
MULTIPART_ACK_SPACING_MS = 300

# OpenHop seen table: max 1000 entries (engine.py max_cache_size).
SEEN_TABLE_MAX = 1000
DUTY_WINDOW_SECONDS = 60.0

# DMC region gating (simple_repeater MyMesh.cpp DC_GATE_*, Dispatcher duty window).
DC_GATE_INTERVAL_SECONDS = 10.0
DC_GATE_RECOVER_JITTER_SECONDS = 30.0
BUDGET_WINDOW_MS = 3_600_000.0

# Loop detect thresholds by path hash size (simple_repeater MyMesh.cpp max_loop_*).
LOOP_MAX_COUNTERS = {
    "minimal": {1: 4, 2: 2, 3: 1},
    "moderate": {1: 2, 2: 1, 3: 1},
    "strict": {1: 1, 2: 1, 3: 1},
}

# Score-based delays: RadioLibWrappers.cpp snr_threshold[] (SF7..SF12) and
# Dispatcher.cpp checkRecv (delays under 50 ms are not queued, cap MAX_RX_DELAY_MILLIS).
SNR_THRESHOLD_BY_SF = {7: -7.5, 8: -10.0, 9: -12.5, 10: -15.0, 11: -17.5, 12: -20.0}
SCORE_DELAY_MIN_MS = 50.0
MAX_RX_DELAY_MS = 32_000.0
# OpenHop advert limiter: inactive keys are forgotten after 7 days, at most 10000 kept.
ADVERT_LIMITER_MAX_KEYS = 10_000
ADVERT_LIMITER_RETENTION_SECONDS = 7 * 24 * 3600.0

# DMC Filter.h
DMC_PUBLIC_CHANNEL_HASH = 0x11
DMC_INVALID_TIMESTAMP_WINDOW = 7 * 24 * 60 * 60
DMC_ACL_TYPES = frozenset({PT_REQ, PT_RESPONSE, PT_TXT_MSG, PT_ANON_REQ, PT_PATH})
# MessageAge.h: 1 Jan 2026 UTC; a clock below this has not been set.
DMC_CLOCK_SET_AFTER = 1767225600
# AdvertLimiter.h
DMC_ADVERT_CACHE_SIZE = 256
DMC_ADVERT_KEY_LEN = 4
# FilterStats.h malformed reasons, in check order.
MALFORMED_REASONS = ("short", "time", "empty", "utf8")
TOP_SOURCES = 8
# DMC filter reasons (drop reasons, and dry-run hits).
FILTER_REASONS = (
    "filter_hash",
    "filter_path",
    "filter_hops",
    "filter_advert",
    "filter_channel",
    "filter_malformed",
    "filter_age",
    "filter_sender",
    "filter_text",
    "filter_rate",
)

FORWARD_KINDS = ("flood", "direct", "trace", "ack", "multipart_ack")
DROP_REASONS = (
    "malformed",
    "unsupported_version",
    "no_identity",
    "no_radio",
    "policy_drop",
    "type_not_forwarded",
    "zero_hop",
    "not_next_hop",
    "trace_end",
    "control_zero_hop",
    "multipart_unsupported",
    "duplicate",
    "own_origin",
    "bad_signature",
    "for_us",
    "unscoped_denied",
    "unknown_region",
    "region_denied",
    "region_gated",
    "flood_max",
    "loop",
    "path_full",
    *FILTER_REASONS,
    "advert_rate",
    "too_large",
    "duty_cycle",
    "too_late",
)


@dataclass(frozen=True)
class RadioParams:
    """Current modulation, from the radio's self info."""

    freq_mhz: float | None
    bw_khz: float
    sf: int
    cr: int


@dataclass(frozen=True)
class RxFacts:
    """What the host pipeline knows about a frame besides its bytes."""

    snr: float | None = None
    rssi: int | None = None
    # Host equivalent of the firmware's markDoNotRetransmit(): a MAC check
    # against our identity succeeded, or the ACK code is one we wait for.
    for_us: bool = False
    # Our own traffic heard back (the firmware has it in its seen table).
    own_origin: bool = False
    # Region name the host pipeline resolved from known_regions (display only; the
    # engine matches transport codes against its own region list).
    region: str | None = None
    # 1-byte identity hashes that bypass the DMC filter (its "ACL client" check).
    acl_hashes: frozenset[int] = frozenset()
    channel_decryptable: bool = False
    channel_sender: str | None = None
    channel_message_body: str | None = None
    # Name of the channel the pipeline decrypted the packet with (group traffic only).
    channel_name: str | None = None


# Drop reasons that mean "traffic you explicitly targeted" (rule and rate-limiter
# drops, the fork's ``air:`` accounting); their airtime counts as saved.
SAVED_AIRTIME_REASONS = frozenset({"policy_drop", *FILTER_REASONS, "advert_rate"})


@dataclass(frozen=True)
class Decision:
    forward: bool
    reason: str
    packet_hash: str
    payload_type: int | None
    route_type: int | None
    hop_count: int | None
    rx_len: int
    forwarded: bytes | None = None
    priority: int | None = None
    delay_ms: float | None = None
    airtime_ms: float | None = None
    policy_action: str | None = None
    policy_rule_id: str | None = None
    # Throttled rules that matched but let this packet slip within their budget.
    policy_passes: tuple[str, ...] = ()
    # For rule / rate-limiter drops: estimated airtime the retransmit would have used.
    saved_airtime_ms: float | None = None
    # Reception score used for the delays (None when SNR or SF is unknown).
    score: float | None = None
    # Filter dry-run: the DMC filter reason this forwarded flood would have been dropped for.
    filter_dryrun: str | None = None

    @property
    def payload_type_name(self) -> str:
        if self.payload_type is None:
            return "UNKNOWN"
        return PAYLOAD_TYPE_NAMES.get(self.payload_type, f"TYPE_{self.payload_type}")


def coding_rate_denominator(cr: int) -> int:
    """Accept 5..8 (denominator) or 1..4 (index) like OpenHop's estimator."""
    cr = int(cr)
    if 1 <= cr <= 4:
        return cr + 4
    return max(5, min(8, cr))


def lora_airtime_ms(length: int, radio: RadioParams, preamble_symbols: int = 16) -> float:
    """LoRa time on air in ms (Semtech AN1200.13 as used by RadioLib getTimeOnAir).

    Explicit header and CRC on, low data rate optimisation when the symbol time is
    at least 16 ms (RadioLib's auto rule, which MeshCore leaves in place).
    """
    sf = max(5, min(12, int(radio.sf)))
    bw_hz = float(radio.bw_khz) * 1000.0 or 250000.0
    cr_denom = coding_rate_denominator(radio.cr)
    symbol_s = (1 << sf) / bw_hz
    low_dr = symbol_s * 1000.0 >= 16.0
    sync_symbols = 6.25 if sf <= 6 else 4.25
    sf_coeff2 = 0 if sf <= 6 else 8
    bits = 8 * length + 16 - 4 * sf + sf_coeff2 + 20
    denom = 4 * (sf - 2) if low_dr else 4 * sf
    payload_symbols = 8 + math.ceil(max(bits, 0) / denom) * cr_denom
    return (preamble_symbols + sync_symbols + payload_symbols) * symbol_s * 1000.0


def packet_score(snr: float | None, sf: int, length: int) -> float | None:
    """Firmware ``RadioLibWrapper::packetScoreInt``: reception quality in [0, 1].

    0 below the spreading factor's SNR floor; otherwise (SNR - floor) / 10 dB scaled
    by a collision penalty ``1 - length / 256``. None when SNR or SF is unknown.
    """
    floor = SNR_THRESHOLD_BY_SF.get(sf)
    if snr is None or floor is None:
        return None
    if snr < floor:
        return 0.0
    success = (snr - floor) / 10.0
    penalty = 1.0 - length / 256.0
    return max(0.0, min(1.0, success * penalty))


def rx_delay_ms(score: float | None, airtime_ms: float, base: float) -> float:
    """Repeater ``rxdelay`` (``MyMesh::calcRxDelay`` + ``Dispatcher::checkRecv``).

    ``(base ^ (0.85 - score) - 1) * airtime``; 0 when the setting is off, the score is
    unknown or the result is under 50 ms (the firmware processes those at once);
    capped at 32 s.
    """
    if base <= 0.0 or score is None:
        return 0.0
    delay = (math.pow(base, 0.85 - score) - 1.0) * airtime_ms
    if delay < SCORE_DELAY_MIN_MS:
        return 0.0
    return min(delay, MAX_RX_DELAY_MS)


def packet_hash(payload_type: int, payload: bytes, path_byte: int | None = None) -> str:
    """Firmware Packet::calculatePacketHash: SHA256(type [+ path_len for TRACE] + payload)."""
    h = hashlib.sha256()
    h.update(bytes([payload_type]))
    if payload_type == PT_TRACE and path_byte is not None:
        h.update(bytes([path_byte]))
    h.update(payload)
    return h.hexdigest()[:16]


class DmcLimiter:
    """Port of DMC ``Limiter.h``: fixed window, optional linear soft cutoff."""

    def __init__(self, limit: int, secs: int, soft: int = 0) -> None:
        self.limit = limit
        self.secs = secs
        self.soft = soft
        self._start = 0.0
        self._count = 0

    def allow(self, now: float, rnd: int) -> bool:
        if not self.limit:
            return True
        if now < self._start + self.secs:
            self._count += 1
        else:
            self._start = now
            self._count = 1
        count = self._count
        if self.soft == 0 or self.soft >= self.limit:
            return count <= self.limit
        if count <= self.soft:
            return True
        if count > self.limit:
            return False
        threshold = (256 * (self.limit - count)) // (self.limit - self.soft)
        return rnd < threshold


def _encode_path_byte(hash_size: int, hop_count: int) -> int:
    return ((hash_size - 1) << 6) | (hop_count & 0x3F)


def _header_and_codes(raw: bytes, env: ParsedPacketEnvelope) -> bytes:
    """Header byte plus the transport-code block when present, unchanged."""
    return raw[: 5 if env.transport_codes is not None else 1]


def dmc_clock_set(now: float) -> bool:
    """``MessageAge::clockSet``: a clock below 1 Jan 2026 has not been set."""
    return int(now) >= DMC_CLOCK_SET_AFTER


def _dmc_message_invalid(data: bytes, now: float) -> str | None:
    """DMC ``Filter::validMessageContent``: the malformed reason, or None when valid."""
    if len(data) <= 5:
        return "short"
    timestamp = int.from_bytes(data[0:4], "little")
    # MessageAge::implausible: zero is always bad; +-1 week only once the clock is set.
    if not timestamp or (
        dmc_clock_set(now) and abs(timestamp - int(now)) > DMC_INVALID_TIMESTAMP_WINDOW
    ):
        return "time"
    if (data[4] >> 2) != 0:  # not TXT_TYPE_PLAIN: not checked further
        return None
    text = data[5:].split(b"\x00", 1)[0]
    if not text:
        return "empty"
    try:
        text.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        return "utf8"
    return None


def dmc_channel_secret(name: str) -> bytes:
    """``Filter::getChannelHash`` secret: Public's key, else sha256(name)[:16] (``#name``)."""
    if name == "Public":
        return bytes.fromhex(PUBLIC_CHANNEL_KEY)
    return hashlib.sha256(name.encode("utf-8")).digest()[:16]


def dmc_channel_hash(secret: bytes) -> int:
    """First byte of sha256(secret): the channel hash a GRP_TXT carries."""
    return hashlib.sha256(secret).digest()[0]


def _dmc_decrypt(secret: bytes, payload: bytes) -> bytes:
    """``Utils::MACThenDecrypt`` over payload[1:]: the plaintext, or b"" on a MAC failure.

    Faithful to DMC: a GRP_TXT on a watched hash byte whose MAC does not verify with
    that key (another channel on the same byte) decrypts to nothing.
    """
    mac = payload[1:3]
    ciphertext = payload[3:]
    if not ciphertext or len(ciphertext) % 16:
        return b""
    if hmac.new(secret + bytes(16), ciphertext, hashlib.sha256).digest()[:2] != mac:
        return b""
    return AES.new(secret, AES.MODE_ECB).decrypt(ciphertext)


def dmc_parse_group_text(data: bytes) -> tuple[bytes, bytes] | None:
    """``FilterRules::parseGroupText``: (sender, text) of a plain group text, else None."""
    if len(data) < 6 or (data[4] >> 2) != 0:
        return None
    body = data[5:].split(b"\x00", 1)[0]
    index = body.find(b": ")
    if index <= 0:
        return None
    return body[:index], body[index + 2 :]


def dmc_match_name(pattern: str, sender: bytes) -> bool:
    """Exact, or prefix when the pattern ends in ``*`` (a lone ``*`` matches all)."""
    raw = pattern.encode("utf-8")
    if raw.endswith(b"*"):
        return sender.startswith(raw[:-1])
    return sender == raw


def dmc_match_text(pattern: str, text: bytes) -> bool:
    """Substring, or prefix when the pattern starts with ``^``. Case-sensitive."""
    raw = pattern.encode("utf-8")
    if raw.startswith(b"^"):
        return len(raw) > 1 and text.startswith(raw[1:])
    return raw in text


def dmc_path_match(path: bytes, hash_size: int, prefixes: list[bytes]) -> int:
    """``FilterPath::findMatch``: index of the first prefix starting any path entry, or -1.

    A prefix longer than the hash size never matches (``A1B2`` is one 2-byte ID).
    """
    if hash_size <= 0:
        return -1
    entries = [path[i : i + hash_size] for i in range(0, len(path) - hash_size + 1, hash_size)]
    for slot, prefix in enumerate(prefixes):
        if not prefix or len(prefix) > hash_size:
            continue
        if any(entry.startswith(prefix) for entry in entries):
            return slot
    return -1


class AdvertOriginWindow:
    """Port of DMC ``AdvertLimiter.h``: each origin's flood advert passes once per window.

    Keyed on the first 4 bytes of the public key, in a 256-entry ring that
    overwrites the oldest entry once full. In memory only, like the firmware.
    """

    def __init__(self, hours: int) -> None:
        self.hours = hours
        self._keys: list[bytes] = []
        self._seen: list[float] = []
        self._head = 0

    def clear(self) -> None:
        self._keys.clear()
        self._seen.clear()
        self._head = 0

    @property
    def count(self) -> int:
        return len(self._keys)

    def allow(self, key: bytes, now: float) -> bool:
        if self.hours <= 0:
            return True
        key = key[:DMC_ADVERT_KEY_LEN]
        window = self.hours * 3600.0
        for i, known in enumerate(self._keys):
            if known != key:
                continue
            if now - self._seen[i] < window:
                return False
            self._seen[i] = now  # window elapsed: pass, and start a new window
            return True
        if len(self._keys) < DMC_ADVERT_CACHE_SIZE:
            self._keys.append(key)
            self._seen.append(now)
        else:
            self._keys[self._head] = key
            self._seen[self._head] = now
            self._head = (self._head + 1) % DMC_ADVERT_CACHE_SIZE
        return True


@dataclass
class FilterCounters:
    """DMC ``FilterStats.h`` counters, in memory (cleared with the shadow stats)."""

    hops: dict[str, int] = field(default_factory=dict)
    rate: dict[str, int] = field(default_factory=dict)
    channel: dict[str, int] = field(default_factory=dict)
    hash_size: list[int] = field(default_factory=lambda: [0, 0, 0, 0])
    hash_type: dict[str, int] = field(default_factory=dict)
    malformed: dict[str, int] = field(default_factory=lambda: dict.fromkeys(MALFORMED_REASONS, 0))
    advert: int = 0
    path: dict[str, int] = field(default_factory=dict)
    sender: dict[str, int] = field(default_factory=dict)
    sender_pass: dict[str, int] = field(default_factory=dict)
    text: dict[str, int] = field(default_factory=dict)
    text_pass: dict[str, int] = field(default_factory=dict)
    age: int = 0
    sources: dict[int, int] = field(default_factory=dict)
    air_ms: float = 0.0
    dryrun_hits: int = 0

    def totals(self) -> dict[str, int]:
        return {
            "hops": sum(self.hops.values()),
            "rate": sum(self.rate.values()),
            "channel": sum(self.channel.values()),
            "hash": sum(self.hash_size),
            "malformed": sum(self.malformed.values()),
            "advert": self.advert,
            "path": sum(self.path.values()),
            "sender": sum(self.sender.values()),
            "text": sum(self.text.values()),
            "age": self.age,
        }


def _bump(counter: dict, key: Any, amount: int = 1) -> None:
    counter[key] = counter.get(key, 0) + amount


def _dmc_src_hash(ptype: int, payload: bytes) -> int | None:
    """``Filter::srcHash``: the originator's 1-byte hash where the payload carries one."""
    if ptype == PT_ADVERT:
        return payload[0] if payload else None
    if ptype in DMC_ACL_TYPES:
        return payload[1] if len(payload) >= 2 else None
    return None


class AdvertLimiter:
    """OpenHop ``AdvertHelper._allow_advert`` without the penalty box and adaptive tiers:
    one token bucket per advertising public key plus a minimum interval per key."""

    def __init__(
        self, capacity: int, refill_tokens: int, refill_seconds: int, min_interval: int
    ) -> None:
        self.capacity = float(capacity)
        self.refill_tokens = float(refill_tokens)
        self.refill_seconds = float(refill_seconds)
        self.min_interval = float(min_interval)
        # key -> [tokens, last_refill, last_seen (-1 = never)]
        self._state: OrderedDict[bytes, list[float]] = OrderedDict()
        self.allowed = 0
        self.dropped = 0
        self._last_cleanup = 0.0

    def allow(self, key: bytes, now: float) -> bool:
        self._cleanup(now)
        state = self._state.get(key)
        if state is None:
            state = [self.capacity, now, -1.0]
            self._state[key] = state
            while len(self._state) > ADVERT_LIMITER_MAX_KEYS:
                self._state.popitem(last=False)
        else:
            self._state.move_to_end(key)
            elapsed = now - state[1]
            if elapsed >= self.refill_seconds:
                intervals = int(elapsed // self.refill_seconds)
                state[0] = min(self.capacity, state[0] + intervals * self.refill_tokens)
                state[1] += intervals * self.refill_seconds
        if self.min_interval > 0 and state[2] >= 0 and now - state[2] < self.min_interval:
            self.dropped += 1
            return False
        if state[0] < 1.0:
            self.dropped += 1
            return False
        state[0] -= 1.0
        state[2] = now
        self.allowed += 1
        return True

    def _cleanup(self, now: float) -> None:
        if now - self._last_cleanup < 3600.0:
            return
        self._last_cleanup = now
        stale = [
            k
            for k, s in self._state.items()
            if now - max(s[1], s[2]) > ADVERT_LIMITER_RETENTION_SECONDS
        ]
        for key in stale:
            del self._state[key]

    @property
    def tracked(self) -> int:
        return len(self._state)


@dataclass
class _DutyWindow:
    entries: deque[tuple[float, float]] = field(default_factory=deque)

    def used(self, now: float) -> float:
        while self.entries and now - self.entries[0][0] >= DUTY_WINDOW_SECONDS:
            self.entries.popleft()
        return sum(ms for _, ms in self.entries)


class AirtimeBudget:
    """DMC ``dmc-dev`` Dispatcher TX budget: ``BUDGET_WINDOW_MS * duty`` ms, refilled at ``duty``.

    ``used_percent`` is ``getTxDutyCyclePercent``: 0 with a full bucket, 100 with an
    empty one. A node that transmits steadily below its duty cycle stays near 0.
    """

    def __init__(self) -> None:
        self.duty: float | None = None
        self.tokens_ms = 0.0
        self._last: float | None = None

    @property
    def max_ms(self) -> float:
        return BUDGET_WINDOW_MS * self.duty if self.duty else 0.0

    def configure(self, duty: float | None, now: float) -> None:
        if duty != self.duty:
            self.duty = duty
            self.tokens_ms = self.max_ms  # Dispatcher::begin starts with a full bucket
            self._last = now

    def _refill(self, now: float) -> None:
        if self._last is None:
            self._last = now
            return
        if now > self._last and self.duty:
            refill = (now - self._last) * 1000.0 * self.duty
            self.tokens_ms = min(self.max_ms, self.tokens_ms + refill)
            self._last = now

    def consume(self, now: float, airtime_ms: float) -> None:
        self._refill(now)
        self.tokens_ms = max(0.0, self.tokens_ms - airtime_ms)

    def used_percent(self, now: float) -> int | None:
        if not self.max_ms:
            return None
        self._refill(now)
        used = 1.0 - self.tokens_ms / self.max_ms
        return max(0, min(100, int(used * 100.0 + 0.5)))


class ForwardingEngine:
    """Stateful decision engine: seen table, DMC limiters, duty-cycle window, region gate."""

    def __init__(
        self,
        settings: HostRepeaterSettings,
        public_key: bytes | None,
        radio: RadioParams | None,
        rng: random.Random | None = None,
    ) -> None:
        self._rng = rng or random.Random()
        self._seen: OrderedDict[str, float] = OrderedDict()
        self._duty = _DutyWindow()
        self.settings = settings
        self.public_key = public_key
        self.radio = radio
        self._limiters: dict[int, DmcLimiter] = {}
        self._build_limiters()
        self._advert_limiter = self._build_advert_limiter()
        self._budget = AirtimeBudget()
        self._gate_level = 0
        self._gate_next: float | None = None
        self._depths: dict[str, int] = {}
        self._max_depth = 0
        self._build_region_tree()
        self._policy_state = PolicyState()
        # Rules generated at runtime (Spam Guard), evaluated around the user's
        # policy rules. Not part of the settings, so ``configure`` leaves them.
        self._managed_before: tuple[PolicyRule, ...] = ()
        self._managed_after: tuple[PolicyRule, ...] = ()
        self.filter_counters = FilterCounters()
        self._advert_window = AdvertOriginWindow(settings.filter_advert_hours)
        # Throttle state per (rule list, pattern), monotonic like the firmware's millis.
        self._rule_last: dict[tuple[str, str], float] = {}
        self._watched: dict[int, bytes] = {}
        self._path_prefixes: list[bytes] = []
        self._pending_dryrun: str | None = None
        self._build_filter_content()

    # ── configuration ────────────────────────────────────────────────────

    def configure(
        self,
        *,
        settings: HostRepeaterSettings | None = None,
        public_key: bytes | None = None,
        radio: RadioParams | None = None,
    ) -> None:
        if settings is not None:
            self.settings = settings
            self._build_limiters()
            self._build_region_tree()
            self._advert_limiter = self._build_advert_limiter()
            self._advert_window.hours = settings.filter_advert_hours
            self._build_filter_content()
        if public_key is not None and public_key != self.public_key:
            self.public_key = public_key
            self._seen.clear()
        if radio is not None:
            self.radio = radio

    def set_managed_rules(self, before: Sequence[PolicyRule], after: Sequence[PolicyRule]) -> None:
        """Replace the runtime rule layers placed before and after the user's rules."""
        self._managed_before = tuple(before)
        self._managed_after = tuple(after)

    @property
    def managed_rule_count(self) -> int:
        return len(self._managed_before) + len(self._managed_after)

    def _build_region_tree(self) -> None:
        """Depth per region (wildcard children = 1), like ``RegionMap::depthOf``."""
        parents = {r.name: r.parent for r in self.settings.regions}
        depths: dict[str, int] = {}
        for name in parents:
            depth, parent = 1, parents[name]
            while parent is not None and parent in parents and depth <= len(parents):
                depth += 1
                parent = parents[parent]
            depths[name] = depth
        self._depths = depths
        self._max_depth = max(depths.values(), default=0)
        if not self.settings.dc_gate_enabled:
            self._gate_level = 0
            self._gate_next = None
        self._gate_level = min(self._gate_level, self._max_depth)

    def reset_state(self) -> None:
        self._seen.clear()
        self._duty = _DutyWindow()
        self._build_limiters()
        self._advert_limiter = self._build_advert_limiter()
        self._policy_state.clear()
        self._advert_window.clear()
        self._rule_last.clear()

    def reset_filter_counters(self) -> None:
        """``clear stats``: counters only; settings and the advert cache stay."""
        self.filter_counters = FilterCounters()

    def _build_filter_content(self) -> None:
        """Keys the content checks may read (``watchedSecret``: Public plus the watch
        list) and the parsed path prefixes. Throttle state of removed rules is dropped."""
        s = self.settings
        secrets: dict[int, bytes] = {}
        for name in ["Public", *s.filter_watch]:
            secret = dmc_channel_secret(name)
            secrets.setdefault(dmc_channel_hash(secret), secret)
        self._watched = secrets
        self._path_prefixes = [bytes.fromhex(p) for p in s.filter_paths]
        live = {("sender", r.pattern) for r in s.filter_sender_rules} | {
            ("text", r.pattern) for r in s.filter_text_rules
        }
        self._rule_last = {k: v for k, v in self._rule_last.items() if k in live}

    def filter_snapshot(self, wall_now: float) -> dict:
        """Counters plus the configuration they are read against (DMC ``filter`` topic shape)."""
        s = self.settings
        c = self.filter_counters
        top = sorted(c.sources.items(), key=lambda kv: (-kv[1], kv[0]))[:TOP_SOURCES]
        hash_top = sorted(c.hash_type.items(), key=lambda kv: (-kv[1], kv[0]))[:3]

        def rules(items: list, drops: dict[str, int], passes: dict[str, int]) -> list[dict]:
            return [
                {
                    "pattern": r.pattern,
                    "secs": r.secs,
                    "prob": r.prob,
                    "drops": drops.get(r.pattern, 0),
                    "pass": passes.get(r.pattern, 0),
                }
                for r in items
            ]

        return {
            "enabled": s.filter_enabled,
            "dryrun": s.filter_dryrun,
            "totals": c.totals(),
            "air_ms": round(c.air_ms, 1),
            "dryrun_hits": c.dryrun_hits,
            "hops": dict(c.hops),
            "rate": dict(c.rate),
            "hash": {
                "size": {f"{i + 1}B": n for i, n in enumerate(c.hash_size)},
                "top_types": dict(hash_top),
            },
            "malformed": dict(c.malformed),
            "channels": [
                {"hash": e.hash, "name": e.label, "drops": c.channel.get(e.hash, 0)}
                for e in s.filter_channels
            ],
            "top_sources": [{"hash": f"{h:02x}", "drops": n} for h, n in top],
            "advert": {
                "window_h": s.filter_advert_hours,
                "cache": self._advert_window.count,
                "cache_size": DMC_ADVERT_CACHE_SIZE,
            },
            "age": {"max_mins": s.filter_age_minutes, "clock_set": dmc_clock_set(wall_now)},
            "paths": [{"prefix": p, "drops": c.path.get(p, 0)} for p in s.filter_paths],
            "senders": rules(s.filter_sender_rules, c.sender, c.sender_pass),
            "texts": rules(s.filter_text_rules, c.text, c.text_pass),
            "watch": list(s.filter_watch),
            "config": {
                name: {
                    "limit": t.rate_limit,
                    "secs": t.rate_secs,
                    "soft": t.soft,
                    "hops_max": t.hops_max,
                }
                for name, t in s.filter_types.items()
            },
        }

    def _build_advert_limiter(self) -> AdvertLimiter:
        s = self.settings
        return AdvertLimiter(
            s.advert_bucket_capacity,
            s.advert_refill_tokens,
            s.advert_refill_interval_seconds,
            s.advert_min_interval_seconds,
        )

    def advert_limiter_snapshot(self) -> dict:
        lim = self._advert_limiter
        return {
            "enabled": self.settings.advert_limiter_enabled,
            "tracked": lim.tracked,
            "allowed": lim.allowed,
            "dropped": lim.dropped,
        }

    def rx_delay_ms(self, raw: bytes, snr: float | None) -> float:
        """Score-based receive delay for a flood frame (0 = judge it now)."""
        if self.settings.rx_delay_base <= 0.0 or self.radio is None:
            return 0.0
        env = parse_packet_envelope(raw)
        if env is None or env.route_type not in (ROUTE_FLOOD, ROUTE_TRANSPORT_FLOOD):
            return 0.0
        score = packet_score(snr, self.radio.sf, len(raw))
        airtime = lora_airtime_ms(len(raw), self.radio, self.settings.preamble_symbols)
        return rx_delay_ms(score, airtime, self.settings.rx_delay_base)

    def _build_limiters(self) -> None:
        by_code = {name: code for code, name in PAYLOAD_TYPE_NAMES.items()}
        self._limiters = {
            by_code[name]: DmcLimiter(limits.rate_limit, limits.rate_secs, limits.soft)
            for name, limits in self.settings.filter_types.items()
        }

    def airtime_used_ms(self, now: float) -> float:
        return self._duty.used(now)

    # ── DMC duty-cycle region gating ─────────────────────────────────────

    def _sync_budget(self, now: float) -> None:
        freq = self.radio.freq_mhz if self.radio is not None else None
        limit = sub_band_duty_limit(freq)
        self._budget.configure(limit / 100.0 if limit else None, now)

    def _gate_catch_up(self, now: float) -> None:
        """Replay the 10 s gate checks due up to ``now`` (``MyMesh::loop``)."""
        self._sync_budget(now)
        s = self.settings
        if not s.dc_gate_enabled:
            self._gate_level = 0
            self._gate_next = None
            return
        if self._gate_next is None:
            self._gate_next = now
        recover = max(0, s.dc_gate_threshold - s.dc_gate_hysteresis)
        while self._gate_next <= now:
            at = self._gate_next
            duty = self._budget.used_percent(at)
            step = DC_GATE_INTERVAL_SECONDS
            if duty is not None and duty > s.dc_gate_threshold:
                if self._gate_level < self._max_depth:
                    self._gate_level += 1
            elif duty is not None and self._gate_level > 0 and duty < recover:
                self._gate_level -= 1
                step += self._rng.uniform(0.0, DC_GATE_RECOVER_JITTER_SECONDS)
            self._gate_next = at + step
            if self._gate_level == 0 and (duty is None or duty <= s.dc_gate_threshold):
                # Without new airtime the reading only falls, so nothing changes until now.
                if self._gate_next <= now:
                    self._gate_next = now + DC_GATE_INTERVAL_SECONDS
                break

    def _wildcard_gated(self) -> bool:
        return self._gate_level >= 1 and self._max_depth > 0

    def _region_gated(self, name: str) -> bool:
        level = self._gate_level
        depth = self._depths.get(name, 0)
        return (
            level >= 2
            and depth <= level - 1
            and depth < self._max_depth
            and name != self.settings.home_region
        )

    def add_own_tx(self, now: float, airtime_ms: float) -> None:
        """The radio's own transmissions use the same budget (one Dispatcher in firmware)."""
        self._gate_catch_up(now)
        if airtime_ms > 0:
            self._budget.consume(now, airtime_ms)

    def gate_snapshot(self, now: float) -> dict:
        self._gate_catch_up(now)
        gated = [r.name for r in self.settings.regions if self._region_gated(r.name)]
        return {
            "enabled": self.settings.dc_gate_enabled,
            "level": self._gate_level,
            "max_level": self._max_depth,
            "budget_used_percent": self._budget.used_percent(now),
            "budget_max_ms": round(self._budget.max_ms, 1),
            "threshold": self.settings.dc_gate_threshold,
            "hysteresis": self.settings.dc_gate_hysteresis,
            "wildcard_gated": self._wildcard_gated(),
            "gated_regions": gated,
        }

    # ── seen table (OpenHop TTL + size cap) ──────────────────────────────

    def _was_seen(self, key: str, now: float) -> bool:
        ts = self._seen.get(key)
        if ts is None:
            return False
        if now - ts > self.settings.seen_ttl_seconds:
            del self._seen[key]
            return False
        return True

    def _mark_seen(self, key: str, now: float) -> None:
        self._seen[key] = now
        self._seen.move_to_end(key)
        while len(self._seen) > SEEN_TABLE_MAX:
            self._seen.popitem(last=False)

    # ── decision ─────────────────────────────────────────────────────────

    def decide(
        self, raw: bytes, facts: RxFacts, now: float, wall_now: float | None = None
    ) -> Decision:
        """Judge one received frame. ``now`` is a monotonic clock in seconds."""
        env = parse_packet_envelope(raw)
        if env is None:
            return Decision(False, "malformed", "", None, None, None, len(raw))

        ptype, route, hops, rx_len = env.payload_type, env.route_type, env.hop_count, len(raw)
        pkt_hash = packet_hash(
            env.payload_type, env.payload, env.path_byte if env.payload_type == PT_TRACE else None
        )

        score = packet_score(facts.snr, self.radio.sf, rx_len) if self.radio else None
        self._pending_dryrun = None

        def drop(reason: str, policy: PolicyDecision | None = None) -> Decision:
            saved = None
            if reason in SAVED_AIRTIME_REASONS and self.radio is not None:
                # Length we would have re-sent: floods grow by our hash, direct
                # forwards lose the consumed one.
                if route in (ROUTE_FLOOD, ROUTE_TRANSPORT_FLOOD):
                    sent_len = rx_len + env.hash_size
                else:
                    sent_len = max(1, rx_len - env.hash_size)
                saved = lora_airtime_ms(sent_len, self.radio, self.settings.preamble_symbols)
                if reason in FILTER_REASONS:
                    self.filter_counters.air_ms += saved
            return Decision(
                False,
                reason,
                pkt_hash,
                policy_action=policy.action if policy and policy.matched else None,
                policy_rule_id=policy.rule_id if policy and policy.matched else None,
                policy_passes=policy.passes if policy else (),
                saved_airtime_ms=saved,
                score=score,
                payload_type=ptype,
                route_type=route,
                hop_count=hops,
                rx_len=rx_len,
            )

        if env.payload_version != PAYLOAD_VER_1:
            return drop("unsupported_version")
        if self.public_key is None or len(self.public_key) < 3:
            return drop("no_identity")
        if self.radio is None:
            return drop("no_radio")

        self._gate_catch_up(now)
        policy = evaluate_layers(
            self._managed_before,
            self.settings.policy,
            self._managed_after,
            self._policy_fields(env, facts),
            packet_hash=pkt_hash,
            now=now,
            state=self._policy_state,
        )
        if policy.action == "drop":
            return drop("policy_drop", policy)

        if env.route_type in (ROUTE_DIRECT, ROUTE_TRANSPORT_DIRECT):
            result = self._decide_direct(raw, env, facts, pkt_hash, now)
        else:
            result = self._decide_flood(raw, env, facts, pkt_hash, now, wall_now)

        if isinstance(result, str):
            return drop(result, policy)
        forwarded, kind, priority, delay_ms = result
        dryrun = self._pending_dryrun

        if len(forwarded) > MAX_RAW_SEND_LEN:
            return drop("too_large", policy)

        airtime = lora_airtime_ms(len(forwarded), self.radio, self.settings.preamble_symbols)
        if delay_ms is None:
            factor = (
                self.settings.tx_delay_factor
                if kind == "flood"
                else self.settings.direct_tx_delay_factor
            )
            delay_ms = airtime * factor * (self._rng.randrange(5001) / 1000.0)
            if (
                self.settings.use_score_for_tx
                and score is not None
                and delay_ms >= SCORE_DELAY_MIN_MS
            ):
                # OpenHop: a strong reception forwards sooner, never below 20 %.
                delay_ms *= max(0.2, 1.0 - score)
        delay_ms = min(delay_ms, float(self.settings.max_tx_delay_ms))

        if (
            self.settings.duty_cycle_enforced
            and self._duty.used(now) + airtime > self.settings.max_airtime_per_minute_ms
        ):
            return drop("duty_cycle", policy)
        self._duty.entries.append((now, airtime))
        self._budget.consume(now, airtime)

        return Decision(
            True,
            kind,
            pkt_hash,
            forwarded=forwarded,
            priority=priority,
            delay_ms=delay_ms,
            airtime_ms=airtime,
            policy_action=policy.action if policy.matched else None,
            policy_rule_id=policy.rule_id if policy.matched else None,
            policy_passes=policy.passes,
            score=score,
            payload_type=ptype,
            route_type=route,
            hop_count=hops,
            rx_len=rx_len,
            filter_dryrun=dryrun,
        )

    def _our_hash(self, size: int) -> bytes:
        assert self.public_key is not None
        return self.public_key[:size]

    def _decide_direct(
        self, raw: bytes, env: ParsedPacketEnvelope, facts: RxFacts, pkt_hash: str, now: float
    ) -> tuple[bytes, str, int, float | None] | str:
        head = _header_and_codes(raw, env)

        if env.payload_type == PT_TRACE:
            # Mesh.cpp: our hash is matched in the payload at offset path_len << path_sz,
            # and the forward appends this reception's SNR (not a hash) to the path.
            if env.path_byte >= MAX_PATH_SIZE:
                return "path_full"
            if len(env.payload) < 9:
                return "malformed"
            path_sz = env.payload[8] & 0x03
            hashes = env.payload[9:]
            offset = env.path_byte << path_sz
            width = 1 << path_sz
            if offset >= len(hashes):
                return "trace_end"
            if hashes[offset : offset + width] != self._our_hash(width)[:width]:
                return "not_next_hop"
            if self._was_seen(pkt_hash, now):
                return "duplicate"
            self._mark_seen(pkt_hash, now)
            snr = facts.snr if facts.snr is not None else 0.0
            snr_byte = max(-128, min(127, int(snr * 4))) & 0xFF
            forwarded = (
                head + bytes([env.path_byte + 1]) + env.path + bytes([snr_byte]) + env.payload
            )
            return forwarded, "trace", 5, None

        if env.payload_type == PT_CONTROL and env.payload and env.payload[0] & 0x80:
            return "control_zero_hop"

        if env.hop_count == 0:
            # Zero-hop direct: delivered to whoever heard it; the firmware only marks it seen.
            self._mark_seen(pkt_hash, now)
            return "zero_hop"

        size = env.hash_size
        if env.path[:size] != self._our_hash(size):
            return "not_next_hop"

        rest = env.path[size:]
        new_path_byte = _encode_path_byte(size, env.hop_count - 1)

        if env.payload_type == PT_MULTIPART:
            # forwardMultipartDirect: only a multipart ACK is relayed, regenerated as a
            # plain DIRECT ACK without the multipart byte, (remaining + 1) * 300 ms later.
            if len(env.payload) < 5 or (env.payload[0] & 0x0F) != PT_ACK:
                return "multipart_unsupported"
            inner = env.payload[1:]
            key = packet_hash(PT_MULTIPART, inner)
            if self._was_seen(key, now):
                return "duplicate"
            self._mark_seen(key, now)
            remaining = env.payload[0] >> 4
            header = (PT_ACK << 2) | ROUTE_DIRECT
            forwarded = bytes([header, new_path_byte]) + rest + inner
            return forwarded, "multipart_ack", 0, float((remaining + 1) * MULTIPART_ACK_SPACING_MS)

        if self._was_seen(pkt_hash, now):
            return "duplicate"
        self._mark_seen(pkt_hash, now)

        if env.payload_type == PT_ACK:
            # routeDirectRecvAcks: regenerated as a plain DIRECT ACK (transport codes
            # dropped), sent with no retransmit delay.
            header = (PT_ACK << 2) | ROUTE_DIRECT
            forwarded = bytes([header, new_path_byte]) + rest + env.payload
            return forwarded, "ack", 0, 0.0

        forwarded = head + bytes([new_path_byte]) + rest + env.payload
        return forwarded, "direct", 0, None

    def _decide_flood(
        self,
        raw: bytes,
        env: ParsedPacketEnvelope,
        facts: RxFacts,
        pkt_hash: str,
        now: float,
        wall_now: float | None,
    ) -> tuple[bytes, str, int, float | None] | str:
        ptype = env.payload_type
        payload = env.payload
        if ptype not in FLOOD_FORWARDED_TYPES:
            return "type_not_forwarded"

        # Minimum lengths from the Mesh.cpp switch ("incomplete ... packet").
        if ptype == PT_ACK and len(payload) < 4:
            return "malformed"
        if ptype in PEER_TYPES and len(payload) <= 2 + CIPHER_MAC_SIZE:
            return "malformed"
        if ptype == PT_ANON_REQ and len(payload) <= 1 + PUB_KEY_SIZE + 2:
            return "malformed"
        if ptype in (PT_GRP_TXT, PT_GRP_DATA) and len(payload) <= 3:
            return "malformed"
        if ptype == PT_ADVERT:
            if len(payload) < PUB_KEY_SIZE + 4 + SIGNATURE_SIZE:
                return "malformed"
            if payload[:PUB_KEY_SIZE] == (self.public_key or b"")[:PUB_KEY_SIZE]:
                return "own_origin"

        if self._was_seen(pkt_hash, now):
            return "duplicate"
        self._mark_seen(pkt_hash, now)

        if ptype == PT_ADVERT and not verify_advert_signature(payload):
            return "bad_signature"
        if facts.own_origin:
            return "own_origin"
        if facts.for_us:
            return "for_us"

        # Region map / unscoped (simple_repeater onRecvPacket + allowPacketForward).
        if env.route_type == ROUTE_FLOOD:
            if not self.settings.unscoped_flood_allow:
                return "unscoped_denied"
            if self._wildcard_gated():
                return "region_gated"
        else:
            reason = self._region_block_reason(env)
            if reason is not None:
                return reason

        hops = env.hop_count
        s = self.settings
        if (
            hops >= s.flood_max
            or (env.route_type == ROUTE_FLOOD and hops >= s.flood_max_unscoped)
            or (ptype == PT_ADVERT and hops >= s.flood_max_advert)
        ):
            return "flood_max"

        if s.loop_detect != "off":
            size = env.hash_size
            ours = self._our_hash(size)
            count = sum(1 for i in range(hops) if env.path[i * size : (i + 1) * size] == ours)
            if count >= LOOP_MAX_COUNTERS[s.loop_detect][size]:
                return "loop"

        if hops >= 63 or (hops + 1) * env.hash_size > MAX_PATH_SIZE:
            return "path_full"

        if s.filter_enabled:
            reason = self._dmc_filter(env, facts, now, wall_now)
            if reason is not None:
                if not s.filter_dryrun:
                    return reason
                # Dry-run (Filter::drop): counted and billed as "would have saved", forwarded.
                self._pending_dryrun = reason
                self.filter_counters.dryrun_hits += 1
                assert self.radio is not None
                self.filter_counters.air_ms += lora_airtime_ms(
                    len(raw) + env.hash_size, self.radio, s.preamble_symbols
                )

        if (
            ptype == PT_ADVERT
            and s.advert_limiter_enabled
            and not self._advert_limiter.allow(bytes(payload[:PUB_KEY_SIZE]), now)
        ):
            return "advert_rate"

        forwarded = (
            _header_and_codes(raw, env)
            + bytes([_encode_path_byte(env.hash_size, hops + 1)])
            + env.path
            + self._our_hash(env.hash_size)
            + payload
        )
        # Mesh::routeRecvPacket: priority = new hop count (closer sources first).
        return forwarded, "flood", hops + 1, None

    def _region_block_reason(self, env: ParsedPacketEnvelope) -> str | None:
        """``RegionMap::findMatch``: the first listed region whose code matches and that
        is neither denied nor gated lets the flood through. Otherwise say why not.

        Only hashtag (auto-key) regions exist here; the firmware's stored private
        region keys have no host equivalent.
        """
        codes = env.transport_codes
        if not codes:
            return "unknown_region"
        blocked: str | None = None
        for region in self.settings.regions:
            if compute_transport_code(region.name, env.payload_type, env.payload) != codes[0]:
                continue
            if region.deny_flood:
                blocked = blocked or "region_denied"
            elif self._region_gated(region.name):
                blocked = blocked or "region_gated"
            else:
                return None
        return blocked or "unknown_region"

    def _dmc_filter(
        self, env: ParsedPacketEnvelope, facts: RxFacts, now: float, wall_now: float | None
    ) -> str | None:
        """DMC ``Filter::allowPacketForward`` for a flood packet, or None to pass.

        Order follows dmc-observer-dev: hash size, path prefixes, hops, per-origin
        advert window, group-text checks, rate limiter. Two DMC issues are not copied:
        a packet a group-text check drops (channel, malformed, age, sender, text) no
        longer consumes the GRP_TXT rate budget (those checks run before the limiter),
        and values are range-checked by the settings model instead of wrapping.
        """
        s = self.settings
        c = self.filter_counters
        ptype = env.payload_type
        payload = env.payload
        name = PAYLOAD_TYPE_NAMES.get(ptype, f"TYPE_{ptype}")
        if (
            ptype in DMC_ACL_TYPES
            and len(payload) >= 2
            and (payload[0] in facts.acl_hashes or payload[1] in facts.acl_hashes)
        ):
            return None
        # FilterStat::recordSrc: only these reasons attribute a source.
        src = _dmc_src_hash(ptype, payload)

        def sourced(reason: str) -> str:
            if src is not None:
                _bump(c.sources, src)
            return reason

        if env.hash_size < s.filter_min_hash_bytes:
            c.hash_size[min(env.hash_size, 4) - 1] += 1
            _bump(c.hash_type, name)
            return sourced("filter_hash")
        slot = dmc_path_match(env.path, env.hash_size, self._path_prefixes)
        if slot >= 0:
            _bump(c.path, s.filter_paths[slot])
            return sourced("filter_path")
        limits = s.filter_types.get(name)
        if limits is not None and env.hop_count >= limits.hops_max:
            _bump(c.hops, name)
            return sourced("filter_hops")
        # Ahead of the per-type limiter, so a repeat advert never eats a legitimate one's budget.
        if (
            ptype == PT_ADVERT
            and len(payload) >= DMC_ADVERT_KEY_LEN
            and not self._advert_window.allow(bytes(payload[:DMC_ADVERT_KEY_LEN]), now)
        ):
            c.advert += 1
            return sourced("filter_advert")
        if ptype == PT_GRP_TXT:
            reason = self._dmc_group_text(payload, now, wall_now)
            if reason is not None:
                return reason
        limiter = self._limiters.get(ptype)
        if limiter is not None and not limiter.allow(now, self._rng.randrange(256)):
            _bump(c.rate, name)
            return sourced("filter_rate")
        return None

    def _dmc_group_text(self, payload: bytes, now: float, wall_now: float | None) -> str | None:
        """GRP_TXT checks: channel block, malformed scan (Public), then age limit and
        sender / text rules on Public plus the watch list. Decrypts once."""
        s = self.settings
        c = self.filter_counters
        if len(payload) <= 1 + CIPHER_MAC_SIZE:
            c.malformed["short"] += 1
            return "filter_malformed"
        channel = f"{payload[0]:02x}"
        if any(entry.hash == channel for entry in s.filter_channels):
            _bump(c.channel, channel)
            return "filter_channel"

        want_malformed = s.filter_malformed and payload[0] == DMC_PUBLIC_CHANNEL_HASH
        want_rules = bool(s.filter_sender_rules or s.filter_text_rules)
        secret = self._watched.get(payload[0]) if (want_rules or s.filter_age_minutes > 0) else None
        if not want_malformed and secret is None:
            return None
        when = wall_now if wall_now is not None else datetime.now().timestamp()
        data = _dmc_decrypt(
            secret if secret is not None else bytes.fromhex(PUBLIC_CHANNEL_KEY), payload
        )

        if want_malformed:
            reason = _dmc_message_invalid(data, when)
            if reason is not None:
                c.malformed[reason] += 1
                return "filter_malformed"

        # MessageAge::tooOld; a failed MAC (len < 4) has no timestamp to read.
        if secret is not None and s.filter_age_minutes > 0 and len(data) >= 4:
            stamp = int.from_bytes(data[0:4], "little")
            now_s = int(when)
            if dmc_clock_set(when) and stamp < now_s and now_s - stamp > s.filter_age_minutes * 60:
                c.age += 1
                return "filter_age"

        if secret is not None and want_rules and data:
            parsed = dmc_parse_group_text(data)
            if parsed is not None:
                sender, text = parsed
                roll = self._rng.randrange(100)  # one roll for both lists, like the firmware
                pattern = self._evaluate_rules(
                    "sender", s.filter_sender_rules, lambda p: dmc_match_name(p, sender), now, roll
                )
                if pattern is not None:
                    _bump(c.sender, pattern)
                    return "filter_sender"
                pattern = self._evaluate_rules(
                    "text", s.filter_text_rules, lambda p: dmc_match_text(p, text), now, roll
                )
                if pattern is not None:
                    _bump(c.text, pattern)
                    return "filter_text"
        return None

    def _evaluate_rules(
        self,
        kind: str,
        rules: list[FilterRule],
        match: Callable[[str], bool],
        now: float,
        roll: int,
    ) -> str | None:
        """``FilterRules::evaluate``: the pattern of the first rule that decides to drop.

        A failed roll or a within-budget throttle pass steps aside to the next rule;
        a throttle window is not extended by over-rate matches.
        """
        c = self.filter_counters
        passes = c.sender_pass if kind == "sender" else c.text_pass
        for rule in rules:
            if not match(rule.pattern):
                continue
            if rule.prob < 100 and roll >= rule.prob:
                continue
            if rule.secs > 0:
                key = (kind, rule.pattern)
                last = self._rule_last.get(key)
                if last is None or now - last >= rule.secs:
                    self._rule_last[key] = now
                    _bump(passes, rule.pattern)
                    continue
            return rule.pattern
        return None

    def _policy_fields(self, env: ParsedPacketEnvelope, facts: RxFacts) -> dict:
        """OpenHop policy context fields for one packet."""
        channel_hash = (
            f"{env.payload[0]:02x}"
            if env.payload_type in (PT_GRP_TXT, PT_GRP_DATA) and env.payload
            else None
        )
        path_hashes = (
            [env.path[i : i + env.hash_size].hex() for i in range(0, len(env.path), env.hash_size)]
            if env.payload_type != PT_TRACE
            else []
        )
        codes = env.transport_codes
        is_flood = env.route_type in (ROUTE_FLOOD, ROUTE_TRANSPORT_FLOOD)
        if not is_flood:
            region = None
        elif env.route_type == ROUTE_FLOOD:
            region = "unscoped"
        else:
            region = facts.region
        return {
            "route_type": env.route_type,
            "payload_type": env.payload_type,
            "payload_length": len(env.payload),
            "path_hash_size": env.hash_size,
            "hop_count": env.hop_count,
            "rssi": facts.rssi,
            "snr": facts.snr,
            "channel_hash": channel_hash,
            "channel_sender": facts.channel_sender,
            "channel_message_body": facts.channel_message_body,
            "channel_decryptable": facts.channel_decryptable,
            "path_hashes": path_hashes,
            "transport_code_0": codes[0] if codes else None,
            "transport_code_1": codes[1] if codes else None,
            "payload_hex": env.payload.hex(),
            "channel_name": facts.channel_name,
            "region": region,
            "path_first": path_hashes[0] if path_hashes else None,
            "path_last": path_hashes[-1] if path_hashes else None,
            "path_string": ">".join(path_hashes),
        }
