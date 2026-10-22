"""Per-contact radio settings and auto switch (spec 4.6)."""

from unittest.mock import AsyncMock, patch

import pytest

from app.models import RadioStamp, TempRadioState
from app.repository.contact_radio_profiles import ContactRadioProfilesRepository
from app.repository.contacts import ContactRepository
from app.services import temp_radio as temp_radio_module
from app.services.temp_radio import ensure_contact_settings, start_for_contact, temp_radio

KEY = "c1" * 32
SF8 = {"freq": 869.618, "bw": 62.5, "sf": 8, "cr": 8}
SF7 = RadioStamp(freq=869.618, bw=62.5, sf=7, cr=8)


def _profile_body(**kw):
    body = {"radio": SF8, "region": "be", "duration_secs": 900, "auto_switch": True}
    body.update(kw)
    return body


class TestApi:
    @pytest.mark.asyncio
    async def test_put_get_delete(self, test_db, client):
        resp = await client.put(f"/api/contacts/{KEY}/radio-profile", json=_profile_body())
        assert resp.status_code == 200
        assert resp.json()["radio"]["sf"] == 8
        got = (await client.get(f"/api/contacts/{KEY}/radio-profile")).json()
        assert got["auto_switch"] is True and got["duration_secs"] == 900
        listed = (await client.get("/api/contacts/radio-profiles")).json()
        assert KEY in listed
        assert (await client.delete(f"/api/contacts/{KEY}/radio-profile")).status_code == 200
        assert (await client.get(f"/api/contacts/{KEY}/radio-profile")).status_code == 404

    @pytest.mark.asyncio
    async def test_validation(self, test_db, client):
        bad = _profile_body(radio={**SF8, "sf": 13})
        assert (await client.put(f"/api/contacts/{KEY}/radio-profile", json=bad)).status_code == 422
        bad = _profile_body(duration_secs=0)
        assert (await client.put(f"/api/contacts/{KEY}/radio-profile", json=bad)).status_code == 422

    @pytest.mark.asyncio
    async def test_switch_endpoint_starts_contact_session(self, test_db, client):
        await client.put(f"/api/contacts/{KEY}/radio-profile", json=_profile_body())
        with patch.object(
            temp_radio, "start", AsyncMock(return_value=TempRadioState(active=True))
        ) as start:
            resp = await client.post(f"/api/contacts/{KEY}/radio-profile/switch")
        assert resp.status_code == 200
        req = start.await_args.args[0]
        assert req.source.kind == "contact" and req.source.contact_key == KEY
        assert req.radio.sf == 8 and req.duration_secs == 900 and req.region == "#be"

    @pytest.mark.asyncio
    async def test_switch_without_profile_404(self, test_db, client):
        assert (await client.post(f"/api/contacts/{KEY}/radio-profile/switch")).status_code == 404

    @pytest.mark.asyncio
    async def test_contact_delete_removes_profile(self, test_db, client):
        await client.put(f"/api/contacts/{KEY}/radio-profile", json=_profile_body())
        await ContactRepository.delete(KEY)
        assert await ContactRadioProfilesRepository.get(KEY) is None


class TestEnsure:
    @pytest.mark.asyncio
    async def test_switches_when_settings_differ(self, test_db, client):
        await client.put(f"/api/contacts/{KEY}/radio-profile", json=_profile_body())
        with (
            patch.object(temp_radio, "_current", return_value=SF7),
            patch.object(temp_radio, "start", AsyncMock()) as start,
        ):
            assert await ensure_contact_settings(KEY) is True
        start.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_noop_when_already_on_settings(self, test_db, client):
        await client.put(f"/api/contacts/{KEY}/radio-profile", json=_profile_body())
        with (
            patch.object(temp_radio, "_current", return_value=RadioStamp(**SF8)),
            patch.object(temp_radio, "start", AsyncMock()) as start,
        ):
            assert await ensure_contact_settings(KEY) is False
        start.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_noop_when_auto_switch_off(self, test_db, client):
        await client.put(
            f"/api/contacts/{KEY}/radio-profile", json=_profile_body(auto_switch=False)
        )
        with (
            patch.object(temp_radio, "_current", return_value=SF7),
            patch.object(temp_radio, "start", AsyncMock()) as start,
        ):
            assert await ensure_contact_settings(KEY) is False
        start.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_noop_without_profile(self, test_db):
        assert await ensure_contact_settings(KEY) is False

    @pytest.mark.asyncio
    async def test_switch_failure_does_not_raise(self, test_db, client):
        await client.put(f"/api/contacts/{KEY}/radio-profile", json=_profile_body())
        with (
            patch.object(temp_radio, "_current", return_value=SF7),
            patch.object(temp_radio, "start", AsyncMock(side_effect=RuntimeError("radio"))),
        ):
            assert await ensure_contact_settings(KEY) is False

    @pytest.mark.asyncio
    async def test_start_for_contact_requires_profile(self, test_db):
        with pytest.raises(LookupError):
            await start_for_contact(KEY)


class TestDmSend:
    @pytest.mark.asyncio
    async def test_dm_send_calls_ensure_before_sending(self, test_db):
        from app.models import SendDirectMessageRequest
        from app.radio import radio_manager
        from app.routers.messages import send_direct_message
        from tests.test_send_messages import _insert_contact, _make_mc

        mc = _make_mc()
        await _insert_contact(KEY, "Border")
        order: list[str] = []

        async def fake_ensure(public_key):
            order.append(f"ensure:{public_key}")
            return False

        original_send = mc.commands.send_msg

        async def tracking_send(*args, **kwargs):
            order.append("send")
            return await original_send(*args, **kwargs)

        mc.commands.send_msg = tracking_send
        with (
            patch.object(temp_radio_module, "ensure_contact_settings", side_effect=fake_ensure),
            patch("app.routers.messages.radio_manager.require_connected", return_value=mc),
            patch.object(radio_manager, "_meshcore", mc),
            patch("app.routers.messages.broadcast_event"),
        ):
            await send_direct_message(SendDirectMessageRequest(destination=KEY, text="hoi"))
        assert order[0] == f"ensure:{KEY}"
        assert "send" in order
