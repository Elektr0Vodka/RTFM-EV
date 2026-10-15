"""MeshCore 1.18 treats transport code 0 as un-scoped (RegionMap::findMatch, #3568)."""

import pytest

from app.path_utils import is_scoped


@pytest.mark.parametrize(
    ("codes", "expected"),
    [(None, False), ((0, 0), False), ((0, 1234), False), ((1234, 0), True)],
)
def test_is_scoped(codes, expected):
    assert is_scoped(codes) is expected
