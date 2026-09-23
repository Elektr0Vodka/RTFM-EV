"""Tests for the communities router (join / hashtag / export / delete)."""

import base64
import hashlib
import hmac
import json
import logging
from unittest.mock import patch

import pytest

from app.repository import ChannelRepository
from app.repository.communities import CommunityRepository

K = bytes(range(32))
K_B64 = base64.urlsafe_b64encode(K).decode()
CID = hashlib.sha256(b"community:v1" + K).hexdigest()


def _key(label: str) -> str:
    return hmac.new(K, f"channel:v1:{label}".encode(), hashlib.sha256).digest()[:16].hex().upper()


def _payload(name: str = "Acme", k: str = K_B64) -> str:
    return json.dumps({"v": 1, "type": "meshcore_community", "name": name, "k": k})


@pytest.fixture(autouse=True)
def _no_broadcast():
    with patch("app.routers.channels.broadcast_event"):
        yield


class TestJoin:
    @pytest.mark.asyncio
    async def test_join_stores_secret_and_creates_public_channel(self, test_db, client):
        response = await client.post("/api/communities/join", json={"payload": _payload()})

        assert response.status_code == 200
        data = response.json()
        assert data["already_joined"] is False
        assert data["community"]["id"] == CID
        assert data["community"]["short_id"] == CID[:8]
        assert data["community"]["public_channel_key"] == _key("__public__")
        assert [c["name"] for c in data["created_channels"]] == ["Acme Public"]
        assert data["community"]["channels"] == [
            {"key": _key("__public__"), "name": "Acme Public", "kind": "public"}
        ]
        assert "secret" not in json.dumps(data)
        assert K_B64.rstrip("=") not in response.text

        stored = await CommunityRepository.get(CID)
        assert stored is not None and stored.secret == K
        channel = await ChannelRepository.get_by_key(_key("__public__"))
        assert channel is not None
        assert channel.name == "Acme Public"
        assert channel.is_hashtag is False
        assert channel.on_radio is False

    @pytest.mark.asyncio
    async def test_join_without_public_channel(self, test_db, client):
        response = await client.post(
            "/api/communities/join", json={"payload": _payload(), "add_public_channel": False}
        )
        assert response.status_code == 200
        assert response.json()["created_channels"] == []
        assert await ChannelRepository.get_by_key(_key("__public__")) is None

    @pytest.mark.asyncio
    async def test_rejoin_is_idempotent(self, test_db, client):
        await client.post("/api/communities/join", json={"payload": _payload()})
        response = await client.post(
            "/api/communities/join", json={"payload": _payload(name="Renamed")}
        )
        data = response.json()
        assert data["already_joined"] is True
        assert data["created_channels"] == []
        assert data["community"]["name"] == "Acme"
        assert len(await CommunityRepository.get_all()) == 1

    @pytest.mark.asyncio
    async def test_invalid_payload_rejected(self, test_db, client):
        response = await client.post(
            "/api/communities/join",
            json={"payload": _payload(k=base64.urlsafe_b64encode(b"x" * 16).decode())},
        )
        assert response.status_code == 400
        assert await CommunityRepository.get_all() == []

    @pytest.mark.asyncio
    async def test_secret_never_logged(self, test_db, client, caplog):
        caplog.set_level(logging.DEBUG)
        await client.post("/api/communities/join", json={"payload": _payload()})
        await client.post(f"/api/communities/{CID}/hashtags", json={"hashtag": "ops"})
        await client.get(f"/api/communities/{CID}/export")
        assert K_B64.rstrip("=") not in caplog.text
        assert K.hex() not in caplog.text


class TestHashtag:
    @pytest.mark.asyncio
    async def test_add_hashtag_derives_hmac_key(self, test_db, client):
        await client.post("/api/communities/join", json={"payload": _payload()})

        response = await client.post(f"/api/communities/{CID}/hashtags", json={"hashtag": "#Ops"})

        assert response.status_code == 200
        data = response.json()
        assert data["created"] is True
        assert data["channel"]["name"] == "Acme #Ops"
        assert data["channel"]["key"] == _key("ops")
        kinds = {c["name"]: c["kind"] for c in data["community"]["channels"]}
        assert kinds == {"Acme Public": "public", "Acme #Ops": "hashtag"}

    @pytest.mark.asyncio
    async def test_add_same_hashtag_twice_is_not_duplicated(self, test_db, client):
        await client.post("/api/communities/join", json={"payload": _payload()})
        await client.post(f"/api/communities/{CID}/hashtags", json={"hashtag": "ops"})
        response = await client.post(f"/api/communities/{CID}/hashtags", json={"hashtag": "OPS"})
        assert response.json()["created"] is False
        assert response.json()["channel"]["name"] == "Acme #ops"

    @pytest.mark.asyncio
    async def test_plain_hashtag_path_unchanged(self, test_db, client):
        """POST /channels '#ops' still uses sha256(name), unrelated to communities."""
        response = await client.post("/api/channels", json={"name": "#ops"})
        assert response.json()["key"] == hashlib.sha256(b"#ops").digest()[:16].hex().upper()

    @pytest.mark.asyncio
    async def test_too_long_name_rejected(self, test_db, client):
        await client.post("/api/communities/join", json={"payload": _payload()})
        response = await client.post(f"/api/communities/{CID}/hashtags", json={"hashtag": "x" * 40})
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_empty_hashtag_rejected(self, test_db, client):
        await client.post("/api/communities/join", json={"payload": _payload()})
        response = await client.post(f"/api/communities/{CID}/hashtags", json={"hashtag": "#"})
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_unknown_community_404(self, test_db, client):
        response = await client.post(
            f"/api/communities/{'0' * 64}/hashtags", json={"hashtag": "ops"}
        )
        assert response.status_code == 404


class TestListExportDelete:
    @pytest.mark.asyncio
    async def test_list_has_no_secret(self, test_db, client):
        await client.post("/api/communities/join", json={"payload": _payload()})
        response = await client.get("/api/communities")
        assert response.status_code == 200
        (item,) = response.json()
        assert set(item) == {
            "id",
            "short_id",
            "name",
            "created_at",
            "public_channel_key",
            "channels",
        }
        assert K_B64.rstrip("=") not in response.text

    @pytest.mark.asyncio
    async def test_export_round_trips(self, test_db, client):
        await client.post("/api/communities/join", json={"payload": _payload(name="Mesh Zuid")})
        response = await client.get(f"/api/communities/{CID}/export")
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        payload = json.loads(response.json()["payload"])
        assert payload == {"v": 1, "type": "meshcore_community", "name": "Mesh Zuid", "k": K_B64}

    @pytest.mark.asyncio
    async def test_delete_forgets_secret_keeps_channels(self, test_db, client):
        await client.post("/api/communities/join", json={"payload": _payload()})
        response = await client.delete(f"/api/communities/{CID}")
        assert response.status_code == 200
        assert await CommunityRepository.get(CID) is None
        assert await ChannelRepository.get_by_key(_key("__public__")) is not None
        assert (await client.delete(f"/api/communities/{CID}")).status_code == 404
