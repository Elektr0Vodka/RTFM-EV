"""FanoutManager dispatch for the new neighbor/region broadcast paths (plan [24]).

Telemetry already has ``broadcast_telemetry`` -> ``on_telemetry``; this adds the
matching always-match paths for neighbor and region forwards.
"""

import pytest

from app.fanout.base import FanoutModule
from app.fanout.manager import FanoutManager


class _CaptureModule(FanoutModule):
    def __init__(self):
        super().__init__("cap", {})
        self.neighbor_calls: list[dict] = []
        self.region_calls: list[dict] = []

    async def start(self) -> None:
        pass

    async def stop(self) -> None:
        pass

    async def on_neighbor(self, data: dict) -> None:
        self.neighbor_calls.append(data)

    async def on_region(self, data: dict) -> None:
        self.region_calls.append(data)

    @property
    def status(self) -> str:
        return "connected"


@pytest.mark.asyncio
async def test_broadcast_neighbor_dispatches_to_on_neighbor():
    manager = FanoutManager()
    mod = _CaptureModule()
    manager._modules["id"] = (mod, {"messages": "none", "raw_packets": "none"})

    await manager.broadcast_neighbor({"subject_id": "AABB", "neighbors": []})

    assert len(mod.neighbor_calls) == 1
    assert mod.neighbor_calls[0]["subject_id"] == "AABB"
    assert mod.region_calls == []  # region path untouched


@pytest.mark.asyncio
async def test_broadcast_region_dispatches_to_on_region():
    manager = FanoutManager()
    mod = _CaptureModule()
    manager._modules["id"] = (mod, {})

    await manager.broadcast_region({"subject_id": "AABB", "regions": []})

    assert len(mod.region_calls) == 1
    assert mod.region_calls[0]["subject_id"] == "AABB"
    assert mod.neighbor_calls == []


@pytest.mark.asyncio
async def test_base_module_neighbor_and_region_hooks_are_noop():
    """A module that does not care about neighbors/regions must not break."""
    mod = FanoutModule("x", {})

    # default hooks exist and are awaitable no-ops
    assert await mod.on_neighbor({"any": "thing"}) is None
    assert await mod.on_region({"any": "thing"}) is None
