use std::process::Command;

fn binary_path() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_BIN_EXE_harness-versioning"))
}

#[test]
fn check_succeeds_on_whole_repo_with_version_in_changelog() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(
        tmp.path().join("Cargo.toml"),
        "[package]\nname = \"x\"\nversion = \"0.1.0\"\n",
    )
    .unwrap();
    std::fs::write(tmp.path().join("CHANGELOG.md"), "## [0.1.0] - 2026-05-16\n").unwrap();
    let out = Command::new(binary_path())
        .args([
            "check",
            "--mode",
            "whole-repo",
            tmp.path().to_str().unwrap(),
        ])
        .output()
        .expect("spawn");
    assert!(
        out.status.success(),
        "stdout={} stderr={}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
fn check_fails_when_version_missing_from_changelog() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(
        tmp.path().join("Cargo.toml"),
        "[package]\nname = \"x\"\nversion = \"0.9.9\"\n",
    )
    .unwrap();
    std::fs::write(tmp.path().join("CHANGELOG.md"), "## [0.1.0]\n").unwrap();
    let out = Command::new(binary_path())
        .args([
            "check",
            "--mode",
            "whole-repo",
            tmp.path().to_str().unwrap(),
        ])
        .output()
        .expect("spawn");
    assert_eq!(out.status.code(), Some(1));
}

#[test]
fn check_per_package_mode_warns_but_succeeds() {
    let tmp = tempfile::tempdir().unwrap();
    let out = Command::new(binary_path())
        .args([
            "check",
            "--mode",
            "per-package",
            tmp.path().to_str().unwrap(),
        ])
        .output()
        .expect("spawn");
    assert!(
        out.status.success(),
        "stdout={} stderr={}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(String::from_utf8_lossy(&out.stderr).contains("per-package mode not implemented yet"));
}
