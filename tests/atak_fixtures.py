"""Hand-built TAK-MESHCORE / MeshCore SAR wire payloads for tests (struct, not the decoders)."""

import base64
import gzip
import struct


def ax25_addr(callsign: str, ssid: int, last: bool) -> bytes:
    padded = (callsign + "      ")[:6].encode("ascii")
    return bytes(b << 1 for b in padded) + bytes([0x60 | (ssid << 1) | (1 if last else 0)])


def ax25_frame(dest: str, src: str, info: bytes) -> bytes:
    return ax25_addr(dest, 0, False) + ax25_addr(src, 0, True) + b"\x03\xf0" + info


def tlv(kind: int, value: bytes) -> bytes:
    return bytes([kind]) + struct.pack(">H", len(value)) + value


def gps_value(
    lat: float = 52.3702,
    lon: float = 4.8952,
    callsign: str = "JSTR25",
    full: str | None = "JESTER_25",
    team: str | None = "Cyan",
    battery: int = 80,
) -> bytes:
    body = callsign.encode("ascii").ljust(6) + struct.pack(
        ">iihHHBB", round(lat * 1e7), round(lon * 1e7), 12, 150, 27000, 0x05, battery
    )
    if full is not None:
        body += b"|" + full.encode()
        if team is not None:
            body += b"\x00" + team.encode()
    return body


def chat_value(text: str = "hello", sender: str = "JSTR25", msg_id: int = 99) -> bytes:
    return sender.encode().ljust(6) + b"ALL   " + struct.pack(">i", msg_id) + text.encode()


def cot_gz(
    uid: str = "u-1",
    cot_type: str = "a-h-G",
    lat: float = 52.1,
    lon: float = 5.1,
    callsign: str = "OP-1",
    remarks: str = "hi",
    stale: str = "2099-01-01T00:00:00Z",
) -> bytes:
    xml = (
        f'<event version="2.0" uid="{uid}" type="{cot_type}" stale="{stale}">'
        f'<point lat="{lat}" lon="{lon}" hae="0" ce="9999999" le="9999999"/>'
        f'<detail><contact callsign="{callsign}"/><remarks>{remarks}</remarks></detail></event>'
    )
    return gzip.compress(xml.encode())


def envelopes(frame: bytes, msg_id: str = "1", chunk: int = 57) -> list[bytes]:
    parts = [frame[i : i + chunk] for i in range(0, len(frame), chunk)]
    return [
        f"UVAX1|{msg_id}|{n}|{len(parts)}|{base64.b64encode(p).decode()}".encode()
        for n, p in enumerate(parts, start=1)
    ]


def sar_fast_gps(prefix_hex: str = "a1b2c3d4e5f6", lat: float = 52.0, lon: float = 5.0) -> bytes:
    return (
        b"\x47"
        + bytes.fromhex(prefix_hex)
        + struct.pack("<ii", round(lat * 1e6), round(lon * 1e6))
        + bytes([36])
    )
