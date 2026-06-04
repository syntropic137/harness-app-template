//! harness-doc-validator - doc-validator slot implementation.
//!
//! The lab engine provides Markdown cross-reference scanning. This template
//! version keeps that core and adds APSS ADR01, manifest, and principle-doc
//! checks needed by the harness.

#![forbid(unsafe_code)]

pub mod checker;
pub mod scanner;
pub mod validators;

pub use checker::{BrokenLink, CheckReport, check_links};
pub use scanner::{Link, LinkKind, extract_anchors, extract_links};
pub use validators::{
    ValidationFinding, validate_adr_directory, validate_manifest_decisions, validate_principles,
};

use anyhow::{Context, Result};
use clap::Parser;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use walkdir::WalkDir;

#[derive(Parser, Debug, Clone)]
#[command(
    name = "harness-doc-validator",
    version,
    about = "Check Markdown links, APSS ADR shape, and harness manifest cross-references."
)]
pub struct Cli {
    /// Repository root to validate.
    #[arg(default_value = ".")]
    pub root: PathBuf,

    /// Substring exclude patterns matched against full paths.
    #[arg(long, default_values_t = default_excludes())]
    pub exclude: Vec<String>,

    /// JSON output instead of human-readable output.
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ValidationReport {
    pub links: CheckReport,
    pub findings: Vec<ValidationFinding>,
}

pub fn parse_cli() -> Cli {
    Cli::parse()
}

pub fn run(cli: Cli) -> Result<ExitCode> {
    let root = cli.root.canonicalize().unwrap_or_else(|_| cli.root.clone());
    let report = validate(&root, &cli.exclude)?;

    if cli.json {
        let json =
            serde_json::to_string_pretty(&report).expect("ValidationReport always serializes");
        println!("{json}");
    } else {
        print_human_report(&report);
    }

    if report.links.broken.is_empty() && report.findings.is_empty() {
        Ok(ExitCode::SUCCESS)
    } else {
        Ok(ExitCode::from(1))
    }
}

pub fn validate(root: &Path, excludes: &[String]) -> Result<ValidationReport> {
    let mut report = ValidationReport::default();

    for entry in WalkDir::new(root)
        .into_iter()
        .filter_entry(|entry| should_descend(entry.path(), excludes))
    {
        let entry = entry.context("walk docs")?;
        if !entry.file_type().is_file() {
            continue;
        }
        if entry.path().extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }

        let content = std::fs::read_to_string(entry.path())
            .with_context(|| format!("read {}", entry.path().display()))?;
        let links = extract_links(&content);
        report.links.total_links += links.len();
        report.links.checked_links += links
            .iter()
            .filter(|link| link.kind != LinkKind::External)
            .count();
        report
            .links
            .broken
            .extend(check_links(entry.path(), &links));
    }

    report.findings.extend(validate_adr_directory(root));
    report.findings.extend(validate_manifest_decisions(root));
    report.findings.extend(validate_principles(root));

    Ok(report)
}

fn should_descend(path: &Path, excludes: &[String]) -> bool {
    let text = path.to_string_lossy();
    !excludes.iter().any(|exclude| text.contains(exclude))
}

fn print_human_report(report: &ValidationReport) {
    if report.links.broken.is_empty() && report.findings.is_empty() {
        println!(
            "✓ doc-validator: {} internal links across {} markdown links, ADRs, manifest decisions, and principle docs all validate",
            report.links.checked_links, report.links.total_links
        );
        return;
    }

    eprintln!("✗ doc-validator failed");
    if !report.links.broken.is_empty() {
        eprintln!(
            "\nBroken links: {} of {} internal links checked",
            report.links.broken.len(),
            report.links.checked_links
        );
        for broken in &report.links.broken {
            eprintln!(
                "  {}:{}: {} -> {} ({})",
                broken.source.display(),
                broken.line,
                broken.target,
                broken.resolved.display(),
                broken.reason
            );
        }
    }

    if !report.findings.is_empty() {
        eprintln!(
            "\nDocumentation contract findings: {}",
            report.findings.len()
        );
        for finding in &report.findings {
            eprintln!("  {}: {}", finding.path.display(), finding.message);
        }
    }
}

