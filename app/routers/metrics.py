"""Prometheus-format metrics (opt-in with ``MESHCORE_METRICS_ENABLED``)."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse

from app.config import settings
from app.services.metrics_export import build_metrics_text

router = APIRouter(tags=["metrics"])

PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8"


@router.get("/metrics", response_class=PlainTextResponse)
async def get_metrics() -> PlainTextResponse:
    """Radio, radio queue, stored counts, tracked node telemetry and MQTT counters.

    404 unless ``MESHCORE_METRICS_ENABLED`` is set. Node names and public keys
    are labels, so keep the endpoint on a trusted network (app-wide Basic auth,
    when configured, covers it too).
    """
    if not settings.metrics_enabled:
        raise HTTPException(status_code=404, detail="Metrics are disabled")
    return PlainTextResponse(await build_metrics_text(), media_type=PROMETHEUS_CONTENT_TYPE)
