"""Async SNMPv2c GET over UDP.

One request goes out on a connected UDP socket, so only datagrams from the
polled host and port are delivered. A reply counts only when it is a Response
PDU carrying our request-id; anything else is ignored and the wait goes on.
Nothing here touches the radio.
"""

from __future__ import annotations

import asyncio
import secrets

from app.snmp import ber
from app.snmp.ber import BerError, Oid, SnmpValue
from app.snmp.message import (
    ERROR_NO_ERROR,
    ERROR_TOO_BIG,
    PDU_GET,
    PDU_RESPONSE,
    SnmpMessage,
    VarBind,
    decode_message,
    encode_message,
)
from app.snmp.mib import ENTRIES, MibValue, decode_varbinds

DEFAULT_PORT = 161
DEFAULT_TIMEOUT_SECONDS = 2.0
DEFAULT_RETRIES = 1

_ERROR_NAMES = {
    1: "tooBig",
    2: "noSuchName",
    3: "badValue",
    4: "readOnly",
    5: "genErr",
    6: "noAccess",
    16: "authorizationError",
}


class SnmpError(Exception):
    """An SNMP request failed (network error, agent error, bad reply)."""


class SnmpTimeoutError(SnmpError):
    """No matching reply arrived in time (wrong address, community or port)."""


class SnmpResponseError(SnmpError):
    """The agent answered with a non-zero error-status."""

    def __init__(self, status: int, index: int) -> None:
        self.status = status
        self.index = index
        name = _ERROR_NAMES.get(status, str(status))
        super().__init__(f"agent returned error {name} (index {index})")


class _GetProtocol(asyncio.DatagramProtocol):
    def __init__(self, request_id: int, reply: asyncio.Future[SnmpMessage]) -> None:
        self._request_id = request_id
        self._reply = reply

    def datagram_received(self, data: bytes, addr: object) -> None:
        try:
            message = decode_message(data)
        except BerError:
            return
        if message.pdu_type != PDU_RESPONSE or message.request_id != self._request_id:
            return
        if not self._reply.done():
            self._reply.set_result(message)

    def error_received(self, exc: Exception) -> None:
        # e.g. ICMP port unreachable on a connected UDP socket.
        if not self._reply.done():
            self._reply.set_exception(SnmpError(f"network error: {exc}"))


async def snmp_get(
    host: str,
    port: int,
    community: str,
    oids: list[Oid],
    *,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    retries: int = DEFAULT_RETRIES,
) -> list[VarBind]:
    """Send one GetRequest and return the response varbinds.

    Raises ``SnmpTimeoutError`` when nothing matching arrives after
    ``1 + retries`` sends, ``SnmpResponseError`` for an agent error-status and
    ``SnmpError`` for a network or name-resolution failure.
    """
    loop = asyncio.get_running_loop()
    request_id = secrets.randbelow(0x7FFFFFFF) + 1
    payload = encode_message(
        SnmpMessage(
            community=community.encode("utf-8"),
            pdu_type=PDU_GET,
            request_id=request_id,
            varbinds=[(oid, SnmpValue(ber.TAG_NULL)) for oid in oids],
        )
    )
    reply: asyncio.Future[SnmpMessage] = loop.create_future()
    try:
        transport, _ = await loop.create_datagram_endpoint(
            lambda: _GetProtocol(request_id, reply), remote_addr=(host, port)
        )
    except OSError as exc:
        raise SnmpError(f"cannot reach {host}:{port}: {exc}") from exc

    try:
        for _ in range(1 + max(0, retries)):
            transport.sendto(payload)
            try:
                message = await asyncio.wait_for(asyncio.shield(reply), timeout)
            except TimeoutError:
                continue
            if message.error_status != ERROR_NO_ERROR:
                raise SnmpResponseError(message.error_status, message.error_index)
            return message.varbinds
        raise SnmpTimeoutError(f"no SNMP reply from {host}:{port}")
    finally:
        transport.close()
        if not reply.done():
            reply.cancel()


async def snmp_get_all(
    host: str,
    port: int,
    community: str,
    oids: list[Oid],
    *,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    retries: int = DEFAULT_RETRIES,
) -> list[VarBind]:
    """GET ``oids`` in one request, halving the request while the agent says tooBig."""
    try:
        return await snmp_get(host, port, community, oids, timeout=timeout, retries=retries)
    except SnmpResponseError as exc:
        if exc.status != ERROR_TOO_BIG or len(oids) < 2:
            raise
    half = len(oids) // 2
    first = await snmp_get_all(host, port, community, oids[:half], timeout=timeout, retries=retries)
    second = await snmp_get_all(
        host, port, community, oids[half:], timeout=timeout, retries=retries
    )
    return first + second


async def poll_meshcore(
    host: str,
    port: int,
    community: str,
    *,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    retries: int = DEFAULT_RETRIES,
) -> dict[str, MibValue]:
    """Read the whole MeshCore OID table from one node."""
    varbinds = await snmp_get_all(
        host, port, community, [entry.oid for entry in ENTRIES], timeout=timeout, retries=retries
    )
    return decode_varbinds(varbinds)
