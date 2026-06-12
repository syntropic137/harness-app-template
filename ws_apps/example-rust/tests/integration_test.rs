//! integration_test.rs — exercise the actual `example-rust` binary as a
//! subprocess (not just the library API).
//!
//! Per Cargo convention, files under `<crate>/tests/` are compiled as
//! separate test binaries and have access only to the crate's public API
//! plus, via `env!("CARGO_BIN_EXE_<name>")`, the freshly-built binary path.
//! The std-mod tests in `src/main.rs` cover the library function;
//! THIS file covers the *process boundary* — env wiring, stdout JSON shape,
//! exit code, wall-clock budget. The smoke-against-live-stack tier lives
//! under `experiments/<date>--polyglot-telemetry-smoke/`.
//!
//! All tests run with `HARNESS_TELEMETRY_DISABLED=1` so we don't need a live
//! OTLP collector; we only assert the stdout JSON line shape.

use std::process::Command;
use std::time::{Duration, Instant};

const WALL_CLOCK_BUDGET: Duration = Duration::from_millis(1000);

/// Path to the freshly-built `example-rust` binary. Cargo sets this env
/// var at compile time for every `[[bin]]` target the integration test
/// can see.
const BIN: &str = env!("CARGO_BIN_EXE_example-rust");

fn run_cli(extra_env: &[(&str, &str)]) -> (i32, String, String, Duration) {
    let started = Instant::now();
    let mut cmd = Command::new(BIN);
    cmd.env("HARNESS_TELEMETRY_DISABLED", "1");
    for (k, v) in extra_env {
        cmd.env(k, v);
    }
    let output = cmd.output().expect("spawn example-rust");
    let duration = started.elapsed();
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    let code = output.status.code().unwrap_or(-1);
    (code, stdout, stderr, duration)
}

/// Pick the first stdout line that parses as the hello-world JSON envelope.
fn find_hello_line(stdout: &str) -> Option<serde_json::Value> {
    for raw in stdout.lines() {
        let line = raw.trim();
        if !line.starts_with('{') {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
            if v.get("msg")
                .and_then(|m| m.as_str())
                .is_some_and(|m| m.contains("hello from"))
            {
                return Some(v);
            }
        }
    }
    None
}

#[test]
fn cli_happy_path_exits_zero_and_emits_envelope() {
    let (code, stdout, stderr, duration) = run_cli(&[]);
    assert_eq!(code, 0, "exit code != 0; stderr was: {stderr}");
    assert!(
        duration < WALL_CLOCK_BUDGET,
        "wall-clock {duration:?} exceeded budget {WALL_CLOCK_BUDGET:?}"
    );

    let line = find_hello_line(&stdout).unwrap_or_else(|| {
        panic!("no hello-world line in stdout: {stdout}");
    });
    assert_eq!(line["severity"], "INFO");
    assert_eq!(line["service"], "example-rust");
    assert!(
        line["msg"]
            .as_str()
            .unwrap()
            .contains("hello from example-rust"),
        "msg field unexpected: {}",
        line["msg"]
    );
    assert!(
        line["time"].as_str().unwrap().len() >= 10,
        "time field unexpected: {}",
        line["time"]
    );
    // example-rust emits `traced: bool` rather than a `traceId` string, because
    // the harness's Rust telemetry surface gives us "is the SDK on?" cheaply
    // without an extra dependency to format trace IDs. With telemetry disabled,
    // this must be `false`.
    assert_eq!(line["traced"], serde_json::Value::Bool(false));
}

#[test]
fn cli_honors_otel_service_name_override() {
    let (code, stdout, _stderr, _duration) = run_cli(&[("OTEL_SERVICE_NAME", "custom-svc")]);
    assert_eq!(code, 0);
    let line = find_hello_line(&stdout).expect("hello-world line present");
    assert_eq!(line["service"], "custom-svc");
}
