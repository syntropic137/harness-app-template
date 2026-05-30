"""Unit tests for example_python.main and example_python.telemetry.

These tests reach 100% lines/branches without a live OTEL collector by
dependency-injecting the SDK / span / shutdown collaborators.
"""

from __future__ import annotations

import datetime as _dt
import io
import json
import os

# Disable telemetry for all tests so OTEL SDK isn't required to be installed.
os.environ["HARNESS_TELEMETRY_DISABLED"] = "1"


# ── telemetry.py ────────────────────────────────────────────────────────────


def test_service_name_default(monkeypatch):
    monkeypatch.delenv("OTEL_SERVICE_NAME", raising=False)
    from example_python.telemetry import SERVICE_NAME_DEFAULT, service_name

    assert service_name() == SERVICE_NAME_DEFAULT == "example-python"


def test_service_name_override(monkeypatch):
    monkeypatch.setenv("OTEL_SERVICE_NAME", "custom-svc")
    from example_python.telemetry import service_name

    assert service_name() == "custom-svc"


def test_endpoint_default(monkeypatch):
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)
    from example_python.telemetry import ENDPOINT_DEFAULT, endpoint

    assert endpoint() == ENDPOINT_DEFAULT == "http://localhost:4318"


def test_endpoint_override(monkeypatch):
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector:4318")
    from example_python.telemetry import endpoint

    assert endpoint() == "http://collector:4318"


def test_telemetry_enabled_toggle(monkeypatch):
    from example_python.telemetry import telemetry_enabled

    monkeypatch.setenv("HARNESS_TELEMETRY_DISABLED", "1")
    assert telemetry_enabled() is False
    monkeypatch.delenv("HARNESS_TELEMETRY_DISABLED", raising=False)
    assert telemetry_enabled() is True


def test_init_returns_none_when_disabled():
    from example_python.telemetry import init

    assert init(enabled=lambda: False) is None


def test_init_uses_injected_factory_when_enabled():
    from example_python.telemetry import init

    calls = {}

    def fake_factory(service, otlp_endpoint):
        calls["service"] = service
        calls["endpoint"] = otlp_endpoint
        return "fake-provider"

    result = init(sdk_factory=fake_factory, enabled=lambda: True)
    assert result == "fake-provider"
    assert calls["service"] == "example-python"
    assert calls["endpoint"].startswith("http://")


def test_default_sdk_factory_constructs_provider(monkeypatch):
    """Cover the lazy-import branch of _default_sdk_factory by stubbing the
    OTEL modules in sys.modules before the function imports them."""
    import sys
    import types

    captured = {}

    class FakeResource:
        @staticmethod
        def create(attrs):
            captured["resource_attrs"] = attrs
            return "resource"

    class FakeProvider:
        def __init__(self, resource):
            captured["provider_resource"] = resource
            self.processors = []

        def add_span_processor(self, proc):
            self.processors.append(proc)

        def shutdown(self):
            captured["shutdown"] = True

    class FakeExporter:
        def __init__(self, endpoint):
            captured["exporter_endpoint"] = endpoint

    class FakeBSP:
        def __init__(self, exporter):
            captured["bsp_exporter"] = exporter

    class FakeTrace:
        @staticmethod
        def set_tracer_provider(p):
            captured["set_provider"] = p

    # Build fake module tree.
    fake_otel = types.ModuleType("opentelemetry")
    fake_otel.trace = FakeTrace
    fake_exporter_mod = types.ModuleType(
        "opentelemetry.exporter.otlp.proto.http.trace_exporter"
    )
    fake_exporter_mod.OTLPSpanExporter = FakeExporter
    fake_resources_mod = types.ModuleType("opentelemetry.sdk.resources")
    fake_resources_mod.Resource = FakeResource
    fake_sdk_trace_mod = types.ModuleType("opentelemetry.sdk.trace")
    fake_sdk_trace_mod.TracerProvider = FakeProvider
    fake_export_mod = types.ModuleType("opentelemetry.sdk.trace.export")
    fake_export_mod.BatchSpanProcessor = FakeBSP

    monkeypatch.setitem(sys.modules, "opentelemetry", fake_otel)
    monkeypatch.setitem(
        sys.modules,
        "opentelemetry.exporter.otlp.proto.http.trace_exporter",
        fake_exporter_mod,
    )
    monkeypatch.setitem(sys.modules, "opentelemetry.sdk.resources", fake_resources_mod)
    monkeypatch.setitem(sys.modules, "opentelemetry.sdk.trace", fake_sdk_trace_mod)
    monkeypatch.setitem(sys.modules, "opentelemetry.sdk.trace.export", fake_export_mod)

    from example_python.telemetry import _default_sdk_factory

    provider = _default_sdk_factory("svc", "http://collector:4318")
    assert isinstance(provider, FakeProvider)
    assert captured["resource_attrs"] == {"service.name": "svc"}
    assert captured["exporter_endpoint"] == "http://collector:4318/v1/traces"
    assert captured["set_provider"] is provider
    assert len(provider.processors) == 1


