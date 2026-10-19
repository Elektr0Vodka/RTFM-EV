"""A 422 that can always be written.

Python's JSON reader takes ``Infinity`` and ``NaN``, so a body can carry them
past parsing. A field that refuses them (or a range check that fails on them)
gives a validation error whose echoed input cannot be written as JSON, and
the client got a 500 instead of the 422. The usual FastAPI answer is kept;
only when it cannot be written are those numbers echoed as text.
"""

import math
from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


def _json_safe(value: Any) -> Any:
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [_json_safe(v) for v in value]
    return value


async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    try:
        return await request_validation_exception_handler(request, exc)
    except ValueError:
        detail = _json_safe(jsonable_encoder(exc.errors()))
        return JSONResponse(status_code=422, content={"detail": detail})


def install_validation_error_handler(app: FastAPI) -> None:
    app.add_exception_handler(RequestValidationError, validation_error_handler)  # type: ignore[arg-type]
