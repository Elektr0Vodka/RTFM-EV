"""meshcore:// contact links: parse/validate, export via the radio, import via the radio.

A contact link is "meshcore://" + lowercase hex of the raw advert packet, the
same format meshcore-open copies (contacts_screen.dart) and meshcore_py returns
for CMD_EXPORT_CONTACT (EventType.CONTACT_URI). The radio is always mocked:
export/import are local radio commands, and share_contact (which transmits) is
never used.
"""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from meshcore import EventType

from app.contact_uri import ContactUriError, format_contact_uri, parse_contact_uri
from app.repository import ContactRepository

# Real captured advert (name "Flightless" + emoji); same vector as test_decoder.py.
REAL_ADVERT_PACKET = bytes.fromhex(
    "1100AE92564C5C9884854F04F469BBB2BAB8871A078053AF6CF4AA2C014B18CE8A83"
    "2DBF6669128E9476F36320F21D1B37FF1CF31680F50F4B17EDABCC7CF8C47D3C5E1D"
    "F3AFD0C8721EA06A8078462EF241DEF80AD6922751F206E3BB121DFB604F4146D60D"
    "913628D902602DB5F8466C696768746C657373F09FA59D"
)
REAL_KEY = "ae92564c5c9884854f04f469bbb2bab8871a078053af6cf4aa2c014b18ce8a83"
REAL_URI = "meshcore://" + REAL_ADVERT_PACKET.hex()


def _result(event_type=EventType.OK, payload=None):
    result = MagicMock()
    result.type = event_type
    result.payload = payload if payload is not None else {}
    return result


def _noop_radio_operation(mc):
    @asynccontextmanager
    async def _ctx(*_args, **_kwargs):
        yield mc

    return _ctx


def _flip(raw: bytes, index: int) -> bytes:
    data = bytearray(raw)
    data[index] ^= 0x01
    return bytes(data)


class TestParseContactUri:
    def test_parses_real_advert(self):
        card = parse_contact_uri(REAL_URI)

        assert card.raw == REAL_ADVERT_PACKET
        assert card.public_key == REAL_KEY
        assert card.advert.name is not None and card.advert.name.startswith("Flightless")

    def test_accepts_uppercase_hex_scheme_case_and_whitespace(self):
        uri = "  MeshCore://" + REAL_ADVERT_PACKET.hex().upper() + "\n"

        assert parse_contact_uri(uri).raw == REAL_ADVERT_PACKET

    def test_format_is_lowercase_hex(self):
        assert format_contact_uri(REAL_ADVERT_PACKET) == REAL_URI
        assert not any(c.isupper() for c in REAL_URI)

    @pytest.mark.parametrize(
        "uri",
        [
            "",
            REAL_ADVERT_PACKET.hex(),  # no scheme
            "https://" + REAL_ADVERT_PACKET.hex(),
            "meshcore://",
            "meshcore://" + REAL_ADVERT_PACKET.hex()[:-1],  # odd length
            "meshcore://zz" + REAL_ADVERT_PACKET.hex(),  # not hex
            "meshcore://" + REAL_ADVERT_PACKET.hex()[:60],  # truncated advert
            "meshcore://15" + REAL_ADVERT_PACKET.hex()[2:],  # GRP_TXT header, not an advert
            "meshcore://" + ("11" + "00" * 300),  # longer than a LoRa packet
        ],
    )
    def test_rejects_malformed(self, uri):
        with pytest.raises(ContactUriError):
            parse_contact_uri(uri)

    @pytest.mark.parametrize("index", [5, 40, 110])  # pubkey, signature, app data
    def test_rejects_bad_signature(self, index):
        # Offsets are into the payload; the packet has a 2-byte header+path prefix.
        with pytest.raises(ContactUriError):
            parse_contact_uri("meshcore://" + _flip(REAL_ADVERT_PACKET, index + 2).hex())


