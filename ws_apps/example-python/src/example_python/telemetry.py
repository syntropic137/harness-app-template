"""OTEL SDK bootstrap for the Python telemetry-sdk slot.

Config via env vars (12-factor):
  OTEL_EXPORTER_OTLP_ENDPOINT  default http://localhost:4318
  OTEL_SERVICE_NAME            default 'example-python'

NOTE on transport: Python SDK historically defaults to gRPC/4317. The polyglot-monorepo
template pins HTTP/protobuf (4318) per Standard §4.4 to keep behavior identical across
language SDKs. The observability-stack collector ingests both.

Design note: every side-effect path is reachable from a function whose dependencies
can be injected, so unit tests hit 100% lines/branches without a live OTLP collector.
"""

from __future__ import annotations

import os
from typing import Any, Callable, Optional

SERVICE_NAME_DEFAULT = "example-python"
ENDPOINT_DEFAULT = "http://localhost:4318"


def service_name() -> str:
    return os.environ.get("OTEL_SERVICE_NAME", SERVICE_NAME_DEFAULT)


def endpoint() -> str:
    return os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", ENDPOINT_DEFAULT)


def telemetry_enabled() -> bool:
    return os.environ.get("HARNESS_TELEMETRY_DISABLED", "") != "1"


# The lazy-imported OTEL TracerProvider crosses the SDK boundary; same scoped-
# ignore pattern as the lab's pydantic boundary at apps/api-py/src/main.py.
# Keeps `disallow_any_explicit = true` honest project-wide.
def _default_sdk_factory(service: str, otlp_endpoint: str) -> Any:  # type: ignore[explicit-any]
    """Real SDK construction. Imported lazily so unit tests with telemetry
    disabled don't need the OTEL SDK installed at import time."""
    from opentelemetry import trace
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    resource = Resource.create({"service.name": service})
    provider = TracerProvider(resource=resource)
    exporter = OTLPSpanExporter(endpoint=f"{otlp_endpoint}/v1/traces")
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    return provider


def init(  # type: ignore[explicit-any]
    sdk_factory: Optional[Callable[[str, str], Any]] = None,
    enabled: Optional[Callable[[], bool]] = None,
) -> Optional[object]:
    """Initialize the OTEL SDK and return the TracerProvider, or None if disabled.

    ``sdk_factory`` and ``enabled`` are dependency-injection hooks so tests can
    cover both the enabled and disabled branches without touching real I/O.
    """
    enabled_fn = enabled or telemetry_enabled
    if not enabled_fn():
        return None
    factory = sdk_factory or _default_sdk_factory
    result: object = factory(service_name(), endpoint())
    return result


def shutdown(provider: Optional[object]) -> None:
    if provider is not None and hasattr(provider, "shutdown"):
        provider.shutdown()
