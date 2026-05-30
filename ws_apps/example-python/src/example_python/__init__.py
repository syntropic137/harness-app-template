"""example-python — minimal Python hello-world for the telemetry-sdk slot."""

from .main import hello_world  # noqa: F401
from .telemetry import (  # noqa: F401
    ENDPOINT_DEFAULT,
    SERVICE_NAME_DEFAULT,
    endpoint,
    service_name,
    telemetry_enabled,
)

__all__ = [
    "hello_world",
    "endpoint",
    "service_name",
    "telemetry_enabled",
    "SERVICE_NAME_DEFAULT",
    "ENDPOINT_DEFAULT",
]
