use std::ffi::OsStr;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::Command;

const BINARY_PATH: &str = env!("CARGO_BIN_EXE_harness-versioning");
const LOCAL_GIT_ENV: &[&str] = &[
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_COMMON_DIR",
    "GIT_DIR",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_WORK_TREE",
];

fn harness_command() -> Command {
    let mut command = Command::new("/usr/bin/env");
    command.arg(BINARY_PATH);
    command
}

fn git<const N: usize, S>(root: &Path, args: [S; N])
where
    S: AsRef<OsStr>,
{
    let out = git_command(root).args(args).output().expect("spawn git");
    assert!(
        out.status.success(),
        "stdout={} stderr={}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
}

fn git_output<const N: usize, S>(root: &Path, args: [S; N]) -> String
where
    S: AsRef<OsStr>,
{
    let out = git_command(root).args(args).output().expect("spawn git");
    assert!(
        out.status.success(),
        "stdout={} stderr={}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap().trim().to_string()
}

fn git_command(root: &Path) -> Command {
    let mut command = Command::new("git");
    command.current_dir(root);
    for key in LOCAL_GIT_ENV {
        command.env_remove(key);
    }
    // Mirror harness_versioning::git_command: silence any host-installed
    // hooks (e.g. apss's managed global pre-commit) so temp git repos
    // can commit without inheriting unrelated host validation.
    command.args(["-c", "core.hooksPath=/dev/null"]);
    command
}

fn seed_repo(subject: &str) -> tempfile::TempDir {
    let tmp = tempfile::tempdir().unwrap();
    git(tmp.path(), ["init"]);
    git(tmp.path(), ["config", "user.email", "test@example.com"]);
    git(tmp.path(), ["config", "user.name", "Harness Test"]);
    std::fs::write(
        tmp.path().join("CHANGELOG.md"),
        "# Changelog\n\n## [Unreleased]\n\n- (Add your first changelog entry here.)\n",
    )
    .unwrap();
    std::fs::write(
        tmp.path().join("harness.manifest.json"),
        "{\n  \"name\": \"test-harness\",\n  \"version\": \"0.0.0\",\n  \"slots\": {}\n}\n",
    )
    .unwrap();
    git(tmp.path(), ["add", "CHANGELOG.md", "harness.manifest.json"]);
    git(tmp.path(), ["commit", "-m", subject]);
    tmp
}

#[test]
fn check_succeeds_for_conventional_history() {
    let tmp = seed_repo("feat: seed release discipline");
    let out = harness_command()
        .args(["check", tmp.path().to_str().unwrap()])
        .output()
        .expect("spawn");
    assert!(
        out.status.success(),
        "stdout={} stderr={}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(String::from_utf8_lossy(&out.stdout).contains("conventional commits"));
}

#[test]
fn check_fails_for_non_conventional_history() {
    let tmp = seed_repo("update release discipline");
    let out = harness_command()
        .args(["ci-check", tmp.path().to_str().unwrap()])
        .output()
        .expect("spawn");
    assert_eq!(out.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&out.stderr).contains("non-conventional commits"));
}

#[test]
fn explicit_empty_range_fails() {
    let tmp = seed_repo("fix: seed release discipline");
    let head = git_output(tmp.path(), ["rev-parse", "HEAD"]);
    let out = harness_command()
        .args([
            "ci-check",
            "--from",
            &head,
            "--to",
            &head,
            tmp.path().to_str().unwrap(),
        ])
        .output()
        .expect("spawn");
    assert_eq!(out.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&out.stderr).contains("no changelog eligible commits"));
}

#[test]
fn release_dry_run_prints_next_version_without_tagging() {
    let tmp = seed_repo("fix: repair release discipline");
    let out = harness_command()
        .args(["release", tmp.path().to_str().unwrap()])
        .output()
        .expect("spawn");
    assert!(
        out.status.success(),
        "stdout={} stderr={}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("0.0.0 -> v0.0.1"));
    assert!(stdout.contains("dry run complete"));
}

#[test]
fn release_execute_updates_changelog_commits_and_tags() {
    let tmp = seed_repo("feat: add releaser");
    let out = harness_command()
        .args(["release", "--execute", tmp.path().to_str().unwrap()])
        .env("HARNESS_RELEASE_DATE", "2026-06-02")
        .output()
        .expect("spawn");
    assert!(
        out.status.success(),
        "stdout={} stderr={}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let changelog = std::fs::read_to_string(tmp.path().join("CHANGELOG.md")).unwrap();
    assert!(changelog.contains("## [0.1.0] - 2026-06-02"));
    assert!(changelog.contains("- add releaser"));
    let manifest = std::fs::read_to_string(tmp.path().join("harness.manifest.json")).unwrap();
    assert!(manifest.contains("\"version\": \"0.1.0\""));
    let tags = git_command(tmp.path())
        .args(["tag", "--list", "v0.1.0"])
        .output()
        .expect("git tag");
    assert_eq!(String::from_utf8_lossy(&tags.stdout).trim(), "v0.1.0");
}

#[cfg(unix)]
#[test]
fn release_execute_reports_date_failure() {
    let tmp = seed_repo("feat: add releaser");
    let bin_dir = tempfile::tempdir().unwrap();
    let date_path = bin_dir.path().join("date");
    std::fs::write(&date_path, "#!/bin/sh\nexit 1\n").unwrap();
    let mut permissions = std::fs::metadata(&date_path).unwrap().permissions();
    permissions.set_mode(0o755);
    std::fs::set_permissions(&date_path, permissions).unwrap();
    let path = format!("{}:/usr/bin:/bin", bin_dir.path().display());

    let out = harness_command()
        .args(["release", "--execute", tmp.path().to_str().unwrap()])
        .env_remove("HARNESS_RELEASE_DATE")
        .env("PATH", path)
        .output()
        .expect("spawn");

    assert_eq!(out.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&out.stderr).contains("date +%F failed"));
}

#[test]
fn check_pr_title_accepts_conventional_subject() {
    let out = harness_command()
        .args(["check-pr-title", "feat(versioning): add pr-title gate"])
        .output()
        .expect("spawn");
    assert!(
        out.status.success(),
        "stdout={} stderr={}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(String::from_utf8_lossy(&out.stdout).contains("PR title is conventional"));
}

#[test]
fn check_pr_title_rejects_non_conventional_subject() {
    let out = harness_command()
        .args([
            "check-pr-title",
            "fork-readiness E2E + fixes for fresh-consumer gaps",
        ])
        .output()
        .expect("spawn");
    assert_eq!(out.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&out.stderr).contains("not a Conventional Commit"));
}

#[test]
fn check_pr_title_reads_from_stdin_when_dash() {
    use std::io::Write;
    use std::process::Stdio;
    let mut child = harness_command()
        .args(["check-pr-title", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn");
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(b"feat: from stdin\n")
        .unwrap();
    let out = child.wait_with_output().expect("wait");
    assert!(
        out.status.success(),
        "stdout={} stderr={}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
fn check_per_package_mode_warns_but_succeeds() {
    let tmp = tempfile::tempdir().unwrap();
    let out = harness_command()
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
    assert!(String::from_utf8_lossy(&out.stderr).contains("per-package mode"));
}
