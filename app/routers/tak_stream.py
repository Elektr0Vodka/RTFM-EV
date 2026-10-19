from fastapi import APIRouter
from pydantic import BaseModel

from app.tak_stream.server import tak_stream

router = APIRouter(prefix="/tak-stream", tags=["tak-stream"])


class TakStreamStatus(BaseModel):
    enabled: bool
    host: str | None
    port: int | None
    clients: int


@router.get("/status", response_model=TakStreamStatus)
async def tak_stream_status() -> TakStreamStatus:
    """Whether the TAK Stream (CoT over TCP for ATAK / WinTAK) runs, and on which port.

    Turned on with the ``MESHCORE_TAK_STREAM_ENABLED`` environment variable; there
    is no switch in the app.
    """
    return TakStreamStatus(**tak_stream.status())
