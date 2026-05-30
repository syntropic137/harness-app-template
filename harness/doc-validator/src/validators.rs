//! Template-specific document contract checks.

use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct ValidationFinding {
    pub path: PathBuf,
    pub message: String,
}

pub fn validate_adr_directory(root: &Path) -> Vec<ValidationFinding> {
    let mut findings = Vec::new();
    let adr_dir = root.join("docs/adrs");

    if !adr_dir.is_dir() {
        findings.push(finding(
            &adr_dir,
            "APSS ADR01 directory docs/adrs is missing",
        ));
        return findings;
    }

    for filename in ["README.md", "CLAUDE.md", "AGENTS.md"] {
        let path = adr_dir.join(filename);
        if !path.is_file() {
            findings.push(finding(&path, "required ADR context/index file is missing"));
            continue;
        }
        if filename != "README.md" {
            let text = std::fs::read_to_string(&path).unwrap_or_default();
            if !text.contains("ADR-") || !text.contains("backlink") {
                findings.push(finding(
                    &path,
                    "ADR context file must describe ADR backlink/reference guidance",
                ));
            }
        }
    }

    validate_adr_index(&adr_dir.join("README.md"), &mut findings);

    let Ok(entries) = std::fs::read_dir(&adr_dir) else {
        return findings;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        let Some(filename) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if ["README.md", "CLAUDE.md", "AGENTS.md"].contains(&filename) {
            continue;
        }
        if !valid_adr_filename(filename) {
            findings.push(finding(
                &path,
                "ADR filename must match ADR-NNNN-kebab-case-title.md",
            ));
        }
        validate_adr_file(&path, &mut findings);
    }

    findings
}

pub fn validate_manifest_decisions(root: &Path) -> Vec<ValidationFinding> {
    let manifest_path = root.join("harness.manifest.json");
    let mut findings = Vec::new();
    let Ok(text) = std::fs::read_to_string(&manifest_path) else {
        findings.push(finding(&manifest_path, "harness manifest is missing"));
        return findings;
    };
    let Ok(json) = serde_json::from_str::<Value>(&text) else {
        findings.push(finding(
            &manifest_path,
            "harness manifest is not valid JSON",
        ));
        return findings;
    };
    let Some(slots) = json.get("slots").and_then(Value::as_object) else {
        findings.push(finding(
            &manifest_path,
            "harness manifest has no slots object",
        ));
        return findings;
    };

    for (slot, config) in slots {
        let Some(decision_at) = config.get("decisionAt").and_then(Value::as_str) else {
            findings.push(finding(
                &manifest_path,
                &format!("slot {slot} is missing decisionAt"),
            ));
            continue;
        };
        let path = root.join(decision_at);
        if !path.is_file() {
            findings.push(finding(
                &path,
                &format!("slot {slot} decisionAt target does not exist"),
            ));
        }
    }

    findings
}

pub fn validate_principles(root: &Path) -> Vec<ValidationFinding> {
    let mut findings = Vec::new();
    let readme = root.join("docs/harness-engineering/README.md");
    let principles = root.join("docs/harness-engineering/lab-five-principles.md");

    if !readme.is_file() {
        findings.push(finding(&readme, "harness-engineering README is missing"));
        return findings;
    }
    if !principles.is_file() {
        findings.push(finding(
            &principles,
            "lab five-principles document is missing",
        ));
    }

    let text = std::fs::read_to_string(&readme).unwrap_or_default();
    for heading in ["Scope", "Actionable", "References"] {
        if !text.contains(&format!("## {heading}")) {
            findings.push(finding(
                &readme,
                &format!("harness-engineering README missing ## {heading}"),
            ));
        }
    }

    findings
}

fn validate_adr_index(path: &Path, findings: &mut Vec<ValidationFinding>) {
    let Ok(text) = std::fs::read_to_string(path) else {
        return;
    };
    if !text.contains("## Index") || !text.contains("| Document | Description |") {
        findings.push(finding(
            path,
            "ADR README must contain APSS Document | Description index",
        ));
    }
}