fn default_excludes() -> Vec<String> {
    vec![
        "/.git/".to_string(),
        "/.beads/".to_string(),
        "/.ntm/".to_string(),
        "/node_modules/".to_string(),
        "/target/".to_string(),
        "harness/doc-validator/target".to_string(),
        "ws_apps/docs/out".to_string(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_valid_adr_tree(root: &Path) {
        let adr_dir = root.join("docs/adrs");
        fs::create_dir_all(&adr_dir).unwrap();
        fs::write(
            adr_dir.join("README.md"),
            "## Index\n\n| Document | Description |\n|---|---|\n",
        )
        .unwrap();
        fs::write(adr_dir.join("CLAUDE.md"), "Use ADR-0001-demo backlinks.").unwrap();
        fs::write(adr_dir.join("AGENTS.md"), "Use ADR-0001-demo backlinks.").unwrap();
        fs::write(
            adr_dir.join("ADR-0001-demo.md"),
            "---\nname: Demo\ndescription: Demo\nstatus: accepted\n---\n\n# ADR-0001: Demo\n\n**Date:** 2026-05-30\n**Category:** Test\n\n## Context\n\n## Decision\n\n## Consequences\n",
        )
        .unwrap();
    }

    fn write_valid_manifest(root: &Path) {
        fs::write(
            root.join("harness.manifest.json"),
            r#"{"slots":{"demo":{"decisionAt":"docs/adrs/ADR-0001-demo.md"}}}"#,
        )
        .unwrap();
    }

    fn write_valid_principles(root: &Path) {
        let dir = root.join("docs/harness-engineering");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("README.md"),
            "## Scope\n\n## Actionable\n\n[principles](./lab-five-principles.md)\n\n## References\n",
        )
        .unwrap();
        fs::write(dir.join("lab-five-principles.md"), "# Principles").unwrap();
    }

    #[test]
    fn validates_clean_fixture() {
        let tmp = tempfile::tempdir().unwrap();
        write_valid_adr_tree(tmp.path());
        write_valid_manifest(tmp.path());
        write_valid_principles(tmp.path());

        let report = validate(tmp.path(), &default_excludes()).unwrap();

        assert!(report.links.broken.is_empty());
        assert!(report.findings.is_empty());
    }

    #[test]
    fn detects_missing_manifest_decision() {
        let tmp = tempfile::tempdir().unwrap();
        write_valid_adr_tree(tmp.path());
        write_valid_principles(tmp.path());
        fs::write(
            tmp.path().join("harness.manifest.json"),
            r#"{"slots":{"demo":{"decisionAt":"docs/adrs/ADR-9999-missing.md"}}}"#,
        )
        .unwrap();

        let report = validate(tmp.path(), &default_excludes()).unwrap();

        assert_eq!(report.findings.len(), 1);
        assert!(report.findings[0].message.contains("decisionAt"));
    }

    #[test]
    fn run_returns_failure_on_broken_anchor() {
        let tmp = tempfile::tempdir().unwrap();
        write_valid_adr_tree(tmp.path());
        write_valid_manifest(tmp.path());
        write_valid_principles(tmp.path());
        fs::write(
            tmp.path().join("a.md"),
            "[bad](docs/adrs/ADR-0001-demo.md#missing)",
        )
        .unwrap();

        let cli = Cli {
            root: tmp.path().to_path_buf(),
            exclude: default_excludes(),
            json: true,
        };

        assert_eq!(run(cli).unwrap(), ExitCode::from(1));
    }

    #[test]
    fn run_returns_success_and_prints_human_report() {
        let tmp = tempfile::tempdir().unwrap();
        write_valid_adr_tree(tmp.path());
        write_valid_manifest(tmp.path());
        write_valid_principles(tmp.path());

        let cli = Cli {
            root: tmp.path().to_path_buf(),
            exclude: default_excludes(),
            json: false,
        };

        assert_eq!(run(cli).unwrap(), ExitCode::SUCCESS);
    }

    #[test]
    fn run_human_report_lists_broken_links_without_findings() {
        let tmp = tempfile::tempdir().unwrap();
        write_valid_adr_tree(tmp.path());
        write_valid_manifest(tmp.path());
        write_valid_principles(tmp.path());
        fs::write(
            tmp.path().join("a.md"),
            "[bad](docs/adrs/ADR-0001-demo.md#missing)",
        )
        .unwrap();

        let cli = Cli {
            root: tmp.path().to_path_buf(),
            exclude: default_excludes(),
            json: false,
        };

        assert_eq!(run(cli).unwrap(), ExitCode::from(1));
    }

    #[test]
    fn run_human_report_lists_findings_without_broken_links() {
        let tmp = tempfile::tempdir().unwrap();
        write_valid_adr_tree(tmp.path());
        write_valid_principles(tmp.path());

        let cli = Cli {
            root: tmp.path().to_path_buf(),
            exclude: default_excludes(),
            json: false,
        };

        assert_eq!(run(cli).unwrap(), ExitCode::from(1));
    }

    #[test]
    fn run_returns_error_when_root_cannot_be_walked() {
        let tmp = tempfile::tempdir().unwrap();
        let cli = Cli {
            root: tmp.path().join("missing-root"),
            exclude: default_excludes(),
            json: false,
        };

        let error = run(cli).unwrap_err();

        assert!(error.to_string().contains("walk docs"));
    }

    #[test]
    fn validate_respects_exclude_patterns() {
        let tmp = tempfile::tempdir().unwrap();
        write_valid_adr_tree(tmp.path());
        write_valid_manifest(tmp.path());
        write_valid_principles(tmp.path());
        let skipped = tmp.path().join("skip-me");
        fs::create_dir(&skipped).unwrap();
        fs::write(skipped.join("broken.md"), "[bad](./missing.md)").unwrap();

        let report = validate(tmp.path(), &["skip-me".to_string()]).unwrap();

        assert!(report.links.broken.is_empty());
        assert!(report.findings.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn validate_reports_read_errors_with_path_context() {
        use std::os::unix::fs::PermissionsExt;

        let tmp = tempfile::tempdir().unwrap();
        let locked = tmp.path().join("locked.md");
        fs::write(&locked, "[link](./target.md)").unwrap();
        let mut permissions = fs::metadata(&locked).unwrap().permissions();
        permissions.set_mode(0o000);
        fs::set_permissions(&locked, permissions).unwrap();

        let error = validate(tmp.path(), &[]).unwrap_err();

        let mut restored = fs::metadata(&locked).unwrap().permissions();
        restored.set_mode(0o600);
        fs::set_permissions(&locked, restored).unwrap();
        assert!(error.to_string().contains("read"));
    }
}
