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
