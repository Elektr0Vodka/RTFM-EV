"""Sensor node routes: min/max/average and (MeshCore 1.18) telemetry push."""

import logging

from fastapi import APIRouter, HTTPException, Query

from app.models import (
    CONTACT_TYPE_SENSOR,
    Contact,
    SensorMmaEntry,
    SensorMmaResponse,
    SensorPushConfigRequest,
    SensorPushStateResponse,
    SensorPushThreshold,
)
from app.repository.sensor_push import SensorPushRepository
from app.routers.contacts import _ensure_on_radio, _resolve_contact_or_404
from app.routers.repeaters import _require_repeater_or_sensor
from app.services import sensor_push
from app.services.radio_runtime import radio_runtime as radio_manager
from app.services.route_timeout import contact_timeout_seconds

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/contacts", tags=["sensors"])


def _require_sensor(contact: Contact) -> None:
    if contact.type != CONTACT_TYPE_SENSOR:
        raise HTTPException(
            status_code=400, detail=f"Contact is not a sensor (type={contact.type})"
        )


def _state(public_key: str, row: dict | None) -> SensorPushStateResponse:
    supported = {
        name: sensor_push.threshold_size(name) for name in sensor_push.threshold_type_codes()
    }
    row = row or {}
    thresholds = [SensorPushThreshold(**t) for t in row.get("thresholds", [])]
    return SensorPushStateResponse(
        public_key=public_key,
        enabled=bool(row.get("enabled", False)),
        thresholds=thresholds,
        threshold_bytes=sum(supported.get(t.type_name, 0) for t in thresholds),
        max_threshold_bytes=sensor_push.MAX_THRESHOLD_BYTES,
        supported_types=supported,
        granted_until=row.get("granted_until"),
        scope_name=row.get("scope_name"),
        last_push_at=row.get("last_push_at"),
        last_error=row.get("last_error"),
    )


@router.get("/{public_key}/sensor-push", response_model=SensorPushStateResponse)
async def get_sensor_push(public_key: str) -> SensorPushStateResponse:
    """Telemetry push thresholds and subscription state for a sensor."""
    contact = await _resolve_contact_or_404(public_key)
    _require_sensor(contact)
    return _state(contact.public_key, await SensorPushRepository.get(contact.public_key))


@router.put("/{public_key}/sensor-push", response_model=SensorPushStateResponse)
async def put_sensor_push(
    public_key: str, body: SensorPushConfigRequest
) -> SensorPushStateResponse:
    """Save the watched channels. Does not transmit; subscribe applies them."""
    contact = await _resolve_contact_or_404(public_key)
    _require_sensor(contact)
    thresholds = [t.model_dump() for t in body.thresholds]
    if thresholds:
        try:
            sensor_push.encode_thresholds(thresholds)
        except sensor_push.ThresholdError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    await SensorPushRepository.save_config(contact.public_key, thresholds, now=sensor_push._now())
    return _state(contact.public_key, await SensorPushRepository.get(contact.public_key))


@router.post("/{public_key}/sensor-push/subscribe", response_model=SensorPushStateResponse)
async def subscribe_sensor_push(public_key: str) -> SensorPushStateResponse:
    """Enable push and subscribe now. Transmits one request to the sensor."""
    radio_manager.require_connected()
    contact = await _resolve_contact_or_404(public_key)
    _require_sensor(contact)
    await SensorPushRepository.set_enabled(contact.public_key, True, now=sensor_push._now())
    try:
        await sensor_push.subscribe(contact.public_key)
    except sensor_push.ThresholdError as exc:
        await SensorPushRepository.set_enabled(contact.public_key, False, now=sensor_push._now())
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _state(contact.public_key, await SensorPushRepository.get(contact.public_key))


@router.post("/{public_key}/sensor-push/unsubscribe", response_model=SensorPushStateResponse)
async def unsubscribe_sensor_push(public_key: str) -> SensorPushStateResponse:
    """Stop push. Transmits one request when the radio is connected; always disables."""
    contact = await _resolve_contact_or_404(public_key)
    _require_sensor(contact)
    await sensor_push.unsubscribe(contact.public_key)
    return _state(contact.public_key, await SensorPushRepository.get(contact.public_key))


@router.post("/{public_key}/sensor/mma", response_model=SensorMmaResponse)
async def sensor_mma(public_key: str, hours: int = Query(24, ge=1, le=168)) -> SensorMmaResponse:
    """Ask a sensor for min/max/average per channel over the last ``hours``."""
    radio_manager.require_connected()
    contact = await _resolve_contact_or_404(public_key)
    _require_repeater_or_sensor(contact)
    async with radio_manager.radio_operation(
        "sensor_mma", pause_polling=True, suspend_auto_fetch=True
    ) as mc:
        await _ensure_on_radio(mc, contact)
        entries = await mc.commands.req_mma_sync(
            contact.public_key,
            hours * 3600,
            0,
            timeout=contact_timeout_seconds(contact, flood_timeout=15.0),
        )
    if entries is None:
        raise HTTPException(status_code=504, detail="No min/max/average reply from sensor")
    return SensorMmaResponse(
        hours=hours,
        entries=[
            SensorMmaEntry(
                channel=int(e.get("channel", 0)),
                type_name=str(e.get("type", "unknown")),
                min=e.get("min", 0),
                max=e.get("max", 0),
                avg=e.get("avg", 0),
            )
            for e in entries
        ],
    )
