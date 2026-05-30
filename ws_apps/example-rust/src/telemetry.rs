// telemetry.rs — OTEL SDK bootstrap for the Rust telemetry-sdk slot.
// Targets opentelemetry-sdk 0.31 (current as of 2026-05-14).
//
// API rename note: in 0.31, the provider is `SdkTracerProvider`. Earlier
// versions called it `TracerProvider`; the rename happened in the run-up to
// the trace API stabilization. Watch the changelog when bumping.
//
// Config via env vars (12-factor):
//   OTEL_EXPORTER_OTLP_ENDPOINT  default http://localhost:4318
//   OTEL_SERVICE_NAME            default "example-rust"
//
// NOTE on transport defaults: the Rust SDK defaults to gRPC/4317 historically,
// but the polyglot-monorepo template pins HTTP/protobuf (4318) per Standard §4.4
// to keep transport behavior identical across language SDKs. The
// observability-stack collector ingests both.
//
// Design for testability: `init()` is split into pure-config (`build_provider`)
// and global-registration (`init`). The pure helper takes no env, no I/O at
// global-state level, and can be unit-tested directly. `init` registers the
// provider with the OTEL global and is itself covered via a unit test that
// exercises both the disabled and enabled branches.

use opentelemetry::global;
use opentelemetry::KeyValue;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::trace::SdkTracerProvider;
use opentelemetry_sdk::Resource;

pub const SERVICE_NAME_DEFAULT: &str = "example-rust";
pub const ENDPOINT_DEFAULT: &str = "http://localhost:4318";

pub fn service_name() -> String {
    std::env::var("OTEL_SERVICE_NAME").unwrap_or_else(|_| SERVICE_NAME_DEFAULT.to_string())
}

pub fn endpoint() -> String {
    std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT").unwrap_or_else(|_| ENDPOINT_DEFAULT.to_string())
}

pub fn telemetry_enabled() -> bool {
    std::env::var("HARNESS_TELEMETRY_DISABLED").unwrap_or_default() != "1"
}

/// Build a tracer provider configured for the current env. Returns Err if the
/// OTLP exporter can't be constructed (e.g. an invalid endpoint URL). Pure
/// w.r.t. the OTEL global state — does NOT call `set_tracer_provider`.
pub fn build_provider() -> Result<SdkTracerProvider, opentelemetry_otlp::ExporterBuildError> {
    let exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_http()
        .with_endpoint(format!("{}/v1/traces", endpoint()))
        .build()?;
    let resource = Resource::builder()
        .with_attribute(KeyValue::new("service.name", service_name()))
        .build();
    Ok(SdkTracerProvider::builder()
        .with_batch_exporter(exporter)
        .with_resource(resource)
        .build())
}

pub fn init() -> Option<SdkTracerProvider> {
    if !telemetry_enabled() {
        return None;
    }
    // Soft-fail: a malformed endpoint should NOT crash the app — it should
    // degrade to "telemetry off" with a one-line stderr breadcrumb. Both
    // arms are exercised by unit tests.
    match build_provider() {
        Ok(provider) => {
            global::set_tracer_provider(provider.clone());
            Some(provider)
        }
        Err(e) => {
            eprintln!("telemetry init failed, continuing without traces: {e}");
            None
        }
    }
}

/// Explicit shutdown. Required before `process::exit` because batch exporters
/// flush asynchronously — see retrospective 021.
pub fn shutdown(provider: Option<SdkTracerProvider>) {
    if let Some(p) = provider {
        let _ = p.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // Env-var tests must serialize because std::env is process-global.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn service_name_uses_default_when_unset() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::remove_var("OTEL_SERVICE_NAME");
        assert_eq!(service_name(), SERVICE_NAME_DEFAULT);
    }

    #[test]
    fn service_name_honors_override() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::set_var("OTEL_SERVICE_NAME", "override-svc");
        assert_eq!(service_name(), "override-svc");
        std::env::remove_var("OTEL_SERVICE_NAME");
    }

    #[test]
    fn endpoint_uses_default_when_unset() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::remove_var("OTEL_EXPORTER_OTLP_ENDPOINT");
        assert_eq!(endpoint(), ENDPOINT_DEFAULT);
    }

    #[test]
    fn endpoint_honors_override() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::set_var("OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel:4318");
        assert_eq!(endpoint(), "http://otel:4318");
        std::env::remove_var("OTEL_EXPORTER_OTLP_ENDPOINT");
    }

    #[test]
    fn telemetry_enabled_branches() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::set_var("HARNESS_TELEMETRY_DISABLED", "1");
        assert!(!telemetry_enabled());
        std::env::set_var("HARNESS_TELEMETRY_DISABLED", "0");
        assert!(telemetry_enabled());
        std::env::remove_var("HARNESS_TELEMETRY_DISABLED");
        assert!(telemetry_enabled());
    }

    #[test]
    fn build_provider_succeeds_with_default_endpoint() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::remove_var("OTEL_EXPORTER_OTLP_ENDPOINT");
        let provider = build_provider().expect("provider builds");
        // Shutdown immediately to avoid leaking the background batch worker.
        let _ = provider.shutdown();
    }

    #[test]
    fn build_provider_errors_on_invalid_endpoint() {
        let _g = ENV_LOCK.lock().unwrap();
        // A non-URL value forces `with_endpoint` -> `build()` to fail when
        // the OTLP exporter tries to parse the endpoint. This covers the
        // `?`-propagated error arm of `build_provider`.
        std::env::set_var("OTEL_EXPORTER_OTLP_ENDPOINT", "::not a url::");
        let r = build_provider();
        std::env::remove_var("OTEL_EXPORTER_OTLP_ENDPOINT");
        // If the SDK is permissive enough to accept the string here, we
        // still won't have a covered error arm — but on opentelemetry-otlp
        // 0.31 the URL is validated eagerly. Document the requirement so a
        // future SDK bump that loosens validation triggers a CI failure.
        // If the SDK loosens validation in a future bump, this test will
        // fail and force us to find a different way to cover the `?` arm.
        assert!(r.is_err());
    }

    #[test]
    fn init_returns_none_when_disabled() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::set_var("HARNESS_TELEMETRY_DISABLED", "1");
        assert!(init().is_none());
        std::env::remove_var("HARNESS_TELEMETRY_DISABLED");
    }

    #[test]
    fn init_returns_some_when_enabled_and_shutdown_drains_it() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::remove_var("HARNESS_TELEMETRY_DISABLED");
        std::env::remove_var("OTEL_EXPORTER_OTLP_ENDPOINT");
        let provider = init().expect("init returns provider when enabled");
        // Exercise the Some-arm of shutdown.
        shutdown(Some(provider));
    }

    #[test]
    fn init_returns_none_on_build_failure() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::remove_var("HARNESS_TELEMETRY_DISABLED");
        std::env::set_var("OTEL_EXPORTER_OTLP_ENDPOINT", "::not a url::");
        let r = init();
        std::env::remove_var("OTEL_EXPORTER_OTLP_ENDPOINT");
        assert!(r.is_none());
    }

    #[test]
    fn shutdown_none_is_a_noop() {
        shutdown(None);
    }
}
