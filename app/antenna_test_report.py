"""Antenna test: run models and the per-run report.

An antenna test run sends a few direct (zero-hop) traces to each selected
node. A direct trace measures both directions of the link: ``remote_snr`` is
how well the node heard us (our transmit side), ``local_snr`` is how well we
heard its reply (our receive side). The browser runs the traces through
``POST /api/contacts/{key}/trace`` and saves the finished run here; the report
is computed from the stored attempts on every read, so changing the report
never needs a migration.
"""

from __future__ import annotations

from collections.abc import Iterable

from pydantic import BaseModel, Field, field_validator

MAX_TRACES_PER_NODE = 10
MAX_NODES_PER_RUN = 100


class AntennaTestAttempt(BaseModel):
    """One direct trace to a node. ``replied`` false = no trace response heard."""

    replied: bool
    remote_snr: float | None = Field(default=None, description="SNR the node heard us at (dB)")
    local_snr: float | None = Field(default=None, description="SNR we heard the node at (dB)")


class AntennaTestNodeResult(BaseModel):
    public_key: str = Field(pattern=r"^[0-9a-fA-F]{64}$")
    name: str | None = Field(default=None, max_length=100)
    distance_km: float | None = Field(default=None, ge=0)
    attempts: list[AntennaTestAttempt] = Field(max_length=MAX_TRACES_PER_NODE)

    @field_validator("public_key")
    @classmethod
    def _lower_key(cls, value: str) -> str:
        return value.lower()


class AntennaTestRunCreate(BaseModel):
    antenna: str = Field(min_length=1, max_length=80)
    notes: str = Field(default="", max_length=500)
    radio_public_key: str | None = Field(default=None, max_length=64)
    radio_name: str | None = Field(default=None, max_length=100)
    traces_per_node: int = Field(ge=1, le=MAX_TRACES_PER_NODE)
    started_at: int = Field(ge=0)
    finished_at: int = Field(ge=0)
    results: list[AntennaTestNodeResult] = Field(min_length=1, max_length=MAX_NODES_PER_RUN)

    @field_validator("antenna")
    @classmethod
    def _strip_antenna(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Antenna name is required")
        return stripped

    @field_validator("notes")
    @classmethod
    def _strip_notes(cls, value: str) -> str:
        return value.strip()


class SnrStats(BaseModel):
    avg: float | None = None
    min: float | None = None
    max: float | None = None


class AntennaTestNodeStats(BaseModel):
    public_key: str
    name: str | None
    distance_km: float | None
    attempts: int
    replies: int
    reply_rate: float
    remote_snr: SnrStats
    local_snr: SnrStats


class AntennaTestSummary(BaseModel):
    nodes: int
    nodes_replied: int
    attempts: int
    replies: int
    reply_rate: float
    remote_snr_avg: float | None
    local_snr_avg: float | None


class AntennaTestRunSummary(BaseModel):
    id: int
    antenna: str
    notes: str
    radio_public_key: str | None
    radio_name: str | None
    traces_per_node: int
    started_at: int
    finished_at: int
    summary: AntennaTestSummary


class AntennaTestRunDetail(AntennaTestRunSummary):
    nodes: list[AntennaTestNodeStats]


def _snr_values(attempts: Iterable[AntennaTestAttempt], attr: str) -> list[float]:
    values: list[float] = []
    for attempt in attempts:
        if not attempt.replied:
            continue
        value = getattr(attempt, attr)
        if isinstance(value, (int, float)):
            values.append(float(value))
    return values


def _stats(values: list[float]) -> SnrStats:
    if not values:
        return SnrStats()
    return SnrStats(
        avg=round(sum(values) / len(values), 2),
        min=round(min(values), 2),
        max=round(max(values), 2),
    )


def _rate(replies: int, attempts: int) -> float:
    return round(replies / attempts, 4) if attempts else 0.0


def node_stats(result: AntennaTestNodeResult) -> AntennaTestNodeStats:
    replies = sum(1 for attempt in result.attempts if attempt.replied)
    return AntennaTestNodeStats(
        public_key=result.public_key,
        name=result.name,
        distance_km=result.distance_km,
        attempts=len(result.attempts),
        replies=replies,
        reply_rate=_rate(replies, len(result.attempts)),
        remote_snr=_stats(_snr_values(result.attempts, "remote_snr")),
        local_snr=_stats(_snr_values(result.attempts, "local_snr")),
    )


def run_summary(results: list[AntennaTestNodeResult]) -> AntennaTestSummary:
    """Totals over every attempt in the run. SNR averages use replied attempts only."""
    all_attempts = [attempt for result in results for attempt in result.attempts]
    replies = sum(1 for attempt in all_attempts if attempt.replied)
    remote = _snr_values(all_attempts, "remote_snr")
    local = _snr_values(all_attempts, "local_snr")
    return AntennaTestSummary(
        nodes=len(results),
        nodes_replied=sum(1 for r in results if any(a.replied for a in r.attempts)),
        attempts=len(all_attempts),
        replies=replies,
        reply_rate=_rate(replies, len(all_attempts)),
        remote_snr_avg=round(sum(remote) / len(remote), 2) if remote else None,
        local_snr_avg=round(sum(local) / len(local), 2) if local else None,
    )
