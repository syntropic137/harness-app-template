// main.rs - minimal hello-world that emits one trace + one log line.
//
// Run with:
//   just stack boot
//   eval "$(just stack ports)"
//   OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:$OTEL_OTLP_PORT" cargo run --release -p example-rust
//
// Then query via the observability-queries skill:
//   curl -sG "http://localhost:$VL_PORT/select/logsql/query" --data-urlencode 'query={service.name="example-rust"} | fields _time, severity, _msg, trace_id | limit 20'
//   curl -s "http://localhost:$VT_PORT/select/jaeger/api/services"

// ── HARNESS-ENGINEERING PROTECTED: do not relax. ────────────────────────────
// Per `Cargo.toml [package.metadata.harness-engineering] no_unsafe = true`
// and Standard §2.5 testing-pyramid contract. Removing this means a strictly
// weaker safety guarantee than declared. If `unsafe` is genuinely required
// in this crate, file a hypothesis-first experiment per CLAUDE.md, do not
// silently remove this attribute.
#![forbid(unsafe_code)]
// ───────────────────────────────────────────────────────────────────────────

// Design for testability:
//   * `hello_world` is split into a side-effect-free message builder
//     (`build_hello_message`) and the actual print/span path
//     (`hello_world`). The builder is unit-tested; the printing path is
//     covered by injecting a writer.
//   * `run` is the binary's full lifecycle (`init` → `hello` → `shutdown`)
//     with every collaborator injected. Unit tests cover both the happy
//     path and the error-propagation path.
//   * `main` is a one-line delegation to `run` and is exercised by the
//     integration tests in `tests/integration_test.rs` (subprocess spawn).
//     `cargo llvm-cov` propagates instrumentation to spawned binaries, so
//     this line is counted.

mod telemetry;

use std::io::Write;

use opentelemetry::trace::{Span, Tracer, TracerProvider};
use opentelemetry::KeyValue;
use serde_json::json;

// `main` is excluded from the unit-test build so its uninstantiated
// monomorphization does not show up as a 0-hit line in `cargo llvm-cov`.
// Coverage of the real entrypoint comes from `tests/integration_test.rs`,
// which spawns the production binary as a subprocess; `cargo llvm-cov`
// propagates instrumentation into the child.
#[cfg(not(test))]
#[tokio::main]
async fn main() -> std::process::ExitCode {
    run(&mut std::io::stdout(), &mut std::io::stderr()).await
}

/// Full binary lifecycle, parameterised on the stdout and stderr sinks so
/// unit tests can drive both the happy path and the error path without
/// touching the real process streams. Uses `dyn Write` (not generics) so
/// there is exactly one instantiation in the compiled artifact. This keeps
/// `cargo llvm-cov` from inflating coverage denominators with per-type
/// monomorphizations.
pub async fn run(out: &mut dyn Write, err: &mut dyn Write) -> std::process::ExitCode {
    let provider = telemetry::init();
    let traced = provider.is_some();
    let result = hello_world(traced, out).await;
    telemetry::shutdown(provider);
    match result {
        Ok(_) => std::process::ExitCode::SUCCESS,
        Err(e) => {
            let _ = writeln!(err, "error: {e}");
            std::process::ExitCode::FAILURE
        }
    }
}

/// Pure builder for the structured hello-world envelope. Side-effect free so
/// it can be asserted on directly.
pub fn build_hello_message(traced: bool, now_rfc3339: String) -> serde_json::Value {
    json!({
        "time": now_rfc3339,
        "severity": "INFO",
        "service": telemetry::service_name(),
        "traced": traced,
        "msg": "hello from example-rust",
    })
}

