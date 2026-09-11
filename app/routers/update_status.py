from fastapi import APIRouter
from pydantic import BaseModel

from app.services.update_check import get_update_status

router = APIRouter(tags=["update"])


class UpdateStatusResponse(BaseModel):
    check_enabled: bool
    update_available: bool
    current_commit: str | None = None
    latest_commit: str | None = None
    commits_behind: int = 0
    compare_url: str | None = None
    checked_at: int


@router.get("/update-status", response_model=UpdateStatusResponse)
async def update_status() -> UpdateStatusResponse:
    """Report whether the fork's main branch is ahead of the running commit."""
    data = await get_update_status()
    return UpdateStatusResponse(**data)
