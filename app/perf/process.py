"""Process and host figures from the standard library and ``/proc``.

No psutil: CPU comes from ``time.process_time()`` (every platform); memory,
threads, file descriptors, host memory and the container memory limit come
from ``/proc`` and the cgroup files on Linux (the Docker image). Anything that
cannot be read is ``None``, which the page shows as "n/a".
"""

import os
import platform
import threading
import time
from pathlib import Path

PROC_SELF = Path("/proc/self")
PROC_MEMINFO = Path("/proc/meminfo")
CGROUP_V2_MAX = Path("/sys/fs/cgroup/memory.max")
CGROUP_V1_LIMIT = Path("/sys/fs/cgroup/memory/memory.limit_in_bytes")

STARTED_AT = time.time()

# (process cpu seconds, wall seconds) of the previous reading.
CpuMark = tuple[float, float]


def _read_text(path: Path) -> str | None:
    try:
        return path.read_text()
    except (OSError, ValueError):
        return None


def _status_field(status: str | None, key: str) -> int | None:
    if status is None:
        return None
    for line in status.splitlines():
        if line.startswith(key + ":"):
            parts = line.split()
            try:
                return int(parts[1])
            except (IndexError, ValueError):
                return None
    return None


def _mem_limit_mb() -> float | None:
    raw = _read_text(CGROUP_V2_MAX)
    if raw is not None and raw.strip() != "max":
        try:
            return round(int(raw.strip()) / 1_048_576, 1)
        except ValueError:
            pass
    raw = _read_text(CGROUP_V1_LIMIT)
    if raw is not None:
        try:
            value = int(raw.strip())
        except ValueError:
            return None
        # cgroup v1 reports a huge number when there is no limit.
        if value < 1 << 60:
            return round(value / 1_048_576, 1)
    return None


def _fd_count() -> int | None:
    try:
        return len(os.listdir(PROC_SELF / "fd"))
    except OSError:
        return None


def process_stats(prev: CpuMark | None) -> tuple[dict, CpuMark]:
    """Current process figures, and the CPU mark to pass in next time.

    ``cpu_percent`` is the share of one core used since ``prev`` (like
    ``top``), ``None`` on the first call.
    """
    cpu_s = time.process_time()
    wall_s = time.monotonic()
    cpu_percent = None
    if prev is not None and wall_s > prev[1]:
        cpu_percent = round(max(0.0, (cpu_s - prev[0]) / (wall_s - prev[1]) * 100), 1)

    status = _read_text(PROC_SELF / "status")
    rss_kb = _status_field(status, "VmRSS")
    threads = _status_field(status, "Threads")
    host_kb = _status_field(_read_text(PROC_MEMINFO), "MemTotal")
    try:
        load1: float | None = round(os.getloadavg()[0], 2)
    except (AttributeError, OSError):
        load1 = None

    stats = {
        "pid": os.getpid(),
        "python": platform.python_version(),
        "platform": platform.system(),
        "started_at": STARTED_AT,
        "uptime_s": round(time.time() - STARTED_AT),
        "cpu_percent": cpu_percent,
        "cpu_seconds": round(cpu_s, 1),
        "rss_mb": round(rss_kb / 1024, 1) if rss_kb is not None else None,
        "threads": threads if threads is not None else threading.active_count(),
        "fds": _fd_count(),
        "load1": load1,
        "host_cores": os.cpu_count(),
        "host_mem_mb": round(host_kb / 1024) if host_kb is not None else None,
        "mem_limit_mb": _mem_limit_mb(),
    }
    return stats, (cpu_s, wall_s)
