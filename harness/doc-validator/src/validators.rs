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
        let filename = path
            .file_name()
            .map(|name| name.to_string_lossy())
            .unwrap_or_default();
        if ["README.md", "CLAUDE.md", "AGENTS.md"].contains(&filename.as_ref()) {
            continue;
        }
        // Skip files beginning with `_` - by convention these are meta /
        // template / coordination docs (e.g., `_template.md` documents the
        // ADR shape itself, per bead create-harness-app-n48.12). Mirrors the
        // APSS ADR01 spec's note that non-ADR files don't belong in the
        // ADR directory - the underscore prefix is the documented signal
        // for "in this directory but not an ADR record".
        if filename.starts_with('_') {
            continue;
        }
        if !valid_adr_filename(&filename) {
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
            "# ADR Context\n\nADR backlink references like ADR-0001-demo establish traceability.",
        )
        .unwrap();
        fs::write(
            adr_dir.join("AGENTS.md"),
            "# ADR Guidance\n\nAgents should understand ADR- backlink references for decisions.",
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

    #[test]
    fn reports_missing_adr_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let findings = validate_adr_directory(tmp.path());

        assert_eq!(findings.len(), 1);
        assert!(findings[0].message.contains("docs/adrs"));
    }

    #[test]
    fn reports_missing_and_stale_adr_context_files() {
        let tmp = tempfile::tempdir().unwrap();
        let adr_dir = tmp.path().join("docs/adrs");
        fs::create_dir_all(&adr_dir).unwrap();
        fs::write(adr_dir.join("README.md"), "no index").unwrap();
        fs::write(adr_dir.join("CLAUDE.md"), "no guidance").unwrap();

        let findings = validate_adr_directory(tmp.path());
        let messages = findings
            .iter()
            .map(|finding| finding.message.as_str())
            .collect::<Vec<_>>();

        assert!(
            findings
                .iter()
                .any(|finding| finding.path.ends_with("AGENTS.md"))
        );
        assert!(messages.iter().any(|message| message.contains("backlink")));
        assert!(
            messages
                .iter()
                .any(|message| message.contains("Document | Description"))
        );
    }

    #[test]
    fn reports_invalid_adr_files_and_skips_meta_files() {
        let tmp = tempfile::tempdir().unwrap();
        let adr_dir = tmp.path().join("docs/adrs");
        fs::create_dir_all(&adr_dir).unwrap();
        fs::write(
            adr_dir.join("README.md"),
            "## Index\n\n| Document | Description |\n|---|---|\n",
        )
        .unwrap();
        fs::write(adr_dir.join("CLAUDE.md"), "# ADR Context\n\nADR backlink references establish traceability.").unwrap();
        fs::write(adr_dir.join("AGENTS.md"), "# ADR Guidance\n\nAgents should understand ADR- backlink references.").unwrap();
        fs::write(adr_dir.join("_template.md"), "not an ADR").unwrap();
        fs::write(adr_dir.join("notes.txt"), "not markdown").unwrap();
        fs::write(
            adr_dir.join("bad.md"),
            "---\nname: Bad\nstatus: invalid\n---\n\n# Bad\n\n## Context\n",
        )
        .unwrap();
        fs::write(
            adr_dir.join("ADR-0004-no-status.md"),
            "---\nname: No Status\ndescription: Missing status\n---\n\n# ADR-0004: No Status\n\n**Date:** 2026-05-30\n**Category:** Test\n\n## Context\n\n## Decision\n\n## Consequences\n",
        )
        .unwrap();
        fs::create_dir(adr_dir.join("ADR-0002-dir.md")).unwrap();
        fs::write(adr_dir.join("ADR-0003-no-frontmatter.md"), "# Missing").unwrap();

        let findings = validate_adr_directory(tmp.path());
        let joined = findings
            .iter()
            .map(|finding| finding.message.as_str())
            .collect::<Vec<_>>()
            .join("\n");

        assert!(joined.contains("ADR filename"));
        assert!(joined.contains("front matter missing description:"));
        assert!(joined.contains("status invalid"));
        assert!(joined.contains("ADR missing **Date:**"));
        assert!(joined.contains("ADR file is not readable"));
        assert!(joined.contains("ADR missing YAML front matter"));
    }

    #[test]
    fn unreadable_adr_index_returns_without_finding() {
        let tmp = tempfile::tempdir().unwrap();
        let adr_dir = tmp.path().join("docs/adrs");
        fs::create_dir_all(&adr_dir).unwrap();
        fs::create_dir(adr_dir.join("README.md")).unwrap();
        fs::write(adr_dir.join("CLAUDE.md"), "# ADR Context\n\nADR backlink references establish traceability.").unwrap();
        fs::write(adr_dir.join("AGENTS.md"), "# ADR Guidance\n\nAgents should understand ADR- backlink references.").unwrap();

        let findings = validate_adr_directory(tmp.path());

        assert!(
            findings
                .iter()
                .any(|finding| finding.path.ends_with("README.md"))
        );
    }

    #[cfg(unix)]
    #[test]
    fn unreadable_adr_directory_returns_findings_so_far() {
        use std::os::unix::fs::PermissionsExt;

        let tmp = tempfile::tempdir().unwrap();
        let adr_dir = tmp.path().join("docs/adrs");
        fs::create_dir_all(&adr_dir).unwrap();
        fs::write(
            adr_dir.join("README.md"),
            "## Index\n\n| Document | Description |\n|---|---|\n",
        )
        .unwrap();
        fs::write(adr_dir.join("CLAUDE.md"), "# ADR Context\n\nADR backlink references establish traceability.").unwrap();
        fs::write(adr_dir.join("AGENTS.md"), "# ADR Guidance\n\nAgents should understand ADR- backlink references.").unwrap();
        let original = fs::metadata(&adr_dir).unwrap().permissions();
        let mut locked = original.clone();
        locked.set_mode(0o0);
        fs::set_permissions(&adr_dir, locked).unwrap();

        let findings = validate_adr_directory(tmp.path());

        fs::set_permissions(&adr_dir, original).unwrap();
        assert!(findings.len() <= 3);
    }

    #[test]
    fn reports_manifest_shape_errors() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(validate_manifest_decisions(tmp.path()).len(), 1);

        fs::write(tmp.path().join("harness.manifest.json"), "{").unwrap();
        assert_eq!(validate_manifest_decisions(tmp.path()).len(), 1);

        fs::write(tmp.path().join("harness.manifest.json"), "{}").unwrap();
        assert_eq!(validate_manifest_decisions(tmp.path()).len(), 1);

        fs::write(
            tmp.path().join("harness.manifest.json"),
            r#"{"slots":{"demo":{}}}"#,
        )
        .unwrap();
        assert_eq!(validate_manifest_decisions(tmp.path()).len(), 1);
    }

    #[test]
    fn reports_principle_doc_gaps() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("docs/harness-engineering");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("README.md"), "## Scope\n").unwrap();

        let findings = validate_principles(tmp.path());
        let joined = findings
            .iter()
            .map(|finding| finding.message.as_str())
            .collect::<Vec<_>>()
            .join("\n");

        assert!(joined.contains("lab five-principles"));
        assert!(joined.contains("## Actionable"));
        assert!(joined.contains("## References"));
    }

    #[test]
    fn rejects_malformed_adr_filenames() {
        for filename in [
            "ADR-nope.md",
            "ADR-12-short.md",
            "ADR-0001-.md",
            "ADR-0001-Bad.md",
            "ADR-0001-no-extension",
        ] {
            assert!(!valid_adr_filename(filename), "{filename}");
        }
        assert!(valid_adr_filename("ADR-0001-good-title.md"));
    }

    #[test]
    fn parses_frontmatter_only_when_closed() {
        assert_eq!(frontmatter("---\nname: Demo\n"), None);
        assert_eq!(
            frontmatter("---\nname: Demo\n---\nbody").map(str::trim),
            Some("name: Demo")
        );
    }
}
