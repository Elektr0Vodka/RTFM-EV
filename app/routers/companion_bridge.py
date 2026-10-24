from fastapi import APIRouter
from pydantic import BaseModel

from app.companion_bridge.server import companion_bridge

router = APIRouter(prefix="/companion-bridge", tags=["companion-bridge"])


class CompanionBridgeClient(BaseModel):
    address: str
    app_name: str
    connected_at: int


class CompanionBridgeStatus(BaseModel):
    enabled: bool
    host: str | None
    port: int | None
    allow_send: bool
    clients: list[CompanionBridgeClient]


@router.get("/status", response_model=CompanionBridgeStatus)
async def companion_bridge_status() -> CompanionBridgeStatus:
    """Whether the companion bridge runs, on which port, and which apps are connected.

    Turned on with the ``MESHCORE_COMPANION_BRIDGE_ENABLED`` environment variable;
    there is no switch in the app.
    """
    return CompanionBridgeStatus(**companion_bridge.status())
