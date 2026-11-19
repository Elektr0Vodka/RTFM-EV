"""scripts/addon_version.py: image tags and HA add-on versions for a CI run.

HA Core offers an add-on update only when AwesomeVersion says latest > installed.
It does not order "3.18.0-EV.0.3" above "3.18.0-EV.0.2", so add-on versions are
numbers only: "-EV.a.b" becomes ".a.b", edge appends ".<run>".
"""

import importlib.util
from pathlib import Path

import pytest

_SPEC = importlib.util.spec_from_file_location(
    "addon_version", Path(__file__).resolve().parents[1] / "scripts" / "addon_version.py"
)
assert _SPEC and _SPEC.loader
addon_version = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(addon_version)

PYPROJECT = '[project]\nname = "x"\nversion = "3.18.0"\n'
VERSION_INFO = 'FORK_VERSION_SUFFIX = "-EV.0.3"\n'


def resolve(ref_type="branch", ref_name="main", ref="refs/heads/main", run=412, **kw):
    return addon_version.resolve(
        kw.get("pyproject", PYPROJECT),
        kw.get("version_info", VERSION_INFO),
        ref_type=ref_type,
        ref_name=ref_name,
        ref=ref,
        run_number=run,
    )


def test_main_is_edge_with_numeric_run_version():
    out = resolve()
    assert out == {
        "version": "3.18.0-EV.0.3",
        "channel": "edge",
        "addon_version": "3.18.0.0.3.412",
    }


def test_release_tag_is_stable():
    out = resolve(ref_type="tag", ref_name="v3.18.0-EV.0.3", ref="refs/tags/v3.18.0-EV.0.3")
    assert out == {"version": "3.18.0-EV.0.3", "channel": "stable", "addon_version": "3.18.0.0.3"}


def test_tag_must_match_app_version():
    with pytest.raises(ValueError, match="does not match"):
        resolve(ref_type="tag", ref_name="v3.18.0-EV.0.4", ref="refs/tags/v3.18.0-EV.0.4")


def test_other_branch_refused():
    with pytest.raises(ValueError, match="main"):
        resolve(ref_name="feat/x", ref="refs/heads/feat/x")


def test_non_numeric_suffix_refused():
    with pytest.raises(ValueError, match="suffix"):
        resolve(version_info='FORK_VERSION_SUFFIX = "-EV.beta"\n')


def test_missing_pyproject_version_refused():
    with pytest.raises(ValueError, match="pyproject"):
        resolve(pyproject='[project]\nname = "x"\n')


@pytest.mark.parametrize(
    ("older", "newer"),
    [
        ("3.18.0.0.2", "3.18.0.0.3"),
        ("3.18.0.0.9", "3.18.0.0.10"),
        ("3.18.0.0.9", "3.19.0.0.1"),
        ("3.18.0.0.2.999", "3.18.0.0.2.1000"),
        ("3.18.0.0.2.999", "3.18.0.0.3.5"),
    ],
)
def test_numeric_versions_order_like_numbers(older, newer):
    def key(v):
        return tuple(int(p) for p in v.split("."))

    assert key(older) < key(newer)
    assert addon_version.NUMERIC.match(older) and addon_version.NUMERIC.match(newer)
