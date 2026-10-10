"""ASGI entry point.

``uvicorn app.asgi:app`` serves the single-radio app unless
``MESHCORE_MULTI_RADIO=true``, in which case it serves the gateway that runs
one worker per radio (plan 30). Workers always run ``app.main:app`` directly.
"""

from app.config import settings


def select_app(current_settings):
    if current_settings.multi_radio:
        from app.gateway.app import create_gateway_app

        return create_gateway_app(settings=current_settings)

    from app.main import app as single_radio_app

    return single_radio_app


app = select_app(settings)
