"""Illustrative example: a typed configuration registry using Pydantic Settings.

This file is illustrative, not load-bearing. The filename, package layout, and
field set are placeholders. In a real project the registry would live wherever
your shared-settings package conventionally lives (e.g. ``packages/shared/src/
<project>/settings/config.py``). What matters is the shape, not the location:

  - one class declares every variable the project reads,
  - each field has a description, type, default, and constraint metadata,
  - secrets use ``SecretStr`` so accidental ``repr()`` does not leak them,
  - feature flags follow the disable-flag pattern (default-on; explicit opt-out),
  - downstream tooling (``.env.example`` generator, doctor, secret sync) reads
    from this class. Nothing else is authoritative on env-var names.

See the SLP at ../../../SKILL.md (principles 1, 2, 8, 9) for the rationale.
"""

from __future__ import annotations

from enum import StrEnum
from functools import lru_cache
from typing import Annotated

from pydantic import Field, PostgresDsn, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class AppEnvironment(StrEnum):
    """Application environment. Drives logging verbosity and feature defaults."""

    DEVELOPMENT = "development"
    STAGING = "staging"
    PRODUCTION = "production"
    TEST = "test"


class Settings(BaseSettings):
    """Application settings: validated on startup, documented in-place."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # =========================================================================
    # APPLICATION
    # =========================================================================

    app_name: str = Field(
        default="example-service",
        description="Application name. Used in logs and metric tags.",
    )

    app_environment: AppEnvironment = Field(
        default=AppEnvironment.DEVELOPMENT,
        description=(
            "Current environment. Affects logging verbosity, error surface, "
            "and which feature defaults apply."
        ),
    )

    debug: bool = Field(
        default=False,
        description="Enable debug mode. Shows detailed errors. Never enable in production.",
    )

    # =========================================================================
    # DATABASE
    # =========================================================================
    # Principle 5: no production-relevant default. Development gets the
    # docker-compose URL; production must override or startup fails.

    database_url: Annotated[
        PostgresDsn | None,
        Field(
            default=None,
            description=(
                "Postgres DSN. Format: postgresql://user:password@host:port/database. "
                "Required in production. Defaults to None so a missing override fails fast "
                "rather than silently pointing at localhost."
            ),
        ),
    ] = None

    database_pool_size: int = Field(
        default=5,
        ge=1,
        le=100,
        description="Connection pool size. Increase for high-traffic production.",
    )

    # =========================================================================
    # HTTP CLIENT TUNABLES (principle 6: lift environment-varying values)
    # =========================================================================

    request_timeout_seconds: int = Field(
        default=30,
        ge=1,
        le=300,
        description="HTTP client request timeout. Increase for slow downstreams.",
    )

    request_retry_count: int = Field(
        default=3,
        ge=0,
        le=10,
        description="Number of retries on transient HTTP failures.",
    )

    # =========================================================================
    # SECRETS (principle 4: separate secrets from non-secret tunables)
    # =========================================================================

    api_key: SecretStr | None = Field(
        default=None,
        description=(
            "Third-party API key. Loaded from secret store (1Password, Vault, "
            "or cloud-native). Never committed to source."
        ),
    )

    # =========================================================================
    # FEATURE FLAGS (principle 9: default-on with explicit disable)
    # =========================================================================
    # Disable-flag shape: feature is enabled by default; setting the flag to
    # true force-disables it. Cleaner than X_ENABLED for stable features.

    polling_disabled: bool = Field(
        default=False,
        description="Set true to disable the background poller in this deployment.",
    )

    metrics_disabled: bool = Field(
        default=False,
        description="Set true to disable metrics emission. Default-on for stable observability.",
    )

    # =========================================================================
    # VALIDATORS
    # =========================================================================

    @field_validator("database_url", mode="before")
    @classmethod
    def empty_str_to_none(cls, v: str | None) -> str | None:
        """Treat empty strings as None so an unset .env entry does not break parsing."""
        if v == "":
            return None
        return v

    # =========================================================================
    # COMPUTED PROPERTIES
    # =========================================================================

    @property
    def is_production(self) -> bool:
        return self.app_environment == AppEnvironment.PRODUCTION

    @property
    def polling_enabled(self) -> bool:
        """Effective polling state. Disable-flag shape, principle 9."""
        return not self.polling_disabled


@lru_cache
def get_settings() -> Settings:
    """Return cached, validated settings. Raises ValidationError on missing required values."""
    return Settings()  # type: ignore[call-arg]


# =============================================================================
# OPTIONAL-WARNING REPORTING (principle 3, second half)
# =============================================================================
# Required values fail fast at Settings() construction (Pydantic raises
# ValidationError naming the missing field). Optional values that are unset
# do not fail; instead, the application logs a warning at startup describing
# which capability is degraded. Silent degradation is the worst outcome.

OPTIONAL_CAPABILITY_CHECKS: tuple[tuple[str, str], ...] = (
    (
        "api_key",
        "API_KEY not set; third-party integration disabled-missing-config.",
    ),
    (
        "database_url",
        "DATABASE_URL not set; falling back to in-memory storage (development only).",
    ),
)


def report_optional_capabilities(settings: Settings, log) -> None:
    """Emit one warning per missing optional value; never log the value itself.

    Pass any logger-like object (logging.Logger, structlog logger, etc.) as
    ``log``; this avoids hard-coding a logging library here. The function
    inspects field presence only and never reads/echoes secret values.
    """
    for field_name, message in OPTIONAL_CAPABILITY_CHECKS:
        value = getattr(settings, field_name, None)
        if value is None:
            log.warning(message)
