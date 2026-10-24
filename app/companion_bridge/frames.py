"""Companion protocol frames, as the companion radio firmware writes and reads them.

Layouts follow meshcore-dev/MeshCore ``examples/companion_radio/MyMesh.cpp``
(``handleCmdFrame``, ``writeContactRespFrame``, ``queueMessage``,
``onChannelMessageRecv``) and the serial/TCP framing of
``ArduinoSerialInterface``: the app sends ``'<' len(LE16) payload``, the radio
answers ``'>' len(LE16) payload``. All integers are little-endian.
"""

import struct

# Commands (app -> radio)
CMD_APP_START = 1
CMD_SEND_TXT_MSG = 2
CMD_SEND_CHANNEL_TXT_MSG = 3
CMD_GET_CONTACTS = 4
CMD_GET_DEVICE_TIME = 5
CMD_SET_DEVICE_TIME = 6
CMD_SYNC_NEXT_MESSAGE = 10
CMD_GET_BATT_AND_STORAGE = 20
CMD_DEVICE_QUERY = 22
CMD_HAS_CONNECTION = 28
CMD_GET_CONTACT_BY_KEY = 30
CMD_GET_CHANNEL = 31

# Responses (radio -> app)
RESP_CODE_OK = 0
RESP_CODE_ERR = 1
RESP_CODE_CONTACTS_START = 2
RESP_CODE_CONTACT = 3
RESP_CODE_END_OF_CONTACTS = 4
RESP_CODE_SELF_INFO = 5
RESP_CODE_SENT = 6
RESP_CODE_CONTACT_MSG_RECV = 7
RESP_CODE_CHANNEL_MSG_RECV = 8
RESP_CODE_CURR_TIME = 9
RESP_CODE_NO_MORE_MESSAGES = 10
RESP_CODE_BATT_AND_STORAGE = 12
RESP_CODE_DEVICE_INFO = 13
RESP_CODE_CONTACT_MSG_RECV_V3 = 16
RESP_CODE_CHANNEL_MSG_RECV_V3 = 17
RESP_CODE_CHANNEL_INFO = 18

# Pushes (radio -> app, unsolicited)
PUSH_CODE_SEND_CONFIRMED = 0x82
PUSH_CODE_MSG_WAITING = 0x83

# Error codes in a RESP_CODE_ERR frame
ERR_CODE_UNSUPPORTED_CMD = 1
ERR_CODE_NOT_FOUND = 2
ERR_CODE_TABLE_FULL = 3
ERR_CODE_BAD_STATE = 4
ERR_CODE_ILLEGAL_ARG = 6

TXT_TYPE_PLAIN = 0
ADV_TYPE_CHAT = 1

# MAX_FRAME_SIZE in the firmware (src/helpers/BaseSerialInterface.h).
MAX_FRAME_SIZE = 176
PUB_KEY_SIZE = 32
MAX_PATH_SIZE = 64
# 0xFF as a path length: no known route (contacts) or arrived direct (messages).
PATH_LEN_NONE = 0xFF

APP_TO_RADIO = 0x3C  # '<'
RADIO_TO_APP = 0x3E  # '>'


def wrap(payload: bytes) -> bytes:
    """One radio -> app frame on the wire."""
    if len(payload) > MAX_FRAME_SIZE:
        payload = payload[:MAX_FRAME_SIZE]
    return bytes([RADIO_TO_APP]) + struct.pack("<H", len(payload)) + payload


def _fixed(text: str, size: int) -> bytes:
    """UTF-8, cut to ``size`` bytes (never mid-character), NUL-padded."""
    raw = text.encode("utf-8")[:size]
    while raw:
        try:
            raw.decode("utf-8")
            break
        except UnicodeDecodeError:
            raw = raw[:-1]
    return raw.ljust(size, b"\0")


def _text_tail(text: str, room: int) -> bytes:
    """UTF-8 text for the end of a frame, cut to ``room`` bytes on a character edge."""
    return _fixed(text, max(room, 0)).rstrip(b"\0")


def ok() -> bytes:
    return bytes([RESP_CODE_OK])


def err(code: int) -> bytes:
    return bytes([RESP_CODE_ERR, code])


def curr_time(now: int) -> bytes:
    return bytes([RESP_CODE_CURR_TIME]) + struct.pack("<I", now & 0xFFFFFFFF)


