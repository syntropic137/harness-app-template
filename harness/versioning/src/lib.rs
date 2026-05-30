//! harness-versioning — wraps cocogitto with per-package detection.
//! Implements ADR-0011-versioning.

#![forbid(unsafe_code)]

use anyhow::Result;
use clap::{Parser, Subcommand, ValueEnum};
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Parser, Debug)]
#[command(
    name = "harness-versioning",
    version,
    about = "Versioning slot orchestrator."
)]
pub struct Cli {
    #[command(subcommand)]
    pub cmd: Cmd,
}

#[derive(Subcommand, Debug)]
pub enum Cmd {
    /// Validate that the current version → CHANGELOG.md mapping is coherent.
    Check {
        /// Project root.
        #[arg(default_value = ".")]
        root: PathBuf,
        /// Mode: whole-repo (one CHANGELOG.md at root) or per-package.
        #[arg(long, value_enum, default_value_t = Mode::WholeRepo)]
        mode: Mode,
    },
}

#[derive(ValueEnum, Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    WholeRepo,
    PerPackage,
}

pub fn run(cli: Cli) -> Result<ExitCode> {
    match cli.cmd {
        Cmd::Check { root, mode } => check_versioning(root, mode),
    }
}

fn check_versioning(root: PathBuf, mode: Mode) -> Result<ExitCode> {
    let root = root.canonicalize().unwrap_or(root);
    match mode {
        Mode::WholeRepo => check_whole_repo(&root),
        Mode::PerPackage => check_per_package(&root),
    }
}

fn check_whole_repo(root: &std::path::Path) -> Result<ExitCode> {
    let changelog = root.join("CHANGELOG.md");
    if !changelog.is_file() {
        eprintln!("error: CHANGELOG.md missing at {}", changelog.display());
        return Ok(ExitCode::from(1));
    }

    let version = detect_version_whole_repo(root)?;
    let content = std::fs::read_to_string(&changelog)?;

    if !content.contains(&format!("[{}]", version)) && !content.contains(&format!("## {}", version))
    {
        eprintln!(
            "error: version {} has no entry in {}",
            version,
            changelog.display()
        );
        return Ok(ExitCode::from(1));
    }
    println!("✓ versioning: {} has CHANGELOG.md entry", version);
    Ok(ExitCode::SUCCESS)
}

fn check_per_package(_root: &std::path::Path) -> Result<ExitCode> {
    // TODO Phase A.6.4 — walk workspace members, validate each
    eprintln!("warn: per-package mode not implemented yet (use --mode whole-repo)");
    Ok(ExitCode::SUCCESS)
}

