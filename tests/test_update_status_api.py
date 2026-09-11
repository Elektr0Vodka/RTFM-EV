from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient


def test_update_status_endpoint_returns_payload():
    payload = {
        "check_enabled": True,
        "update_available": True,
        "current_commit": "dc11fbe0",
        "latest_commit": "a1b2c3d4",
        "commits_behind": 7,
        "compare_url": "https://github.com/Elektr0Vodka/RTFM-EV/compare/dc11fbe0...main",
        "checked_at": 1757600000,
    }
    with patch(
        "app.routers.update_status.get_update_status",
        new=AsyncMock(return_value=payload),
    ):
        from app.main import app

        client = TestClient(app)
        response = client.get("/api/update-status")

    assert response.status_code == 200
    data = response.json()
    assert data["update_available"] is True
    assert data["commits_behind"] == 7
    assert data["compare_url"].endswith("compare/dc11fbe0...main")
