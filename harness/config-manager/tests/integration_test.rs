use std::process::Command;
use tempfile::TempDir;

fn binary() -> &'static str {
    env!("CARGO_BIN_EXE_harness-config-manager")
}

fn write_config(dir: &TempDir, content: &str) {
    std::fs::write(dir.path().join("config.toml"), content).unwrap();
}

#[test]
fn schema_load_fails_on_missing_file() {
    let dir = TempDir::new().unwrap();
    let out = Command::new(binary())
        .arg("check")
        .current_dir(dir.path())
        .output()
        .unwrap();
    assert!(!out.status.success());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("config.toml") || stderr.contains("No such file"),
        "stderr: {stderr}"
    );
}

#[test]
fn schema_load_fails_on_invalid_toml() {
    let dir = TempDir::new().unwrap();
    write_config(&dir, "not valid toml ::::");
    let out = Command::new(binary())
        .arg("check")
        .current_dir(dir.path())
        .output()
        .unwrap();
    assert!(!out.status.success());
}

const MINIMAL_CONFIG: &str = r#"
[config]
version = "1"
app_prefix = "TEST"

[[var]]
name = "REQUIRED_VAR"
description = "A required variable"
required = true

[[var]]
name = "OPTIONAL_VAR"
description = "An optional variable"
required = false
default = "default-value"
"#;

#[test]
fn check_fails_when_required_var_missing() {
    let dir = TempDir::new().unwrap();
    write_config(&dir, MINIMAL_CONFIG);
    let out = Command::new(binary())
        .arg("check")
        .current_dir(dir.path())
        .env_remove("REQUIRED_VAR")
        .output()
        .unwrap();
    assert!(!out.status.success(), "expected non-zero exit");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("REQUIRED_VAR"), "stderr: {stderr}");
}

#[test]
fn check_passes_when_required_var_in_env() {
    let dir = TempDir::new().unwrap();
    write_config(&dir, MINIMAL_CONFIG);
    let out = Command::new(binary())
        .arg("check")
        .env("REQUIRED_VAR", "somevalue")
        .current_dir(dir.path())
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
fn check_passes_when_required_var_in_dotenv() {
    let dir = TempDir::new().unwrap();
    write_config(&dir, MINIMAL_CONFIG);
    std::fs::write(dir.path().join(".env"), "REQUIRED_VAR=from-dotenv\n").unwrap();
    let out = Command::new(binary())
        .arg("check")
        .env_remove("REQUIRED_VAR")
        .current_dir(dir.path())
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
fn check_reports_all_missing_vars_at_once() {
    let dir = TempDir::new().unwrap();
    write_config(
        &dir,
        r#"
[config]
version = "1"
app_prefix = "TEST"

[[var]]
name = "FIRST_REQUIRED"
description = "First"
required = true

[[var]]
name = "SECOND_REQUIRED"
description = "Second"
required = true
"#,
    );
    let out = Command::new(binary())
        .args(["check"])
        .env_remove("FIRST_REQUIRED")
        .env_remove("SECOND_REQUIRED")
        .current_dir(dir.path())
        .output()
        .unwrap();
    assert!(!out.status.success());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("FIRST_REQUIRED"), "stderr: {stderr}");
    assert!(stderr.contains("SECOND_REQUIRED"), "stderr: {stderr}");
}

#[test]
fn sync_generates_env_example() {
    let dir = TempDir::new().unwrap();
    write_config(&dir, MINIMAL_CONFIG);
    let out = Command::new(binary())
        .args(["sync"])
        .current_dir(dir.path())
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let example = std::fs::read_to_string(dir.path().join(".env.example")).unwrap();
    assert!(example.contains("REQUIRED_VAR="), "example:\n{example}");
    assert!(example.contains("[REQUIRED]"), "example:\n{example}");
    assert!(
        example.contains("OPTIONAL_VAR=default-value"),
        "example:\n{example}"
    );
}

#[test]
fn sync_preserves_existing_env_values() {
    let dir = TempDir::new().unwrap();
    write_config(&dir, MINIMAL_CONFIG);
    std::fs::write(dir.path().join(".env"), "REQUIRED_VAR=my-secret\n").unwrap();
    let out = Command::new(binary())
        .args(["sync"])
        .current_dir(dir.path())
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let env = std::fs::read_to_string(dir.path().join(".env")).unwrap();
    assert!(env.contains("REQUIRED_VAR=my-secret"), "env:\n{env}");
}

#[test]
fn sync_archives_removed_vars() {
    let dir = TempDir::new().unwrap();
    write_config(&dir, MINIMAL_CONFIG);
    std::fs::write(
        dir.path().join(".env"),
        "REQUIRED_VAR=val\nOLD_VAR=legacy\n",
    )
    .unwrap();
    let out = Command::new(binary())
        .args(["sync"])
        .current_dir(dir.path())
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let env = std::fs::read_to_string(dir.path().join(".env")).unwrap();
    assert!(env.contains("ARCHIVED VARIABLES"), "env:\n{env}");
    assert!(env.contains("OLD_VAR=legacy"), "env:\n{env}");
}

#[test]
fn exec_injects_env_into_subprocess() {
    let dir = TempDir::new().unwrap();
    write_config(&dir, MINIMAL_CONFIG);
    std::fs::write(dir.path().join(".env"), "REQUIRED_VAR=injected\n").unwrap();

    let out = Command::new(binary())
        .args(["exec", "--", "env"])
        .current_dir(dir.path())
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("REQUIRED_VAR=injected"),
        "stdout:\n{stdout}"
    );
}

#[test]
fn exec_fails_when_no_command_given() {
    let dir = TempDir::new().unwrap();
    write_config(&dir, MINIMAL_CONFIG);
    let out = Command::new(binary())
        .args(["exec", "--"])
        .current_dir(dir.path())
        .output()
        .unwrap();
    assert!(!out.status.success());
}

#[test]
fn source_emits_shell_exports() {
    let dir = TempDir::new().unwrap();
    write_config(&dir, MINIMAL_CONFIG);
    std::fs::write(dir.path().join(".env"), "REQUIRED_VAR=sourced\n").unwrap();
    let out = Command::new(binary())
        .arg("source")
        .current_dir(dir.path())
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("export REQUIRED_VAR="), "stdout:\n{stdout}");
}

#[test]
fn show_masks_secret_values() {
    let dir = TempDir::new().unwrap();
    write_config(
        &dir,
        r#"
[config]
version = "1"
app_prefix = "TEST"

[[var]]
name = "MY_SECRET"
description = "A secret"
required = false
default = "plaintext"
secret = true
"#,
    );
    let out = Command::new(binary())
        .arg("show")
        .current_dir(dir.path())
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("MY_SECRET = ***"), "stdout:\n{stdout}");
    assert!(
        !stdout.contains("plaintext"),
        "should not show plaintext: {stdout}"
    );
}

#[test]
fn show_displays_non_secret_values() {
    let dir = TempDir::new().unwrap();
    write_config(
        &dir,
        r#"
[config]
version = "1"
app_prefix = "TEST"

[[var]]
name = "LOG_LEVEL"
description = "Log level"
required = false
default = "info"
"#,
    );
    let out = Command::new(binary())
        .arg("show")
        .current_dir(dir.path())
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("LOG_LEVEL = info"), "stdout:\n{stdout}");
}
