"""Backend self-monitoring for the Performance page.

The app watches the mesh, the radio and the nodes; this package watches the
app itself. Everything here is in memory and bounded, fed by small hooks in
the hot paths (packet ingest, database, radio, fanout, HTTP, background
loops), plus a watchdog thread that catches event-loop stalls. A sampler
keeps a one-hour ring of 10 s points and writes one row per minute to
``perf_samples`` for history.

Hooks must never raise into the code they measure: recorders swallow their
own errors (see ``metrics.safe``).
"""
