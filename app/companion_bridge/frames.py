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
CMD_SEND_SELF_ADVERT = 7
CMD_SET_ADVERT_NAME = 8
CMD_ADD_UPDATE_CONTACT = 9
CMD_SYNC_NEXT_MESSAGE = 10
CMD_SET_RADIO_PARAMS = 11
CMD_SET_RADIO_TX_POWER = 12
CMD_RESET_PATH = 13
CMD_SET_ADVERT_LATLON = 14
CMD_REMOVE_CONTACT = 15
CMD_SHARE_CONTACT = 16
CMD_EXPORT_CONTACT = 17
CMD_IMPORT_CONTACT = 18
CMD_REBOOT = 19
CMD_GET_BATT_AND_STORAGE = 20
CMD_SET_TUNING_PARAMS = 21
CMD_DEVICE_QUERY = 22
CMD_EXPORT_PRIVATE_KEY = 23
CMD_IMPORT_PRIVATE_KEY = 24
CMD_SEND_RAW_DATA = 25
CMD_SEND_LOGIN = 26
CMD_SEND_STATUS_REQ = 27
CMD_HAS_CONNECTION = 28
CMD_LOGOUT = 29
CMD_GET_CONTACT_BY_KEY = 30
CMD_GET_CHANNEL = 31
CMD_SET_CHANNEL = 32
CMD_SIGN_START = 33
CMD_SIGN_DATA = 34
CMD_SIGN_FINISH = 35
CMD_SEND_TRACE_PATH = 36
CMD_SET_DEVICE_PIN = 37
CMD_SET_OTHER_PARAMS = 38
CMD_SEND_TELEMETRY_REQ = 39
CMD_GET_CUSTOM_VARS = 40
CMD_SET_CUSTOM_VAR = 41
CMD_GET_ADVERT_PATH = 42
CMD_GET_TUNING_PARAMS = 43
CMD_SEND_BINARY_REQ = 50
CMD_FACTORY_RESET = 51
CMD_SEND_PATH_DISCOVERY_REQ = 52
CMD_SET_FLOOD_SCOPE_KEY = 54
CMD_SEND_CONTROL_DATA = 55
CMD_GET_STATS = 56
CMD_SEND_ANON_REQ = 57
CMD_SET_AUTOADD_CONFIG = 58
CMD_GET_AUTOADD_CONFIG = 59
CMD_GET_ALLOWED_REPEAT_FREQ = 60
CMD_SET_PATH_HASH_MODE = 61
CMD_SEND_CHANNEL_DATA = 62
CMD_SET_DEFAULT_FLOOD_SCOPE = 63
CMD_GET_DEFAULT_FLOOD_SCOPE = 64
CMD_SEND_RAW_PACKET = 65
CMD_RUN_CLI_COMMAND = 66

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
RESP_CODE_EXPORT_CONTACT = 11
RESP_CODE_BATT_AND_STORAGE = 12
RESP_CODE_DEVICE_INFO = 13
RESP_CODE_PRIVATE_KEY = 14
RESP_CODE_DISABLED = 15
RESP_CODE_CONTACT_MSG_RECV_V3 = 16
RESP_CODE_CHANNEL_MSG_RECV_V3 = 17
RESP_CODE_CHANNEL_INFO = 18
RESP_CODE_SIGN_START = 19
RESP_CODE_SIGNATURE = 20
RESP_CODE_CUSTOM_VARS = 21
RESP_CODE_ADVERT_PATH = 22
RESP_CODE_TUNING_PARAMS = 23
RESP_CODE_STATS = 24
RESP_CODE_AUTOADD_CONFIG = 25
RESP_CODE_ALLOWED_REPEAT_FREQ = 26
RESP_CODE_DEFAULT_FLOOD_SCOPE = 28
RESP_CODE_CLI_REPLY = 29