def no_more_messages() -> bytes:
    return bytes([RESP_CODE_NO_MORE_MESSAGES])


def msg_waiting() -> bytes:
    return bytes([PUSH_CODE_MSG_WAITING])


def send_confirmed(ack: bytes, round_trip_ms: int) -> bytes:
    return (
        bytes([PUSH_CODE_SEND_CONFIRMED])
        + ack[:4].ljust(4, b"\0")
        + struct.pack("<I", max(0, round_trip_ms) & 0xFFFFFFFF)
    )


def sent(*, flood: bool, ack: bytes, est_timeout_ms: int) -> bytes:
    return (
        bytes([RESP_CODE_SENT, 1 if flood else 0])
        + ack[:4].ljust(4, b"\0")
        + struct.pack("<I", est_timeout_ms & 0xFFFFFFFF)
    )


def batt_and_storage(millivolts: int, used_kb: int = 0, total_kb: int = 0) -> bytes:
    return bytes([RESP_CODE_BATT_AND_STORAGE]) + struct.pack(
        "<HII", max(0, millivolts) & 0xFFFF, used_kb, total_kb
    )


def self_info(info: dict) -> bytes:
    """RESP_CODE_SELF_INFO from the connected radio's own self info."""
    lat = round(float(info.get("adv_lat") or 0.0) * 1e6)
    lon = round(float(info.get("adv_lon") or 0.0) * 1e6)
    telemetry = (
        (int(info.get("telemetry_mode_env") or 0) & 0b11) << 4
        | (int(info.get("telemetry_mode_loc") or 0) & 0b11) << 2
        | (int(info.get("telemetry_mode_base") or 0) & 0b11)
    )
    key = bytes.fromhex(str(info.get("public_key") or "")).ljust(PUB_KEY_SIZE, b"\0")
    payload = (
        bytes(
            [
                RESP_CODE_SELF_INFO,
                int(info.get("adv_type") or ADV_TYPE_CHAT) & 0xFF,
                int(info.get("tx_power") or 0) & 0xFF,
                int(info.get("max_tx_power") or 0) & 0xFF,
            ]
        )
        + key[:PUB_KEY_SIZE]
        + struct.pack("<ii", lat, lon)
        + bytes(
            [
                int(info.get("multi_acks") or 0) & 0xFF,
                int(info.get("adv_loc_policy") or 0) & 0xFF,
                telemetry,
                1 if info.get("manual_add_contacts") else 0,
            ]
        )
        + struct.pack(
            "<II",
            round(float(info.get("radio_freq") or 0.0) * 1000),
            round(float(info.get("radio_bw") or 0.0) * 1000),
        )
        + bytes([int(info.get("radio_sf") or 0) & 0xFF, int(info.get("radio_cr") or 0) & 0xFF])
    )
    return payload + _text_tail(str(info.get("name") or ""), MAX_FRAME_SIZE - len(payload))


