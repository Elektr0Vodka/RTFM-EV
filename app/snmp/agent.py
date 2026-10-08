"""Read-only SNMPv2c agent: answers GET, GETNEXT and GETBULK from a value table.

``handle_request`` is a pure function from one request datagram to one reply
datagram (or None when nothing must be sent), so the protocol logic is tested
without sockets. ``SnmpAgentProtocol`` is the thin UDP wrapper around it.

Behaviour, by design:
- A wrong community or a malformed datagram gets no reply at all.
- SET is refused with ``notWritable``; nothing is ever changed.
- Only SNMPv2c is spoken (``decode_message`` rejects v1 and v3).
"""

from __future__ import annotations

import asyncio
import hmac
from bisect import bisect_right
from collections.abc import Callable
from dataclasses import dataclass

from app.snmp import ber
from app.snmp.ber import BerError, Oid, SnmpValue
from app.snmp.message import (
    ERROR_NO_ERROR,
    ERROR_TOO_BIG,
    PDU_GET,
    PDU_GETNEXT,
    PDU_RESPONSE,
    PDU_SET,
    SnmpMessage,
    VarBind,
    decode_message,
    encode_message,
)

ERROR_NOT_WRITABLE = 17

# Keep replies inside one unfragmented Ethernet frame, like the firmware agent.
MAX_RESPONSE_BYTES = 1400
MAX_BULK_VARBINDS = 100

_NO_SUCH_OBJECT = SnmpValue(ber.TAG_NO_SUCH_OBJECT)
_END_OF_MIB_VIEW = SnmpValue(ber.TAG_END_OF_MIB_VIEW)

# Returns the served values, sorted by OID.
TableProvider = Callable[[], list[VarBind]]


@dataclass
class AgentCounters:
    requests: int = 0
    bad_community: int = 0
    malformed: int = 0


def _get_next(table: list[VarBind], oids: list[Oid], oid: Oid) -> VarBind:
    index = bisect_right(oids, oid)
    if index >= len(table):
        return (oid, _END_OF_MIB_VIEW)
    return table[index]


def _answer(request: SnmpMessage, table: list[VarBind]) -> tuple[list[VarBind], bool]:
    """Response varbinds for a request, and whether they may be cut short."""
    oids = [oid for oid, _ in table]
    by_oid = dict(table)

    if request.pdu_type == PDU_GET:
        return [(oid, by_oid.get(oid, _NO_SUCH_OBJECT)) for oid, _ in request.varbinds], False

    if request.pdu_type == PDU_GETNEXT:
        return [_get_next(table, oids, oid) for oid, _ in request.varbinds], False

    # What is left is a GetBulkRequest (SET and Response never get here):
    # error-status carries non-repeaters, error-index max-repetitions.
    non_repeaters = max(0, min(request.error_status, len(request.varbinds)))
    max_repetitions = max(0, request.error_index)
    out = [_get_next(table, oids, oid) for oid, _ in request.varbinds[:non_repeaters]]
    current = [oid for oid, _ in request.varbinds[non_repeaters:]]
    for _ in range(max_repetitions):
        if not current or len(out) >= MAX_BULK_VARBINDS:
            break
        row = [_get_next(table, oids, oid) for oid in current]
        out.extend(row)
        if all(value.tag == ber.TAG_END_OF_MIB_VIEW for _, value in row):
            break
        current = [oid for oid, _ in row]
    return out[:MAX_BULK_VARBINDS], True


def handle_request(
    data: bytes,
    community: bytes,
    provider: TableProvider,
    counters: AgentCounters | None = None,
) -> bytes | None:
    """Turn one request datagram into its reply datagram, or None for no reply."""
    counters = counters if counters is not None else AgentCounters()
    try:
        request = decode_message(data)
    except BerError:
        counters.malformed += 1
        return None
    if not hmac.compare_digest(request.community, community):
        counters.bad_community += 1
        return None
    if request.pdu_type == PDU_RESPONSE:
        return None
    counters.requests += 1

    def reply(varbinds: list[VarBind], status: int = ERROR_NO_ERROR, index: int = 0) -> bytes:
        return encode_message(
            SnmpMessage(
                community=request.community,
                pdu_type=PDU_RESPONSE,
                request_id=request.request_id,
                error_status=status,
                error_index=index,
                varbinds=varbinds,
            )
        )

    if request.pdu_type == PDU_SET:
        return reply(request.varbinds, ERROR_NOT_WRITABLE, 1 if request.varbinds else 0)

    varbinds, may_truncate = _answer(request, provider())
    encoded = reply(varbinds)
    if len(encoded) <= MAX_RESPONSE_BYTES:
        return encoded
    if not may_truncate:
        return reply([], ERROR_TOO_BIG)
    # A bulk reply may hold fewer repetitions than asked for (RFC 3416 4.2.3).
    while varbinds and len(encoded) > MAX_RESPONSE_BYTES:
        varbinds = varbinds[: max(0, len(varbinds) * 3 // 4)]
        encoded = reply(varbinds)
    return encoded


class SnmpAgentProtocol(asyncio.DatagramProtocol):
    def __init__(self, community: bytes, provider: TableProvider) -> None:
        self._community = community
        self._provider = provider
        self._transport: asyncio.DatagramTransport | None = None
        self.counters = AgentCounters()

    def connection_made(self, transport: asyncio.BaseTransport) -> None:
        self._transport = transport  # type: ignore[assignment]

    def datagram_received(self, data: bytes, addr: tuple) -> None:
        try:
            response = handle_request(data, self._community, self._provider, self.counters)
        except Exception:  # noqa: BLE001 - a bad request must never take the listener down
            self.counters.malformed += 1
            return
        if response is not None and self._transport is not None:
            self._transport.sendto(response, addr)
