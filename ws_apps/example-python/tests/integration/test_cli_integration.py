"""Integration tests: exercise the actual `example-python` CLI as a subprocess.

Per Standard §2.5 testing-pyramid: unit tests cover pure helpers in
``tests/test_main.py``; this suite covers the *process boundary* — env-var
wiring, stdout JSON shape, exit code, wall-clock budget. The smoke-against-
live-stack tier lives under ``experiments/<date>--polyglot-telemetry-smoke/``.

All tests run with ``HARNESS_TELEMETRY_DISABLED=1`` so we don't need a live
OTLP collector; we only assert the stdout JSON line shape.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from typing import Any, Optional

import pytest

WALL_CLOCK_BUDGET_S = 2.0


def _run_cli(extra_env: Optional[dict[str, str]] = None) -> tuple[int, str, str, float]:
    """Spawn ``python -m example_python.main`` and capture exit/stdout/stderr/wall-clock.

    Using ``-m`` rather than the installed ``example-python`` console script
    keeps the test independent of where pip places entry-point shims, which
    differs between venv and system installs.
    """
    env = os.environ.copy()
    env["HARNESS_TELEMETRY_DISABLED"] = "1"
    if extra_env:
        env.update(extra_env)
    started = time.monotonic()
    proc = subprocess.run(
        [sys.executable, "-m", "example_python.main"],
        env=env,
        capture_output=True,
        text=True,
        check=False,
        timeout=10,
    )
    duration = time.monotonic() - started
    return proc.returncode, proc.stdout, proc.stderr, duration


def _find_hello_line(stdout: str) -> Optional[dict[str, Any]]:
    """First stdout line that parses as the hello-world JSON envelope."""
    for raw in stdout.splitlines():
        line = raw.strip()
        if not line.startswith("{"):
            continue
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError:
            continue
        msg = parsed.get("msg")
        if isinstance(msg, str) and "hello from" in msg:
            return parsed
    return None


class TestExamplePythonCli:
    def test_happy_path_exits_zero_and_emits_envelope(self) -> None:
        code, stdout, stderr, duration = _run_cli()
        assert code == 0, f"exit code != 0; stderr was: {stderr}"
        assert duration < WALL_CLOCK_BUDGET_S, (
            f"wall-clock {duration:.3f}s exceeded budget {WALL_CLOCK_BUDGET_S}s"
        )

        line = _find_hello_line(stdout)
        assert line is not None, f"no hello-world line in stdout: {stdout!r}"
        assert line["severity"] == "INFO"
        assert line["service"] == "example-python"
        assert "hello from example-python" in line["msg"]
        assert line["time"].startswith(("19", "20", "21"))  # ISO-8601 year prefix
        # `traceId` is always emitted by hello_world(); with telemetry disabled
        # there is no active span so the value is the empty string.
        assert line["traceId"] == ""

    def test_honors_otel_service_name_override(self) -> None:
        code, stdout, _stderr, _duration = _run_cli({"OTEL_SERVICE_NAME": "custom-svc"})
        assert code == 0
        line = _find_hello_line(stdout)
        assert line is not None
        assert line["service"] == "custom-svc"


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
