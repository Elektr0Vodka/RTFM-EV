"""Settings and state of RTFM-EV's own SNMP agent (off by default)."""

import logging

from fastapi import APIRouter

from app.models import SnmpAgentSettings, SnmpAgentState
from app.repository.snmp_agent import SnmpAgentRepository
from app.services.snmp_agent import apply_snmp_agent_settings, get_snmp_agent_state

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/snmp-agent", tags=["snmp"])


@router.get("", response_model=SnmpAgentState)
async def get_snmp_agent() -> SnmpAgentState:
    """Stored settings plus whether the listener is running right now."""
    return get_snmp_agent_state(await SnmpAgentRepository.get())


@router.put("", response_model=SnmpAgentState)
async def put_snmp_agent(settings: SnmpAgentSettings) -> SnmpAgentState:
    """Save the settings and start, restart or stop the listener to match.

    A listener that cannot bind its port is reported in ``error``; the
    settings are saved either way.
    """
    await SnmpAgentRepository.save(settings)
    await apply_snmp_agent_settings(settings)
    logger.info("SNMP agent settings saved (enabled=%s, port=%d)", settings.enabled, settings.port)
    return get_snmp_agent_state(settings)