fn detect_version_whole_repo(root: &std::path::Path) -> Result<String> {
    // Try Cargo.toml [workspace.package].version first
    let cargo_toml = root.join("Cargo.toml");
    if cargo_toml.is_file() {
        let content = std::fs::read_to_string(&cargo_toml)?;
        let parsed: toml::Value = toml::from_str(&content)?;
        if let Some(v) = parsed
            .get("workspace")
            .and_then(|w| w.get("package"))
            .and_then(|p| p.get("version"))
            .and_then(|v| v.as_str())
        {
            return Ok(v.to_string());
        }
        if let Some(v) = parsed
            .get("package")
            .and_then(|p| p.get("version"))
            .and_then(|v| v.as_str())
        {
            return Ok(v.to_string());
        }
    }

    // Try package.json
    let package_json = root.join("package.json");
    if package_json.is_file() {
        let content = std::fs::read_to_string(&package_json)?;
        let parsed: serde_json::Value = serde_json::from_str(&content)?;
        if let Some(v) = parsed.get("version").and_then(|v| v.as_str()) {
            return Ok(v.to_string());
        }
    }

    // Try pyproject.toml
    let pyproject = root.join("pyproject.toml");
    if pyproject.is_file() {
        let content = std::fs::read_to_string(&pyproject)?;
        let parsed: toml::Value = toml::from_str(&content)?;
        if let Some(v) = parsed
            .get("project")
            .and_then(|p| p.get("version"))
            .and_then(|v| v.as_str())
        {
            return Ok(v.to_string());
        }
    }

    anyhow::bail!(
        "no version found in {}/Cargo.toml, package.json, or pyproject.toml",
        root.display()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_workspace_package_version_from_cargo_toml() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("Cargo.toml"),
            "[workspace.package]\nversion = \"1.2.3\"\n",
        )
        .unwrap();
        assert_eq!(detect_version_whole_repo(tmp.path()).unwrap(), "1.2.3");
    }

    #[test]
    fn detects_package_version_from_cargo_toml_fallback() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("Cargo.toml"),
            "[package]\nname = \"foo\"\nversion = \"0.4.2\"\n",
        )
        .unwrap();
        assert_eq!(detect_version_whole_repo(tmp.path()).unwrap(), "0.4.2");
    }

    #[test]
    fn detects_package_json_version() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("package.json"), r#"{"version": "2.0.0"}"#).unwrap();
        assert_eq!(detect_version_whole_repo(tmp.path()).unwrap(), "2.0.0");
    }

    #[test]
    fn detects_pyproject_version() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("pyproject.toml"),
            "[project]\nname = \"foo\"\nversion = \"3.1.4\"\n",
        )
        .unwrap();
        assert_eq!(detect_version_whole_repo(tmp.path()).unwrap(), "3.1.4");
    }

    #[test]
    fn check_whole_repo_succeeds_when_version_in_changelog() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("Cargo.toml"),
            "[package]\nname = \"x\"\nversion = \"0.1.0\"\n",
        )
        .unwrap();
        std::fs::write(
            tmp.path().join("CHANGELOG.md"),
            "# Changelog\n\n## [0.1.0] - 2026-05-16\n",
        )
        .unwrap();
        let result = check_whole_repo(tmp.path()).unwrap();
        assert_eq!(result, ExitCode::SUCCESS);
    }

    #[test]
    fn check_whole_repo_fails_when_version_missing_from_changelog() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("Cargo.toml"),
            "[package]\nname = \"x\"\nversion = \"0.2.0\"\n",
        )
        .unwrap();
        std::fs::write(
            tmp.path().join("CHANGELOG.md"),
            "# Changelog\n\n## [0.1.0] - 2026-05-16\n",
        )
        .unwrap();
        let result = check_whole_repo(tmp.path()).unwrap();
        // ExitCode doesn't impl PartialEq with literals; use the inner u8 via process::ExitCode debug
        assert_eq!(format!("{:?}", result), format!("{:?}", ExitCode::from(1)));
    }

    #[test]
    fn check_whole_repo_fails_when_changelog_missing() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("Cargo.toml"),
            "[package]\nname = \"x\"\nversion = \"0.1.0\"\n",
        )
        .unwrap();
        // No CHANGELOG.md written
        let result = check_whole_repo(tmp.path()).unwrap();
        assert_eq!(format!("{:?}", result), format!("{:?}", ExitCode::from(1)));
    }

    #[test]
    fn check_per_package_returns_success_with_warning() {
        let tmp = tempfile::tempdir().unwrap();
        let result = check_per_package(tmp.path()).unwrap();
        assert_eq!(result, ExitCode::SUCCESS);
    }

    #[test]
    fn check_versioning_dispatches_whole_repo() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("Cargo.toml"),
            "[package]\nname = \"x\"\nversion = \"0.1.0\"\n",
        )
        .unwrap();
        std::fs::write(tmp.path().join("CHANGELOG.md"), "## [0.1.0]\n").unwrap();
        let result = check_versioning(tmp.path().to_path_buf(), Mode::WholeRepo).unwrap();
        assert_eq!(result, ExitCode::SUCCESS);
    }

    #[test]
    fn check_versioning_dispatches_per_package() {
        let tmp = tempfile::tempdir().unwrap();
        let result = check_versioning(tmp.path().to_path_buf(), Mode::PerPackage).unwrap();
        assert_eq!(result, ExitCode::SUCCESS);
    }

    #[test]
    fn run_dispatches_check_cmd() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("Cargo.toml"),
            "[package]\nname = \"x\"\nversion = \"0.1.0\"\n",
        )
        .unwrap();
        std::fs::write(tmp.path().join("CHANGELOG.md"), "## [0.1.0]\n").unwrap();
        let cli = Cli {
            cmd: Cmd::Check {
                root: tmp.path().to_path_buf(),
                mode: Mode::WholeRepo,
            },
        };
        let result = run(cli).unwrap();
        assert_eq!(result, ExitCode::SUCCESS);
    }

    #[test]
    fn detect_version_package_json_no_version_field_falls_through() {
        let tmp = tempfile::tempdir().unwrap();
        // package.json exists but has no "version" key; should fall through to bail
        std::fs::write(tmp.path().join("package.json"), r#"{"name": "foo"}"#).unwrap();
        let err = detect_version_whole_repo(tmp.path()).unwrap_err();
        assert!(err.to_string().contains("no version found"));
    }

    #[test]
    fn detect_version_pyproject_no_project_version_falls_through() {
        let tmp = tempfile::tempdir().unwrap();
        // pyproject.toml exists but has no [project].version
        std::fs::write(
            tmp.path().join("pyproject.toml"),
            "[tool.something]\nfoo = \"bar\"\n",
        )
        .unwrap();
        let err = detect_version_whole_repo(tmp.path()).unwrap_err();
        assert!(err.to_string().contains("no version found"));
    }

    #[test]
    fn detect_version_cargo_toml_no_version_falls_through_to_package_json() {
        let tmp = tempfile::tempdir().unwrap();
        // Cargo.toml with no version at all, package.json has version
        std::fs::write(
            tmp.path().join("Cargo.toml"),
            "[workspace]\nresolver = \"2\"\n",
        )
        .unwrap();
        std::fs::write(tmp.path().join("package.json"), r#"{"version": "5.0.0"}"#).unwrap();
        assert_eq!(detect_version_whole_repo(tmp.path()).unwrap(), "5.0.0");
    }

    #[test]
    fn detect_version_no_manifests_bails() {
        let tmp = tempfile::tempdir().unwrap();
        // Empty directory — nothing to detect
        let err = detect_version_whole_repo(tmp.path()).unwrap_err();
        assert!(err.to_string().contains("no version found"));
    }
}