def device_info(
    *,
    firmware_ver_code: int,
    max_contacts: int,
    max_channels: int,
    build: str,
    model: str,
    version: str,
    repeat: bool = False,
    path_hash_mode: int = 0,
) -> bytes:
    """RESP_CODE_DEVICE_INFO. The BLE PIN is always reported as 0."""
    return (
        bytes(
            [
                RESP_CODE_DEVICE_INFO,
                firmware_ver_code & 0xFF,
                min(max_contacts // 2, 0xFF),
                min(max_channels, 0xFF),
            ]
        )
        + struct.pack("<I", 0)
        + _fixed(build, 12)
        + _fixed(model, 40)
        + _fixed(version, 20)
        + bytes([1 if repeat else 0, path_hash_mode & 0xFF])
    )


def encode_path_len(hops: int | None, hash_mode: int | None) -> int:
    """The firmware's path length byte: hash size - 1 in the top 2 bits, hop count below."""
    if hops is None or hops < 0:
        return PATH_LEN_NONE
    mode = hash_mode if hash_mode is not None and 0 <= hash_mode <= 2 else 0
    return ((mode & 0b11) << 6) | (min(hops, 0x3F) & 0x3F)


def contact(
    *,
    public_key: str,
    name: str,
    contact_type: int,
    flags: int,
    path_hex: str | None,
    path_hops: int | None,
    path_hash_mode: int | None,
    last_advert: int,
    lat: float | None,
    lon: float | None,
    lastmod: int,
) -> bytes:
    """RESP_CODE_CONTACT (layout of ``writeContactRespFrame``)."""
    key = bytes.fromhex(public_key)[:PUB_KEY_SIZE].ljust(PUB_KEY_SIZE, b"\0")
    try:
        path = bytes.fromhex(path_hex or "")
    except ValueError:
        path = b""
    return (
        bytes([RESP_CODE_CONTACT])
        + key
        + bytes(
            [
                contact_type & 0xFF,
                flags & 0xFF,
                encode_path_len(path_hops, path_hash_mode),
            ]
        )
        + path[:MAX_PATH_SIZE].ljust(MAX_PATH_SIZE, b"\0")
        + _fixed(name, 32)
        + struct.pack(
            "<IiiI",
            max(0, last_advert) & 0xFFFFFFFF,
            round((lat or 0.0) * 1e6),
            round((lon or 0.0) * 1e6),
            max(0, lastmod) & 0xFFFFFFFF,
        )
    )


def contacts_start(count: int) -> bytes:
    return bytes([RESP_CODE_CONTACTS_START]) + struct.pack("<I", count)


def end_of_contacts(most_recent_lastmod: int) -> bytes:
    return bytes([RESP_CODE_END_OF_CONTACTS]) + struct.pack(
        "<I", max(0, most_recent_lastmod) & 0xFFFFFFFF
    )


def channel_info(index: int, name: str, secret: bytes) -> bytes:
    return (
        bytes([RESP_CODE_CHANNEL_INFO, index & 0xFF])
        + _fixed(name, 32)
        + secret[:16].ljust(16, b"\0")
    )


def contact_message(
    *,
    v3: bool,
    snr: float | None,
    pubkey_prefix: bytes,
    path_len: int,
    txt_type: int,
    sender_timestamp: int,
    text: str,
) -> bytes:
    if v3:
        head = bytes([RESP_CODE_CONTACT_MSG_RECV_V3, _snr_byte(snr), 0, 0])
    else:
        head = bytes([RESP_CODE_CONTACT_MSG_RECV])
    payload = (
        head
        + pubkey_prefix[:6].ljust(6, b"\0")
        + bytes([path_len & 0xFF, txt_type & 0xFF])
        + struct.pack("<I", sender_timestamp & 0xFFFFFFFF)
    )
    return payload + _text_tail(text, MAX_FRAME_SIZE - len(payload))


def channel_message(
    *,
    v3: bool,
    snr: float | None,
    channel_index: int,
    path_len: int,
    sender_timestamp: int,
    text: str,
) -> bytes:
    if v3:
        head = bytes([RESP_CODE_CHANNEL_MSG_RECV_V3, _snr_byte(snr), 0, 0])
    else:
        head = bytes([RESP_CODE_CHANNEL_MSG_RECV])
    payload = (
        head
        + bytes([channel_index & 0xFF, path_len & 0xFF, TXT_TYPE_PLAIN])
        + struct.pack("<I", sender_timestamp & 0xFFFFFFFF)
    )
    return payload + _text_tail(text, MAX_FRAME_SIZE - len(payload))


def _snr_byte(snr: float | None) -> int:
    if snr is None:
        return 0
    value = max(-128, min(127, round(snr * 4)))
    return value & 0xFF


class FrameReader:
    """Collects app -> radio frames from a byte stream (``'<' len payload``)."""

    def __init__(self) -> None:
        self._buf = bytearray()

    def feed(self, data: bytes) -> list[bytes]:
        self._buf.extend(data)
        frames: list[bytes] = []
        while True:
            start = self._buf.find(bytes([APP_TO_RADIO]))
            if start < 0:
                self._buf.clear()
                return frames
            if start:
                del self._buf[:start]
            if len(self._buf) < 3:
                return frames
            (length,) = struct.unpack_from("<H", self._buf, 1)
            if length == 0:
                del self._buf[:3]
                continue
            if len(self._buf) < 3 + length:
                return frames
            frame = bytes(self._buf[3 : 3 + length])
            del self._buf[: 3 + length]
            # Like the firmware: anything past MAX_FRAME_SIZE is dropped.
            frames.append(frame[:MAX_FRAME_SIZE])
