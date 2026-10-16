"""Spam Guard against a simulated attack on a busy mesh (see ``tests/spam_redteam.py``)."""

import pytest

from tests.spam_redteam import EXCLUDED_KINDS, generate, simulate

# The gate: at least this share of attack messages stopped, at most this share
# of regulars' messages held, on both engines.
MIN_STOPPED = 90.0
MAX_HELD = 3.0
GATE = False


@pytest.fixture(scope="module")
def result():
    return simulate()


def test_the_scenario_has_chat_and_every_attack():
    kinds = {m.kind for m in generate()}
    assert "regular" in kinds
    assert len(kinds - {"regular"} - EXCLUDED_KINDS) >= 11


def test_simulation_reports_numbers(result):
    print("\n" + result.report())
    host, node = result.per_engine["host"], result.per_engine["openhop"]
    assert host.attack_total == node.attack_total > 0
    assert host.regular_total == node.regular_total > 0


def test_simulation_is_deterministic(result):
    again = simulate()
    for engine, score in result.per_engine.items():
        assert again.per_engine[engine].per_kind == score.per_kind


@pytest.mark.skipif(not GATE, reason="gate not switched on yet")
@pytest.mark.parametrize("engine", ["host", "openhop"])
def test_gate(result, engine):
    score = result.per_engine[engine]
    assert score.stop_rate >= MIN_STOPPED, result.report()
    assert score.held_rate <= MAX_HELD, result.report()
