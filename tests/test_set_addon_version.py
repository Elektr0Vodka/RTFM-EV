"""scripts/set_addon_version.py: bump the version line of a HA add-on config.yaml."""

import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "set_addon_version.py"

CONFIG = b"""name: RTFM-EV (alpha)
slug: rtfm_ev
version: "3.18.0-EV.0.2"
image: ghcr.io/elektr0vodka/rtfm-ev
arch:
  - amd64
  - aarch64
description: keeps version: "x" in text
"""


def run(path: Path, version: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), str(path), version], capture_output=True, text=True
    )


def test_replaces_quoted_version_only(tmp_path):
    p = tmp_path / "config.yaml"
    p.write_bytes(CONFIG)
    assert run(p, "3.18.0-EV.0.3").returncode == 0
    assert p.read_bytes() == CONFIG.replace(
        b'version: "3.18.0-EV.0.2"', b'version: "3.18.0-EV.0.3"', 1
    )


def test_replaces_unquoted_version(tmp_path):
    p = tmp_path / "config.yaml"
    p.write_bytes(b"name: x\nversion: 1.0.0\nslug: x\n")
    assert run(p, "3.18.0-EV.0.2-edge.412").returncode == 0
    assert p.read_bytes() == b'name: x\nversion: "3.18.0-EV.0.2-edge.412"\nslug: x\n'


def test_keeps_crlf_line_endings(tmp_path):
    p = tmp_path / "config.yaml"
    p.write_bytes(b'name: x\r\nversion: "1"\r\n')
    assert run(p, "2").returncode == 0
    assert p.read_bytes() == b'name: x\r\nversion: "2"\r\n'


def test_idempotent(tmp_path):
    p = tmp_path / "config.yaml"
    p.write_bytes(CONFIG)
    run(p, "3.18.0-EV.0.3")
    once = p.read_bytes()
    run(p, "3.18.0-EV.0.3")
    assert p.read_bytes() == once


def test_missing_version_line_fails(tmp_path):
    p = tmp_path / "config.yaml"
    p.write_bytes(b"name: x\n")
    result = run(p, "1")
    assert result.returncode == 1
    assert p.read_bytes() == b"name: x\n"


def test_rejects_version_with_quotes_or_newlines(tmp_path):
    p = tmp_path / "config.yaml"
    p.write_bytes(CONFIG)
    assert run(p, 'bad"\nslug: evil').returncode == 2
    assert p.read_bytes() == CONFIG
