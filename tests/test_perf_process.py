"""Process figures and the event-loop watchdog."""

import asyncio
import time
from pathlib import Path

from app.perf import process
from app.perf.loopwatch import LoopWatch


def test_process_stats_without_proc(monkeypatch, tmp_path: Path):
    missing = tmp_path / "nope"
    monkeypatch.setattr(process, "PROC_SELF", missing)
    monkeypatch.setattr(process, "PROC_MEMINFO", missing / "meminfo")
    monkeypatch.setattr(process, "CGROUP_V2_MAX", missing / "memory.max")
    monkeypatch.setattr(process, "CGROUP_V1_LIMIT", missing / "limit")

    first, mark = process.process_stats(None)
    assert first["cpu_percent"] is None
    assert first["rss_mb"] is None
    assert first["fds"] is None
    assert first["host_mem_mb"] is None
    assert first["mem_limit_mb"] is None
    assert first["threads"] >= 1

    sum(range(200_000))
    second, _ = process.process_stats(mark)
    assert isinstance(second["cpu_percent"], float)


def test_process_stats_reads_proc_files(monkeypatch, tmp_path: Path):
    proc = tmp_path / "self"
    (proc / "fd").mkdir(parents=True)
    for name in ("0", "1", "2"):
        (proc / "fd" / name).write_text("")
    (proc / "status").write_text("Name:\tpython\nVmRSS:\t  204800 kB\nThreads:\t7\n")
    meminfo = tmp_path / "meminfo"
    meminfo.write_text("MemTotal:       8000000 kB\n")
    limit = tmp_path / "memory.max"
    limit.write_text("536870912\n")
    monkeypatch.setattr(process, "PROC_SELF", proc)
    monkeypatch.setattr(process, "PROC_MEMINFO", meminfo)
    monkeypatch.setattr(process, "CGROUP_V2_MAX", limit)

    stats, _ = process.process_stats(None)
    assert stats["rss_mb"] == 200.0
    assert stats["threads"] == 7
    assert stats["fds"] == 3
    assert stats["host_mem_mb"] == 7812
    assert stats["mem_limit_mb"] == 512.0


def _block_the_loop():
    time.sleep(0.4)


async def test_watchdog_records_stall_with_stack():
    watch = LoopWatch()
    watch.start()
    try:
        await asyncio.sleep(0.25)  # a few clean heartbeats first
        _block_the_loop()
        await asyncio.sleep(0.3)  # let the heartbeat record the stall
    finally:
        await watch.stop()

    stalls = watch.stalls()
    assert len(stalls) == 1
    stall = stalls[0]
    assert stall["duration_ms"] >= 300
    assert any("_block_the_loop" in line for line in stall["stack"])
    assert stall["task"] is not None
    assert watch.lag.hour.last_hour().count >= 3


def test_stack_keeps_the_innermost_app_frame():
    import sys

    from app.perf import loopwatch

    app_file = str(Path(loopwatch._ROOT) / "app" / "fake_service.py")
    # 15 nested library frames below one app frame.
    lib_globals: dict = {"sys": sys}
    lib_src = "def lib(n):\n    return lib(n - 1) if n else sys._getframe()\n"
    exec(compile(lib_src, "/site-packages/somelib/deep.py", "exec"), lib_globals)
    app_globals: dict = {"lib": lib_globals["lib"]}
    app_src = "def service():\n    return lib(15)\n"
    exec(compile(app_src, app_file, "exec"), app_globals)

    stack = loopwatch.format_stack(app_globals["service"]())
    assert stack[0].startswith("somelib/deep.py:2 in lib")
    assert len(stack) == loopwatch.MAX_FRAMES + 1
    assert stack[-1] == "app/fake_service.py:2 in service"
