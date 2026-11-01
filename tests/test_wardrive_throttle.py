"""The wardrive login throttle keeps its memory bounded."""

from app.wardrive.sessions import LoginThrottle


def test_throttle_blocks_after_max_failures():
    throttle = LoginThrottle(max_failures=3, window_s=900)
    for _ in range(3):
        throttle.record_failure("Mike", now=0)
    assert throttle.blocked("mike", now=1)
    assert not throttle.blocked("mike", now=901)


def test_throttle_forgets_expired_usernames():
    throttle = LoginThrottle(window_s=900)
    for i in range(500):
        throttle.record_failure(f"user{i}", now=0)
    throttle.record_failure("late", now=1000)
    assert list(throttle._failures) == ["late"]


def test_throttle_never_tracks_more_than_its_limit():
    throttle = LoginThrottle(window_s=900)
    for i in range(LoginThrottle.MAX_TRACKED + 50):
        throttle.record_failure(f"user{i}", now=0)
    assert len(throttle._failures) == LoginThrottle.MAX_TRACKED
    # The newest names are the ones kept.
    assert f"user{LoginThrottle.MAX_TRACKED + 49}" in throttle._failures
    assert "user0" not in throttle._failures


def test_throttle_when_full_forgets_the_name_with_fewest_failures():
    throttle = LoginThrottle(max_failures=5, window_s=900)
    for _ in range(4):
        throttle.record_failure("mike", now=0)
    for i in range(LoginThrottle.MAX_TRACKED + 10):
        throttle.record_failure(f"made-up{i}", now=1)
    throttle.record_failure("mike", now=2)
    assert throttle.blocked("mike", now=3)