fn validate_adr_file(path: &Path, findings: &mut Vec<ValidationFinding>) {
    let Ok(text) = std::fs::read_to_string(path) else {
        findings.push(finding(path, "ADR file is not readable"));
        return;
    };

    let Some(frontmatter) = frontmatter(&text) else {
        findings.push(finding(path, "ADR missing YAML front matter"));
        return;
    };

    for field in ["name:", "description:", "status:"] {
        if !frontmatter
            .lines()
            .any(|line| line.trim_start().starts_with(field))
        {
            findings.push(finding(path, &format!("ADR front matter missing {field}")));
        }
    }

    let status = frontmatter
        .lines()
        .find_map(|line| line.trim_start().strip_prefix("status:"))
        .map(str::trim);
    if let Some(status) = status {
        let valid_statuses = BTreeSet::from(["proposed", "accepted", "deprecated", "superseded"]);
        if !valid_statuses.contains(status) {
            findings.push(finding(path, &format!("ADR status {status} is not valid")));
        }
    }

    for marker in [
        "**Date:**",
        "**Category:**",
        "## Context",
        "## Decision",
        "## Consequences",
    ] {
        if !text.contains(marker) {
            findings.push(finding(path, &format!("ADR missing {marker}")));
        }
    }
}

fn frontmatter(text: &str) -> Option<&str> {
    let rest = text.strip_prefix("---\n")?;
    let end = rest.find("\n---\n")?;
    Some(&rest[..end])
}

fn valid_adr_filename(filename: &str) -> bool {
    let Some(stem) = filename.strip_suffix(".md") else {
        return false;
    };
    let Some(rest) = stem.strip_prefix("ADR-") else {
        return false;
    };
    let Some((digits, title)) = rest.split_once('-') else {
        return false;
    };
    (3..=5).contains(&digits.len())
        && digits.chars().all(|ch| ch.is_ascii_digit())
        && !title.is_empty()
        && title
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
}

fn finding(path: &Path, message: &str) -> ValidationFinding {
    ValidationFinding {
        path: path.to_path_buf(),
        message: message.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn validates_adr_shape_and_manifest_targets() {
        let tmp = tempfile::tempdir().unwrap();
        let adr_dir = tmp.path().join("docs/adrs");
        fs::create_dir_all(&adr_dir).unwrap();
        fs::write(
            adr_dir.join("README.md"),
            "## Index\n\n| Document | Description |\n|---|---|\n",
        )
        .unwrap();
        fs::write(
            adr_dir.join("CLAUDE.md"),
            "Add backlink comments like ADR-0001-demo.",
        )
        .unwrap();
        fs::write(
            adr_dir.join("AGENTS.md"),
            "Add backlink comments like ADR-0001-demo.",
        )
        .unwrap();
        fs::write(
            adr_dir.join("ADR-0001-demo.md"),
            "---\nname: Demo\ndescription: Demo\nstatus: accepted\n---\n\n# ADR-0001: Demo\n\n**Date:** 2026-05-30\n**Category:** Test\n\n## Context\n\n## Decision\n\n## Consequences\n",
        )
        .unwrap();
        fs::write(
            tmp.path().join("harness.manifest.json"),
            r#"{"slots":{"demo":{"decisionAt":"docs/adrs/ADR-0001-demo.md"}}}"#,
        )
        .unwrap();

        assert!(validate_adr_directory(tmp.path()).is_empty());
        assert!(validate_manifest_decisions(tmp.path()).is_empty());
    }

    #[test]
    fn reports_missing_principles_docs() {
        let tmp = tempfile::tempdir().unwrap();
        let findings = validate_principles(tmp.path());
        assert_eq!(findings.len(), 1);
        assert!(findings[0].message.contains("README"));
    }
}
