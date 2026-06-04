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

use anyhow::{Result, anyhow};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use walkdir::WalkDir;

#[derive(Debug, Clone)]
pub struct Cli {
    pub root: PathBuf,
    pub exclude: Vec<String>,
    pub json: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ValidationReport {
    pub links: CheckReport,
    pub findings: Vec<ValidationFinding>,
}

pub fn run(cli: Cli) -> Result<ExitCode> {
    let root = match cli.root.canonicalize() {
        Ok(root) => root,
        Err(_) => cli.root.clone(),
    };
    let report = validate(&root, &cli.exclude)?;

    if cli.json {
        let json = serde_json::to_string_pretty(&report)
            .expect("ValidationReport serialization cannot fail");
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

    for entry in WalkDir::new(root) {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => return Err(anyhow!("walk docs: {error}")),
        };
        if !should_descend(entry.path(), excludes) {
            continue;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        if entry.path().extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }

        let content = match std::fs::read_to_string(entry.path()) {
            Ok(content) => content,
            Err(error) => return Err(anyhow!("read {}: {error}", entry.path().display())),
        };
        let links = extract_links(&content);
        report.links.total_links += links.len();
        for link in &links {
            if link.kind != LinkKind::External {
                report.links.checked_links += 1;
            }
        }
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
        println!("{}", human_success_line(report));
        return;
    }

    for line in human_failure_lines(report) {
        eprintln!("{line}");
    }
}

fn human_success_line(report: &ValidationReport) -> String {
    format!(
        "✓ doc-validator: {} internal links across {} markdown links, ADRs, manifest decisions, and principle docs all validate",
        report.links.checked_links, report.links.total_links
    )
}

fn human_failure_lines(report: &ValidationReport) -> Vec<String> {
    let mut lines = vec!["✗ doc-validator failed".to_string()];
    if !report.links.broken.is_empty() {
        lines.push(String::new());
        lines.push(format!(
            "Broken links: {} of {} internal links checked",
            report.links.broken.len(),
            report.links.checked_links
        ));
        for broken in &report.links.broken {
            lines.push(format!(
                "  {}:{}: {} -> {} ({})",
                broken.source.display(),
                broken.line,
                broken.target,
                broken.resolved.display(),
                broken.reason
            ));
        }
    }
    if report.findings.is_empty() {
        return lines;
    }
    lines.push(String::new());
    lines.push(format!(
        "Documentation contract findings: {}",
        report.findings.len()
    ));
    for finding in &report.findings {
        lines.push(format!("  {}: {}", finding.path.display(), finding.message));
    }
    lines
}

pub fn default_excludes() -> Vec<String> {
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
    fn run_returns_success_and_prints_human_report_for_clean_tree() {
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
    fn run_human_report_includes_links_and_contract_findings() {
        let tmp = tempfile::tempdir().unwrap();
        write_valid_adr_tree(tmp.path());
        fs::write(tmp.path().join("a.md"), "[bad](./missing.md)").unwrap();

        let cli = Cli {
            root: tmp.path().to_path_buf(),
            exclude: default_excludes(),
            json: false,
        };

        assert_eq!(run(cli).unwrap(), ExitCode::from(1));
    }

    #[test]
    fn validate_skips_excluded_paths_and_non_markdown_files() {
        let tmp = tempfile::tempdir().unwrap();
        write_valid_adr_tree(tmp.path());
        write_valid_manifest(tmp.path());
        write_valid_principles(tmp.path());
        let ignored = tmp.path().join("ignored");
        fs::create_dir_all(&ignored).unwrap();
        fs::write(ignored.join("bad.md"), "[bad](./missing.md)").unwrap();
        fs::write(tmp.path().join("notes.txt"), "[bad](./missing.md)").unwrap();

        let report = validate(tmp.path(), &[ignored.to_string_lossy().to_string()]).unwrap();

        assert!(report.links.broken.is_empty());
        assert_eq!(report.links.total_links, 1);
    }

    #[test]
    fn should_descend_uses_substring_excludes() {
        assert!(!should_descend(
            Path::new("/repo/node_modules/pkg"),
            &["/node_modules/".to_string()]
        ));
        assert!(should_descend(
            Path::new("/repo/docs/readme.md"),
            &["/node_modules/".to_string()]
        ));
    }

    #[test]
    fn run_returns_error_when_root_cannot_be_walked() {
        let tmp = tempfile::tempdir().unwrap();
        let cli = Cli {
            root: tmp.path().join("missing"),
            exclude: Vec::new(),
            json: false,
        };

        assert!(run(cli).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn validate_returns_error_for_unreadable_markdown_entry() {
        use std::os::unix::fs::PermissionsExt;

        let tmp = tempfile::tempdir().unwrap();
        let bad = tmp.path().join("bad.md");
        fs::write(&bad, "[bad](./missing.md)").unwrap();
        let original = fs::metadata(&bad).unwrap().permissions();
        let mut locked = original.clone();
        locked.set_mode(0o0);
        fs::set_permissions(&bad, locked).unwrap();

        let err = validate(tmp.path(), &[]).unwrap_err();

        fs::set_permissions(&bad, original).unwrap();
        assert!(err.to_string().contains("read"));
    }

    #[test]
    fn human_report_helpers_render_success_and_failure_lines() {
        let success = ValidationReport {
            links: CheckReport {
                broken: Vec::new(),
                total_links: 2,
                checked_links: 1,
            },
            findings: Vec::new(),
        };
        assert!(human_success_line(&success).contains("1 internal links"));

        let failure = ValidationReport {
            links: CheckReport {
                broken: vec![BrokenLink {
                    source: PathBuf::from("docs/a.md"),
                    line: 3,
                    target: "./missing.md".to_string(),
                    reason: "target file not found".to_string(),
                    resolved: PathBuf::from("docs/missing.md"),
                }],
                total_links: 1,
                checked_links: 1,
            },
            findings: vec![ValidationFinding {
                path: PathBuf::from("docs/adrs/README.md"),
                message: "bad index".to_string(),
            }],
        };
        let lines = human_failure_lines(&failure);
        assert!(lines.iter().any(|line| line.contains("Broken links")));
        assert!(lines.iter().any(|line| line.contains("bad index")));

        let broken_only = ValidationReport {
            findings: Vec::new(),
            ..failure
        };
        let lines = human_failure_lines(&broken_only);
        assert!(
            !lines
                .iter()
                .any(|line| line.contains("Documentation contract findings"))
        );

        let findings_only = ValidationReport {
            links: CheckReport::default(),
            findings: vec![ValidationFinding {
                path: PathBuf::from("docs/adrs/README.md"),
                message: "bad index".to_string(),
            }],
        };
        let lines = human_failure_lines(&findings_only);
        assert!(lines.iter().any(|line| line.contains("bad index")));
    }
}