/// Emit one hello-world span + one structured log line to `out`.
/// Takes `&mut dyn Write` so there is only one instantiation. This keeps coverage
/// denominators stable across the bin and test builds.
pub async fn hello_world(
    traced: bool,
    out: &mut dyn Write,
) -> Result<serde_json::Value, std::io::Error> {
    let tracer = opentelemetry::global::tracer_provider().tracer("example-rust");
    let mut span = tracer.start("hello-world");
    span.set_attribute(KeyValue::new("greeting", "hi from the harness"));

    let msg = build_hello_message(traced, chrono::Utc::now().to_rfc3339());
    writeln!(out, "{msg}")?;

    span.end();
    Ok(msg)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::Mutex;

    // std::env is process-global; serialize tests that touch it. We use
    // `tokio::sync::Mutex` (not `std::sync::Mutex`) because some tests hold
    // the guard across `.await` points. Clippy's `await_holding_lock` lint
    // rejects the std mutex in that pattern, and the async-aware mutex is the
    // canonical fix.
    static ENV_LOCK: Mutex<()> = Mutex::const_new(());

    #[tokio::test]
    async fn build_hello_message_shape_traced_true() {
        let _g = ENV_LOCK.lock().await;
        std::env::remove_var("OTEL_SERVICE_NAME");
        let msg = build_hello_message(true, "2026-01-01T00:00:00Z".to_string());
        assert_eq!(msg["severity"], "INFO");
        assert_eq!(msg["service"], "example-rust");
        assert_eq!(msg["traced"], true);
        assert_eq!(msg["time"], "2026-01-01T00:00:00Z");
        assert!(msg["msg"]
            .as_str()
            .unwrap()
            .contains("hello from example-rust"));
    }

    #[test]
    fn build_hello_message_shape_traced_false() {
        let msg = build_hello_message(false, "2026-01-01T00:00:00Z".to_string());
        assert_eq!(msg["traced"], false);
    }

    #[tokio::test]
    async fn hello_world_writes_json_line() {
        let _g = ENV_LOCK.lock().await;
        std::env::remove_var("OTEL_SERVICE_NAME");
        let mut buf: Vec<u8> = Vec::new();
        let result = hello_world(false, &mut buf).await.expect("hello_world ok");
        let written = String::from_utf8(buf).unwrap();
        assert!(written.ends_with('\n'));
        let parsed: serde_json::Value =
            serde_json::from_str(written.trim()).expect("stdout line parses as JSON");
        assert_eq!(parsed["service"], "example-rust");
        assert_eq!(parsed["severity"], "INFO");
        assert_eq!(parsed["traced"], false);
        assert_eq!(result["service"], "example-rust");
    }

    /// A writer that fails on every `write`. Lets us cover the Err arm of
    /// `hello_world` without monkey-patching stdout.
    struct FailingWriter;
    impl Write for FailingWriter {
        fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
            Err(std::io::Error::other("boom"))
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Err(std::io::Error::other("flush-boom"))
        }
    }

    #[test]
    fn failing_writer_flush_is_exercised() {
        // The `Write` trait requires a `flush` impl, so we have to provide
        // one on `FailingWriter`. Exercising it here is what keeps the test
        // double from showing up as uncovered.
        let mut w = FailingWriter;
        assert!(w.flush().is_err());
    }

    #[tokio::test]
    async fn hello_world_propagates_writer_error() {
        let mut sink = FailingWriter;
        let err = hello_world(true, &mut sink)
            .await
            .expect_err("should error");
        assert_eq!(err.kind(), std::io::ErrorKind::Other);
    }

    #[tokio::test]
    async fn run_happy_path_returns_success_when_disabled() {
        let _g = ENV_LOCK.lock().await;
        std::env::set_var("HARNESS_TELEMETRY_DISABLED", "1");
        let mut out: Vec<u8> = Vec::new();
        let mut err: Vec<u8> = Vec::new();
        let code = run(&mut out, &mut err).await;
        // ExitCode doesn't impl PartialEq; round-trip via Debug as a proxy.
        assert_eq!(
            format!("{code:?}"),
            format!("{:?}", std::process::ExitCode::SUCCESS)
        );
        assert!(err.is_empty());
        assert!(!out.is_empty());
        std::env::remove_var("HARNESS_TELEMETRY_DISABLED");
    }

    #[tokio::test]
    async fn run_happy_path_returns_success_when_enabled() {
        let _g = ENV_LOCK.lock().await;
        std::env::remove_var("HARNESS_TELEMETRY_DISABLED");
        let mut out: Vec<u8> = Vec::new();
        let mut err: Vec<u8> = Vec::new();
        let code = run(&mut out, &mut err).await;
        assert_eq!(
            format!("{code:?}"),
            format!("{:?}", std::process::ExitCode::SUCCESS)
        );
    }

    #[tokio::test]
    async fn run_error_path_returns_failure_and_writes_stderr() {
        let _g = ENV_LOCK.lock().await;
        std::env::set_var("HARNESS_TELEMETRY_DISABLED", "1");
        let mut out = FailingWriter;
        let mut err: Vec<u8> = Vec::new();
        let code = run(&mut out, &mut err).await;
        assert_eq!(
            format!("{code:?}"),
            format!("{:?}", std::process::ExitCode::FAILURE)
        );
        let stderr = String::from_utf8(err).unwrap();
        assert!(stderr.starts_with("error: "));
        std::env::remove_var("HARNESS_TELEMETRY_DISABLED");
    }
}
