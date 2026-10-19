"""A validation error on Infinity or NaN is a 422, not a 500."""

import httpx
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict, Field

from app.validation_errors import install_validation_error_handler, validation_error_handler


class Reading(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    value: float
    lat: float = Field(default=0, ge=-90, le=90)


def _app() -> FastAPI:
    app = FastAPI()
    install_validation_error_handler(app)

    @app.post("/reading")
    async def reading(body: Reading) -> dict[str, float]:
        return {"value": body.value}

    return app


async def _post(content: str) -> httpx.Response:
    transport = httpx.ASGITransport(app=_app())
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.post(
            "/reading", content=content, headers={"content-type": "application/json"}
        )


async def test_infinity_is_a_422_with_the_value_as_text():
    r = await _post('{"value": Infinity}')
    assert r.status_code == 422
    assert r.json()["detail"][0]["input"] == "inf"


async def test_nan_failing_a_range_check_is_a_422():
    r = await _post('{"value": 1, "lat": NaN}')
    assert r.status_code == 422
    assert r.json()["detail"][0]["loc"] == ["body", "lat"]


async def test_ordinary_validation_errors_are_unchanged():
    r = await _post('{"value": "x"}')
    assert r.status_code == 422
    assert r.json()["detail"][0]["input"] == "x"


def test_main_app_uses_the_handler():
    from app.main import app

    assert app.exception_handlers[RequestValidationError] is validation_error_handler
