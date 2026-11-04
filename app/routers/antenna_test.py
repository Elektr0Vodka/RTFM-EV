"""Antenna test runs: save, list, report, delete.

The traces themselves are sent by the browser, one at a time, through the
existing direct-trace endpoint (``POST /api/contacts/{key}/trace``). This
router only stores finished runs and computes their reports. It never
transmits.
"""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from app.antenna_test_report import (
    AntennaTestNodeResult,
    AntennaTestRunCreate,
    AntennaTestRunDetail,
    AntennaTestRunSummary,
    node_stats,
    run_summary,
)
from app.repository.antenna_tests import AntennaTestRepository

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/antenna-tests", tags=["antenna-tests"])


def _parse_results(row: dict) -> list[AntennaTestNodeResult]:
    results: list[AntennaTestNodeResult] = []
    for item in row["results"]:
        try:
            results.append(AntennaTestNodeResult.model_validate(item))
        except ValidationError:
            logger.warning("Skipping an unreadable node result in antenna test run %s", row["id"])
    return results


def _summary(row: dict, results: list[AntennaTestNodeResult]) -> AntennaTestRunSummary:
    return AntennaTestRunSummary(
        id=row["id"],
        antenna=row["antenna"],
        notes=row["notes"],
        radio_public_key=row["radio_public_key"],
        radio_name=row["radio_name"],
        traces_per_node=row["traces_per_node"],
        started_at=row["started_at"],
        finished_at=row["finished_at"],
        summary=run_summary(results),
    )


def _detail(row: dict) -> AntennaTestRunDetail:
    results = _parse_results(row)
    return AntennaTestRunDetail(
        **_summary(row, results).model_dump(),
        nodes=[node_stats(result) for result in results],
    )


@router.get("", response_model=list[AntennaTestRunSummary])
async def list_antenna_tests() -> list[AntennaTestRunSummary]:
    """Every saved run with its totals, newest first."""
    rows = await AntennaTestRepository.list_all()
    return [_summary(row, _parse_results(row)) for row in rows]


@router.post("", response_model=AntennaTestRunDetail)
async def save_antenna_test(run: AntennaTestRunCreate) -> AntennaTestRunDetail:
    """Store a finished run and return its report."""
    if run.finished_at < run.started_at:
        raise HTTPException(status_code=400, detail="finished_at is before started_at")
    for result in run.results:
        if len(result.attempts) > run.traces_per_node:
            raise HTTPException(
                status_code=400,
                detail="A node has more attempts than traces_per_node",
            )
    run_id = await AntennaTestRepository.create(
        antenna=run.antenna,
        notes=run.notes,
        radio_public_key=run.radio_public_key,
        radio_name=run.radio_name,
        traces_per_node=run.traces_per_node,
        started_at=run.started_at,
        finished_at=run.finished_at,
        results=[result.model_dump() for result in run.results],
    )
    row = await AntennaTestRepository.get(run_id)
    if row is None:
        raise HTTPException(status_code=500, detail="Saved run could not be read back")
    logger.info("Saved antenna test run %d (%s, %d nodes)", run_id, run.antenna, len(run.results))
    return _detail(row)


@router.get("/{run_id}", response_model=AntennaTestRunDetail)
async def get_antenna_test(run_id: int) -> AntennaTestRunDetail:
    """One run's report: totals plus per-node reply rate and SNR in both directions."""
    row = await AntennaTestRepository.get(run_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Antenna test run not found")
    return _detail(row)


@router.delete("/{run_id}")
async def delete_antenna_test(run_id: int) -> dict[str, bool]:
    if not await AntennaTestRepository.delete(run_id):
        raise HTTPException(status_code=404, detail="Antenna test run not found")
    return {"deleted": True}