class TestExportOwnContactUri:
    @pytest.mark.asyncio
    async def test_returns_radio_uri(self, test_db, client):
        mc = MagicMock()
        mc.commands.export_contact = AsyncMock(
            return_value=_result(EventType.CONTACT_URI, {"uri": REAL_URI})
        )
        with patch("app.routers.radio.radio_manager") as mock_rm:
            mock_rm.require_connected.return_value = mc
            mock_rm.radio_operation = _noop_radio_operation(mc)
            response = await client.get("/api/radio/contact-uri")

        assert response.status_code == 200
        assert response.json() == {"uri": REAL_URI, "public_key": REAL_KEY}
        mc.commands.export_contact.assert_awaited_once_with()
        mc.commands.share_contact.assert_not_called()

    @pytest.mark.asyncio
    async def test_radio_error_is_502(self, test_db, client):
        mc = MagicMock()
        mc.commands.export_contact = AsyncMock(return_value=_result(EventType.ERROR, {}))
        with patch("app.routers.radio.radio_manager") as mock_rm:
            mock_rm.require_connected.return_value = mc
            mock_rm.radio_operation = _noop_radio_operation(mc)
            response = await client.get("/api/radio/contact-uri")

        assert response.status_code == 502

    @pytest.mark.asyncio
    async def test_invalid_radio_uri_is_502(self, test_db, client):
        mc = MagicMock()
        mc.commands.export_contact = AsyncMock(
            return_value=_result(EventType.CONTACT_URI, {"uri": "meshcore://00"})
        )
        with patch("app.routers.radio.radio_manager") as mock_rm:
            mock_rm.require_connected.return_value = mc
            mock_rm.radio_operation = _noop_radio_operation(mc)
            response = await client.get("/api/radio/contact-uri")

        assert response.status_code == 502


class TestExportContactUri:
    @pytest.mark.asyncio
    async def test_returns_radio_uri_for_contact(self, test_db, client):
        await ContactRepository.upsert({"public_key": REAL_KEY, "name": "Flightless"})
        mc = MagicMock()
        mc.commands.export_contact = AsyncMock(
            return_value=_result(EventType.CONTACT_URI, {"uri": REAL_URI})
        )
        with patch("app.routers.contacts.radio_manager") as mock_rm:
            mock_rm.require_connected.return_value = mc
            mock_rm.radio_operation = _noop_radio_operation(mc)
            response = await client.get(f"/api/contacts/{REAL_KEY}/contact-uri")

        assert response.status_code == 200
        assert response.json() == {"uri": REAL_URI, "public_key": REAL_KEY}
        mc.commands.export_contact.assert_awaited_once_with(REAL_KEY)
        mc.commands.share_contact.assert_not_called()

    @pytest.mark.asyncio
    async def test_radio_returns_other_nodes_advert_is_502(self, test_db, client):
        other = "bb" * 32
        await ContactRepository.upsert({"public_key": other, "name": "Other"})
        mc = MagicMock()
        mc.commands.export_contact = AsyncMock(
            return_value=_result(EventType.CONTACT_URI, {"uri": REAL_URI})
        )
        with patch("app.routers.contacts.radio_manager") as mock_rm:
            mock_rm.require_connected.return_value = mc
            mock_rm.radio_operation = _noop_radio_operation(mc)
            response = await client.get(f"/api/contacts/{other}/contact-uri")

        assert response.status_code == 502

    @pytest.mark.asyncio
    async def test_contact_not_on_radio_is_404(self, test_db, client):
        await ContactRepository.upsert({"public_key": REAL_KEY, "name": "Flightless"})
        mc = MagicMock()
        mc.commands.export_contact = AsyncMock(return_value=_result(EventType.ERROR, {}))
        with patch("app.routers.contacts.radio_manager") as mock_rm:
            mock_rm.require_connected.return_value = mc
            mock_rm.radio_operation = _noop_radio_operation(mc)
            response = await client.get(f"/api/contacts/{REAL_KEY}/contact-uri")

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_unknown_contact_is_404_without_radio_call(self, test_db, client):
        mc = MagicMock()
        mc.commands.export_contact = AsyncMock()
        with patch("app.routers.contacts.radio_manager") as mock_rm:
            mock_rm.require_connected.return_value = mc
            mock_rm.radio_operation = _noop_radio_operation(mc)
            response = await client.get(f"/api/contacts/{'cc' * 32}/contact-uri")

        assert response.status_code == 404
        mc.commands.export_contact.assert_not_called()


