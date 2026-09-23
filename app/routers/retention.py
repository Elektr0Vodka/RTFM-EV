import logging
import time

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from app.repository import AppSettingsRepository
from app.repository.retention import RetentionRepository
from app.services import retention_pruner

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/retention", tags=["retention"])


class RetentionClassStats(BaseModel):
    key: str
    rows: int
    oldest_ts: int | None = None


class RetentionStatsResponse(BaseModel):
    classes: list[RetentionClassStats]
    interval_hours: int
    last_run_at: int | None = None
    next_run_at: int | None = None
    last_result: dict[str, int] = Field(default_factory=dict)
    messages_would_delete: int | None = Field(
        default=None,
        description="Messages older than messages_days (only when that query param is given)",
    )


class RetentionPruneResponse(BaseModel):
    deleted: dict[str, int]
    ran_at: int


@router.get("/stats", response_model=RetentionStatsResponse)
async def get_retention_stats(
    messages_days: int | None = Query(default=None, ge=1, le=3650),
) -> RetentionStatsResponse:
    """Row count and oldest entry per retention class, plus prune-service status.

    ``messages_days`` previews how many messages a message retention of that
    many days would delete on the next run.
    """
    settings = await AppSettingsRepository.get()
    stats = await RetentionRepository.stats()
    status = retention_pruner.status()
    last_run_at = status["last_run_at"]
    interval = settings.retention_prune_interval_hours

    would_delete = None
    if messages_days is not None:
        cutoff = int(time.time()) - messages_days * 86400
        would_delete = await RetentionRepository.count_messages_older_than(cutoff)

    return RetentionStatsResponse(
        classes=[
            RetentionClassStats(key=key, rows=v["rows"] or 0, oldest_ts=v["oldest_ts"])
            for key, v in stats.items()
        ],
        interval_hours=interval,
        last_run_at=last_run_at,
        next_run_at=last_run_at + interval * 3600 if last_run_at is not None else None,
        last_result=status["last_result"],
        messages_would_delete=would_delete,
    )


@router.post("/prune", response_model=RetentionPruneResponse)
async def run_retention_prune() -> RetentionPruneResponse:
    """Run the retention prune now, using the current settings."""
    deleted = await retention_pruner.prune_once()
    return RetentionPruneResponse(
        deleted=deleted, ran_at=retention_pruner.status()["last_run_at"] or 0
    )
