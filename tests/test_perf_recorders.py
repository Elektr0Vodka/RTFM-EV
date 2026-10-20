"""Recorders that the hot paths feed (loops, pipeline, DB, radio, outputs, routes, logs)."""

import logging

import pytest

from app.perf import recorders
from app.perf.recorders import (
    DbCallRecorder,
    LoopRegistry,
    OutputRecorder,
    PerfLogHandler,
    PipelineRecorder,
    RadioOpRecorder,
    RouteRecorder,
    caller_name,
)


class TestLoops:
    def test_records_run_and_duration(self):
        loops = LoopRegistry()
        with loops.tick("svc.loop", 60):
            pass
        (row,) = loops.rows(now=None)
        assert row["name"] == "svc.loop"
        assert row["runs"] == 1
        assert row["errors"] == 0
        assert row["state"] == "ok"
        assert row["every_s"] == 60

    def test_running_inside_tick(self):
        loops = LoopRegistry()
        with loops.tick("svc.loop", 60):
            (row,) = loops.rows()
            assert row["state"] == "running"

    def test_error_counted_and_reraised(self):
        loops = LoopRegistry()
        with pytest.raises(RuntimeError):
            with loops.tick("svc.loop", 60):
                raise RuntimeError("bad poll")
        (row,) = loops.rows()
        assert row["errors"] == 1
        assert row["last_error"] == "RuntimeError: bad poll"
        assert row["state"] == "error"

    def test_overdue_after_threshold(self):
        loops = LoopRegistry()
        with loops.tick("svc.loop", 60):
            pass
        start = loops.rows()[0]["last_start"]
        # max(2 * 60, 60 + 60) = 120 s
        assert loops.rows(now=start + 119)[0]["state"] == "ok"
        assert loops.rows(now=start + 121)[0]["state"] == "overdue"

    def test_on_demand_loop_never_overdue(self):
        loops = LoopRegistry()
        with loops.tick("svc.on_demand", None):
            pass
        start = loops.rows()[0]["last_start"]
        assert loops.rows(now=start + 86_400)[0]["state"] == "idle"

    def test_hourly_strip_has_24_cells(self):
        loops = LoopRegistry()
        with loops.tick("svc.loop", 10):
            pass
        hourly = loops.rows()[0]["hourly"]
        assert len(hourly) == 24
        assert hourly[-1]["runs"] == 1


class TestPipeline:
    def test_counts_and_stage_times(self):
        p = PipelineRecorder()
        p.record(
            payload_type="GROUP_TEXT",
            parse_ms=0.4,
            store_ms=3.0,
            process_ms=1.0,
            broadcast_ms=0.2,
            is_new=True,
            decrypted=False,
            malformed=False,
        )
        p.record(
            payload_type="ADVERT",
            parse_ms=0.5,
            store_ms=2.0,
            process_ms=4.0,
            broadcast_ms=0.3,
            is_new=False,
            decrypted=False,
            malformed=False,
        )
        snap = p.snapshot()
        assert snap["per_minute"]["received"] == 2
        assert snap["per_minute"]["duplicate"] == 1
        assert snap["per_minute"]["undecrypted"] == 1  # GROUP_TEXT without a key
        assert snap["stages"]["store"]["count"] == 2
        assert snap["by_type"][0]["type"] in {"GROUP_TEXT", "ADVERT"}


class TestDbCalls:
    def test_records_per_caller(self):
        d = DbCallRecorder()
        d.record("write", "Repo.create", wait_ms=1.0, hold_ms=4.0, error=False)
        d.record("read", "Repo.list", wait_ms=0.0, hold_ms=40.0, error=True)
        snap = d.snapshot()
        names = [c["caller"] for c in snap["slowest"]]
        assert names[0] == "Repo.list"
        assert snap["write"]["hold"]["count"] == 1
        assert snap["slowest"][0]["errors"] == 1

    def test_caller_name_is_the_calling_function(self):
        def inner():
            return caller_name()

        assert caller_name().endswith("test_caller_name_is_the_calling_function")
        assert inner().endswith("inner")


class TestRadioAndOutputs:
    def test_radio_ops(self):
        r = RadioOpRecorder()
        r.record("get_stats", wait_ms=0.5, hold_ms=90, error=False)
        r.note_reconnect(ok=True)
        snap = r.snapshot()
        assert snap["ops"][0]["name"] == "get_stats"
        assert snap["reconnects"] == {"attempts": 1, "ok": 1}

    def test_outputs(self):
        o = OutputRecorder()
        o.record("cfg1", 12.0, "ok")
        o.record("cfg1", 10_000.0, "timeout")
        snap = o.snapshot()
        assert snap["cfg1"]["sent_last_hour"] == 2
        assert snap["cfg1"]["timeouts"] == 1


class TestRoutes:
    def test_groups_by_template_and_counts_5xx(self):
        r = RouteRecorder()
        r.record("GET", "/api/contacts/{key}", 5.0, 200)
        r.record("GET", "/api/contacts/{key}", 8.0, 503)
        (row,) = r.snapshot()["routes"]
        assert row["route"] == "GET /api/contacts/{key}"
        assert row["calls"] == 2
        assert row["errors_5xx"] == 1


class TestLogTail:
    def test_keeps_warnings_only(self):
        handler = PerfLogHandler(max_records=3)
        log = logging.getLogger("perf.test.tail")
        log.addHandler(handler)
        log.propagate = False
        log.setLevel(logging.DEBUG)
        try:
            log.info("quiet")
            for i in range(5):
                log.warning("w%d", i)
        finally:
            log.removeHandler(handler)
        records = handler.records(10)
        assert [r["message"] for r in records] == ["w4", "w3", "w2"]
        assert records[0]["level"] == "WARNING"
        assert records[0]["logger"] == "perf.test.tail"

    def test_exception_text_added_once(self):
        handler = PerfLogHandler()
        log = logging.getLogger("perf.test.exc")
        log.addHandler(handler)
        log.propagate = False
        try:
            try:
                raise OSError("refused")
            except OSError as exc:
                log.warning("Reconnect failed: %s", exc, exc_info=True)
            try:
                raise OSError("boom")
            except OSError:
                log.warning("Loop error", exc_info=True)
        finally:
            log.removeHandler(handler)
        messages = [r["message"] for r in handler.records(10)]
        assert messages == ["Loop error (OSError: boom)", "Reconnect failed: refused"]


def test_module_singletons_exist():
    for name in ("loops", "pipeline", "db_calls", "radio_ops", "outputs", "routes", "log_tail"):
        assert getattr(recorders, name) is not None