class TestImportContactUri:
    @pytest.mark.asyncio
    async def test_imports_valid_link_and_creates_contact(self, test_db, client):
        mc = MagicMock()
        mc.commands.import_contact = AsyncMock(return_value=_result(EventType.OK))
        with (
            patch("app.routers.contacts.radio_manager") as mock_rm,
            patch("app.websocket.broadcast_event"),
        ):
            mock_rm.require_connected.return_value = mc
            mock_rm.radio_operation = _noop_radio_operation(mc)
            response = await client.post("/api/contacts/import-uri", json={"uri": REAL_URI})

        assert response.status_code == 200
        body = response.json()
        assert body["public_key"] == REAL_KEY
        assert body["name"].startswith("Flightless")
        mc.commands.import_contact.assert_awaited_once_with(REAL_ADVERT_PACKET)
        mc.commands.share_contact.assert_not_called()
        stored = await ContactRepository.get_by_key(REAL_KEY)
        assert stored is not None and stored.name is not None
        assert stored.name.startswith("Flightless")
        # Not heard on RF: an imported card must not count as an advert or sighting.
        assert stored.last_advert is None
        assert stored.last_seen is None

    @pytest.mark.asyncio
    async def test_existing_contact_is_kept(self, test_db, client):
        await ContactRepository.upsert({"public_key": REAL_KEY, "name": "My label", "type": 2})
        mc = MagicMock()
        mc.commands.import_contact = AsyncMock(return_value=_result(EventType.OK))
        with (
            patch("app.routers.contacts.radio_manager") as mock_rm,
            patch("app.websocket.broadcast_event"),
        ):
            mock_rm.require_connected.return_value = mc
            mock_rm.radio_operation = _noop_radio_operation(mc)
            response = await client.post("/api/contacts/import-uri", json={"uri": REAL_URI})

        assert response.status_code == 200
        stored = await ContactRepository.get_by_key(REAL_KEY)
        assert stored is not None
        assert (stored.name, stored.type) == ("My label", 2)

    @pytest.mark.asyncio
    async def test_invalid_link_is_400_without_radio_call(self, test_db, client):
        mc = MagicMock()
        mc.commands.import_contact = AsyncMock()
        bad = "meshcore://" + _flip(REAL_ADVERT_PACKET, 42).hex()
        with patch("app.routers.contacts.radio_manager") as mock_rm:
            mock_rm.require_connected.return_value = mc
            mock_rm.radio_operation = _noop_radio_operation(mc)
            response = await client.post("/api/contacts/import-uri", json={"uri": bad})

        assert response.status_code == 400
        mc.commands.import_contact.assert_not_called()
        assert await ContactRepository.get_by_key(REAL_KEY) is None

    @pytest.mark.asyncio
    async def test_radio_rejects_import_is_422_and_nothing_stored(self, test_db, client):
        mc = MagicMock()
        mc.commands.import_contact = AsyncMock(return_value=_result(EventType.ERROR, {}))
        with patch("app.routers.contacts.radio_manager") as mock_rm:
            mock_rm.require_connected.return_value = mc
            mock_rm.radio_operation = _noop_radio_operation(mc)
            response = await client.post("/api/contacts/import-uri", json={"uri": REAL_URI})

        assert response.status_code == 422
        assert await ContactRepository.get_by_key(REAL_KEY) is None