# Pushes (radio -> app, unsolicited)
PUSH_CODE_ADVERT = 0x80
PUSH_CODE_PATH_UPDATED = 0x81
PUSH_CODE_SEND_CONFIRMED = 0x82
PUSH_CODE_MSG_WAITING = 0x83
PUSH_CODE_RAW_DATA = 0x84
PUSH_CODE_LOGIN_SUCCESS = 0x85
PUSH_CODE_LOGIN_FAIL = 0x86
PUSH_CODE_STATUS_RESPONSE = 0x87
PUSH_CODE_LOG_RX_DATA = 0x88
PUSH_CODE_TRACE_DATA = 0x89
PUSH_CODE_NEW_ADVERT = 0x8A
PUSH_CODE_TELEMETRY_RESPONSE = 0x8B
PUSH_CODE_BINARY_RESPONSE = 0x8C
PUSH_CODE_PATH_DISCOVERY_RESPONSE = 0x8D
PUSH_CODE_CONTROL_DATA = 0x8E
PUSH_CODE_CONTACT_DELETED = 0x8F
PUSH_CODE_CONTACTS_FULL = 0x90

# Error codes in a RESP_CODE_ERR frame
ERR_CODE_UNSUPPORTED_CMD = 1
ERR_CODE_NOT_FOUND = 2
ERR_CODE_TABLE_FULL = 3
ERR_CODE_BAD_STATE = 4
ERR_CODE_FILE_IO_ERROR = 5
ERR_CODE_ILLEGAL_ARG = 6

TXT_TYPE_PLAIN = 0
TXT_TYPE_CLI_DATA = 1
ADV_TYPE_CHAT = 1

# MAX_FRAME_SIZE in the firmware (src/helpers/BaseSerialInterface.h).
MAX_FRAME_SIZE = 176
PUB_KEY_SIZE = 32
MAX_PATH_SIZE = 64
# 0xFF as a path length: no known route (contacts) or arrived direct (messages).
PATH_LEN_NONE = 0xFF
# MAX_SIGN_DATA_LEN in MyMesh.cpp: the most data CMD_SIGN_DATA may collect.
MAX_SIGN_DATA_LEN = 8 * 1024

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


def disabled() -> bytes:
    return bytes([RESP_CODE_DISABLED])


def cli_reply(text: str) -> bytes:
    """RESP_CODE_CLI_REPLY: the reply of the radio's own command line."""
    head = bytes([RESP_CODE_CLI_REPLY])
    return head + _text_tail(text, MAX_FRAME_SIZE - len(head))


def sign_start(max_len: int = MAX_SIGN_DATA_LEN) -> bytes:
    return bytes([RESP_CODE_SIGN_START, 0]) + struct.pack("<I", max_len)


def contact_deleted(public_key: str) -> bytes:
    return bytes([PUSH_CODE_CONTACT_DELETED]) + bytes.fromhex(public_key)[:PUB_KEY_SIZE].ljust(
        PUB_KEY_SIZE, b"\0"
    )


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


def decode_path_len(value: int) -> tuple[int | None, int]:
    """(hops, hash mode) from the firmware's path length byte; hops None when unknown."""
    if value == PATH_LEN_NONE:
        return None, 0
    return value & 0x3F, (value >> 6) & 0b11


def parse_contact_frame(frame: bytes) -> dict:
    """CMD_ADD_UPDATE_CONTACT fields (layout of ``updateContactFromFrame``).

    Raises ValueError when the frame is shorter than the fixed part.
    """
    fixed = 1 + PUB_KEY_SIZE + 3 + MAX_PATH_SIZE + 32 + 4
    if len(frame) < fixed:
        raise ValueError("contact frame too short")
    i = 1
    key = frame[i : i + PUB_KEY_SIZE].hex()
    i += PUB_KEY_SIZE
    contact_type, flags, path_len = frame[i], frame[i + 1], frame[i + 2]
    i += 3
    path_raw = frame[i : i + MAX_PATH_SIZE]
    i += MAX_PATH_SIZE
    name = frame[i : i + 32].split(b"\0", 1)[0].decode("utf-8", "replace")
    i += 32
    (last_advert,) = struct.unpack_from("<I", frame, i)
    i += 4
    lat = lon = None
    if len(frame) >= i + 8:
        raw_lat, raw_lon = struct.unpack_from("<ii", frame, i)
        lat, lon = raw_lat / 1e6, raw_lon / 1e6
    hops, hash_mode = decode_path_len(path_len)
    path_hex = None
    if hops is not None:
        path_hex = path_raw[: min(hops * (hash_mode + 1), MAX_PATH_SIZE)].hex()
    return {
        "public_key": key,
        "type": contact_type,
        "flags": flags,
        "path_hops": hops,
        "path_hash_mode": hash_mode,
        "path_hex": path_hex,
        "name": name,
        "last_advert": last_advert,
        "lat": lat,
        "lon": lon,
    }


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