def test_shutdown_no_op_for_none():
    from example_python.telemetry import shutdown

    shutdown(None)  # Should not raise.


def test_shutdown_calls_provider_shutdown():
    from example_python.telemetry import shutdown

    class Prov:
        def __init__(self):
            self.called = False

        def shutdown(self):
            self.called = True

    p = Prov()
    shutdown(p)
    assert p.called is True


def test_shutdown_skips_provider_without_shutdown_attr():
    from example_python.telemetry import shutdown

    class NoShutdown:
        pass

    # Should not raise; just silently skips.
    shutdown(NoShutdown())


# ── main.hello_world ────────────────────────────────────────────────────────


def test_hello_world_emits_structured_message(capsys):
    from example_python.main import hello_world

    result = hello_world(traced=False)
    assert result["service"] == "example-python"
    assert result["severity"] == "INFO"
    assert "hello from example-python" in result["msg"]
    assert result["traceId"] == ""

    captured = capsys.readouterr()
    parsed = json.loads(captured.out.strip().splitlines()[-1])
    assert parsed["service"] == "example-python"


def test_hello_world_uses_injected_clock_and_stream():
    from example_python.main import hello_world

    fixed = _dt.datetime(2026, 1, 1, tzinfo=_dt.timezone.utc)
    buf = io.StringIO()
    result = hello_world(traced=False, now=lambda: fixed, out=buf)
    assert result["time"] == fixed.isoformat()
    assert json.loads(buf.getvalue().strip())["time"] == fixed.isoformat()


def test_hello_world_traced_with_real_trace_id():
    """Cover the traced=True branch with a non-zero trace_id."""
    from example_python.main import hello_world

    class FakeCtx:
        def __init__(self, trace_id):
            self.trace_id = trace_id

    class FakeSpan:
        def __init__(self, trace_id):
            self.attrs = {}
            self._ctx = FakeCtx(trace_id)

        def set_attribute(self, k, v):
            self.attrs[k] = v

        def get_span_context(self):
            return self._ctx

    class FakeSpanCtx:
        def __init__(self, trace_id):
            self.span = FakeSpan(trace_id)
            self.entered = False
            self.exited = False

        def __enter__(self):
            self.entered = True
            return self.span

        def __exit__(self, exc_type, exc, tb):
            self.exited = True
            return None

    ctx = FakeSpanCtx(trace_id=0xABC)
    buf = io.StringIO()
    result = hello_world(traced=True, span_factory=lambda: ctx, out=buf)
    assert ctx.entered and ctx.exited
    assert result["traceId"] == format(0xABC, "032x")
    assert ctx.span.attrs == {"greeting": "hi from the harness"}


