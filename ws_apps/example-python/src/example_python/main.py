"""main.py — minimal hello-world that emits one trace + one JSON log line.

Run with:    pip install -e . && example-python
Or:          python -m example_python.main

Then query via the observability-queries skill:
  curl 'http://localhost:9428/select/logsql/query' -d 'query=service:"example-python"'

Design note: every code path is reachable from `hello_world` or `cli` via
injectable dependencies so unit tests hit 100% lines/branches without spawning
a subprocess or requiring a live OTEL stack. The script-entry block at the
bottom is the only line excluded from coverage.
"""

from __future__ import annotations

import datetime as _dt
import json
import sys
from typing import Any, Callable, Optional

from .telemetry import init as init_telemetry
from .telemetry import service_name, shutdown as shutdown_telemetry, telemetry_enabled


# The OTEL span context manager and the test-injected file-like `out` are SDK /
# stdlib boundary types we don't want to import-just-for-typing. Same pattern
# as the lab's pydantic boundary at apps/api-py/src/main.py (scoped
# `# type: ignore[explicit-any]` keeps `disallow_any_explicit = true` honest).
def _real_tracer_span_factory() -> Any:  # type: ignore[explicit-any]
    """Return a context-manager yielding a started OTEL span. Lazy-imported so
    tests with telemetry disabled don't require the SDK installed."""
    from opentelemetry import trace

    tracer = trace.get_tracer("example-python")
    return tracer.start_as_current_span("hello-world")


def hello_world(  # type: ignore[explicit-any]
    traced: bool = False,
    span_factory: Optional[Callable[[], Any]] = None,
    now: Optional[Callable[[], _dt.datetime]] = None,
    out: Any = None,
) -> dict[str, Any]:
    """Emit a structured JSON line on stdout; return the same dict.

    ``span_factory``/``now``/``out`` are DI hooks for unit tests.
    """
    stream = out if out is not None else sys.stdout
    clock = now or (lambda: _dt.datetime.now(_dt.timezone.utc))

    trace_id = ""
    span_ctx = None
    if traced:
        factory = span_factory or _real_tracer_span_factory
        span_ctx = factory()
        span = span_ctx.__enter__()
        span.set_attribute("greeting", "hi from the harness")
        ctx = span.get_span_context()
        trace_id = format(ctx.trace_id, "032x") if ctx and ctx.trace_id else ""

    msg = {
        "time": clock().isoformat(),
        "severity": "INFO",
        "service": service_name(),
        "traceId": trace_id,
        "msg": "hello from example-python",
    }
    stream.write(json.dumps(msg) + "\n")
    stream.flush()

    if span_ctx is not None:
        span_ctx.__exit__(None, None, None)

    return msg


def cli(  # type: ignore[explicit-any]
    hello: Optional[Callable[..., dict[str, Any]]] = None,
    init_fn: Optional[Callable[[], Optional[object]]] = None,
    shutdown_fn: Optional[Callable[[Optional[object]], None]] = None,
    enabled_fn: Optional[Callable[[], bool]] = None,
    write_err: Optional[Callable[[str], int]] = None,
) -> int:
    """Entry point for the `example-python` console script.

    All collaborators are injectable so tests can cover the happy path, the
    telemetry-enabled branch, and the exception path without real I/O.
    """
    do_init = init_fn or init_telemetry
    do_shutdown = shutdown_fn or shutdown_telemetry
    is_enabled = enabled_fn or telemetry_enabled
    err = write_err or (lambda s: sys.stderr.write(s))
    say_hello = hello or hello_world

    provider = do_init()
    try:
        say_hello(traced=is_enabled() and provider is not None)
        return 0
    except Exception as e:  # noqa: BLE001
        err(f"error: {e}\n")
        return 1
    finally:
        do_shutdown(provider)


if (
    __name__ == "__main__"
):  # pragma: no cover - script-entry wiring; cli() itself is tested
    sys.exit(cli())