def test_hello_world_traced_with_zero_trace_id_yields_empty_string():
    """Cover the falsy-trace-id branch of the format() ternary."""
    from example_python.main import hello_world

    class FakeCtx:
        trace_id = 0

    class FakeSpan:
        def set_attribute(self, *_a, **_kw):
            pass

        def get_span_context(self):
            return FakeCtx()

    class FakeSpanCtx:
        def __enter__(self):
            return FakeSpan()

        def __exit__(self, *a):
            return None

    buf = io.StringIO()
    result = hello_world(traced=True, span_factory=lambda: FakeSpanCtx(), out=buf)
    assert result["traceId"] == ""


def test_hello_world_traced_with_none_span_context_yields_empty_string():
    """Cover the ``not ctx`` branch — get_span_context returns None."""
    from example_python.main import hello_world

    class FakeSpan:
        def set_attribute(self, *_a, **_kw):
            pass

        def get_span_context(self):
            return None

    class FakeSpanCtx:
        def __enter__(self):
            return FakeSpan()

        def __exit__(self, *a):
            return None

    buf = io.StringIO()
    result = hello_world(traced=True, span_factory=lambda: FakeSpanCtx(), out=buf)
    assert result["traceId"] == ""


def test_real_tracer_span_factory_uses_stubbed_otel(monkeypatch):
    """Cover the lazy-import branch of _real_tracer_span_factory."""
    import sys
    import types

    captured = {}

    class FakeTracer:
        def start_as_current_span(self, name):
            captured["span_name"] = name
            return "span-ctx"

    class FakeTrace:
        @staticmethod
        def get_tracer(name):
            captured["tracer_name"] = name
            return FakeTracer()

    fake_otel = types.ModuleType("opentelemetry")
    fake_otel.trace = FakeTrace
    monkeypatch.setitem(sys.modules, "opentelemetry", fake_otel)

    from example_python.main import _real_tracer_span_factory

    result = _real_tracer_span_factory()
    assert result == "span-ctx"
    assert captured["tracer_name"] == "example-python"
    assert captured["span_name"] == "hello-world"


# ── main.cli ────────────────────────────────────────────────────────────────


def test_cli_returns_zero_on_success(monkeypatch):
    from example_python.main import cli

    monkeypatch.setenv("HARNESS_TELEMETRY_DISABLED", "1")
    rc = cli()
    assert rc == 0


def test_cli_success_with_telemetry_enabled_passes_traced_true():
    from example_python.main import cli

    calls = {}

    def fake_hello(traced):
        calls["traced"] = traced
        return {"ok": True}

    shutdowns = []
    rc = cli(
        hello=fake_hello,
        init_fn=lambda: "provider",
        shutdown_fn=lambda p: shutdowns.append(p),
        enabled_fn=lambda: True,
    )
    assert rc == 0
    assert calls["traced"] is True
    assert shutdowns == ["provider"]


def test_cli_success_with_disabled_telemetry_passes_traced_false():
    from example_python.main import cli

    calls = {}
    rc = cli(
        hello=lambda traced: calls.setdefault("traced", traced) or {"ok": True},
        init_fn=lambda: None,
        shutdown_fn=lambda p: None,
        enabled_fn=lambda: False,
    )
    assert rc == 0
    assert calls["traced"] is False


def test_cli_returns_one_on_exception_and_calls_shutdown():
    from example_python.main import cli

    def boom(traced):
        raise RuntimeError("nope")

    errs: list[str] = []
    shutdowns: list[object] = []

    rc = cli(
        hello=boom,
        init_fn=lambda: "provider",
        shutdown_fn=lambda p: shutdowns.append(p),
        enabled_fn=lambda: True,
        write_err=lambda s: errs.append(s) or len(s),
    )
    assert rc == 1
    assert any("nope" in s for s in errs)
    assert shutdowns == ["provider"]  # finally-block runs even on error


def test_cli_default_write_err_writes_to_stderr(capsys):
    from example_python.main import cli

    def boom(traced):
        raise RuntimeError("bang")

    rc = cli(
        hello=boom,
        init_fn=lambda: None,
        shutdown_fn=lambda p: None,
        enabled_fn=lambda: False,
    )
    assert rc == 1
    captured = capsys.readouterr()
    assert "bang" in captured.err
